# -*- coding: utf-8 -*-
"""
正式验收 runner：多模型 × 多轮 × 26 题（L2 性质判分）。

用法:
  1. 在 benchmarks/acceptance_models.json 里登记验收模型：
     [
       {"name": "qwen38-flash",  "provider": "dashscope",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api_key": "sk-...", "model_name": "qwen3.8-flash", "timeout_seconds": 240},
       {"name": "glm46v", "provider": "zhipu",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "api_key": "xxx", "model_name": "glm-4.6v", "timeout_seconds": 240}
     ]
  2. python scripts/acceptance_run.py --rounds 3
     （每模型每轮自动切换 config.json -> 跑批 -> 收集报告，结束后恢复原 config.json）
  3. 可选 L3 视觉判官：--with-l3（判官固定用 config.json 备份里的原模型，
     避免验收过程中判官跟着被切换）

产物:
  benchmarks/reports/acceptance_<时间>/  每模型每轮的原始报告
  benchmarks/reports/acceptance_summary_<时间>.json  总矩阵
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

MODELS_FILE = ROOT / "benchmarks" / "acceptance_models.json"
CONFIG_PATH = ROOT / "config.json"
REPORTS = ROOT / "benchmarks" / "reports"
PYTHON = str(ROOT / ".venv" / "Scripts" / "python.exe")


def write_model_config(entry: dict):
    """把某个验收模型的接入信息写入 config.json（后端每请求重读，即时生效）。"""
    cfg = {
        "provider": "openai_compatible",
        "base_url": entry["base_url"].rstrip("/"),
        "api_key": entry["api_key"],
        "model_name": entry["model_name"],
        "timeout_seconds": str(entry.get("timeout_seconds", 240)),
    }
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def run_batch(label: str, fresh: bool):
    cmd = [PYTHON, str(ROOT / "scripts" / "bench_run.py"),
           "--label", label, "--skip-channel-check"]
    if fresh:
        cmd.append("--fresh")
    print(f"\n>>> 跑批 {label}")
    subprocess.run(cmd, cwd=str(ROOT), check=False)


def main():
    ap = argparse.ArgumentParser(description="多模型正式验收 runner")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--models-file", default=str(MODELS_FILE))
    ap.add_argument("--with-l3", action="store_true",
                    help="每轮结束后追加 L3 视觉判官（判官固定为验收前的原模型）")
    args = ap.parse_args()

    models = json.loads(Path(args.models_file).read_text(encoding="utf-8"))
    if not models:
        raise SystemExit(f"模型清单为空：请在 {MODELS_FILE.relative_to(ROOT)} 登记验收模型")

    original_cfg = CONFIG_PATH.read_text(encoding="utf-8") if CONFIG_PATH.exists() else None
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    acc_dir = REPORTS / f"acceptance_{stamp}"
    acc_dir.mkdir(parents=True, exist_ok=True)
    print(f"验收模型 {len(models)} 个 × {args.rounds} 轮，报告目录 {acc_dir.relative_to(ROOT)}\n")

    try:
        for entry in models:
            name = entry["name"]
            print(f"\n================ 模型：{name} ({entry['model_name']}) ================")
            write_model_config(entry)
            time.sleep(2)
            for rnd in range(1, args.rounds + 1):
                label = f"acc_{name}_r{rnd}"
                run_batch(label, fresh=True)
                # 把该轮报告挪进验收目录
                reports = sorted(REPORTS.glob(f"{label}_*.json"))
                if reports:
                    shutil.move(str(reports[-1]), acc_dir / reports[-1].name)
            if args.with_l3:
                print(f">>> L3 视觉判官：{name}")
                subprocess.run([PYTHON, str(ROOT / "scripts" / "l3_run.py"),
                                "--limit", "0"], cwd=str(ROOT), check=False)
                l3s = sorted(REPORTS.glob("l3_*.json"))
                if l3s:
                    shutil.move(str(l3s[-1]), acc_dir / f"l3_{name}_{l3s[-1].name}")
    finally:
        if original_cfg is not None:
            CONFIG_PATH.write_text(original_cfg, encoding="utf-8")
            print("\n原 config.json 已恢复")

    # 汇总矩阵
    summary = {}
    for r in sorted(acc_dir.glob("acc_*_r*.json")):
        data = json.loads(r.read_text(encoding="utf-8"))
        model = data["label"].rsplit("_r", 1)[0].replace("acc_", "")
        s = summary.setdefault(model, {"rounds": 0, "pass_rates": []})
        s["rounds"] += 1
        s["pass_rates"].append(data.get("pass_rate", 0))
    final = {}
    for model, s in summary.items():
        rates = s["pass_rates"]
        final[model] = {"rounds": s["rounds"],
                        "pass_rates": rates,
                        "mean": round(sum(rates) / len(rates), 4) if rates else 0,
                        "min": round(min(rates), 4) if rates else 0}
    out = ROOT / "benchmarks" / "reports" / f"acceptance_summary_{stamp}.json"
    out.write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n===== 验收总矩阵 =====")
    for model, s in final.items():
        print(f"{model}: {s['rounds']} 轮 | 均值 {s['mean']:.0%} | 最低 {s['min']:.0%}")
    print(f"已写入 {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
