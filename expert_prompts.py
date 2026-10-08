# -*- coding: utf-8 -*-
"""
专家 prompt v4.2：SOP 库装配器（inline 占位符版）。

每个专家 prompt 由「SKILL.md 正文（内嵌 {{SOP:name}} 占位符）+ 坑手册」装配而成。
SOP 模式卡片存于 shared/sops/（跨类别复用的局部画图模式库，每张卡 =
触发条件 + 标准指令片段 + 变体/注意点）；skill 与库的关系是 import：
SKILL.md 正文写 {{SOP:name}} 引用行，装配时从库中取卡**原位展开**——
skill 存的只是引用，卡片内容永远只有库中一份，改卡即全引用方同步。

装配顺序（每次访问按文件当前内容读取并缓存 mtime——改任何来源文件立即生效）：
  1. SKILL.md 正文（剥掉 YAML frontmatter），逐个 {{SOP:name}} 原位替换为卡片全文
  2. skills/shared/ggb-pitfalls.md——GeoGebra 实证坑手册（四个 skill 共用，追加在尾部）

四个专家已统一使用 inline 引用，不再读取已删除的 references/sops.md。
缺失、拼错或嵌套的引用会带专家上下文报错，不静默遗漏卡片。

类别映射（Router 输出 -> skill 目录）：
  A -> function-expert        函数与图像
  B -> planar-geometry-expert 平面几何
  C -> conic-expert           解析几何/圆锥曲线
  D -> solid-geometry-expert  立体几何

对外接口与 v2/v3/v4 完全兼容：EXPERT_PROMPTS[category] 返回完整专家 prompt，
支持 in / keys() 等字典式只读操作（app.py 的 PROMPT_MAP 直接指向它）。
"""

import re
from collections.abc import Mapping
from pathlib import Path

_SKILLS_DIR = Path(__file__).resolve().parent / "skills"

CATEGORY_TO_SKILL = {
    "A": "function-expert",
    "B": "planar-geometry-expert",
    "C": "conic-expert",
    "D": "solid-geometry-expert",
}

_SOPS_DIR = _SKILLS_DIR / "shared" / "sops"
_PITFALLS_PATH = _SKILLS_DIR / "shared" / "ggb-pitfalls.md"

_SOP_PLACEHOLDER = re.compile(r"\{\{SOP:([A-Za-z0-9_-]+)\}\}")


def _strip_frontmatter(text: str) -> str:
    """剥掉 SKILL.md 头部的 YAML frontmatter（--- ... ---），返回正文。"""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip("\n")
    return text


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").rstrip()


def _sop_names(body: str, category: str) -> list[str]:
    """装配与缓存使用同一份去掉 frontmatter 的正文及引用规则。"""
    names = _SOP_PLACEHOLDER.findall(body)
    if "{{SOP" in _SOP_PLACEHOLDER.sub("", body) or not names:
        raise ValueError(
            f"{CATEGORY_TO_SKILL[category]} 的 SOP 引用缺失或格式错误；"
            "应使用 {{SOP:card-name}}，且至少引用一张卡。")
    return names


def _sop_card_path(name: str, category: str) -> Path:
    """解析卡名 -> 库文件路径；缺失时带上下文报错（fail-loudly）。"""
    card = _SOPS_DIR / f"{name}.md"
    if not card.is_file():
        raise FileNotFoundError(
            f"SOP 卡缺失: {card}（{CATEGORY_TO_SKILL[category]} 引用了 {name!r}，"
            f"现有卡片: {sorted(p.stem for p in _SOPS_DIR.glob('*.md'))}）")
    return card


def load_expert_prompt(category: str) -> str:
    """装配完整专家 prompt。

    SKILL.md 中的 {{SOP:name}} 原位展开为卡片全文，以坑手册收尾。
    """
    if category not in CATEGORY_TO_SKILL:
        raise KeyError(f"未知专家类别: {category!r}（应为 A/B/C/D）")
    base = _SKILLS_DIR / CATEGORY_TO_SKILL[category]
    skill_body = _strip_frontmatter(_read(base / "SKILL.md"))

    _sop_names(skill_body, category)

    def _expand(m: re.Match) -> str:
        card_body = _read(_sop_card_path(m.group(1), category))
        if "{{SOP" in card_body:
            raise ValueError(f"SOP 卡 {m.group(1)!r} 含嵌套引用；请在专家 SKILL.md 显式引用依赖。")
        return card_body

    body = _SOP_PLACEHOLDER.sub(_expand, skill_body)

    pitfalls = _read(_PITFALLS_PATH)
    return "\n\n".join([body, pitfalls])


def _participating_files(category: str) -> list[Path]:
    """列出装配该类别 prompt 时读取的全部文件（用于 mtime 缓存 stamp）。"""
    base = _SKILLS_DIR / CATEGORY_TO_SKILL[category]
    files = [base / "SKILL.md"]
    text = _strip_frontmatter(_read(base / "SKILL.md"))
    names = _sop_names(text, category)
    files.extend(_sop_card_path(n, category) for n in dict.fromkeys(names))
    files.append(_PITFALLS_PATH)
    return files


class _ExpertPromptCatalog(Mapping):
    """字典式只读视图：__getitem__ 每次按 mtime 缓存装配，改 skill/SOP 文件免重启生效。

    缓存 stamp 覆盖全部参与装配的文件——SKILL.md、被 {{SOP:}} 引用的每张卡
    、坑手册——任何一处变动都会触发重装。
    """

    def __init__(self):
        self._cache = {}  # category -> (stamp, text)

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
