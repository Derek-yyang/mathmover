# -*- coding: utf-8 -*-
"""
MathMover 基线集工具：解析金标准为对象清单（IR），并据其判分。

解析核心在根目录 ggb_parser.py（与线上校验层共用同一实现）。

用法:
  python scripts/benchmark.py parse              # 解析全部 golden_commands.txt -> expected_objects.json
  python scripts/benchmark.py selftest           # 每题用金标准自身对照判分（应全 PASS）
  python scripts/benchmark.py score --case DIR --candidate FILE
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ggb_parser import parse_commands, try_float  # noqa: E402

CASES_DIR = ROOT / "benchmarks" / "cases"


def parse_case(case_dir: Path) -> dict:
    golden = case_dir / "golden_commands.txt"
    if not golden.exists():
        raise FileNotFoundError(golden)
    ir = parse_commands(golden.read_text(encoding="utf-8"))
    ir["case"] = str(case_dir.relative_to(CASES_DIR)).replace("\\", "/")
    return ir


# ---------------- 判分 ----------------

# 参数可交换的构造器：Line(A,B) 与 Line(B,A) 语义相同
SYMMETRIC_ARG_KINDS = {
    "line", "segment", "intersect", "circle", "midpoint", "angle",
    "anglebisector", "perpendicularbisector", "perpendicularline",
    "tangent", "sphere",
}


def norm_math(s: str) -> str:
    """数学表达式归一化：去空格小写 + 补隐式乘号（2t → 2*t）。"""
    s = re.sub(r"\s+", "", s or "").lower()
    s = re.sub(r"(?<=[0-9])(?=[a-z(])", "*", s)
    s = re.sub(r"(?<=\))(?=[0-9a-z(])", "*", s)
    return s


def _coord_val(c):
    """坐标统一键：数值 → ("num", v)，表达式/引用 → ("str", 归一化串)。"""
    try:
        return ("num", round(float(c), 9))
    except (TypeError, ValueError):
        return ("str", norm_math(str(c)))


def _close_pair(a, b) -> bool:
    if a[0] == "num" and b[0] == "num":
        return abs(a[1] - b[1]) <= 1e-6
    return a == b


def obj_key(o: dict) -> tuple:
    """对象语义签名：kind + 几何实质（坐标/参数/引用序列）。"""
    k = o.get("kind")
    if k == "point":
        vals = o.get("numeric") or (o.get("coords") or [])
        return ("point", tuple(_coord_val(v) for v in vals))
    if k == "slider":
        raw_args = o.get("args") or []
        vals = o.get("numeric") or [try_float(a) for a in raw_args[:2]]
        vals = (vals or [])[:2]  # 只比区间，步长是表现细节
        if vals:
            return ("slider", tuple(("num", round(v, 9)) if v is not None else ("str", a)
                                    for v, a in zip(vals, raw_args)))
        return ("slider", ())
    if k == "function" and o.get("expr") is not None:
        return ("function", norm_math(o["expr"]))
    if k == "equation":
        return ("equation", norm_math(o.get("expr", "")))
    if k == "moving_point":
        return ("moving_point", tuple(sorted(norm_math(p) for p in (o.get("path") or []))))
    if k == "expression":
        return ("expression", norm_math(o.get("expr", "")))
    args = tuple(o.get("args") or [])
    if k in SYMMETRIC_ARG_KINDS:
        args = tuple(sorted(args))
    return (k, args)


def match_object(exp: dict, cand_map: dict) -> bool:
    """在候选里找与期望对象语义一致的实例。"""
    kind, key = obj_key(exp)
    for cand in cand_map.values():
        cand_kind, cand_key = obj_key(cand)
        if cand_kind != kind or not key or not cand_key or len(key) != len(cand_key):
            continue
        if kind in ("point", "slider"):
            if all(_close_pair(a, b) for a, b in zip(key, cand_key)):
                return True
        elif key == cand_key:
            return True
    return False


def score_case(case_dir: Path, candidate_text: str) -> dict:
    exp_ir = parse_case(case_dir)
    cand_ir = parse_commands(candidate_text)
    cand_map = {o["name"]: o for o in cand_ir["objects"]}

    missing, matched = [], []
    for obj in exp_ir["objects"]:
        if match_object(obj, cand_map):
            matched.append(obj["name"])
        else:
            missing.append(obj["name"])

    warnings = []
    if cand_ir["unparsed"]:
        warnings.append(f"{len(cand_ir['unparsed'])} 行无法解析: {cand_ir['unparsed'][:3]}")
    hygiene = []
    texts = [o["name"] for o in cand_ir["objects"] if o["kind"] == "text"]
    if texts:
        hygiene.append(f"存在文字对象: {texts}")

    return {
        "case": exp_ir["case"],
        "expected": len(exp_ir["objects"]),
        "matched": len(matched),
        "missing": missing,
        "hygiene": hygiene,
        "warnings": warnings,
        "pass": not missing and not hygiene,
    }


# ---------------- CLI ----------------

def cmd_parse(args):
    cases = sorted(p.parent for p in CASES_DIR.rglob("golden_commands.txt"))
    ok = warn = 0
    for case in cases:
        try:
            ir = parse_case(case)
        except FileNotFoundError:
            print(f"[跳过] {case.relative_to(CASES_DIR)}: 无 golden_commands.txt")
            continue
        (case / "expected_objects.json").write_text(
            json.dumps(ir, ensure_ascii=False, indent=2), encoding="utf-8")
        if ir["unparsed"]:
            warn += 1
            print(f"[OK(未解析 {len(ir['unparsed'])})] {ir['case']}: {ir['unparsed']}")
        else:
            ok += 1
            print(f"[OK] {ir['case']}: {len(ir['objects'])} 对象, "
                  f"有效率 {ir['stats']['validity']}")
    print(f"\n完成：{ok + warn} 个案例，干净 {ok}，含未解析行 {warn}")


def cmd_selftest(args):
    cases = sorted(p.parent for p in CASES_DIR.rglob("expected_objects.json"))
    total = passed = 0
    for case in cases:
        golden = (case / "golden_commands.txt").read_text(encoding="utf-8")
        result = score_case(case, golden)
        total += 1
        if result["pass"]:
            passed += 1
            print(f"[PASS] {result['case']}: {result['matched']}/{result['expected']}")
        else:
            print(f"[FAIL] {result['case']}: 缺失 {result['missing']}, 卫生 {result['hygiene']}")
    print(f"\n自测：{passed}/{total} PASS" + (" —— 工具链自洽" if passed == total else " —— 需修解析器！"))
    return 0 if passed == total else 1


def cmd_score(args):
    case_dir = Path(args.case)
    if not case_dir.is_absolute():
        case_dir = ROOT / case_dir
    text = Path(args.candidate).read_text(encoding="utf-8")
    result = score_case(case_dir, text)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["pass"] else 1


def main():
    ap = argparse.ArgumentParser(description="MathMover 基线解析与判分工具")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("parse", help="解析全部金标准 -> expected_objects.json")
    sub.add_parser("selftest", help="金标准自对照判分（应全 PASS）")
    sc = sub.add_parser("score", help="候选指令对照某案例判分")
    sc.add_argument("--case", required=True, help="案例目录，如 benchmarks/cases/初中/A-二次函数1")
    sc.add_argument("--candidate", required=True, help="候选指令文件路径")
    args = ap.parse_args()
    if args.cmd == "parse":
        cmd_parse(args)
    elif args.cmd == "selftest":
        sys.exit(cmd_selftest(args))
    elif args.cmd == "score":
        sys.exit(cmd_score(args))


if __name__ == "__main__":
    main()
