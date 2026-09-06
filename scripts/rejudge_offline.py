# -*- coding: utf-8 -*-
"""离线重判：对 cases 下已有候选指令按当前性质清单跑一遍 L2 判分（不调任何 API）。

默认判 candidate_commands.txt；--archive candidate_hy3_r1.txt 改判指定归档候选。
"""
import argparse
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.properties import evaluate_properties, CASES_DIR

def main():
    ap = argparse.ArgumentParser(description="离线 L2 重判")
    ap.add_argument("--archive", help="判指定归档候选文件名，如 candidate_hy3_r1.txt")
    args = ap.parse_args()
    fname = args.archive or "candidate_commands.txt"
    cases = sorted(p.parent for p in CASES_DIR.rglob("problem.png"))
    npass = ndone = prop_hit = prop_total = 0
    fails, skips, missing = [], [], []
    for case in cases:
        name = str(case.relative_to(CASES_DIR)).replace("\\", "/")
        cand = case / fname
        if not cand.exists():
            missing.append(name)
            continue
        text = cand.read_text(encoding="utf-8")
        r = evaluate_properties(case, text)
        if r.get("skip"):
            skips.append(name)
            continue
        ndone += 1
        total = r.get("total", 0)
        hit = total - len(r.get("failed", []))
        prop_hit += hit
        prop_total += total
        if r["pass"]:
            npass += 1
        else:
            fails.append((name, [f["type"] for f in r.get("failed", [])]))
    print(f"完成 {ndone} | PASS {npass} ({npass/ndone:.0%}) | 性质命中 {prop_hit}/{prop_total} ({prop_hit/prop_total:.1%})")
    if skips: print("skip:", skips)
    if missing: print("缺候选:", missing)
    for name, types in fails:
        print("FAIL", name, types)

if __name__ == "__main__":
    main()
