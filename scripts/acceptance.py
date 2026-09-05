# -*- coding: utf-8 -*-
"""
正式验收编排：多模型 × 26 题基准跑批。

对指定模型逐一：写入 config.json（后端每请求热读，无需重启）→
跑 bench_run 全量 → 恢复原 config → 产出对比矩阵。

用法:
  python scripts/acceptance.py --models qwen3.5-plus qwen3.7-plus ... --rounds 1
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

CONFIG = ROOT / "config.json"


def set_model(model_name: str):
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    cfg["model_name"] = model_name
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def run_batch(label: str) -> int:
    r = subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "bench_run.py"),
         "--label", label, "--fresh", "--skip-channel-check"],
        cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
    )
    tail = (r.stdout or "").strip().splitlines()[-3:]
    for line in tail:
        print("   ", line[:110])
    return r.returncode


def main():
    ap = argparse.ArgumentParser(description="多模型验收编排")
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--rounds", type=int, default=1)
    args = ap.parse_args()

    original = CONFIG.read_text(encoding="utf-8")
    started = datetime.now()
    try:
        for rnd in range(1, args.rounds + 1):
            for model in args.models:
                label = f"acc_{model.replace('/', '_')}_r{rnd}"
                print(f"\n===== [{datetime.now().strftime('%H:%M')}] {model} 第 {rnd} 轮 =====")
                set_model(model)
                time.sleep(2)
                rc = run_batch(label)
                if rc != 0:
                    print(f"    ⚠️ 跑批退出码 {rc}，继续下一个")
    finally:
        CONFIG.write_text(original, encoding="utf-8")
        print(f"\nconfig.json 已恢复原样。总耗时 {datetime.now() - started}")


if __name__ == "__main__":
    main()
