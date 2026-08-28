# -*- coding: utf-8 -*-
"""
MathMover 基线集工具：解析 GGB 指令为对象清单（IR），并据其判分。

用法:
  python scripts/benchmark.py parse              # 解析全部 golden_commands.txt -> expected_objects.json
  python scripts/benchmark.py selftest           # 每题用金标准自身对照判分（应 26/26 PASS）
  python scripts/benchmark.py score --case DIR --candidate FILE
                                                 # 用候选指令文件对照某案例的期望清单判分

设计约定（与 benchmarks/README.md 一致）:
  - 判分在对象语义层进行（kind + 数值坐标/参数 + 引用名序列），不比对指令顺序/命名风格
  - `MODE:` 行、`#` 注释、空行在清洗阶段剔除；同名重复定义以最后一次为准
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES_DIR = ROOT / "benchmarks" / "cases"

# 已知几何构造器（小写化后作为 kind）
CONSTRUCTORS = {
    "point", "slider", "polygon", "segment", "line", "circle", "ellipse",
    "hyperbola", "parabola", "arc", "midpoint", "intersect", "sphere",
    "cone", "cylinder", "angle", "anglebisector", "perpendicularbisector",
    "perpendicularline", "function", "vector", "text", "tangent", "dilate",
    "translate", "rotate", "reflect", "locus", "pointin",
}

# 对目标对象生效的属性命令（最后一个参数段作为值）
ATTR_COMMANDS = {
    "setfixed", "showlabel", "setlabelmode", "setcolor", "setpointsize",
    "setfilling", "setlinestyle", "setvisibleinview", "setcaption",
    "setvalue", "setthickness",
}
# 全局场景命令（不归属到对象）
GLOBAL_COMMANDS = {"setaxesvisible", "setgridvisible", "zoomin", "zoomout", "centerview"}

FLOAT_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
FUNC_DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*\(([^)]*)\)\s*=\s*(.+)$")
DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*=\s*(.+)$")
CMD_RE = re.compile(r"^([A-Za-z]\w*)\s*\((.*)\)\s*$")


def norm(s: str) -> str:
    """归一化：去所有空白、转小写。用于语义比较。"""
    return re.sub(r"\s+", "", s or "").lower()


def split_top_level(s: str) -> list:
    """按顶层逗号拆分参数（忽略括号/花括号/引号内的逗号）。"""
    parts, depth, cur, in_str = [], 0, "", False
    for ch in s:
        if ch == '"':
            in_str = not in_str
            cur += ch
        elif not in_str and ch in "([{":
            depth += 1
            cur += ch
        elif not in_str and ch in ")]}":
            depth -= 1
            cur += ch
        elif not in_str and ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def try_float(s: str):
    s = s.strip()
    return float(s) if FLOAT_RE.match(s) else None


def parse_coords(parts: list):
    """点坐标：全部可解析为数值则给 numeric，否则保留原文。"""
    raw = [p for p in parts]
    nums = [try_float(p) for p in raw]
    return raw, (nums if all(n is not None for n in nums) else None)


def clean_lines(text: str):
    """剔除 MODE 头、# 注释、空行；返回 (mode, [指令行])。"""
    mode = None
    cmds = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        m = re.match(r"^MODE\s*:\s*(\w+)$", s, re.I)
        if m:
            mode = m.group(1).upper()
            continue
        if s.startswith("#") or s.startswith("//"):
            continue
        cmds.append(s)
    return mode, cmds


def parse_rhs(name: str, rhs: str) -> dict:
    """把定义右端解析为对象 dict（kind + 关键字段）。"""
    rhs_s = rhs.strip()
    # 点: (x, y[, z]) 元组
    if rhs_s.startswith("(") and rhs_s.endswith(")"):
        parts = split_top_level(rhs_s[1:-1])
        if len(parts) in (2, 3):
            raw, numeric = parse_coords(parts)
            return {"kind": "point", "coords": raw,
                    "numeric": numeric, "raw": norm(rhs_s)}
    # 构造器调用
    m = CMD_RE.match(rhs_s)
    if m:
        head = m.group(1).lower()
        args = split_top_level(m.group(2))
        if head == "point":
            # Point({x,y,z}) / Point(x,y) / Point(path[, t])
            inner = m.group(2).strip()
            if inner.startswith("{") and inner.endswith("}"):
                raw, numeric = parse_coords(split_top_level(inner[1:-1]))
                return {"kind": "point", "coords": raw, "numeric": numeric,
                        "raw": norm(rhs_s)}
            if len(args) in (1, 2) and ("(" in inner or "[" in inner or not try_float(args[0])):
                return {"kind": "moving_point", "path": [norm(a) for a in args],
                        "raw": norm(rhs_s)}
            raw, numeric = parse_coords(args)
            return {"kind": "point", "coords": raw, "numeric": numeric,
                    "raw": norm(rhs_s)}
        if head == "slider" and len(args) >= 2:
            nums = [try_float(a) for a in args[:3]]
            return {"kind": "slider", "args": [norm(a) for a in args],
                    "numeric": nums if all(n is not None for n in nums[:2]) else None,
                    "raw": norm(rhs_s)}
        if head == "polygon":
            return {"kind": "polygon", "args": [norm(a) for a in args],
                    "raw": norm(rhs_s)}
        if head in CONSTRUCTORS:
            return {"kind": head, "args": [norm(a) for a in args],
                    "raw": norm(rhs_s)}
    # 函数: 名字(x) = expr 形式已被外层捕获；这里处理 f = ... 或含 = 的表达式
    if "=" in rhs_s:
        return {"kind": "function", "expr": norm(rhs_s), "raw": norm(rhs_s)}
    # 向量/表达式运算（如 P = 2 * D - A）
    return {"kind": "expression", "expr": norm(rhs_s), "raw": norm(rhs_s)}


def parse_commands(text: str) -> dict:
    """解析整份指令文本 -> IR dict。"""
    mode, cmds = clean_lines(text)
    objects = {}   # name -> object dict（保留首次出现顺序）
    order = []
    scene_attrs = {}
    redefinitions = []
    unparsed = []

    for line in cmds:
        # 函数定义 f(x) = expr
        m = FUNC_DEF_RE.match(line)
        if m and m.group(2).strip() in ("x", "t", "a"):
            name = m.group(1)
            obj = {"kind": "function", "expr": norm(m.group(3)), "raw": norm(line), "attrs": {}}
            if name in objects:
                redefinitions.append(name)
            else:
                order.append(name)
            objects[name] = obj
            continue
        # 定义 NAME = rhs
        m = DEF_RE.match(line)
        if m:
            name, rhs = m.group(1), m.group(2)
            obj = parse_rhs(name, rhs)
            obj["attrs"] = {}
            if name in objects:
                redefinitions.append(name)
            else:
                order.append(name)
            objects[name] = obj
            continue
        # 冒号定义式: d: x = -1
        m = re.match(r"^([A-Za-z]\w*)\s*:\s*(.+)$", line)
        if m:
            name, rhs = m.group(1), m.group(2)
            obj = {"kind": "equation", "expr": norm(rhs), "raw": norm(rhs), "attrs": {}}
            if name in objects:
                redefinitions.append(name)
            else:
                order.append(name)
            objects[name] = obj
            continue
        # 属性/全局命令
        m = CMD_RE.match(line)
        if m:
            head = m.group(1).lower()
            args = split_top_level(m.group(2))
            if head in GLOBAL_COMMANDS:
                scene_attrs[head] = [norm(a) for a in args]
                continue
            if head in ATTR_COMMANDS and args:
                target = args[0].strip().strip('"')
                value = [norm(a) for a in args[1:]]
                obj = objects.get(target)
                if obj is None:
                    # 目标未定义（如 xOyPlane 等内建），记为场景级
                    scene_attrs.setdefault(head, []).append(value)
                elif head == "setvisibleinview" and len(value) == 2:
                    obj["attrs"].setdefault("visible_in_view", {})[value[0]] = value[1]
                else:
                    obj["attrs"][head] = value
                continue
        unparsed.append(line)

    return {
        "mode": mode,
        "scene_attrs": scene_attrs,
        "objects": [objects[n] | {"name": n} for n in order],
        "redefinitions": sorted(set(redefinitions)),
        "unparsed": unparsed,
    }


def parse_case(case_dir: Path) -> dict:
    golden = case_dir / "golden_commands.txt"
    if not golden.exists():
        raise FileNotFoundError(golden)
    ir = parse_commands(golden.read_text(encoding="utf-8"))
    ir["case"] = str(case_dir.relative_to(CASES_DIR)).replace("\\", "/")
    return ir


# ---------------- 判分 ----------------

def obj_key(o: dict) -> tuple:
    """对象语义签名：kind + 几何实质（坐标/参数/引用序列）。"""
    k = o.get("kind")
    if k == "point":
        return ("point", tuple(o.get("numeric")) if o.get("numeric")
                else tuple(o.get("coords") or []))
    if k == "slider":
        return ("slider", tuple(o.get("numeric") or o.get("args") or [])[:2])
    if k == "function":
        return ("function", o.get("expr", ""))
    if k == "moving_point":
        return ("moving_point", tuple(o.get("path") or []))
    if k in ("expression",):
        return ("expression", o.get("expr", ""))
    # 其余构造器：kind + 引用名序列
    return (k, tuple(o.get("args") or []))


def match_object(exp: dict, cand_map: dict) -> bool:
    """在候选里找与期望对象语义一致的实例。"""
    key = obj_key(exp)
    for cand in cand_map.values():
        if cand.get("kind") != key[0]:
            continue
        ck = obj_key(cand)
        if key[0] in ("point", "slider") and key[1] and ck[1] and len(key[1]) == len(ck[1]):
            if all(abs(a - b) <= 1e-6 for a, b in zip(key[1], ck[1])
                   if isinstance(a, float) and isinstance(b, float)) and \
               all(a == b for a, b in zip(key[1], ck[1])
                   if not (isinstance(a, float) and isinstance(b, float))):
                return True
            # 数值坐标容差比对
            if key[0] == "point" and key[1] and ck[1] and len(key[1]) == len(ck[1]):
                try:
                    if all(abs(float(a) - float(b)) <= 1e-6 for a, b in zip(key[1], ck[1])):
                        return True
                except (TypeError, ValueError):
                    pass
        elif ck[1] == key[1]:
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

    hygiene = []
    if cand_ir["unparsed"]:
        hygiene.append(f"{len(cand_ir['unparsed'])} 行无法解析: {cand_ir['unparsed'][:3]}")
    texts = [o["name"] for o in cand_ir["objects"] if o["kind"] == "text"]
    if texts:
        hygiene.append(f"存在文字对象: {texts}")

    passed = not missing and not hygiene
    return {
        "case": exp_ir["case"],
        "expected": len(exp_ir["objects"]),
        "matched": len(matched),
        "missing": missing,
        "hygiene": hygiene,
        "pass": passed,
    }


# ---------------- CLI ----------------

def cmd_parse(args):
    cases = sorted(p.parent for p in CASES_DIR.rglob("golden_commands.txt"))
    ok = fail = 0
    for case in cases:
        try:
            ir = parse_case(case)
        except FileNotFoundError:
            print(f"[跳过] {case.relative_to(CASES_DIR)}: 无 golden_commands.txt")
            continue
        out = case / "expected_objects.json"
        out.write_text(json.dumps(ir, ensure_ascii=False, indent=2), encoding="utf-8")
        status = "OK" if not ir["unparsed"] else f"OK(未解析行 {len(ir['unparsed'])})"
        if ir["unparsed"]:
            fail += 1
        else:
            ok += 1
        print(f"[{status}] {ir['case']}: {len(ir['objects'])} 对象, "
              f"重复定义 {ir['redefinitions'] or '无'}, 未解析 {ir['unparsed'] or '无'}")
    print(f"\n完成：{ok + fail} 个案例，完全干净解析 {ok}，含未解析行 {fail}")


def cmd_selftest(args):
    cases = sorted(p.parent for p in CASES_DIR.rglob("golden_commands.txt"))
    total = passed = 0
    for case in cases:
        if not (case / "expected_objects.json").exists():
            continue
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
    candidate = Path(args.candidate)
    text = candidate.read_text(encoding="utf-8")
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
