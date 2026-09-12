# -*- coding: utf-8 -*-
"""L3 判官校准包：从统一判官报告抽样（每模型 pass/partial/fail 各一例），
本地渲染多帧 + 原题图，生成盲评 HTML——人不看判官结论，独立复验。

用法:
  python scripts/build_review_pack.py          # 抽样+渲染+生成 benchmarks/review/

产物:
  benchmarks/review/R01..R12/  每例: problem.png + f1/f2/f3 帧
  benchmarks/review/index.html 盲评索引（不含模型名与判官结论）
  benchmarks/review/manifest.json 盲评映射（对答案用，人别先看）
  benchmarks/review/verdicts.txt 人工复验填写模板
"""
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

import l3_run  # noqa: E402
from ggb_parser import extract_valid_commands  # noqa: E402
from scripts.properties import CASES_DIR  # noqa: E402

REVIEW = ROOT / "benchmarks" / "review"
UNIFIED = [
    ("candidate_mimo_2stage.txt", "l3_20260912_160634.json"),
    ("candidate_glm_2stage.txt", "l3_20260912_162716.json"),
    ("candidate_qwen_2stage.txt", "l3_20260912_165446.json"),
    ("candidate_ds_2stage.txt", "l3_20260912_171843.json"),
]


def pick_samples():
    """每模型抽 pass/partial/fail 各一例。"""
    picks = []
    for archive, report in UNIFIED:
        d = json.loads((ROOT / "benchmarks" / "reports" / report).read_text(encoding="utf-8"))
        got = {}
        for r in d["results"]:
            v = r["verdict"]
            if v in ("pass", "partial", "fail") and v not in got:
                got[v] = r
            if len(got) == 3:
                break
        for v in ("pass", "partial", "fail"):
            if v in got:
                picks.append((archive, got[v]))
    return picks


def main():
    samples = pick_samples()
    REVIEW.mkdir(parents=True, exist_ok=True)
    manifest = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)

        def page_factory():
            return browser.new_page(viewport={"width": 1020, "height": 760})

        for i, (archive, r) in enumerate(samples, 1):
            rid = f"R{i:02d}"
            case = CASES_DIR / r["case"]
            out = REVIEW / rid
            out.mkdir(exist_ok=True)
            shutil.copy(case / "problem.png", out / "problem.png")
            commands = extract_valid_commands((case / archive).read_text(encoding="utf-8"))
            l3_run.SHOTS_DIR = out  # 渲染帧直接落到该例目录
            frames, numeric_check, err = [], {}, ""
            for attempt in range(2):  # applet 外部资源偶发加载超时，重试一次
                frames, numeric_check, err = l3_run.render_multiframe(page_factory, commands, rid)
                if frames:
                    break
                print(f"  {rid} 第{attempt + 1}次渲染失败：{err[:60]}，重试")
            manifest.append({
                "id": rid, "model_archive": archive, "case": r["case"],
                "judge_verdict": r["verdict"], "judge_reason": r.get("reason", ""),
                "render_error": err, "frames": [f.name for f in frames],
            })
            print(f"{rid}: {r['case']}（判官={r['verdict']}）渲染 {len(frames)} 帧")
        browser.close()

    (REVIEW / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    rows = []
    for m in manifest:
        frames_html = "".join(
            f'<figure><img src="{m["id"]}/{f}"><figcaption>{f}</figcaption></figure>'
            for f in m["frames"])
        rows.append(f"""
  <section>
    <h2>{m['id']}</h2>
    <figure class="prob"><img src="{m['id']}/problem.png"><figcaption>原题图</figcaption></figure>
    {frames_html}
    <p class="verdict">人工判定：<input type="radio" name="{m['id']}" value="pass">通过
       <input type="radio" name="{m['id']}" value="fail">不通过　
       理由（可选）：<input type="text" name="{m['id']}_reason" size="50"></p>
  </section>""")

    html = f"""<!doctype html><meta charset="utf-8">
<title>L3 判官校准盲评（{len(manifest)} 例）</title>
<style>body{{font-family:sans-serif;max-width:1100px;margin:auto}}
img{{max-width:100%}}figure{{display:inline-block;margin:4px;vertical-align:top}}
figcaption{{font-size:12px;color:#666}}.prob img{{max-width:420px}}
section{{border-top:2px solid #333;padding:8px 0}}.verdict{{font-size:16px}}</style>
<h1>L3 判官校准盲评</h1>
<p>每例：原题图 + 渲染三帧（滑块首/中/末，等同拖动动点）。
判定标准：这张图是否忠实表达了题意（人眼验收口径）。</p>
{''.join(rows)}"""
    (REVIEW / "index.html").write_text(html, encoding="utf-8")

    lines = [f"# 盲评填写模板（共 {len(manifest)} 例）：每行 Rxx: 通过|不通过 [理由]"]
    lines += [f"{m['id']}: " for m in manifest]
    (REVIEW / "verdicts.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n盲评包就绪：{REVIEW.relative_to(ROOT)}/index.html（{len(manifest)} 例）")
    print(f"对答案映射（先别看）: manifest.json；填写: verdicts.txt")


if __name__ == "__main__":
    main()
