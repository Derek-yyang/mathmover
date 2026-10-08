# -*- coding: utf-8 -*-
"""批量跑五题新链路并导出可注入浏览器的 localStorage 脚本。

用法：
  .venv/Scripts/python.exe -B scripts/batch_sop_eval.py                 # 跑五题
  .venv/Scripts/python.exe -B scripts/batch_sop_eval.py --skip-existing # 只跑缺的

产物：
  benchmarks_manual/eval_results.json   原始结果（含耗时/校验元数据）
  benchmarks_manual/inject_mathmover.js 浏览器控制台粘贴脚本（注入 localStorage）
"""
import base64
import io
import json
import time
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "benchmarks_manual"

CASES = [
    ("初中题/二次函数1.png", "初中-二次函数1"),
    ("初中题/二次函数2.png", "初中-二次函数2"),
    ("初中题/二次函数3.png", "初中-二次函数3"),
    ("初中题/二次函数4.png", "初中-二次函数4"),
    ("初中题/二次函数5.png", "初中-二次函数5"),
]


def make_thumbnail(png_bytes: bytes, max_edge: int = 96) -> str | None:
    """与前端 makeThumbnail 同规格：canvas 画到 maxEdge 内，JPEG 0.7。"""
    try:
        from PIL import Image
        with Image.open(io.BytesIO(png_bytes)) as im:
            im = im.convert("RGB")
            scale = min(1, max_edge / max(im.width, im.height))
            w, h = max(1, round(im.width * scale)), max(1, round(im.height * scale))
            im = im.resize((w, h))
            buf = io.BytesIO()
            im.save(buf, format="JPEG", quality=0.7)
            return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None


def run_case(img_path: Path, title: str) -> dict:
    with open(img_path, "rb") as f:
        img = f.read()
    boundary = uuid.uuid4().hex
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"{img_path.name}\"\r\nContent-Type: image/png\r\n\r\n"
    ).encode() + img + (
        f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"responseMode\"\r\n\r\nstream\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:5000/api/upload", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})

    t0 = time.time()
    record = {
        "id": f"gen_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}",
        "title": title,
        "problem_type": None,
        "category": None,
        "commands": [],
        "thumbnail": make_thumbnail(img),
        "router_meta": None,
        "_eval": {"image": str(img_path.relative_to(ROOT)), "started": datetime.now().isoformat(timespec='seconds')},
    }
    with urllib.request.urlopen(req, timeout=900) as resp:
        for line in resp:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            st = ev.get("status")
            if st == "classified":
                record["category"] = ev.get("category")
                record["router_meta"] = ev.get("router")
            elif st == "completed":
                record["commands"] = ev.get("commands") or []
                record["_eval"]["validation"] = ev.get("validation")
            elif st == "error":
                record["_eval"]["error"] = ev.get("message")
    record["_eval"]["elapsed_s"] = round(time.time() - t0, 1)
    return record


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-existing", action="store_true", help="已有结果标题的题跳过")
    args = ap.parse_args()
    OUT_DIR.mkdir(exist_ok=True)
    results_path = OUT_DIR / "eval_results.json"
    results = json.loads(results_path.read_text(encoding="utf-8")) if results_path.exists() else []
    done_titles = {r["title"] for r in results}

    for rel, title in CASES:
        if args.skip_existing and title in done_titles:
            print(f"[skip] {title}")
            continue
        img = ROOT / "测试题目图片" / rel
        print(f"[run ] {title} ...", flush=True)
        try:
            rec = run_case(img, title)
        except Exception as e:
            print(f"[FAIL] {title}: {e}")
            continue
        results = [r for r in results if r["title"] != title] + [rec]
        results_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        v = rec.get("_eval", {}).get("validation") or {}
        print(f"[done] {title}: {rec['category']} 类, {len(rec['commands'])} 条指令, "
              f"有效率 {v.get('validity')}, 语义重试 {v.get('semantic_retries')}, "
              f"耗时 {rec['_eval']['elapsed_s']}s", flush=True)

    # 生成注入脚本
    records = [{k: r[k] for k in ("id", "title", "problem_type", "category",
                                  "commands", "created_at", "thumbnail", "router_meta")
                if k in r} for r in results]
    payload = json.dumps(records, ensure_ascii=False)
    js = f"""// MathMover 历史注入脚本（benchmarks_manual 人工验收样本）
// 用法：打开 dashboard 页面 → F12 控制台 → 粘贴运行 → 刷新页面
(() => {{
  const KEY = "mathmover_generations_v1";
  const MAX = 50;
  const incoming = {payload};
  let existing = [];
  try {{ existing = JSON.parse(localStorage.getItem(KEY) || "[]"); }} catch (e) {{}}
  const byId = new Map(existing.map(r => [r.id, r]));
  incoming.forEach(r => byId.set(r.id, r));  // 注入覆盖同 id
  const merged = [...byId.values()]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent("mathmover_generations_changed"));
  console.log(`已注入 ${{incoming.length}} 条样本，合并后共 ${{merged.length}} 条历史`);
}})();
"""
    (OUT_DIR / "inject_mathmover.js").write_text(js, encoding="utf-8")
    n_ok = sum(1 for r in results if r["commands"])
    print(f"\n汇总: {n_ok}/{len(results)} 条有效 → {OUT_DIR / 'inject_mathmover.js'}")


if __name__ == "__main__":
    main()
