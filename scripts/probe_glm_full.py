# -*- coding: utf-8 -*-
"""full-payload probe: replicate the pipeline's real specialist request shape
(system = expert prompt, user = image + short text) against glm-5.3-flash.
Times the request; exit 0 on 200. Distinguishes payload-size failures from
tiny-probe success.
"""
import base64
import io
import sys
import time
import warnings
from pathlib import Path

import requests

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from expert_prompts import EXPERT_PROMPTS  # noqa: E402


def shrink(image_bytes, max_side=1400, quality=85):
    from PIL import Image
    buf = io.BytesIO(image_bytes)
    with Image.open(buf) as im:
        im = im.convert('RGB')
        im.thumbnail((max_side, max_side))
        out = io.BytesIO()
        im.save(out, format='JPEG', quality=quality)
        return out.getvalue()


def attempt(prompt, b64, mime, timeout):
    t0 = time.time()
    try:
        r = requests.post(
            f"{BASE}/chat/completions", headers=H, timeout=timeout,
            json={
                "model": "glm-5.3-flash",
                "messages": [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": [
                        {"type": "image_url",
                         "image_url": {"url": f"data:{mime};base64,{b64}"}},
                        {"type": "text", "text": "请根据图片内容执行任务。"},
                    ]},
                ],
            },
        )
        dt = time.time() - t0
        if r.status_code == 200:
            content = r.json()["choices"][0]["message"].get("content") or ""
            print(f"OK in {dt:.0f}s, content {len(content)} chars")
            return 0
        print(f"HTTP {r.status_code} after {dt:.0f}s")
    except Exception as e:
        print(f"EXC after {time.time()-t0:.0f}s: {str(e)[:90]}")
    return 1


category = sys.argv[1] if len(sys.argv) > 1 else "C"
img_rel = sys.argv[2] if len(sys.argv) > 2 else "高中/C-抛物线2"
img_path = Path("benchmarks/cases") / f"{img_rel}/problem.png"
img = img_path.read_bytes()
prompt = EXPERT_PROMPTS[category]
print(f"prompt chars: {len(prompt)}, image KB: {len(img)//1024}")

BASE = "https://api.b.ai/v1"
KEY = "sk-2gvwqexgxj3b9c7up95j7qvj2uzxrptx"
H = {"Authorization": f"Bearer {KEY}"}

# 模拟管线真实降级：全尺寸短超时先试，失败换压缩图（与后端行为一致）
rc = attempt(prompt, base64.b64encode(img).decode(), "image/png", 150)
if rc != 0:
    shrunk = shrink(img)
    print(f"shrunk image KB: {len(shrunk)//1024}")
    rc = attempt(prompt, base64.b64encode(shrunk).decode(), "image/jpeg", 420)
sys.exit(rc)
