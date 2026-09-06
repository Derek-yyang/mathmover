# -*- coding: utf-8 -*-
"""通道健康探测：对指定模型发 3 次小文本请求，全 200 则 exit 0，否则 exit 1。"""
import sys
import time
import warnings

import requests

warnings.filterwarnings("ignore")

model = sys.argv[1] if len(sys.argv) > 1 else "glm-5.3-flash"
BASE = "https://api.b.ai/v1"
KEY = "sk-2gvwqexgxj3b9c7up95j7qvj2uzxrptx"
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
