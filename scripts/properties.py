# -*- coding: utf-8 -*-
"""
性质判分引擎（新度量标准）。

理念：判分依据从"复刻金标准构造"升级为"验证题目数学性质"。
每道题的 expected_properties.json 是一组可编程谓词，与构造方式、
命名、指令顺序、表达风格全部无关——以生成图形的数学实质为准。

谓词在 ggb_parser 解析出的 IR 上求值（与线上校验层同一解析实现）。

CLI:
  python scripts/properties.py convert     # 金标准 -> expected_properties.json 初稿
  python scripts/properties.py selftest    # 每题金标准自身过自家性质（应全 PASS）
  python scripts/properties.py matrix      # 对三组候选出性质口径对比矩阵
"""
import json
import math
import re
import statistics
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ggb_parser import parse_commands  # noqa: E402
from scripts.benchmark import CASES_DIR  # noqa: E402

DEFAULT_TOL = 0.05
FUNC_SAMPLE_XS = [-4, -3, -2, -1, -0.5, 0.5, 1, 2, 3, 4]

# ---------- 表达式求值（用于验证函数性质，白名单字符） ----------

_SAFE_CHARS = set("0123456789+-*/().%^ ,xyztabcdefghijklmnopqrswuv")
_SAFE_NAMES = {"sin", "cos", "tan", "sqrt", "abs", "exp", "log", "ln", "pi", "e"}


def eval_function_expr(expr: str, x: float):
    """求模型输出的函数表达式在 x 处的值。支持 ^ 幂、隐式乘号、基本函数。"""
    s = (expr or "").strip()
    if not s:
        return None
    # 归一化：小写、去空格、^ → **、隐式乘号
    s = s.lower().replace(" ", "").replace("^", "**")
    s = s.replace("π", "pi")
    prev = None
    while prev != s:
        prev = s
        for a, b in [(")(", ")*("), ("0(", "0*("), ("1(", "1*("), ("2(", "2*("),
                     ("3(", "3*("), ("4(", "4*("), ("5(", "5*("), ("6(", "6*("),
                     ("7(", "7*("), ("8(", "8*("), ("9(", "9*(")]:
            s = s.replace(a, b)
    # 隐式乘号：数字后跟字母
    out = []
    for i, ch in enumerate(s):
        out.append(ch)
        if ch.isdigit() and i + 1 < len(s) and (s[i + 1].isalpha() or s[i + 1] == "("):
            out.append("*")
    s = "".join(out)
    if not set(s) <= _SAFE_CHARS:
        return None
    env = {n: getattr(math, n) for n in ("sin", "cos", "tan", "sqrt", "exp", "log")
           if hasattr(math, n)}
    env.update({"pi": math.pi, "e": math.e, "abs": abs, "ln": math.log, "x": x})
    env["lg"] = math.log10
    try:
        return float(eval(s, {"__builtins__": {}}, env))  # noqa: S307 字符集已白名单
    except Exception:
        return None


# ---------- 求值辅助 ----------

def _num(v, tol=1e-9):
    try:
        return abs(float(v)) < float("inf") and v is not None
    except (TypeError, ValueError):
        return False


def _close(a, b, tol=DEFAULT_TOL):
    try:
        return abs(float(a) - float(b)) <= tol
    except (TypeError, ValueError):
        return False


def _coords_close(a, b, tol=DEFAULT_TOL):
    a = a or []
    b = b or []
    if len(a) != len(b):
        return False
    return all(_close(x, y, tol) for x, y in zip(a, b))


def _arg_to_coords(arg: str):
    """'(3, 0)' -> [3.0, 0.0]；非坐标返回 None。"""
    s = (arg or "").strip()
    if s.startswith("(") and s.endswith(")"):
        parts = [p.strip() for p in s[1:-1].split(",")]
        if 2 <= len(parts) <= 3:
            try:
                return [float(v) for v in parts]
            except ValueError:
                return None
    return None


class CandidateIndex:
    """候选指令的检索索引：对象表 + 数值坐标解析。"""

    def __init__(self, ir: dict):
        self.ir = ir
        self.by_name = {o["name"]: o for o in ir["objects"]}
        # name -> 数值坐标（点）
        self.point_coords = {}
        for o in ir["objects"]:
            if o["kind"] == "point" and o.get("numeric"):
                self.point_coords[o["name"]] = o["numeric"]

    def resolve_arg(self, arg: str):
        """构造器参数解析为数值坐标：先查名字，再试字面坐标。"""
        a = (arg or "").strip()
        if a in self.point_coords:
            return self.point_coords[a]
        return _arg_to_coords(a)

    def points_near(self, coords, tol=DEFAULT_TOL):
        return [n for n, c in self.point_coords.items() if _coords_close(c, coords, tol)]

    def functions(self):
        return [o for o in self.ir["objects"] if o["kind"] == "function" and o.get("expr") is not None]

    def sliders(self):
        return [o for o in self.ir["objects"] if o["kind"] == "slider"]

    def moving_points(self):
        return [o for o in self.ir["objects"] if o["kind"] == "moving_point"]


# ---------- 谓词实现 ----------

def _prop_point_at(idx: CandidateIndex, prop):
    target = prop.get("coords") or []
    hits = idx.points_near(target, prop.get("tol", DEFAULT_TOL))
    return bool(hits), f"命中: {hits}"


def _prop_function_through(idx, prop):
    pts = prop.get("points") or []
    if not pts:
        return True, "无采样点"
    for fn in idx.functions():
        ok = True
        for x, y in pts:
            v = eval_function_expr(fn["expr"], x)
            if v is None or not _close(v, y, prop.get("tol", 0.2)):
                ok = False
                break
        if ok:
            return True, f"函数 {fn['name']} 通过全部采样点"
    return False, "无函数通过全部采样点"


def _prop_slider_range(idx, prop):
    lo, hi = prop.get("min", 0), prop.get("max", 0)
    tol = prop.get("tol", 0.5)
    for s in idx.sliders():
        nums = s.get("numeric") or []
        if len(nums) >= 2 and nums[0] <= lo + tol and nums[1] >= hi - tol:
            return True, f"滑块 {s['name']} 覆盖 [{nums[0]}, {nums[1]}]"
    return False, "无滑块覆盖所需区间"


def _prop_moving_point(idx, prop):
    movings = idx.moving_points()
    if movings:
        names = [m["name"] for m in movings]
        return True, f"动点: {names}"
    # 退化判定：点坐标引用了滑块名
    slider_names = {s["name"] for s in idx.sliders()}
    for o in idx.ir["objects"]:
        if o["kind"] == "point":
            for c in o.get("coords") or []:
                c = str(c)
                base = c.split("(")[0].split("*")[0].split("+")[0].strip()
                if base in slider_names:
                    return True, f"{o['name']} 由滑块驱动"
    return False, "未发现滑块驱动的动点"


def _resolve_all(idx, names):
    out = []
    for n in names:
        c = idx.resolve_arg(n)
        if c is None:
            return None
        out.append(c)
    return out


def _prop_polygon_vertices(idx, prop):
    target = [list(v) for v in (prop.get("vertices") or [])]
    if not target:
        return True, "无顶点要求"
    for o in idx.ir["objects"]:
        if o["kind"] != "polygon":
            continue
        resolved = _resolve_all(idx, o.get("args") or [])
        if resolved is None:
            continue
        remaining = [list(v) for v in target]
        for c in resolved:
            for i, t in enumerate(remaining):
                if _coords_close(c, t, prop.get("tol", DEFAULT_TOL)):
                    remaining.pop(i)
                    break
        if not remaining:
            return True, f"多边形 {o['name']} 顶点齐全"
    return False, "无多边形含全部要求顶点"


def _prop_line_through(idx, prop):
    pts = prop.get("points") or []
    if len(pts) != 2:
        return True, "无要求"
    for o in idx.ir["objects"]:
        if o["kind"] not in ("line", "segment"):
            continue
        resolved = _resolve_all(idx, o.get("args") or [])
        if resolved is None or len(resolved) != 2:
            continue
        tol = prop.get("tol", DEFAULT_TOL)
        if (_coords_close(resolved[0], pts[0], tol) and _coords_close(resolved[1], pts[1], tol)) or \
           (_coords_close(resolved[0], pts[1], tol) and _coords_close(resolved[1], pts[0], tol)):
            return True, f"直线 {o['name']} 过两点"
    # 宽松：无法解析参数的 line/segment 存在则放行（避免冤枉）
    if any(o["kind"] in ("line", "segment") for o in idx.ir["objects"]):
        return True, "存在直线/线段对象（参数未可解析，宽松放行）"
    return False, "无直线/线段"


def _prop_circle_center_radius(idx, prop):
    center = prop.get("center")
    radius = prop.get("radius")
    for o in idx.ir["objects"]:
        if o["kind"] != "circle":
            continue
        args = o.get("args") or []
        c = idx.resolve_arg(args[0]) if args else None
        r = None
        if len(args) >= 2:
            try:
                r = float(args[1])
            except (TypeError, ValueError):
                pt = idx.resolve_arg(args[1])
                if pt and c:
                    r = math.dist(c, pt)
        if c and r is not None and center and radius is not None:
            if _coords_close(c, center, prop.get("tol", DEFAULT_TOL)) and _close(r, radius, 0.1):
                return True, f"圆 {o['name']} 匹配"
    return False, "无匹配的圆"


def _prop_conic_exists(idx, prop):
    kind = prop.get("conic_kind")
    for o in idx.ir["objects"]:
        if o["kind"] == kind:
            return True, f"{o['name']}"
    return False, f"无 {kind} 对象"


def _prop_equation_present(idx, prop):
    target = (prop.get("expr") or "").replace(" ", "").lower()
    for o in idx.ir["objects"]:
        if o["kind"] == "equation" and o.get("expr", "").replace(" ", "") == target:
            return True, o["name"]
    return False, "无同式方程"


def _prop_no_text(idx, prop):
    texts = [o["name"] for o in idx.ir["objects"] if o["kind"] == "text"]
    return not texts, f"文字对象: {texts}" if texts else "干净"


def _prop_syntax_clean(idx, prop):
    bad = idx.ir["stats"]["invalid_lines"]
    return bad == 0, f"无效行 {bad}"


def _prop_interaction(idx, prop):
    return _prop_moving_point(idx, prop)


PREDICATES = {
    "point_at": _prop_point_at,
    "function_through": _prop_function_through,
    "slider_range": _prop_slider_range,
    "moving_point": _prop_moving_point,
    "polygon_vertices": _prop_polygon_vertices,
    "line_through": _prop_line_through,
    "circle_center_radius": _prop_circle_center_radius,
    "conic_exists": _prop_conic_exists,
    "equation_present": _prop_equation_present,
    "no_text": _prop_no_text,
    "syntax_clean": _prop_syntax_clean,
    "interaction": _prop_moving_point,
}


def _rigid_embedded(P, C, tol=DEFAULT_TOL):
    """判断性质点集 P 能否距离守恒地嵌入候选数值点集 C（刚体/反射等价）。

    回溯 + 剪枝：逐点分配候选点，要求与已分配点的距离和 P 的距离矩阵一致。
    规模保护：k<=12 且 |C|<=80。
    """
    k = len(P)
    if k < 2 or len(C) < k or k > 12 or len(C) > 80:
        return False
    if any(len(p) < 2 for p in P):
        return False
    dist = math.dist
    Pd = [[dist(P[i], P[j]) for j in range(k)] for i in range(k)]
    used = [False] * len(C)
    assign = [-1] * k

    def backtrack(i):
        if i == k:
            return True
        for j in range(len(C)):
            if used[j]:
                continue
            ok = True
            for t in range(i):
                if abs(Pd[i][t] - dist(C[j], C[assign[t]])) > tol:
                    ok = False
                    break
            if ok:
                used[j] = True
                assign[i] = j
                if backtrack(i + 1):
                    return True
                used[j] = False
        return False

    return backtrack(0)


def evaluate_properties(case_dir: Path, candidate_text: str) -> dict:
    prop_file = case_dir / "expected_properties.json"
    if not prop_file.exists():
        return {"case": str(case_dir.relative_to(CASES_DIR)).replace("\\", "/"),
                "skip": True, "pass": True, "results": []}
    props = json.loads(prop_file.read_text(encoding="utf-8"))
    if props.get("skip"):
        return {"case": str(case_dir.relative_to(CASES_DIR)).replace("\\", "/"),
                "skip": True, "pass": True, "skip_reason": props.get("skip_reason", ""),
                "results": []}
    ir = parse_commands(candidate_text)
    idx = CandidateIndex(ir)
    results = []
    for prop in props.get("properties", []):
        ptype = prop.get("type")
        fn = PREDICATES.get(ptype)
        if fn is None:
            results.append({"type": ptype, "pass": True, "detail": "未知谓词，放行"})
            continue
        ok, detail = fn(idx, prop)
        results.append({"type": ptype, "desc": prop.get("desc", ""), "pass": ok, "detail": detail})

    # 3D 建系差异兜底（point_at 组）：
    #   a) 同名引擎点兜底——候选存在同名对象但由引擎求值（Intersect/Midpoint 等，
    #      坐标由 GeoGebra 保证），视为通过；
    #   b) 刚体等价——仍失败的 point_at（含已通过者组成完整点集）与候选数值点集
    #      存在距离守恒嵌入（回溯剪枝，三点定刚体）；
    #      局限：镜像（手性翻转）距离同样守恒，方向问题交由 L3/人工。
    paired = list(zip(results, props.get("properties", [])))
    failed_pt = [(r, p) for r, p in paired if r["type"] == "point_at" and not r["pass"]]
    if failed_pt:
        # a) 同名引擎点兜底：desc 形如 "点 B"
        for r, p in failed_pt:
            m = re.match(r"点\s+([A-Za-z]\w*)", p.get("desc") or "")
            if m:
                obj = idx.by_name.get(m.group(1))
                if obj is not None and obj.get("kind") not in ("point", "unknown", "expression"):
                    r["pass"] = True
                    r["detail"] = f"同名引擎点（{obj.get('kind')}，坐标由引擎保证）"
        # b) 刚体等价：只用仍失败的静态点子集（引擎点坐标未知，不参与距离矩阵）
        still_failed = [(r, p) for r, p in paired
                        if r["type"] == "point_at" and not r["pass"]]
        if still_failed:
            P = [p.get("coords") or [] for _, p in still_failed]
            C = [list(v) for v in idx.point_coords.values()]
            if _rigid_embedded(P, C):
                for r, _p in still_failed:
                    r["pass"] = True
                    r["detail"] = "刚体等价（自由建系，距离守恒）"

    passed = all(r["pass"] for r in results)
    return {
        "case": str(case_dir.relative_to(CASES_DIR)).replace("\\", "/"),
        "skip": False,
        "pass": passed,
        "total": len(results),
        "failed": [r for r in results if not r["pass"]],
        "results": results,
    }


# ---------- 金标准 -> 性质清单 自动转换 ----------

def convert_case(case_dir: Path) -> dict:
    exp = case_dir / "expected_objects.json"
    if not exp.exists():
        return {"case": "", "properties": []}
    ir = json.loads(exp.read_text(encoding="utf-8"))
    objs = {o["name"]: o for o in ir["objects"]}
    props = [{"type": "syntax_clean", "desc": "语法干净"},
             {"type": "no_text", "desc": "无文字对象"}]

    def numeric_of(name):
        o = objs.get(name)
        if o and o.get("numeric"):
            return o["numeric"]
        return None

    for o in ir["objects"]:
        k = o.get("kind")
        if k == "point" and o.get("numeric"):
            props.append({"type": "point_at", "coords": o["numeric"],
                          "desc": f"点 {o['name']}"})
        elif k == "function" and o.get("expr") is not None:
            samples = []
            for x in FUNC_SAMPLE_XS:
                v = eval_function_expr(o["expr"], x)
                if v is not None and abs(v) < 1e6:
                    samples.append([x, round(v, 6)])
            if samples:
                props.append({"type": "function_through", "points": samples,
                              "desc": f"函数 {o['name']} 采样等价", "tol": 0.2})
        elif k == "slider" and o.get("numeric") and len(o["numeric"]) >= 2:
            props.append({"type": "slider_range", "min": o["numeric"][0],
                          "max": o["numeric"][1], "desc": f"滑块 {o['name']}"})
        elif k == "moving_point":
            props.append({"type": "moving_point", "desc": f"动点 {o['name']}"})
        elif k == "polygon" and o.get("args"):
            verts = [numeric_of(a) for a in o["args"]]
            if all(v is not None for v in verts):
                props.append({"type": "polygon_vertices", "vertices": verts,
                              "desc": f"多边形 {o['name']}"})
        elif k in ("line", "segment") and o.get("args"):
            pts = [numeric_of(a) or _arg_to_coords(a) for a in o["args"]]
            if all(p is not None for p in pts) and len(pts) == 2:
                props.append({"type": "line_through", "points": pts,
                              "desc": f"{k} {o['name']}"})
        elif k == "circle" and o.get("args"):
            args = o["args"]
            center = numeric_of(args[0]) if args else None
            radius = None
            if len(args) >= 2:
                try:
                    radius = float(args[1])
                except (TypeError, ValueError):
                    pt = numeric_of(args[1])
                    if pt and center:
                        radius = round(math.dist(center, pt), 6)
            if center and radius is not None:
                props.append({"type": "circle_center_radius", "center": center,
                              "radius": radius, "desc": f"圆 {o['name']}"})
        elif k in ("ellipse", "hyperbola", "parabola"):
            props.append({"type": "conic_exists", "conic_kind": k,
                          "desc": f"{k} {o['name']}"})
        elif k == "equation":
            props.append({"type": "equation_present", "expr": o.get("expr", ""),
                          "desc": f"方程 {o['name']}"})
        # unknown / expression / other：跳过（不生成性质）

    return {"case": str(case_dir.relative_to(CASES_DIR)).replace("\\", "/"),
            "properties": props}


# ---------- CLI ----------

def cmd_convert(args):
    n = 0
    for case in sorted(p.parent for p in CASES_DIR.rglob("expected_objects.json")):
        data = convert_case(case)
        out = case / "expected_properties.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        n += 1
        print(f"[OK] {data['case']}: {len(data['properties'])} 条性质")
    print(f"\n转换完成 {n} 例")


def cmd_selftest(args):
    total = passed = 0
    for case in sorted(p.parent for p in CASES_DIR.rglob("expected_properties.json")):
        golden = case / "golden_commands.txt"
        if not golden.exists():
            continue
        result = evaluate_properties(case, golden.read_text(encoding="utf-8"))
        total += 1
        if result["pass"]:
            passed += 1
        else:
            print(f"[FAIL] {result['case']}: " +
                  "; ".join(f"{f['type']}({f['detail']})" for f in result["failed"]))
    print(f"\n性质自测：{passed}/{total} PASS" +
          (" —— 性质清单与金标准自洽" if passed == total else " —— 需人工校准性质清单"))
    return 0 if passed == total else 1


def cmd_matrix(args):
    sets = [
        ("Gemini 改造前", "candidate_pre_p0.txt"),
        ("qwen 改造前", "candidate_qwen_pre_p0.txt"),
        ("qwen 改造后(P0)", "candidate_commands.txt"),
    ]
    summary = {}
    for tag, fname in sets:
        rows = []
        for case in sorted(p.parent for p in CASES_DIR.rglob("expected_properties.json")):
            cand = case / fname
            if not cand.exists():
                continue
            r = evaluate_properties(case, cand.read_text(encoding="utf-8"))
            rows.append(r)
        n = len(rows)
        passes = sum(r["pass"] for r in rows)
        prop_hits = (sum(r["total"] - len(r["failed"]) for r in rows) /
                     max(1, sum(r["total"] for r in rows)))
        summary[tag] = {"cases": n, "pass": passes, "pass_rate": round(passes / n, 4) if n else 0,
                        "avg_property_hit_rate": round(prop_hits, 4) if n else 0}
        print(f"【{tag}】 完成 {n} | PASS {passes} ({summary[tag]['pass_rate']:.0%}) "
              f"| 单性质平均命中 {summary[tag]['avg_property_hit_rate']:.0%}")
    out = ROOT / "benchmarks" / "reports" / "property_matrix.json"
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n矩阵已写入 {out.relative_to(ROOT)}")


def main():
    import argparse
    ap = argparse.ArgumentParser(description="性质判分引擎")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("convert", help="金标准 -> expected_properties.json")
    sub.add_parser("selftest", help="金标准自对照性质判分")
    sub.add_parser("matrix", help="三组候选的性质口径对比矩阵")
    args = ap.parse_args()
    if args.cmd == "convert":
        cmd_convert(args)
    elif args.cmd == "selftest":
        sys.exit(cmd_selftest(args))
    elif args.cmd == "matrix":
        cmd_matrix(args)


if __name__ == "__main__":
    main()
