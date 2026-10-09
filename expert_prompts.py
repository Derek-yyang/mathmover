# -*- coding: utf-8 -*-
"""Assemble expert prompts directly from SKILL.md and its inline SOP references."""
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
_RULES_PATH = _SKILLS_DIR / "shared" / "generation-rules.md"
_SOP_REFERENCE = re.compile(r"^[ \t]*\{\{SOP:([a-z0-9-]+)\}\}[ \t]*$", re.M)
_STEP_BLOCK = re.compile(r"^## ([1-9]\d*)\.[^\n]*\n.*?(?=^## [1-9]\d*\.|\Z)", re.M | re.S)


def _strip_frontmatter(text: str) -> str:
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip("\n")
    return text


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").rstrip()


def _skill_path(category: str) -> Path:
    if category not in CATEGORY_TO_SKILL:
        raise KeyError(f"未知专家类别: {category!r}")
    return _SKILLS_DIR / CATEGORY_TO_SKILL[category] / "SKILL.md"


def _sop_card_path(name: str, category: str) -> Path:
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9-]+", name):
        raise ValueError(f"非法 SOP 名称: {name!r}")
    card = _SOPS_DIR / f"{name}.md"
    if not card.is_file():
        raise FileNotFoundError(f"SOP 卡缺失: {card}（{CATEGORY_TO_SKILL[category]}）")
    return card


def _sop_names(body: str, category: str) -> list[str]:
    """SKILL.md alone defines the card list and insertion order."""
    names = _SOP_REFERENCE.findall(body)
    if not names or "{{SOP" in _SOP_REFERENCE.sub("", body):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置缺失或格式错误；"
                         "应独占一行写 {{SOP:card-name}}")
    if len(names) != len(set(names)):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置重复")
    blocks = list(_STEP_BLOCK.finditer(body))
    steps = [block.group(1) for block in blocks]
    if len(steps) != len(set(steps)):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: 编号步骤重复")
    if set(_SOP_REFERENCE.findall("".join(block.group(0) for block in blocks))) != set(names):
        raise ValueError(f"{CATEGORY_TO_SKILL[category]}: SOP 插入位置必须位于编号步骤")
    return names


@dataclass(frozen=True)
class PromptAssembly:
    text: str
    metadata: dict


def assemble_expert_prompt(category: str) -> PromptAssembly:
    skill = _strip_frontmatter(_read(_skill_path(category)))
    names = _sop_names(skill, category)
    cards = {name: _read(_sop_card_path(name, category)) for name in names}
    if any("{{SOP" in card for card in cards.values()):
        raise ValueError("SOP 卡含嵌套引用；所需写法应在 skill 中直接引用")

    def reference(match):
        # Nest card headings below numbered steps, preserving executable examples.
        return re.sub(r"\A# ", "### ", cards[match.group(1)], count=1)

    inline = _SOP_REFERENCE.sub(reference, skill).strip()
    text = _read(_RULES_PATH) + "\n\n" + inline
    return PromptAssembly(text, {
        "mode": "full", "cards": names, "characters": len(text),
        "skill_characters": len(_SOP_REFERENCE.sub("", skill)),
        "sop_characters": sum(map(len, cards.values())),
    })


def load_expert_prompt(category: str) -> str:
    return assemble_expert_prompt(category).text


def _participating_files(category: str) -> list[Path]:
    skill_path = _skill_path(category)
    names = _sop_names(_strip_frontmatter(_read(skill_path)), category)
    return [skill_path, _RULES_PATH] + [_sop_card_path(name, category) for name in names]


class _ExpertPromptCatalog(Mapping):
    def __init__(self):
        self._cache = {}

    def __getitem__(self, category: str) -> str:
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
