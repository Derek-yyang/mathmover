# -*- coding: utf-8 -*-
"""generation-shaped probe: send a real image + ask for one GGB line.

Unlike probe_channel.py (tiny text), this mimics the pipeline's vision request
shape, which is what the distributor has been rejecting during the outage.
exit 0 on HTTP 200 within timeout; exit 1 otherwise.
"""
import base64
import io
import json
import sys
import warnings
from pathlib import Path

import requests

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
img_path = ROOT / "benchmarks" / "cases" / "初中" / "A-二次函数1" / "problem.png"
img = img_path.read_bytes()
b64 = base64.b64encode(img).decode()

cfg = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
BASE = cfg["base_url"].rstrip("/")
H = {"Authorization": f"Bearer {cfg['api_key']}"}

try:
    r = requests.post(
        f"{BASE}/chat/completions", headers=H, timeout=240,
        json={
            "model": sys.argv[1] if len(sys.argv) > 1 else cfg["model_name"], "max_tokens": 4000,
            "messages": [{"role": "user", "content": [
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{b64}"}},
                {"type": "text",
                 "text": "不要解题。只输出一行 GeoGebra 指令：A=(0,3)"},
            ]}],
        },
    )
    if r.status_code == 200:
        content = r.json()["choices"][0]["message"].get("content") or ""
        print("OK", content[:30].replace("\n", " "))
        sys.exit(0)
    print(f"HTTP {r.status_code}: {r.text[:80]}")
except Exception as e:
    print(f"EXC {str(e)[:80]}")
sys.exit(1)
