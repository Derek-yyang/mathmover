# -*- coding: utf-8 -*-
"""
盲评注入（浏览器控制台版）。

生成 math-mover-next/public/review_import.json，作者在 localhost:3000 的
浏览器控制台粘贴一行代码即可导入 localStorage（盲评记录：编号乱序、
title 无判官信息、thumbnail 为题目原图缩略）。

用法:
  .venv/Scripts/python.exe scripts/inject_review.py

校验完成后删除 public/review_import.json 或重跑 --clean。
"""
import argparse
import base64
import json
import random
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CASES_DIR = ROOT / "benchmarks" / "cases"
DEFAULT_REPORT = ROOT / "benchmarks" / "reports" / "l3_20260829_215953.json"
REVIEW_MAP = ROOT / "benchmarks" / "reports" / "review_map.json"
IMPORT_FILE = ROOT / "math-mover-next" / "public" / "review_import.json"
THUMB_MAX = 260


def make_thumb_dataurl(image_path: Path) -> str:
    from PIL import Image
    img = Image.open(image_path).convert("RGB")
    img.thumbnail((THUMB_MAX, THUMB_MAX))
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", default=str(DEFAULT_REPORT))
    ap.add_argument("--clean", action="store_true", help="删除导入文件（校验完成后）")
    args = ap.parse_args()

    if args.clean:
        if IMPORT_FILE.exists():
            IMPORT_FILE.unlink()
            print("已删除", IMPORT_FILE.relative_to(ROOT))
        return

    l3 = json.loads(Path(args.report).read_text(encoding="utf-8"))
    items = []
    for r in l3["results"]:
        case_dir = CASES_DIR / r["case"]
        cand = case_dir / "candidate_commands.txt"
        problem = case_dir / "problem.png"
        if not cand.exists() or not problem.exists():
            print(f"[跳过] {r['case']}: 缺候选或题目图")
            continue
        commands = [ln for ln in cand.read_text(encoding="utf-8").splitlines() if ln.strip()]
        items.append({"case": r["case"], "verdict": r["verdict"],
                      "reason": r["reason"], "commands": commands,
                      "thumb": make_thumb_dataurl(problem)})

    rng = random.Random(20260830)
    rng.shuffle(items)

    records, mapping = [], []
    for i, it in enumerate(items, 1):
        records.append({
            "id": f"review_{i:02d}",
            "title": f"校验 #{i:02d}",
            "problem_type": None,
            "category": None,
            "commands": it["commands"],
            "created_at": datetime(2026, 8, 30, 12, i).isoformat(),
            "thumbnail": it["thumb"],
        })
        mapping.append({"no": f"{i:02d}", "case": it["case"],
                        "judge_verdict": it["verdict"], "judge_reason": it["reason"]})

    IMPORT_FILE.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    REVIEW_MAP.write_text(json.dumps({
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "l3_report": Path(args.report).name,
        "mapping": mapping,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    size_kb = IMPORT_FILE.stat().st_size // 1024
    print(f"导入文件已生成: {IMPORT_FILE.relative_to(ROOT)} ({size_kb} KB, {len(records)} 条)")
    print(f"对照映射（校验完再看）: {REVIEW_MAP.relative_to(ROOT)}")
    print("\n===== 操作步骤 =====")
    print("1. 打开 http://localhost:3000/dashboard")
    print("2. 按 F12 打开控制台，粘贴下面这一行并回车：\n")
    print("fetch('/review_import.json').then(r=>r.json()).then(d=>{localStorage.setItem('mathmover_generations_v1',JSON.stringify(d));location.reload()})\n")
    print("3. 页面刷新后，侧栏出现 25 条「校验 #NN」，逐条点开：")
    print("   左上预览框 = 题目原图，画布 = 真实动图（滑块可拖）")
    print("4. 记录判官判错的编号：重点找「动图明显有问题却判 pass」和")
    print("   「动图其实表达了题意却判 partial/fail」两类，告诉我编号即可。")


if __name__ == "__main__":
    main()
