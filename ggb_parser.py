# -*- coding: utf-8 -*-
"""
GGB 指令解析器（共享模块）。

同时服务于：
  - scripts/benchmark.py：金标准解析与判分
  - app.py：P0 指令校验层（specialist 输出的合法性检查与清洗）

判分/校验口径在对象语义层（kind + 坐标/参数/引用序列），不比对指令顺序。
`MODE:` 行、`#` 注释、空行在清洗阶段剔除；同名重复定义以最后一次为准。
"""
import re

FLOAT_RE = re.compile(r"^-?\d+(?:\.\d+)?$")
FUNC_DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*\(([^)]*)\)\s*=\s*(.+)$")
DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*=\s*(.+)$")
CMD_RE = re.compile(r"^([A-Za-z]\w*)\s*\((.*)\)\s*$")
COLON_DEF_RE = re.compile(r"^([A-Za-z]\w*)\s*:\s*(.+)$")
MODE_RE = re.compile(r"^MODE\s*:\s*(\w+)$", re.I)

CONSTRUCTORS = {
    "point", "slider", "polygon", "segment", "line", "circle", "ellipse",
    "hyperbola", "parabola", "arc", "midpoint", "intersect", "sphere",
    "cone", "cylinder", "angle", "anglebisector", "perpendicularbisector",
    "perpendicularline", "function", "vector", "text", "tangent", "dilate",
    "translate", "rotate", "reflect", "locus", "pointin",
}

ATTR_COMMANDS = {
    "setfixed", "showlabel", "setlabelmode", "setcolor", "setpointsize",
    "setfilling", "setlinestyle", "setvisibleinview", "setcaption",
    "setvalue", "setthickness",
}
GLOBAL_COMMANDS = {"setaxesvisible", "setgridvisible", "zoomin", "zoomout", "centerview"}


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


def _parse_coords(parts: list):
    raw = list(parts)
    nums = [try_float(p) for p in raw]
    return raw, (nums if all(n is not None for n in nums) else None)


def parse_rhs(rhs: str) -> dict:
    """把定义右端解析为对象字段（kind + 关键字段）。"""
    rhs_s = rhs.strip()
    if rhs_s.startswith("(") and rhs_s.endswith(")"):
        parts = split_top_level(rhs_s[1:-1])
        if len(parts) in (2, 3):
            raw, numeric = _parse_coords(parts)
            return {"kind": "point", "coords": raw,
                    "numeric": numeric, "raw": norm(rhs_s)}
    m = CMD_RE.match(rhs_s)
    if m:
        head = m.group(1).lower()
        args = split_top_level(m.group(2))
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
    if "=" in rhs_s:
        return {"kind": "function", "expr": norm(rhs_s), "raw": norm(rhs_s)}
    return {"kind": "expression", "expr": norm(rhs_s), "raw": norm(rhs_s)}


def strip_inline_comment(line: str) -> str:
    """剔除引号外的 // 行内注释（GGB evalCommand 不接受注释，属真实失效噪声）。"""
    out, in_str = [], False
    i = 0
    while i < len(line):
        ch = line[i]
        if ch == '"':
            in_str = not in_str
            out.append(ch)
        elif not in_str and ch == "/" and line[i:i + 2] == "//":
            break
        else:
            out.append(ch)
        i += 1
    return "".join(out).strip()


def clean_lines(text: str):
    """剔除 MODE 头、# 注释、// 行内注释、空行；返回 (mode, [指令行])。"""
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
        cmds.append(s)
    return mode, cmds


ARITH_RE = re.compile(r"^[\d\s+\-*/().]+$")


def safe_arith(s: str):
    """纯数值四则运算求值（如 (0+1)/2），含字母则放弃。"""
    if not ARITH_RE.match(s):
        return None
    try:
        return float(eval(s, {"__builtins__": {}}, {}))  # noqa: S307 输入已经白名单过滤
    except Exception:
        return None


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
    """对坐标为表达式/变量引用/函数调用的点做解析（常量传播 + 函数展开）。"""
    env = resolve_numeric_env(objects)
    funcs = {n: o for n, o in objects.items()
             if o["kind"] == "function" and o.get("expr") is not None and o.get("param")}
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
    objects, order = {}, []
    scene_attrs = {}
    records = []

    for line in cmds:
        m = FUNC_DEF_RE.match(line)
        if m and m.group(2).strip() in ("x", "t", "a"):
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
            head = m.group(1).lower()
            args = split_top_level(m.group(2))
            if head in GLOBAL_COMMANDS:
                scene_attrs[head] = [norm(a) for a in args]
                records.append({"text": line, "type": "global"})
                continue
            if head in ATTR_COMMANDS and args:
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
        records.append({"text": line, "type": "unparsed"})

    valid = sum(1 for r in records if r["type"] != "unparsed")
    total = len(records)
    resolve_point_coords(objects)
    redefinitions = sorted({n for n, o in objects.items() if o.get("_redefined")})
    return {
        "mode": mode,
        "scene_attrs": scene_attrs,
        "objects": [objects[n] | {"name": n} for n in order],
        "redefinitions": redefinitions,
        "records": records,
        "stats": {
            "cleaned_lines": total,
            "valid_lines": valid,
            "invalid_lines": total - valid,
            "validity": round(valid / total, 4) if total else 1.0,
        },
        "unparsed": [r["text"] for r in records if r["type"] == "unparsed"],
    }


def extract_valid_commands(text: str) -> list:
    """提取可下发前端的指令流：MODE 行 + 全部有效指令行（剔除注释/无效行）。"""
    ir = parse_commands(text)
    out = []
    if ir["mode"]:
        out.append(f"MODE: {ir['mode']}")
    out.extend(r["text"] for r in ir["records"] if r["type"] != "unparsed")
    return out


def validate_text(text: str) -> dict:
    """P0 校验层用的摘要：有效率 + 无效行明细 + 建议动作。"""
    ir = parse_commands(text)
    stats = ir["stats"]
    return {
        "ir": ir,
        "validity": stats["validity"],
        "invalid_lines": ir["unparsed"],
        "has_text_object": any(o["kind"] == "text" for o in ir["objects"]),
        "ok": stats["invalid_lines"] == 0,
    }
