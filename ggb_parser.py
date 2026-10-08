# -*- coding: utf-8 -*-
"""
GGB 指令解析器（共享模块）。

服务于 app.py：P0 指令校验层（specialist 输出的合法性检查与清洗）。

判分/校验口径在对象语义层（kind + 坐标/参数/引用序列），不比对指令顺序。
`MODE:` 行、`#` 注释、空行在清洗阶段剔除；同名重复定义以最后一次为准。

命令目录策略：
  - 权威命令表来自 ggb_commands.json（单一事实来源，prompt 允许集同源）
  - "形式像命令但白名单外"的行：放行下发 + 标记 unknown_command（GGB 自己
    静默失败一条的伤害 < 我们丢掉一条合法指令的伤害）
  - 已确认的非法命令/API 混用、常用签名的参数数目/类型/视图错误剔除并反馈修正
  - 未收录签名或无法静态确定类型的表达式交给 GeoGebra，不声称静态检查等于可执行
"""
import re
import ggb_catalog

_FLOAT_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
FUNC_DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*\(([^)]*)\)\s*=\s*(.+)$")
DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*=\s*(.+)$")
CMD_RE = re.compile(r"^([A-Za-z]\w*)\s*[([](.*)[)\]]\s*$")
COLON_DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*:\s*(.+)$")
MODE_RE = re.compile(r"^MODE\s*:\s*(\w+)$", re.I)


def load_whitelist(refresh=False) -> dict:
    """加载权威命令表（低写字母 key）。结构:
    {constructors: {name: {"views": ["2d"/"3d"]}}, attributes: set, globals: set}
    """
    return ggb_catalog.load_catalog(refresh=refresh)


def whitelist_command_names() -> dict:
    """给 prompt 生成用：返回 {'2d': [...], '3d': [...], 'attributes': [...], 'globals': [...]}"""
    wl = load_whitelist()
    by_view = {"2d": [], "3d": []}
    for name_l, info in sorted(wl["constructors"].items()):
        for v in info["views"]:
            by_view.setdefault(v, []).append(name_l)
    # 找出仅属于 3d 的构造器，其余默认进 2d
    only_3d = {n for n, info in wl["constructors"].items()
               if "2d" not in info["views"]}
    by_view["2d"] = sorted(n for n in by_view.get("2d", []) if n not in only_3d)
    by_view["3d"] = sorted(set(by_view.get("3d", [])) | only_3d)
    return {
        "2d": [wl["canonical"][n] for n in by_view["2d"]],
        "3d": [wl["canonical"][n] for n in by_view["3d"]],
        "attributes": [wl["canonical"][n] for n in sorted(wl["attributes"])],
        "globals": [wl["canonical"][n] for n in sorted(wl["globals"])],
    }



def norm(s: str) -> str:
    """归一化：去所有空白、转小写。用于语义比较。"""
    return re.sub(r"\s+", "", s or "").lower()


def split_top_level(s: str) -> list:
    """按顶层逗号拆分参数（忽略括号/花括号/引号内的逗号）。"""
    return ggb_catalog.split_args(s)


def try_float(s: str):
    s = s.strip()
    return float(s) if _FLOAT_RE.match(s) else None


def _parse_coords(parts: list):
    raw = list(parts)
    nums = [try_float(p) for p in raw]
    return raw, (nums if all(n is not None for n in nums) else None)


def parse_rhs(rhs: str) -> dict:
    """把定义右端解析为对象字段（kind + 关键字段）。"""
    rhs_s = rhs.strip()
    if rhs_s.startswith("(") and rhs_s.endswith(")"):
        try:
            parts = split_top_level(rhs_s[1:-1])
        except ValueError:
            parts = []  # e.g. (A-B) + (C-D) is not one coordinate tuple
        if len(parts) in (2, 3):
            raw, numeric = _parse_coords(parts)
            return {"kind": "point", "coords": raw,
                    "numeric": numeric, "raw": norm(rhs_s)}
    m = CMD_RE.match(rhs_s)
    if m:
        try:
            args = split_top_level(m.group(2))
        except ValueError:
            m = None  # e.g. Midpoint(A,B)+Vector(A,B), a valid compound expression
    if m:
        raw_head = m.group(1).lower()
        head = load_whitelist()["aliases"].get(raw_head, raw_head)
        if head == "point":
            inner = m.group(2).strip()
            if inner.startswith("{") and inner.endswith("}"):
                raw, numeric = _parse_coords(split_top_level(inner[1:-1]))
                return {"kind": "point", "coords": raw, "numeric": numeric,
                        "raw": norm(rhs_s)}
            if len(args) in (1, 2) and ("(" in inner or "[" in inner or not try_float(args[0])):
                return {"kind": "moving_point", "path": [norm(a) for a in args],
                        "raw": norm(rhs_s)}
            raw, numeric = _parse_coords(args)
            return {"kind": "point", "coords": raw, "numeric": numeric,
                    "raw": norm(rhs_s)}
        if head == "slider" and len(args) >= 2:
            nums = [try_float(a) if try_float(a) is not None else safe_arith(a) for a in args[:3]]
            return {"kind": "slider", "args": [norm(a) for a in args],
                    "numeric": nums if all(n is not None for n in nums[:2]) else None,
                    "raw": norm(rhs_s)}
        if head == "polygon":
            return {"kind": "polygon", "args": [norm(a) for a in args],
                    "raw": norm(rhs_s)}
        if head in load_whitelist()["constructors"]:
            return {"kind": head, "args": [norm(a) for a in args],
                    "raw": norm(rhs_s)}
        # 白名单外的构造器：仍按对象定义保留（策略反转：宁可放过）
        return {"kind": "unknown", "head": head, "args": [norm(a) for a in args],
                "raw": norm(rhs_s)}
    if "=" in rhs_s:
        return {"kind": "function", "expr": norm(rhs_s), "raw": norm(rhs_s)}
    return {"kind": "expression", "expr": norm(rhs_s), "raw": norm(rhs_s)}


def strip_inline_comment(line: str) -> str:
    """剔除引号外的 // 行内注释（GGB evalCommand 不接受注释，属真实失效噪声）。"""
    out, in_str, escaped = [], False, False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str and ch == "\\" and not escaped:
            escaped = True
            out.append(ch)
        elif ch == '"' and not escaped:
            in_str = not in_str
            out.append(ch)
        elif not in_str and ch == "/" and line[i:i + 2] == "//":
            break
        else:
            out.append(ch)
            escaped = False
        i += 1
    return "".join(out).strip()


def strip_think_blocks(text: str) -> str:
    """剔除 <think>...</think> 思考块（minimax 等模型的 content 内嵌思考段）。"""
    return re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.I)


def clean_lines(text: str):
    """剔除 MODE 头、# 注释、// 行内注释、think 块、空行；返回 (mode, [指令行])。"""
    text = strip_think_blocks(text)
    mode = None
    cmds = []
    for line in text.splitlines():
        s = strip_inline_comment(line.strip())
        if not s:
            continue
        m = MODE_RE.match(s)
        if m:
            mode = m.group(1).upper()
            continue
        if s.startswith("#") or s.startswith("//"):
            continue
        if re.fullmatch(r"`{3,}[\w]*", s):
            continue  # markdown 围栏
        cmds.append(s)
    return mode, cmds


# 数学函数/常量白名单（sqrt(3) 等精确表达式坐标）
MATH_FUNCS = {"sin": "sin", "cos": "cos", "tan": "tan", "sqrt": "sqrt",
              "exp": "exp", "log": "log10", "ln": "log"}
MATH_CONSTS = {"pi": 3.141592653589793, "e": 2.718281828459045}
EXPR_IDENT_RE = re.compile(r"[A-Za-z_]\w*")


def safe_arith(s: str):
    """数值表达式求值：四则运算 + 数学函数/常量（如 2*sqrt(3)、pi/2）。

    标识符必须全部命中白名单（函数/常量），出现未知变量则返回 None。
    支持 ^ 幂与隐式乘号（2sqrt(3)）。
    """
    s = (s or "").strip()
    if not s:
        return None
    s = s.replace("^", "**")
    s = re.sub(r"(?<=[0-9)])\s*(?=[A-Za-z(])", "*", s)
    idents = {i.lower() for i in EXPR_IDENT_RE.findall(s)}
    if idents and not idents <= (set(MATH_FUNCS) | set(MATH_CONSTS)):
        return None  # 含未知变量（如 x、t），交由调用方处理
    import math as _math
    env = {n: getattr(_math, attr) for n, attr in MATH_FUNCS.items()}
    env.update(MATH_CONSTS)
    env["abs"] = abs
    try:
        return float(eval(s, {"__builtins__": {}}, env))  # noqa: S307 标识符已白名单
    except Exception:
        return None


def _num_or_none(v: str):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None



# ---------- AST 安全求值器（向量/函数/引擎零点） ----------

def _eval_with_x(expr: str, x: float):
    """带变量 x 的数学表达式求值（白名单函数，支持 ^ 与隐式乘号）。"""
    s = (expr or "").strip()
    if not s:
        return None
    s = s.replace("^", "**")
    s = re.sub(r"(?<=[0-9)])\s*(?=[A-Za-z(])", "*", s)
    idents = {i.lower() for i in EXPR_IDENT_RE.findall(s)}
    known = set(MATH_FUNCS) | set(MATH_CONSTS) | {"x"}
    if idents and not idents <= known:
        return None
    import math as _math
    env = {n: getattr(_math, attr) for n, attr in MATH_FUNCS.items()}
    env.update(MATH_CONSTS)
    env["x"] = x
    env["abs"] = abs
    try:
        return float(eval(s, {"__builtins__": {}}, env))  # noqa: S307 标识符已白名单
    except Exception:
        return None


def _root_of(expr: str, a: float, b: float):
    """GGB Root(f, a, b) 语义：区间 [a,b] 内第一个零点（网格扫描 + 二分）。"""
    N = 200
    prev_x, prev_v = a, _eval_with_x(expr, a)
    if prev_v is None:
        return None
    if abs(prev_v) < 1e-9:
        return a  # 区间端点恰为零点
    for i in range(1, N + 1):
        x = a + (b - a) * i / N
        v = _eval_with_x(expr, x)
        if v == 0:
            return x  # 网格点恰为零点
        if v is not None and prev_v * v < 0:
            lo, hi = prev_x, x
            flo = prev_v
            for _ in range(60):
                mid = (lo + hi) / 2
                vm = _eval_with_x(expr, mid)
                if vm is None:
                    break
                if flo * vm < 0:
                    hi = mid
                else:
                    lo, flo = mid, vm
            return (lo + hi) / 2
        if v is not None:
            prev_x, prev_v = x, v
    return None


def _eval_geo_expr(expr: str, objects: dict, funcs: dict, env: dict):
    """AST 安全求值：标量/向量（元组）混合运算、函数代入、引擎零点 Root。

    返回数值（标量）或 list（向量），失败返回 None。
    """
    import ast as _ast
    try:
        tree = _ast.parse(expr.replace("^", "**"), mode="eval")
    except SyntaxError:
        return None

    def ev(node):
        if isinstance(node, _ast.Expression):
            return ev(node.body)
        if isinstance(node, _ast.Constant):
            return node.value
        if isinstance(node, _ast.BinOp):
            l = ev(node.left)
            r = ev(node.right)
            if l is None or r is None:
                return None
            lv = l if isinstance(l, list) else [l]
            rv = r if isinstance(r, list) else [r]
            if isinstance(node.op, _ast.Add):
                if len(lv) == len(rv):
                    return [a + b for a, b in zip(lv, rv)]
                if len(rv) == 1:
                    return [a + rv[0] for a in lv]
                if len(lv) == 1:
                    return [lv[0] + b for b in rv]
                return None
            if isinstance(node.op, _ast.Sub):
                if len(lv) == len(rv):
                    return [a - b for a, b in zip(lv, rv)]
                if len(rv) == 1:
                    return [a - rv[0] for a in lv]
                return None
            if isinstance(node.op, _ast.Mult):
                if len(lv) == 1:
                    return [lv[0] * b for b in rv]
                if len(rv) == 1:
                    return [a * rv[0] for a in lv]
                return None
            if isinstance(node.op, _ast.Div):
                if len(rv) == 1 and rv[0] != 0:
                    return [a / rv[0] for a in lv]
                return None
            if isinstance(node.op, _ast.Pow):
                if len(lv) == 1 and len(rv) == 1:
                    return [lv[0] ** rv[0]]
                return None
            return None
        if isinstance(node, _ast.UnaryOp):
            v = ev(node.operand)
            if v is None:
                return None
            if isinstance(node.op, _ast.USub):
                return [-x for x in v] if isinstance(v, list) else -v
            return v
        if isinstance(node, _ast.Tuple):
            vals = [ev(e) for e in node.elts]
            if any(v is None for v in vals):
                return None
            flat = []
            for v in vals:
                flat.extend(v if isinstance(v, list) else [v])
            return flat
        if isinstance(node, _ast.Name):
            n = node.id
            nl = n.lower()
            obj = next((objects[k] for k in objects if k.lower() == nl), None)
            if obj is not None:
                if obj.get("numeric"):
                    return list(obj["numeric"]) if len(obj["numeric"]) > 1 else obj["numeric"][0]
                if "numeric_scalar" in obj:
                    return obj["numeric_scalar"]
                return None
            if nl in env:
                return env[nl]
            return None
        if isinstance(node, _ast.Call):
            fname = node.func.id.lower() if isinstance(node.func, _ast.Name) else ""
            if fname == "root" and len(node.args) >= 3 and isinstance(node.args[0], _ast.Name):
                # Root(f, a, b)：首参是函数名（非值），须在求值 args 前特判
                fobj = funcs.get(node.args[0].id.lower())
                a = ev(node.args[1])
                b = ev(node.args[2])
                if fobj and fobj.get("expr") is not None and a is not None and b is not None:
                    return _root_of(fobj["expr"], a, b)
                return None
            args = [ev(a) for a in node.args]
            if any(a is None for a in args):
                return None
            if fname in MATH_FUNCS:
                if any(isinstance(a, list) for a in args):
                    return None  # 数学函数不接收向量参数
                import math as _math
                return float(getattr(_math, MATH_FUNCS[fname])(*args))
            if fname in MATH_CONSTS:
                return MATH_CONSTS[fname]
            if fname == "root" and len(args) >= 3:
                # Root(f, a, b)：args[0] 是函数名（Name 节点求值为 None，需特殊取）
                if isinstance(node.args[0], _ast.Name):
                    fobj = funcs.get(node.args[0].id.lower())
                    if fobj and fobj.get("expr") is not None:
                        root = _root_of(fobj["expr"], args[1], args[2])
                        return root
                return None
            if fname in funcs and len(args) == 1:
                fobj = funcs[fname]
                return _eval_with_x(fobj["expr"], args[0])
            return None
        return None

    return ev(tree.body)





def resolve_numeric_env(objects: dict):
    """数值常量传播：x_f = -0.4 之类的标量定义进 env，供坐标引用解析。"""
    env = {}
    for name, o in objects.items():
        if o["kind"] == "expression" and o.get("expr") is not None:
            v = try_float(o["expr"])
            if v is None:
                v = safe_arith(o["expr"])
            if v is not None:
                env[name] = v
        elif o["kind"] == "point" and o.get("numeric"):
            env[name] = o["numeric"]
    return env


def _subst_param(expr: str, param: str, new: str) -> str:
    """把函数表达式里的参数替换为新变量（允许数字后隐式乘法，如 2x → 2t）。"""
    if not param:
        return expr
    return re.sub(rf"(?<![A-Za-z_]){re.escape(param)}(?![A-Za-z0-9_])", new, expr)


def _subst_env(expr: str, env: dict) -> str:
    """把表达式里的标量变量替换为数值。"""
    for name, val in env.items():
        expr = re.sub(rf"(?<![A-Za-z_]){re.escape(name)}(?![A-Za-z0-9_])",
                      repr(val), expr)
    return expr


def resolve_point_coords(objects: dict):
    """对坐标为表达式/变量引用/函数调用的点做解析（常量传播 + 函数展开）。

    同时处理向量表达式形式的点定义（P1.5 prompt 教的防手算写法）：
      A1 = A + (0, 0, 2)  /  D = M + 0.5 * (-(y(B)-y(C)), x(B)-x(C))  /  P = 2 * D - A
    """
    env = resolve_numeric_env(objects)
    funcs = {n: o for n, o in objects.items()
             if o["kind"] == "function" and o.get("expr") is not None and o.get("param")}
    # AST 求值：向量表达式 ((A+C)/2、B+D-A)、函数代入 (f(0)、g(4))、引擎零点 (Root(f,a,b))
    for _ in range(2):
        for o in objects.values():
            if o.get("kind") == "expression" and not o.get("numeric") and o.get("expr"):
                v = _eval_geo_expr(o["expr"], objects, funcs, env)
                if isinstance(v, list) and len(v) >= 2 and all(isinstance(t, (int, float)) for t in v):
                    o["kind"] = "point"
                    o["numeric"] = [round(t, 9) for t in v]
                elif isinstance(v, (int, float)):
                    o["numeric_scalar"] = v
                    o["numeric"] = [v]
                    for n2, o2 in objects.items():
                        if o2 is o:
                            env[n2] = v
    # 两轮迭代：标量表达式可引用更早的表达式（y_f = -0.6 * x_f + 1.8）
    for _ in range(2):
        for o in objects.values():
            if o["kind"] == "expression" and "numeric_scalar" not in o and o.get("expr"):
                substituted = _subst_env(o["expr"], env)
                v = safe_arith(substituted)
                if v is not None:
                    o["numeric_scalar"] = v
                    # 标量表达式以自身名字进入 env
                    for n2, o2 in objects.items():
                        if o2 is o:
                            env[n2] = v
    # 向量表达式点：BASE + (dx, dy[, dz]) / BASE - (...) / [k *] (...) 组合
    for o in objects.values():
        if o["kind"] != "expression" or o.get("numeric") or not o.get("expr"):
            continue
        expr = o["expr"]
        base_vec = None
        # 抽取表达式中的具名点引用与元组，按 +/- 顺序累加
        tokens = re.findall(r"([A-Za-z]\w*)|\(([^()]+)\)|([+-])|(\*|(?:\d+\.?\d*))", expr)
        # 简化：仅处理 "A + (dx,dy[,dz])" 与 "A - (...)" 及系数形式 "k*(...)"、"A + k*(...)"
        m = re.match(r"^([a-z]\w*)\s*([+-])\s*(?:(\d*\.?\d+)\s*\*\s*)?\(([^()]+)\)$", expr)
        if m:
            base = m.group(1)
            sign = -1 if m.group(2) == "-" else 1
            coef = float(m.group(3)) if m.group(3) else 1.0
            base_vec = None
            # expr 已 norm 为小写而 objects 键是原名——大小写不敏感查找
            base_obj = next((objects[n] for n in objects if n.lower() == base), None)
            # base 可能是点（坐标）或标量环境值（一维平移）
            if base_obj is not None and base_obj.get("numeric"):
                base_vec = list(base_obj["numeric"])
            elif base in env:
                base_vec = [env[base]]
            if base_vec is not None:
                offs = [_num_or_none(v) for v in m.group(4).split(",")]
                if all(v is not None for v in offs) and len(offs) == len(base_vec):
                    o["numeric"] = [round(b + sign * coef * v, 9) for b, v in zip(base_vec, offs)]
                    o["kind"] = "point"
                    o["coords"] = [str(v) for v in o["numeric"]]
    for o in objects.values():
        if o["kind"] != "point" or o.get("numeric"):
            continue
        resolved = []
        for c in o.get("coords") or []:
            v = try_float(c)
            if v is None:
                v = safe_arith(c)
            if v is None and c in env:
                v = env[c]
            if v is None:
                m = re.match(r"^([A-Za-z]\w*)\(([A-Za-z]\w*)\)$", c.strip())
                if m and m.group(1) in funcs:
                    f = funcs[m.group(1)]
                    c = _subst_param(f["expr"], f["param"], m.group(2))
            if v is None:
                v = _eval_geo_expr(c, objects, funcs, env)
            resolved.append(v if v is not None else c)
        if resolved:
            nums = [v for v in resolved if isinstance(v, float)]
            if len(nums) == len(resolved) and resolved:
                o["numeric"] = nums
            elif any(isinstance(v, str) for v in resolved):
                o["coords"] = resolved


def _register(objects: dict, order: list, name: str, obj: dict):
    if name in objects:
        obj["_redefined"] = True
    else:
        order.append(name)
    objects[name] = obj


def parse_commands(text: str) -> dict:
    """解析整份指令文本 -> IR dict。

    返回字段：
      mode / scene_attrs / objects（首次定义顺序、末次定义内容）/ redefinitions
      records: 清洗后逐行记录 [{text, type: object|attr|global|unparsed, name?}]
      stats:   {cleaned_lines, valid_lines, invalid_lines, validity}
    """
    mode, cmds = clean_lines(text)
    catalog = load_whitelist()
    attr_commands = catalog["attributes"]
    global_commands = catalog["globals"]
    local_functions = {m.group(1) for line in cmds
                       if (m := FUNC_DEF_RE.match(line))}
    objects, order = {}, []
    scene_attrs = {}
    records = []
    types = {}
    command_errors = []
    unknown_found = set()

    for line in cmds:
        errors, unknown, result_type = ggb_catalog.inspect_line(line, types, local_functions, mode)
        unknown_found.update(unknown)
        if errors:
            command_errors.append({"line": line, "errors": errors})
            records.append({"text": line, "type": "invalid_command", "errors": errors})
            continue
        definition = re.match(r"^([A-Za-z]\w*)(?:\([^)]*\))?\s*[:]?=", line)
        if definition:
            if result_type is not None:
                types[definition.group(1)] = result_type
            else:
                types.pop(definition.group(1), None)
        m = FUNC_DEF_RE.match(line)
        if m and all(re.fullmatch(r"[A-Za-z]\w*", part)
                     for part in split_top_level(m.group(2))):
            name = m.group(1)
            _register(objects, order, name, {
                "kind": "function", "param": m.group(2).strip(),
                "expr": norm(m.group(3)), "raw": norm(line), "attrs": {}})
            records.append({"text": line, "type": "object", "name": name})
            continue
        m = DEF_RE.match(line)
        if m:
            name = m.group(1)
            obj = parse_rhs(m.group(2))
            obj["attrs"] = {}
            _register(objects, order, name, obj)
            records.append({"text": line, "type": "object", "name": name})
            continue
        m = COLON_DEF_RE.match(line)
        if m:
            name = m.group(1)
            _register(objects, order, name, {
                "kind": "equation", "expr": norm(m.group(2)),
                "raw": norm(line), "attrs": {}})
            records.append({"text": line, "type": "object", "name": name})
            continue
        m = CMD_RE.match(line)
        if m:
            raw_head = m.group(1).lower()
            head = catalog["aliases"].get(raw_head, raw_head)
            try:
                args = split_top_level(m.group(2))
            except ValueError:
                records.append({"text": line, "type": "command"})
                continue  # balanced compound expression, calls already inspected
            if head in global_commands:
                scene_attrs[head] = [norm(a) for a in args]
                records.append({"text": line, "type": "global"})
                continue
            if head == "setbackgroundcolor" and len(args) in (1, 3):
                scene_attrs[head] = [norm(a) for a in args]
                records.append({"text": line, "type": "global"})
                continue
            if head in attr_commands and args:
                target = args[0].strip().strip('"')
                value = [norm(a) for a in args[1:]]
                obj = objects.get(target)
                if obj is None:
                    scene_attrs.setdefault(head, []).append(value)
                elif head == "setvisibleinview" and len(value) == 2:
                    obj["attrs"].setdefault("visible_in_view", {})[value[0]] = value[1]
                else:
                    obj["attrs"][head] = value
                records.append({"text": line, "type": "attr", "name": target})
                continue
            if head in catalog["constructors"]:
                records.append({"text": line, "type": "command"})
                continue
            if head.startswith(("set", "show", "hide")) and args:
                # 形如属性命令但白名单外（如 SetOptions）：放行 + 标记（P1.5 策略反转）
                records.append({"text": line, "type": "unknown_command", "name": head})
                continue
            # 其他白名单外的命令形式（如 Execute）：放行 + 标记
            records.append({"text": line, "type": "unknown_command", "name": head})
            continue
        records.append({"text": line, "type": "unparsed"})

    valid = sum(1 for r in records if r["type"] not in {"unparsed", "invalid_command"})
    total = len(records)
    resolve_point_coords(objects)
    redefinitions = sorted({n for n, o in objects.items() if o.get("_redefined")})
    unknown_commands = sorted(unknown_found)
    return {
        "mode": mode,
        "scene_attrs": scene_attrs,
        "objects": [objects[n] | {"name": n} for n in order],
        "redefinitions": redefinitions,
        "records": records,
        "unknown_commands": unknown_commands,
        "command_errors": command_errors,
        "stats": {
            "cleaned_lines": total,
            "valid_lines": valid,
            "invalid_lines": total - valid,
            "validity": round(valid / total, 4) if total else 1.0,
        },
        "unparsed": [r["text"] for r in records if r["type"] in {"unparsed", "invalid_command"}],
    }


def reorder_commands(lines: list) -> list:
    """定义先行重排：属性命令移动到全部对象定义之后（保持各组内原顺序）。

    背景：模型生成的指令流常出现 SetColor(F1,...) 先于 F1 定义，GeoGebra 对
    引用未定义对象的属性命令静默返回 false，样式全部丢失。两遍扫描即可保证
    属性必然在目标对象存在后执行；对象定义之间保持原依赖顺序不动。
    """
    first_pass, second_pass = [], []
    for r in lines:
        # r 可能是纯字符串；此处输入为已清洗的 records
        t = r.get("type")
        if t in {"unparsed", "invalid_command"}:
            continue
        if t in ("attr",):
            second_pass.append(r["text"])
        else:
            first_pass.append(r["text"])
    return first_pass + second_pass


def extract_valid_commands(text: str) -> list:
    """提取可下发前端的指令流：MODE 行 + 全部有效指令行（定义先行重排）。

    剔除注释/无效行；未知命令与全局命令随定义组先行，属性命令统一殿后。
    """
    ir = parse_commands(text)
    out = []
    if ir["mode"]:
        out.append(f"MODE: {ir['mode']}")
    out.extend(reorder_commands(ir["records"]))
    return out


def validate_text(text: str) -> dict:
    """P0 校验层用的摘要：有效率 + 无效行明细 + 未知命令遥测 + 建议动作。

    无效 = 纯文字/残缺行，或已核实的非法调用；
    未知命令（白名单外）= 放行下发，仅记录遥测，不触发重试。
    """
    ir = parse_commands(text)
    stats = ir["stats"]
    return {
        "ir": ir,
        "validity": stats["validity"],
        "invalid_lines": ir["unparsed"],
        "unknown_commands": ir["unknown_commands"],
        "command_errors": ir["command_errors"],
        "has_command_errors": bool(ir["command_errors"]),
        "has_text_object": any(o["kind"] == "text" for o in ir["objects"]),
        "ok": stats["invalid_lines"] == 0,
    }
