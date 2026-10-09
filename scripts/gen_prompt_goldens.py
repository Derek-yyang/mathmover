# -*- coding: utf-8 -*-
"""从现行 Python 现算并固化四类专家 prompt 的黄金基线（字符数 + SHA-256 + 卡片清单）。

为什么需要这个脚本
------------------
skills/SOP_VALIDATION.md:160 原文写「四类完整装配正文 SHA-256 与本次修改前完全一致，
仍为 8,601 / 7,496 / 9,310 / 10,505 字符」——这句话把哈希与字符数混为一谈。
实测全文件**没有任何 SHA-256 摘要值**，只有字符数。TS 移植若要「逐字节等价」回归，
没有哈希就没有可对拍的基线。

本脚本补上它，并顺手钉死 PromptAssembly.metadata 的三个计数公式
（三者不可互推，逐字段断言，避免移植后"总数对上但内部错位"）：

  characters       = len(text)                        # rules + "\\n\\n" + 内联正文
  skill_characters = len(_SOP_REFERENCE.sub("", skill))   # 去掉 {{SOP:*}} 引用后的 skill
  sop_characters   = sum(len(card) for card in cards)  # 卡片 rstrip 原文之和
                                                       # **不含** H1→H3 每卡 +2 字符的改写增量

用法
----
  python scripts/gen_prompt_goldens.py            # 生成/更新 packages/ggb-core/src/data/prompt-goldens.json
  python scripts/gen_prompt_goldens.py --check    # 只校验，不写文件（CI 用）
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from expert_prompts import (  # noqa: E402
    CATEGORY_TO_SKILL,
    _RULES_PATH,
    _participating_files,
    _read,
    _sop_names,
    _strip_frontmatter,
    assemble_expert_prompt,
)

# skills/SOP_VALIDATION.md:126-129 记录的「完整装配正文」字符数。
# 用于证明本脚本测的与历史验收是同一个东西；对不上就说明测量口径漂了。
SOP_VALIDATION_CHAR_COUNTS = {"A": 8601, "B": 7496, "C": 9310, "D": 10505}

OUT_PATH = ROOT / "packages" / "ggb-core" / "src" / "data" / "prompt-goldens.json"


def _sha256_text(text: str) -> str:
    """哈希 UTF-8 字节。TS 侧用 TextEncoder + crypto.subtle 可逐位对拍。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def build_golden(category: str) -> dict:
    assembly = assemble_expert_prompt(category)
    text = assembly.text
    meta = assembly.metadata

    skill_path = ROOT / "skills" / CATEGORY_TO_SKILL[category] / "SKILL.md"
    skill_body = _strip_frontmatter(_read(skill_path))
    cards = meta["cards"]

    # 参与文件的内容哈希（按参与顺序）。TS 侧缓存失效用内容哈希而非 mtime——
    # Windows 的 mtime 粒度是坑（见实现假设）。
    files = _participating_files(category)
    file_hashes = [
        {"path": str(p.relative_to(ROOT)).replace("\\", "/"), "sha256": _sha256_text(p.read_text(encoding="utf-8"))}
        for p in files
    ]

    # 逐字段钉死 metadata 的三个计数公式
    assert meta["characters"] == len(text), (
        f"{category}: characters 应为 len(text)={len(text)}，实得 {meta['characters']}"
    )
    assert meta["skill_characters"] == _skill_characters_after_ref_strip(skill_path), (
        f"{category}: skill_characters 公式漂移"
    )

    return {
        "category": category,
        "skill": CATEGORY_TO_SKILL[category],
        "cards": cards,
        "card_count": len(cards),
        "text_sha256": _sha256_text(text),
        "text_bytes_utf8": len(text.encode("utf-8")),
        "characters": meta["characters"],
        "skill_characters": meta["skill_characters"],
        "sop_characters": meta["sop_characters"],
        "files": file_hashes,
    }


def _skill_characters_after_ref_strip(skill_path: Path) -> int:
    """skill_characters 的口径：去掉 {{SOP:*}} 引用行后的**长度**（int）。"""
    import re
    from expert_prompts import _SOP_REFERENCE
    skill = _strip_frontmatter(_read(skill_path))
    return len(_SOP_REFERENCE.sub("", skill))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只校验已固化基线，不写文件")
    args = ap.parse_args()

    goldens = []
    failures = []

    for category in ("A", "B", "C", "D"):
        try:
            g = build_golden(category)
        except Exception as e:  # noqa: BLE001
            failures.append(f"{category}: 装配失败 {type(e).__name__}: {e}")
            continue

        expected_chars = SOP_VALIDATION_CHAR_COUNTS[category]
        if g["characters"] != expected_chars:
            failures.append(
                f"{category}: 字符数 {g['characters']} ≠ SOP_VALIDATION 记录的 {expected_chars}"
                f"（测量口径漂移，历史验收失效）"
            )

        goldens.append(g)
        print(
            f"{category} {g['skill']:<26} 卡={g['card_count']:>2}  "
            f"characters={g['characters']:>6}  "
            f"skill={g['skill_characters']:>6}  sop={g['sop_characters']:>6}  "
            f"sha256={g['text_sha256'][:16]}…"
        )

    if failures:
        print("\n[FAIL]")
        for f in failures:
            print("  -", f)
        return 1

    payload = {
        "schema": "mathmover.prompt-goldens/1",
        "generator": "scripts/gen_prompt_goldens.py",
        "source": "expert_prompts.assemble_expert_prompt (Python, 当前实现)",
        "notes": [
            "text_sha256 为 UTF-8 字节哈希；TS 侧用 TextEncoder 后 crypto.subtle.digest 对拍。",
            "characters/skill_characters/sop_characters 三者不可互推，逐字段断言。",
            "sop_characters 是卡片 rstrip 原文之和，不含 H1→H3 每卡 +2 字符的改写增量。",
            "files[].sha256 参与文件内容哈希，用作 TS 侧缓存失效键（不用 mtime）。",
            "本基线**锁定现行行为**，含已知缺陷（如 'A := (0,0)' 的 COLON_DEF 误判）；",
            "修复缺陷须同时更新本基线并另立变更，避免同一输入两套预期。",
        ],
        "goldens": goldens,
    }

    if args.check:
        if not OUT_PATH.is_file():
            print(f"[FAIL] 基线文件缺失: {OUT_PATH}")
            return 1
        existing = json.loads(OUT_PATH.read_text(encoding="utf-8"))
        if existing.get("goldens") != goldens:
            print(f"[FAIL] 与已固化基线不一致: {OUT_PATH}")
            print("       若是有意变更，请去掉 --check 重新生成并另立变更说明。")
            return 1
        print(f"\n[OK] 四类基线与 {OUT_PATH.relative_to(ROOT)} 一致")
        return 0

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n[OK] 已固化 {len(goldens)} 类基线 → {OUT_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
