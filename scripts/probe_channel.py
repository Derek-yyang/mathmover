# -*- coding: utf-8 -*-
"""通道健康探测：对 config.json 当前模型发 3 次小文本请求，全 200 则 exit 0。

用法:
  python scripts/probe_channel.py           # 探测 config.json 当前模型
  python scripts/probe_channel.py glm-5.3-flash   # 探测指定模型（仍用 config 的通道）
"""
import json
import sys
import time
import warnings
from pathlib import Path

import requests

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
BASE = cfg["base_url"].rstrip("/")
KEY = cfg["api_key"]
model = sys.argv[1] if len(sys.argv) > 1 else cfg["model_name"]
H = {"Authorization": f"Bearer {KEY}"}

for i in range(3):
    try:
        r = requests.post(
            f"{BASE}/chat/completions", headers=H, timeout=45,
            json={"model": model, "max_tokens": 10,
                  "messages": [{"role": "user", "content": "hi"}]},
        )
        if r.status_code == 200:
            print("OK")
            sys.exit(0)
        print(f"attempt{i+1}: HTTP {r.status_code}")
    except Exception as e:
        print(f"attempt{i+1}: {str(e)[:60]}")
    time.sleep(10)
sys.exit(1)
