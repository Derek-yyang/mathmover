# -*- coding: utf-8 -*-
"""Complete expert guidance with question-specific GGB syntax references.

SKILL.md defines numbered drawing steps and {{SOP:name}} insertion points.
Selected cards expand at those points; unselected references disappear while
the complete workflow remains. Cross-category extras are appended separately.
Selection metadata lives in a separate index. EXPERT_PROMPTS stays compatible.
"""
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

_SKILLS_DIR = Path(__file__).resolve().parent / "skills"
CATEGORY_TO_SKILL = {
    "A": "function-expert", "B": "planar-geometry-expert",
    "C": "conic-expert", "D": "solid-geometry-expert",
}
_SOPS_DIR = _SKILLS_DIR / "shared" / "sops"
_INDEX_PATH = _SKILLS_DIR / "shared" / "sop-index.json"
_RULES_PATH = _SKILLS_DIR / "shared" / "generation-rules.md"
_PITFALLS_PATH = _SKILLS_DIR / "shared" / "ggb-pitfalls.md"
_SOP_REFERENCE = re.compile(r"^[ \t]*\{\{SOP:([a-z0-9-]+)\}\}[ \t]*$", re.M)


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip("\n")
    return text


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").rstrip()


def _sop_card_path(name: str, category: str) -> Path:
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9-]+", name):
        raise ValueError(f"非法 SOP 名称: {name!r}")
    card = _SOPS_DIR / f"{name}.md"
    if not card.is_file():
        raise FileNotFoundError(f"SOP 卡缺失: {card}（{CATEGORY_TO_SKILL[category]}）")
    return card


def _sop_names(body: str, category: str) -> list[str]:
    """Insertion points must be unique standalone lines, outside frontmatter."""
    names = _SOP_REFERENCE.findall(body)
    if not names or "{{SOP" in _SOP_REFERENCE.sub("", body):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置缺失或格式错误；"
                         "应独占一行写 {{SOP:card-name}}")
    if len(names) != len(set(names)):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置重复")
    return names


def resolve_sops(category: str, requested: list[str], index: dict) -> list[str]:
    """Add common syntax and hard prerequisites, then stable-order cards."""
    if category not in CATEGORY_TO_SKILL:
        raise KeyError(category)
    view = "3D" if category == "D" else "2D"
    selected = set()
    def add(name):
        if not isinstance(name, str) or name not in index["cards"]:
            raise ValueError(f"未知 SOP: {name!r}")
        if view not in index["cards"][name]["views"]:
            raise ValueError(f"{name}: 不适用于 {view}")
        if name in selected:
            return
        selected.add(name)
        for dep in index["cards"][name].get("requires", []):
            add(dep)
    for name in index["always"] + requested:
        add(name)
    return [name for name in index["cards"] if name in selected]


def load_sop_index() -> dict:
    """Author-owned source errors fail loudly, separate from router errors."""
    index = json.loads(_read(_INDEX_PATH))
    cards = index["cards"]
    if not cards or set(index["categories"]) != set(CATEGORY_TO_SKILL):
        raise ValueError("SOP 索引必须覆盖四类专家及全部卡片")
    if set(cards) != {p.stem for p in _SOPS_DIR.glob("*.md")}:
        raise ValueError("SOP 索引与卡片文件不一致")
    for name, spec in cards.items():
        _sop_card_path(name, "A")
        if not spec["summary"] or spec["views"] not in (["2D"], ["3D"], ["2D", "3D"]):
            raise ValueError(f"{name}: 缺少说明或视图无效")
        if not isinstance(spec.get("requires", []), list):
            raise ValueError(f"{name}: requires 必须是列表")
        if any(dep not in cards for dep in spec.get("requires", [])):
            raise ValueError(f"{name}: 依赖不存在")
    def visit(name, stack):
        if name in stack:
            raise ValueError(f"SOP 依赖循环: {' -> '.join(stack + [name])}")
        for dep in cards[name].get("requires", []):
            visit(dep, stack + [name])
    for name in cards:
        visit(name, [])
    used = set()
    for category, names in index["categories"].items():
        if not isinstance(names, list) or not names or len(set(names)) != len(names):
            raise ValueError(f"{category}: 完整卡片集无效")
        if set(resolve_sops(category, names, index)) != set(names):
            raise ValueError(f"{category}: 完整卡片集缺少常驻卡或依赖")
        used.update(names)
    if used != set(cards):
        raise ValueError("存在未被任何专家使用的 SOP")
    return index


def router_sop_catalog() -> str:
    """Short capability index, never SOP bodies or expert guidance."""
    index = load_sop_index()
    return "\n".join(
        f"{name}: {spec['summary']}"
        + ("（仅3D）" if spec["views"] == ["3D"] else "")
        for name, spec in index["cards"].items() if name not in index["always"])


def parse_sop_selection(raw: str, category: str) -> tuple:
    """Only trust a structured selection tied to the final category."""
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip()).strip()
    try:
        data = json.loads(clean)
    except (ValueError, TypeError):
        return None, "router_not_json"
    if not isinstance(data, dict) or str(data.get("category", "")).strip().upper() != category:
        return None, "router_category_mismatch"
    if data.get("sop_uncertain") is not False:
        return None, "router_uncertain_or_legacy"
    names = data.get("sops")
    if not isinstance(names, list) or not names or any(not isinstance(n, str) for n in names):
        return None, "router_invalid_selection"
    return list(dict.fromkeys(names)), "router_selected"


@dataclass(frozen=True)
class PromptAssembly:
    text: str
    metadata: dict


def assemble_expert_prompt(category: str, router_output: str = "") -> PromptAssembly:
    if category not in CATEGORY_TO_SKILL:
        raise KeyError(f"未知专家类别: {category!r}")
    index = load_sop_index()
    requested, reason = parse_sop_selection(router_output, category)
    mode = "selected"
    if requested is not None:
        try:
            names = resolve_sops(category, requested, index)
        except ValueError:
            requested, reason = None, "router_unknown_or_incompatible_card"
    if requested is None:
        mode = "full"
        names = resolve_sops(category, index["categories"][category], index)
    skill = _strip_frontmatter(_read(_SKILLS_DIR / CATEGORY_TO_SKILL[category] / "SKILL.md"))
    locations = _sop_names(skill, category)
    # Validate author references even when the router has not selected them.
    resolve_sops(category, locations, index)
    cards = {name: _read(_sop_card_path(name, category)) for name in names}
    if any("{{SOP" in card for card in cards.values()):
        raise ValueError("SOP 卡含嵌套引用；依赖应写入独立索引")
    rules, pitfalls = _read(_RULES_PATH), _read(_PITFALLS_PATH)

    def reference(name):
        # Nest card headings below numbered step headings, preserving ggb blocks.
        return re.sub(r"\A# ", "### ", cards[name], count=1)

    inline = _SOP_REFERENCE.sub(
        lambda match: reference(match.group(1)) if match.group(1) in cards else "", skill)
    inline = re.sub(r"\n{3,}", "\n\n", inline).strip()
    extras = [name for name in names if name not in locations]
    parts = [rules, inline]
    if extras:
        parts.append("## 补充写法参考\n\n以下卡片用于本题额外涉及的构造，"
                     "按已有步骤的对象依赖使用。\n\n"
                     + "\n\n".join(reference(name) for name in extras))
    parts.append(pitfalls)
    text = "\n\n".join(parts)
    return PromptAssembly(text, {
        "mode": mode, "reason": reason, "requested": requested, "cards": names,
        "inline_cards": [name for name in locations if name in cards], "extra_cards": extras,
        "characters": len(text), "skill_characters": len(_SOP_REFERENCE.sub("", skill)),
        "sop_characters": sum(map(len, cards.values())),
    })


def load_expert_prompt(category: str) -> str:
    return assemble_expert_prompt(category).text


def _participating_files(category: str) -> list[Path]:
    index = load_sop_index()
    names = resolve_sops(category, index["categories"][category], index)
    return [_SKILLS_DIR / CATEGORY_TO_SKILL[category] / "SKILL.md",
            _INDEX_PATH, _RULES_PATH, _PITFALLS_PATH] + [
                _sop_card_path(name, category) for name in names]


class _ExpertPromptCatalog(Mapping):
    def __init__(self):
        self._cache = {}

    def __getitem__(self, category: str) -> str:
        if category not in CATEGORY_TO_SKILL:
            raise KeyError(category)
        stamp = tuple((p, p.stat().st_mtime_ns) for p in _participating_files(category))
        cached = self._cache.get(category)
        if cached is not None and cached[0] == stamp:
            return cached[1]
        text = load_expert_prompt(category)
        self._cache[category] = (stamp, text)
        return text

    def __iter__(self):
        return iter(CATEGORY_TO_SKILL)

    def __len__(self):
        return len(CATEGORY_TO_SKILL)

    def __contains__(self, category):
        return category in CATEGORY_TO_SKILL


EXPERT_PROMPTS = _ExpertPromptCatalog()
