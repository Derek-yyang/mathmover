# -*- coding: utf-8 -*-
"""
专家 prompt v4：SOP 库装配器。

每个专家 prompt 由「SKILL.md 正文 + SOP 模式卡片 + 坑手册」装配而成。
SOP 卡片存于 shared/sops/（跨类别复用的局部画图模式库，每张卡 =
触发条件 + 标准指令片段 + 变体/注意点），各 skill 通过 references/sops.md
声明本类别 import 哪些卡、按什么顺序——改库/改清单均无需重启后端。

装配顺序（每次访问按文件当前内容读取并缓存 mtime——改任何来源文件立即生效）：
  1. SKILL.md 正文（剥掉 YAML frontmatter）——专家定位 + 标准骨架
  2. shared/sops/ 各卡正文——按 references/sops.md 清单顺序逐一拼接
  3. skills/shared/ggb-pitfalls.md——GeoGebra 实证坑手册（四个 skill 共用）

类别映射（Router 输出 -> skill 目录）：
  A -> function-expert        函数与图像
  B -> planar-geometry-expert 平面几何
  C -> conic-expert           解析几何/圆锥曲线
  D -> solid-geometry-expert  立体几何

对外接口与 v2/v3 完全兼容：EXPERT_PROMPTS[category] 返回完整专家 prompt，
支持 in / keys() 等字典式只读操作（app.py 的 PROMPT_MAP 直接指向它）。
"""

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


def _strip_frontmatter(text: str) -> str:
    """剥掉 SKILL.md 头部的 YAML frontmatter（--- ... ---），返回正文。"""
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            return text[end + 4:].lstrip("\n")
    return text


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8").rstrip()


def parse_sop_manifest(path: Path) -> list[str]:
    """解析 sops.md import 清单：`#` 注释与空行跳过，其余行 = SOP 卡名。

    卡名同时接受 `locus` 与 `locus.md` 两种写法；返回去重后的有序列表。
    """
    names: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        name = line.strip()
        if not name or name.startswith("#"):
            continue
        name = name.split()[0]  # 允许行尾注释：`locus  # 轨迹显式化`
        if name.startswith("#"):
            continue
        if name.endswith(".md"):
            name = name[:-3]  # 显式剥离后缀（rstrip('.md') 会把结尾的 d 也啃掉）
        if name not in names:
            names.append(name)
    return names


def load_expert_prompt(category: str) -> str:
    """按类别装配完整专家 prompt：SKILL.md 正文 + SOP 卡（清单序）+ 坑手册。"""
    if category not in CATEGORY_TO_SKILL:
        raise KeyError(f"未知专家类别: {category!r}（应为 A/B/C/D）")
    base = _SKILLS_DIR / CATEGORY_TO_SKILL[category]
    skill_body = _strip_frontmatter(_read(base / "SKILL.md"))

    manifest = parse_sop_manifest(base / "references" / "sops.md")
    sop_sections = []
    for name in manifest:
        card = _SOPS_DIR / f"{name}.md"
        if not card.is_file():
            raise FileNotFoundError(
                f"SOP 卡缺失: {card}（{CATEGORY_TO_SKILL[category]} 的 sops.md 引用了它，"
                f"现有卡片: {sorted(p.stem for p in _SOPS_DIR.glob('*.md'))}）")
        sop_sections.append(_read(card))

    pitfalls = _read(_PITFALLS_PATH)
    return "\n\n".join([skill_body, *sop_sections, pitfalls])


class _ExpertPromptCatalog(Mapping):
    """字典式只读视图：__getitem__ 每次按 mtime 缓存装配，改 skill/SOP 文件免重启生效。

    缓存 stamp 覆盖全部参与装配的文件（SKILL.md、sops.md 清单、被 import 的每张卡、
    坑手册）——任何一处变动都会触发重装。
    """

    def __init__(self):
        self._cache = {}  # category -> (stamp, text)

    def __getitem__(self, category: str) -> str:
        if category not in CATEGORY_TO_SKILL:
            raise KeyError(category)
        base = _SKILLS_DIR / CATEGORY_TO_SKILL[category]
        manifest_path = base / "references" / "sops.md"
        files = [base / "SKILL.md", manifest_path]
        try:
            names = parse_sop_manifest(manifest_path)
        except OSError:
            names = []
        files.extend(_SOPS_DIR / f"{n}.md" for n in names)
        files.append(_PITFALLS_PATH)
        stamp = tuple((p, p.stat().st_mtime_ns) for p in files)
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
