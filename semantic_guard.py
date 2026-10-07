# -*- coding: utf-8 -*-
"""语义校验闭环（L2 精神的生产化）。

按"路由类别 -> 结构要求"做**免金标准的通用语义检查**，供线上生成链路在
下发前自查，失败明细回灌给模型重试。

检查项（按类别）：
  通用：语法有效率、无残留文字对象（Text）、动点自由度自洽
  A 函数：至少一个函数/显式方程对象
  B 几何：至少一个多边形或圆
  C 解析几何：至少一个圆锥曲线（conic/parabola/ellipse/hyperbola）
  D 立体几何：MODE: 3D 且有空间点/多边形

动点判据（自由度自洽，按题意）：没有固定坐标的点即动点（依赖滑块/参数的点，
含 Intersect/Midpoint 等隐含派生点），轨迹与驱动机制看题意——滑块参数
（t = Slider + P=(t, f(t))）与路径自由点（Point(路径[, t])）都算"已设置"。
有动点才要求可动机制；全为固定坐标的静态构造不要求滑块/路径。
真正要抓的两种残缺：
  free_param    —— 坐标依赖自由参数 t，但 t 无滑块也无路径（动点没设置）
  orphan_slider —— 滑块孤立，没有驱动任何对象（动点被写成死坐标/滑块多余）
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ggb_parser import parse_commands, whitelist_command_names  # noqa: E402

CONIC_KINDS = {"conic", "parabola", "ellipse", "hyperbola"}

# 表达式里的合法名字：数学内置/常量 + 命令白名单（Root 等构造器可当表达式用）
_MATH_FUNCS = {
    "sqrt", "cbrt", "abs", "exp", "log", "ln", "log10", "log2",
    "sin", "cos", "tan", "cot", "sec", "csc", "cosec",
    "asin", "acos", "atan", "acot", "arcsin", "arccos", "arctan", "arccot",
    "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
    "floor", "ceil", "round", "trunc", "sgn", "sign",
    "min", "max", "mod", "gcd", "lcm", "fact", "factorial", "ncr", "npr",
    "binomial", "random", "shuffle", "if", "ifundefined", "sort", "keepif",
    "zip", "element", "length", "dimension", "count", "unique", "product",
    "sum", "mean", "median", "x", "y", "z",
    "pi", "e", "phi", "i", "undefined", "true", "false",
}
_COMMAND_NAMES = {n.lower()
                  for names in whitelist_command_names().values() for n in names}

_DEF_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*:?=")
# 单遍分词：字符串 | 数字 | 标识符——标识符自带尾随数字（n_1 不会被数字规则吃成 n_）
_TOKEN_RE = re.compile(r'"[^"]*"|\d+\.?\d*(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*')


def _idents(rhs: str):
    """右端里的裸标识符引用（字符串/数字字面量不算）。

    调用头（名字紧跟括号，如 Root(、f(、Polygon(）不算引用——构造器合法性归 P0 白名单管，
    自由参数检查看的是坐标/表达式里的裸名字（如 P=(t, f(t)) 的 t）。
    """
    out = []
    for m in _TOKEN_RE.finditer(rhs):
        tok = m.group(0)
        if tok[0] == '"' or tok[0].isdigit():
            continue  # 字符串/数字字面量
        if rhs[m.end():].lstrip().startswith("("):
            continue  # 调用头
        out.append(tok)
    return out


def semantic_check(category: str, candidate_text: str) -> dict:
    """返回 {ok, validity, failures: [{check, detail}], summary}。"""
    ir = parse_commands(candidate_text)
    objs = ir["objects"]
    stats = ir["stats"]
    failures = []

    def kinds():
        return {o["kind"] for o in objs}

    def names_of(kind_set):
        return [o["name"] for o in objs if o["kind"] in kind_set]

    # 1) 语法有效率
    validity = stats.get("validity", 0.0)
    if validity < 0.95:
        failures.append({"check": "syntax",
                         "detail": f"指令有效率 {validity}，无效行 {stats.get('invalid_lines')} 行"})

    # 2) 残留文字对象（题面文字不该进图）
    text_objs = names_of({"text"})
    if text_objs:
        failures.append({"check": "no_text",
                         "detail": f"存在文字对象 {text_objs}，题目文字不应生成 Text 对象，请删除这些行"})

    # 3) 动点自由度自洽（判据见模块 docstring）：
    #    有动点 -> 可动机制必须已设置（滑块或路径动点）；全固定坐标的静态构造 -> 不要求
    obj_names = {o["name"] for o in objs}
    slider_names = {o["name"] for o in objs if o["kind"] == "slider"}
    # 定义行解析：(名字, 绑定参数, 右端文本)
    defs = []
    for line in candidate_text.splitlines():
        m = _DEF_RE.match(line)
        if not m:
            continue
        name, params = m.group(1), (m.group(2) or "")
        bound = {p.strip() for p in params.split(",") if p.strip()}
        # 右端= def 等号之后（不用 split("=")：字符串字面量里的 = 会切错）
        defs.append((name, bound, line[m.end():]))
    bound_all = set().union(*(b for _, b, _ in defs)) if defs else set()
    variants = {f"{n}_{i}" for n in obj_names for i in (1, 2, 3)}

    def is_known(ident: str) -> bool:
        low = ident.lower()
        return (ident in obj_names or ident in bound_all or ident in variants
                or low in _MATH_FUNCS or low in _COMMAND_NAMES)

    # a) 自由参数未声明：定义引用了既非对象/滑块/路径、也非内置的名字（动点没设置可动机制）
    free_params = {}
    for name, _bound, rhs in defs:
        for ident in _idents(rhs):
            if not is_known(ident):
                free_params.setdefault(ident, name)
    if free_params:
        first = next(iter(free_params))
        pairs = "；".join(f"{p}（被 {owner} 引用）" for p, owner in free_params.items())
        failures.append({"check": "free_param",
                         "detail": f"引用了未定义的名字 {pairs}。若这是动点参数，动点未设置可动机制："
                                   f"请加 {first} = Slider(...) 并让点坐标引用它（如 P=({first}, f({first}))），"
                                   f"或改为路径动点 Point(路径[, 参数])；若是笔误请修正对象名"})

    # b) 孤立滑块：滑块没有驱动任何对象（动点被写成死坐标，或滑块多余）
    referenced = set()
    for _n, _b, rhs in defs:
        referenced.update(_idents(rhs))
    orphan = sorted(slider_names - referenced)
    if orphan:
        failures.append({"check": "orphan_slider",
                         "detail": f"滑块 {orphan} 未驱动任何对象。若题目有动点，动点坐标应引用滑块"
                                   f"（如 P=({orphan[0]}, f({orphan[0]}))）；若题目无动点，应删除多余滑块"})

    # 4) 类别结构要求
    ks = kinds()
    if category == "A":
        if not ({"function", "equation"} & ks):
            failures.append({"check": "category_structure",
                             "detail": "函数与图像类题目：图中缺少函数或方程对象（应有 f(x)=... 或显式曲线方程）"})
    elif category == "B":
        if not ({"polygon", "circle", "arc"} & ks):
            failures.append({"check": "category_structure",
                             "detail": "平面几何类题目：缺少多边形/圆等几何对象，仅有孤立的点和线不满足题意"})
    elif category == "C":
        if not (ks & CONIC_KINDS):
            failures.append({"check": "category_structure",
                             "detail": "解析几何类题目：缺少圆锥曲线对象（Parabola/Ellipse/Hyperbola 或二次方程曲线），"
                                       "请用题目给定的方程或条件构造圆锥曲线"})
    elif category == "D":
        mode = (ir.get("mode") or "").upper()
        has_3d = bool({"point3d", "polygon3d", "sphere", "cone", "cylinder"} & ks) or \
                 any("3" in str(c) or "," in str(c) and str(c).count(",") == 2
                     for o in objs if o["kind"] == "point"
                     for c in (o.get("coords") or []) if not o.get("numeric"))
        if mode != "3D" and not has_3d:
            failures.append({"check": "category_structure",
                             "detail": "立体几何类题目：应为 3D 视图（MODE: 3D）且含空间点/空间多边形，"
                                       "当前图是平面图，请按立体几何骨架重做"})

    return {
        "ok": not failures,
        "validity": validity,
        "failures": failures,
        "summary": "; ".join(f"{f['check']}: {f['detail'][:60]}" for f in failures),
    }


def strip_text_objects(candidate_text: str) -> str:
    """D 规则过滤：删除 Text 类对象的定义行及其属性行。"""
    ir = parse_commands(candidate_text)
    text_names = {o["name"].lower() for o in ir["objects"] if o["kind"] == "text"}
    if not text_names:
        return candidate_text
    out_lines = []
    for line in candidate_text.splitlines():
        s = line.strip()
        if not s:
            continue
        s_low = s.lower()
        dropped = False
        for tn in text_names:
            # 定义行：txt_m = Text(...) （容空格与大小写）
            if s_low == f"{tn} = text(...)" or s_low.startswith(f"{tn}=text(") \
                    or s_low.startswith(f"{tn} = text("):
                dropped = True
                break
            # 属性行：SetXxx(txt_m, ...) 首参为 text 对象名
            if s_low.startswith("set") and "(" in s:
                first_arg = s.split("(", 1)[1].split(",")[0].strip().strip('"').lower()
                if first_arg == tn:
                    dropped = True
                    break
        if not dropped:
            out_lines.append(line)
    return "\n".join(out_lines) + "\n"
