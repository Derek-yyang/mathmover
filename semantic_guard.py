# -*- coding: utf-8 -*-
"""语义校验闭环（L2 精神的生产化）。

金标准判分（scripts/properties.py）绑定每题的 expected_properties.json，只能离线用；
本模块按"路由类别 -> 结构要求"做**免金标准的通用语义检查**，供线上生成链路在
下发前自查，失败明细回灌给模型重试。

检查项（按类别）：
  通用：语法有效率、无残留文字对象（Text）、有动点（滑块驱动的点）
  A 函数：至少一个函数/显式方程对象
  B 几何：至少一个多边形或圆
  C 解析几何：至少一个圆锥曲线（conic/parabola/ellipse/hyperbola）
  D 立体几何：MODE: 3D 且有空间点/多边形
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from ggb_parser import parse_commands  # noqa: E402

CONIC_KINDS = {"conic", "parabola", "ellipse", "hyperbola"}


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

    # 3) 动点：存在滑块，且至少一个点由它驱动（坐标引用滑块，或 Point(路径, 滑块) 形态）
    sliders = [o["name"] for o in objs if o["kind"] == "slider"]
    if not sliders:
        failures.append({"check": "moving_point",
                         "detail": "缺少滑块 Slider；题目需要可拖动的动点，请增加滑块及由滑块坐标驱动的动点"})
    else:
        slider_names = set(sliders)
        # a) 解析器已识别的路径参数化动点（Point(路径, 滑块)）
        if any(o["kind"] == "moving_point" for o in objs):
            has_moving = True
        else:
            # b) 点坐标表达式引用滑块名
            has_moving = False
            for o in objs:
                if o["kind"] != "point":
                    continue
                for c in o.get("coords") or []:
                    c_str = str(c)
                    if any(s.lower() in c_str.lower() for s in slider_names):
                        has_moving = True
                        break
                # c) 表达式点（expression kind）同样查引用
                if not has_moving and o.get("kind") == "expression" and o.get("expr"):
                    if any(s.lower() in str(o["expr"]).lower() for s in slider_names):
                        has_moving = True
                if has_moving:
                    break
        if not has_moving:
            failures.append({"check": "moving_point",
                             "detail": f"存在滑块 {sliders} 但没有点由它驱动；"
                                       f"动点坐标应引用滑块（如 P=({sliders[0]}, f({sliders[0]})) 或 M=Point(路径, {sliders[0]})）"})

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
