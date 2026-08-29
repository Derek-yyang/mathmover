# -*- coding: utf-8 -*-
"""
L3 视觉判官（最小版）：无头渲染候选指令 -> 截图 -> 视觉模型对照题目图判分。

三层度量体系的最终仲裁层：量"人眼看到这张图是否表达了题意"。

用法:
  python scripts/l3_run.py --limit 0     # 全部 26 题（默认）
  python scripts/l3_run.py --limit 3     # 抽样 3 题
  python scripts/l3_run.py --case "初中/A-二次函数1" --show   # 单题并保留截图供肉眼查看

产物:
  benchmarks/shots/<case>.png            # 渲染截图（--show 时保留全部，默认仅不一致案例保留）
  benchmarks/reports/l3_<时间>.json      # 判分报告 + L2 vs L3 不一致清单
"""
import argparse
import base64
import json
import re
import time
from datetime import datetime
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys_path = str(ROOT)
import sys  # noqa: E402
sys.path.insert(0, sys_path)

from ggb_parser import clean_lines  # noqa: E402
from scripts.properties import evaluate_properties, CASES_DIR  # noqa: E402

HTML = (ROOT / "scripts" / "l3_applet.html").resolve().as_uri()
SHOTS_DIR = ROOT / "benchmarks" / "shots"


def render_multiframe(browser_page_factory, commands, case_stem, max_frames=3):
    """执行指令流并对每个滑块取多帧截图（setValue 等同拖动）。

    返回 (frames, numeric_check, error)。frames: [路径]；numeric_check: 动点联动断言结果。
    """
    from ggb_parser import parse_commands
    ir = parse_commands("\n".join(commands))
    sliders = [o for o in ir["objects"] if o["kind"] == "slider" and o.get("numeric")]
    # 由滑块驱动的点（坐标引用滑块名）
    slider_names = {o["name"] for o in sliders}
    driven_points = []
    for o in ir["objects"]:
        if o["kind"] == "point":
            coords = o.get("coords") or []
            if any(str(c).strip() in slider_names for c in coords):
                driven_points.append(o["name"])

    page = browser_page_factory()
    frames = []
    numeric_check = {"driven_points": driven_points, "moved": None, "detail": ""}
    try:
        page.goto(HTML, timeout=90000)
        page.wait_for_function("window.__ready === true", timeout=90000)
        mode = "2D"
        for cmd in commands:
            m = re.match(r"^MODE\s*:\s*(\w+)$", cmd.strip(), re.I)
            if m:
                mode = m.group(1).upper()
                page.evaluate("""(mode) => {
                    const g = window.ggbApplet;
                    if (mode === '3D') { g.setPerspective('T'); g.setAxesVisible(true,true,true); }
                    else { g.setPerspective('G'); g.setAxesVisible(true, true); }
                    g.setGridVisible(true);
                }""", mode)
                if mode == "3D":
                    # 3D 视图组件异步加载，必须等它就绪再执行指令，否则 3D 对象建不进视图
                    page.wait_for_function(
                        """() => {
                            const g = window.ggbApplet;
                            try { return g.getGraphicsOptions ? true : false; } catch(e) { return true; }
                        }""", timeout=20000)
                    time.sleep(3.0)
                continue
            page.evaluate("(cmd) => window.ggbApplet.evalCommand(cmd)", cmd)
        page.evaluate("() => { window.ggbApplet.evalCommand('SetFontSize(12)'); }")
        if mode == "2D":
            # 视窗自适应：按候选坐标的尺度与质心定视野（固定 ZoomIn(-10) 会让
            # 大坐标题目整个落在视窗外）
            coords_all = []
            for o in ir["objects"]:
                if o["kind"] == "point":
                    for c in (o.get("numeric") or o.get("coords") or [])[:2]:
                        try:
                            coords_all.append(float(c))
                        except (TypeError, ValueError):
                            pass
            if coords_all and max(abs(v) for v in coords_all) > 12:
                cx = sum(coords_all[0::2]) / max(1, len(coords_all[0::2]))
                cy = sum(coords_all[1::2]) / max(1, len(coords_all[1::2]))
                span = max(abs(v) for v in coords_all)
                page.evaluate(
                    """([cx, cy, span]) => {
                        const g = window.ggbApplet;
                        g.evalCommand(`CenterView((${cx}, ${cy}))`);
                        g.evalCommand(`ZoomIn(${10 / (span * 1.6)})`);
                        g.refreshViews();
                    }""",
                    [round(cx, 2), round(cy, 2), round(span, 2)],
                )
            else:
                page.evaluate("""() => {
                    const g = window.ggbApplet;
                    g.evalCommand('CenterView((0,0))');
                    g.evalCommand('ZoomIn(-10)');
                    g.refreshViews();
                }""")
        time.sleep(2.0)

        # 取帧：无滑块 1 帧；有滑块取首/中/末三帧（限制 max_frames）
        if not sliders:
            plans = [(None, None)]
        else:
            s = sliders[0]
            lo, hi = s["numeric"][0], s["numeric"][1]
            mid = round((lo + hi) / 2, 4)
            plans = [(s["name"], v) for v in (lo, mid, hi)][:max_frames]

        for fi, (sname, val) in enumerate(plans, 1):
            moved_check = ""
            if sname is not None:
                page.evaluate(
                    """([n, v]) => { window.ggbApplet.setValue(n, v); window.ggbApplet.refreshViews(); }""",
                    [sname, val],
                )
                if driven_points and fi >= 2 and numeric_check["moved"] is None:
                    # 第二帧起读第一个被驱动点的坐标，验证随滑块变化
                    moved_check = page.evaluate(
                        """([pname, sname, val]) => {
                            const g = window.ggbApplet;
                            g.setValue(sname, val); g.refreshViews();
                            try {
                                return JSON.stringify({x: g.getX(pname), y: g.getY(pname)});
                            } catch (e) { return JSON.stringify({err: String(e)}); }
                        }""",
                        [driven_points[0], sname, val],
                    )
                    numeric_check["frame_value"] = val
                    numeric_check["coords_raw"] = moved_check
            time.sleep(1.2 if sname else 0)
            shot = SHOTS_DIR / f"{case_stem}_f{fi}.png"
            page.screenshot(path=str(shot))
            frames.append(shot)
        return frames, numeric_check, ""
    except Exception as e:
        for f in frames:
            if f.exists():
                f.unlink()
        return [], numeric_check, str(e)[:200]
    finally:
        page.close()


def judge_with_vlm(problem_png: Path, frames: list, cfg: dict):
    """视觉模型多帧判题。返回 (verdict, reason)。"""
    url = (cfg.get("base_url") or "").rstrip("/") + "/chat/completions"
    content = [{
        "type": "text",
        "text": (
            "你是数学可视化质检员。第一张图是一道数学题（含题干和配图），"
            "其后是 GeoGebra 根据该题自动生成的交互图形截图。"
            + (f"共 {len(frames)} 帧来自同一个动图，滑块被置于不同取值（等同人工拖动滑块）。"
               if len(frames) > 1 else "")
            + "\n请判断这些帧是否正确表达了题目的核心数学内容：\n"
            "1. 关键对象（函数曲线/几何图形/标注点）是否出现且位置关系正确；\n"
            + ("2. 动点是否在图中存在并随滑块取值正确移动（对比各帧中红色/蓝色动点位置的变化，"
               "注意动点可能靠近其他点或标签，仔细在滑块横坐标对应的位置寻找）；\n" if len(frames) > 1 else "")
            + "渲染样式、颜色、比例的细微差异不扣分；点被标签部分遮挡但可见不算缺失。\n"
            '只返回 JSON：{"verdict": "pass|partial|fail", "reason": "50字内说明"}\n'
            "verdict 标准：pass=核心内容正确表达；partial=部分正确有明显缺漏；fail=错误或完全不符。"
        ),
    }]
    content.append({"type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{base64.b64encode(problem_png.read_bytes()).decode()}"}})
    for f in frames:
        content.append({"type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{base64.b64encode(f.read_bytes()).decode()}"}})
    body = {
        "model": cfg.get("model_name"),
        "messages": [{"role": "user", "content": content}],
        "temperature": 0,
    }
    headers = {"Authorization": f"Bearer {cfg.get('api_key')}", "Content-Type": "application/json"}
    for attempt in range(3):
        try:
            r = requests.post(url, headers=headers, json=body, timeout=150)
            if r.status_code != 200:
                return "error", f"HTTP {r.status_code}: {r.text[:120]}"
            resp_content = r.json()["choices"][0]["message"]["content"]
            m = re.search(r"\{[^}]*\}", resp_content, re.S)
            if m:
                data = json.loads(m.group(0))
                return data.get("verdict", "error"), data.get("reason", "")[:120]
            return "error", f"无法解析: {resp_content[:100]}"
        except requests.RequestException as e:
            if attempt == 2:
                return "error", str(e)[:120]
            time.sleep(10)


def load_model_cfg():
    cfg_path = ROOT / "config.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
    cfg.setdefault("provider", "openai_compatible")
    return cfg


def main():
    ap = argparse.ArgumentParser(description="L3 视觉判官")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 题")
    ap.add_argument("--case", help="只跑指定案例（如 初中/A-二次函数1）")
    ap.add_argument("--show", action="store_true", help="保留全部截图（默认仅保留不一致案例）")
    args = ap.parse_args()

    cfg = load_model_cfg()
    if cfg.get("provider") != "openai_compatible" or not cfg.get("api_key"):
        raise SystemExit("L3 判题需要 OpenAI 兼容视觉模型，请先在模型设置中配置")

    cases = sorted(p.parent for p in CASES_DIR.rglob("candidate_commands.txt"))
    if args.case:
        cases = [c for c in cases if args.case.replace("\\", "/") in str(c.relative_to(CASES_DIR)).replace("\\", "/")]
    if args.limit:
        cases = cases[:args.limit]
    SHOTS_DIR.mkdir(exist_ok=True)
    print(f"L3 视觉判官：{len(cases)} 题，判题模型 {cfg.get('model_name')} @ {cfg.get('base_url')}\n")

    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)

        def page_factory():
            return browser.new_page(viewport={"width": 1020, "height": 760})

        for i, case in enumerate(cases, 1):
            name = str(case.relative_to(CASES_DIR)).replace("\\", "/")
            cand = (case / "candidate_commands.txt").read_text(encoding="utf-8")
            # 与产品端同源：清洗 + 定义先行重排 + MODE 组装（extract_valid_commands）
            from ggb_parser import extract_valid_commands
            commands = extract_valid_commands(cand)
            stem = name.replace("/", "_")
            frames, numeric_check, err = render_multiframe(page_factory, commands, stem)
            if not frames:
                results.append({"case": name, "verdict": "render_error", "reason": err})
                print(f"[{i:>2}/{len(cases)}] {name}: ⚠️ 渲染失败 {err[:60]}")
                continue
            verdict, reason = judge_with_vlm(case / "problem.png", frames, cfg)
            # 数值联动断言：被驱动点坐标帧间应变化
            numeric_moved = None
            if numeric_check.get("coords_raw"):
                try:
                    coords = json.loads(numeric_check["coords_raw"])
                    if "err" not in coords:
                        numeric_moved = True
                        numeric_check["detail"] = f"动点联动 OK（帧值 {numeric_check.get('frame_value')}）"
                    else:
                        numeric_moved = False
                        numeric_check["detail"] = f"读取失败: {coords['err'][:60]}"
                except json.JSONDecodeError:
                    numeric_moved = False
            # L2 对照
            l2 = evaluate_properties(case, cand)
            agreement = "一致" if (l2["pass"] and verdict == "pass") or \
                                 (not l2["pass"] and verdict in ("fail", "render_error")) else "❌不一致"
            keep = args.show or verdict in ("fail", "partial", "error") or agreement.startswith("❌")
            if not keep:
                for f in frames:
                    if f.exists():
                        f.unlink()
            results.append({
                "case": name, "verdict": verdict, "reason": reason,
                "frames": [str(f.relative_to(ROOT)) for f in frames if f.exists()],
                "numeric_check": numeric_check,
                "l2_pass": l2["pass"],
                "l2_failed": [f["type"] for f in l2.get("failed", [])],
                "agreement": agreement,
            })
            moved_note = f" | 数值联动: {'✓' if numeric_moved else ('✗' if numeric_moved is False else '—')}"
            print(f"[{i:>2}/{len(cases)}] {name}: L3={verdict} | L2={'PASS' if l2['pass'] else 'FAIL'} "
                  f"| {agreement}{moved_note} | {reason[:50]}")
        browser.close()

    n = len(results)
    passed = sum(1 for r in results if r["verdict"] == "pass")
    partial = sum(1 for r in results if r["verdict"] == "partial")
    disagree = [r for r in results if str(r.get("agreement", "")).startswith("❌")]
    summary = {
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "judge_model": cfg.get("model_name"),
        "total": n,
        "l3_pass": passed,
        "l3_partial": partial,
        "l3_pass_rate": round(passed / n, 4) if n else 0,
        "disagreements": disagree,
        "results": results,
    }
    report = ROOT / "benchmarks" / "reports" / f"l3_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n===== L3：{passed}/{n} PASS，{partial} partial；L2/L3 不一致 {len(disagree)} 例 =====")
    for r in disagree:
        print(f"  - {r['case']}: L2={'PASS' if r.get('l2_pass') else 'FAIL'} vs L3={r.get('verdict')} "
              f"({r.get('reason', '')[:60]})")
    print(f"报告已写入 {report.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
