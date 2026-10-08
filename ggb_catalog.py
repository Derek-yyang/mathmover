"""Shared input-command catalog and conservative call validation.

This is not a GeoGebra expression evaluator. Unknown commands/types remain
observable and executable; only documented arity/view/type mismatches fail.
"""
import json
import re
from pathlib import Path

CATALOG_PATH = Path(__file__).with_name("ggb_commands.json")
_cached = None
_stamp = None


def load_catalog(refresh=False):
    global _cached, _stamp
    stamp = (CATALOG_PATH, CATALOG_PATH.stat().st_mtime_ns)
    if not refresh and _cached is not None and stamp == _stamp:
        return _cached
    raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    constructors = {}
    canonical = {}
    for view, names in raw["constructors"].items():
        for name in names:
            canonical[name.lower()] = name
            constructors.setdefault(name.lower(), {"views": []})["views"].append(view)
    attrs = {n.lower() for n in raw["attributes"]}
    globals_ = {n.lower() for n in raw["globals"]}
    for name in raw["attributes"] + raw["globals"]:
        if name.lower() in canonical:
            raise ValueError(f"Duplicate command family: {name}")
        canonical[name.lower()] = name
    aliases = {a.lower(): b.lower() for a, b in raw.get("aliases", {}).items()}
    for alias, target in aliases.items():
        if target not in canonical:
            raise ValueError(f"Missing alias target: {alias} -> {target}")
    signatures = {n.lower(): s for n, s in raw.get("signatures", {}).items()}
    for name, overloads in signatures.items():
        if name not in canonical or not overloads:
            raise ValueError(f"Invalid signature entry: {name}")
        for signature in overloads:
            if not isinstance(signature.get("args"), list) or not signature.get("result"):
                raise ValueError(f"Invalid signature: {name}")
    rejected = {n.lower(): hint for n, hint in raw.get("rejected_commands", {}).items()}
    if (attrs & globals_) or (set(canonical) & set(rejected)):
        raise ValueError("Command groups/rejected names overlap")
    _cached = dict(constructors=constructors, attributes=attrs, globals=globals_,
                   canonical=canonical, aliases=aliases, signatures=signatures,
                   rejected=rejected, expression_functions=set(raw["expression_functions"]))
    _stamp = stamp
    return _cached


def split_args(text):
    """Keep empty arguments, honor nested delimiters and escaped string quotes."""
    if not text.strip():
        return []
    parts, stack, start, quoted, escaped = [], [], 0, False, False
    for i, ch in enumerate(text):
        if quoted:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                quoted = False
        elif ch == '"':
            quoted = True
        elif ch in "([{":
            stack.append(ch)
        elif ch in ")]}":
            if not stack or dict(zip(")]}", "([{"))[ch] != stack.pop():
                raise ValueError("Unbalanced delimiters")
        elif ch == "," and not stack:
            parts.append(text[start:i].strip())
            start = i + 1
    if stack or quoted:
        raise ValueError("Unbalanced delimiters or unterminated string")
    parts.append(text[start:].strip())
    return parts


def calls_in(expression):
    """Find calls anywhere, including list/coordinate/nested expression calls."""
    stack, calls, quoted, escaped = [], [], False, False
    for i, ch in enumerate(expression):
        if quoted:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                quoted = False
            continue
        if ch == '"':
            quoted = True
        elif ch in "([{":
            head = re.search(r"([A-Za-z][A-Za-z0-9_]*)\s*$", expression[:i])
            stack.append((ch, i, head.group(1) if head and ch in "([" else None))
        elif ch in ")]}":
            if not stack:
                raise ValueError("Unbalanced delimiters")
            opening, start, head = stack.pop()
            if dict(zip(")]}", "([{"))[ch] != opening:
                raise ValueError("Unbalanced delimiters")
            if head:
                calls.append((head, split_args(expression[start + 1:i]), start, i))
    if stack or quoted:
        raise ValueError("Unbalanced delimiters or unterminated string")
    return calls


_FAMILIES = {
    "object": {"point", "number", "boolean", "string", "list", "line", "segment", "ray", "vector", "conic", "function", "curve", "polygon", "plane", "quadric"},
    "geometry": {"point", "line", "segment", "ray", "conic", "function", "curve", "polygon", "plane", "quadric"},
    "path": {"line", "segment", "ray", "conic", "function", "curve", "polygon"},
    "region": {"polygon", "conic", "plane", "quadric"},
    "direction": {"line", "segment", "ray", "vector"},
}


def compatible(actual, expected):
    if actual is None or actual in {"any", "geometry"} or expected == "any":
        return True  # unresolved expressions/overloads belong to GeoGebra
    if actual == "coordinate":
        # A bare tuple can be a point or vector depending on naming/context.
        return compatible("point", expected) or compatible("vector", expected)
    return any(actual == part or actual in _FAMILIES.get(part, set())
               for part in expected.split("|"))


def infer_type(expression, types, catalog):
    value = expression.strip()
    if value.lower() in {"true", "false"}:
        return "boolean"
    if value == "space":
        return "space"
    if value in types:
        return types[value]
    if value in {"xAxis", "yAxis", "zAxis"}:
        return "line"
    if re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?", value):
        return "number"
    if value.startswith('"') and value.endswith('"'):
        return "string"
    if value.startswith("{") and value.endswith("}"):
        return "list"
    if value.startswith("(") and value.endswith(")"):
        try:
            if len(split_args(value[1:-1])) in (2, 3):
                return "coordinate"
        except ValueError:
            return None
    try:
        calls = calls_in(value)
    except ValueError:
        return None
    root = next(((name, args) for name, args, start, end in calls
                 if value[:start].strip() == name and not value[end + 1:].strip()), None)
    if root:
        spelling, args = root
        head = catalog["aliases"].get(spelling.lower(), spelling.lower())
        if head in catalog["expression_functions"]:
            return "number"
        if types.get(spelling) == "function":
            return "number"
        actuals = [infer_type(arg, types, catalog) for arg in args]
        results = {s["result"] for s in catalog["signatures"].get(head, [])
                   if arity_matches(s, len(args)) and all(
                       compatible(actual, s["args"][i] if i < len(s["args"]) else s["variadic"])
                       for i, actual in enumerate(actuals))}
        if len(results) == 1:
            return results.pop()
    return None


def arity_matches(signature, count):
    size = len(signature["args"])
    if "variadic" in signature:
        return count >= size
    return signature.get("min_args", size) <= count <= size


def inspect_line(line, types, local_functions, mode=None):
    catalog = load_catalog()
    lhs = re.match(r"^([A-Za-z]\w*)(?:\(([^)]*)\))?\s*[:]?=", line)
    expression = line[lhs.end():] if lhs else line
    errors, unknown = [], set()
    try:
        calls = calls_in(expression)
    except ValueError as error:
        return [str(error)], [], None
    if expression.strip().startswith("(") and expression.strip().endswith(")"):
        try:
            parts = split_args(expression.strip()[1:-1])
        except ValueError:
            parts = []  # a sum/product of parenthesized expressions, not a tuple
        if len(parts) in (2, 3):
            for part in parts:
                actual = infer_type(part, types, catalog)
                if not compatible(actual, "number"):
                    errors.append(f"Coordinate component must be numeric, got {actual}: {part}")
    for spelling, args, start, end in calls:
        head = catalog["aliases"].get(spelling.lower(), spelling.lower())
        if head in catalog["rejected"]:
            errors.append(f"{spelling}: {catalog['rejected'][head]}")
            continue
        if head in catalog["expression_functions"] or spelling in local_functions:
            continue
        if head not in catalog["canonical"]:
            unknown.add(spelling.lower())
            continue
        if mode == "2D" and head in catalog["constructors"] and "2d" not in catalog["constructors"][head]["views"]:
            errors.append(f"{spelling}: requires MODE: 3D")
        signatures = catalog["signatures"].get(head)
        if not signatures:
            continue  # explicit name-only coverage
        if all(s["result"] == "void" for s in signatures):
            if lhs or expression[end + 1:].strip() or expression[:start].strip() != spelling:
                errors.append(f"{spelling}: a scripting command cannot be used as an expression")
        options = [s for s in signatures if arity_matches(s, len(args))]
        if not options or any(not arg for arg in args):
            errors.append(f"{spelling}: unsupported argument count {len(args)} or empty argument")
            continue
        if mode == "2D":
            options = [s for s in options if "2d" in s.get("views", ["2d", "3d"])]
            if not options:
                errors.append(f"{spelling}: this overload requires MODE: 3D")
                continue
        actuals = [infer_type(arg, types, catalog) for arg in args]
        def matches(signature):
            expected = signature["args"]
            return all(compatible(actual, expected[i] if i < len(expected) else signature["variadic"])
                       for i, actual in enumerate(actuals))
        if not any(matches(s) for s in options):
            errors.append(f"{spelling}: incompatible known argument types {actuals}")
    result = "function" if lhs and lhs.group(2) is not None else infer_type(expression, types, catalog)
    return errors, sorted(unknown), result
