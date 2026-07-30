# 验证 Agnes 接入：文本 ping + 图片识别（走生产同款 OpenAICompatibleAdapter）
import os, sys, time
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import ModelFactory

adapter = ModelFactory.create()
print(f"adapter = {type(adapter).__name__}, model = {adapter.model_name}")

# 1. 纯文本 ping
t0 = time.time()
text = adapter.generate("用一句话回答：勾股定理的内容是什么？")
print(f"[文本] {time.time()-t0:.1f}s -> {text[:120]}")

# 2. 图片识别（用项目自带的案例图）
img_path = os.path.join("math-mover-next", "public", "cases", "case1.png")
with open(img_path, "rb") as f:
    img = f.read()
t0 = time.time()
text2 = adapter.generate("描述这张图片里的数学内容，50 字以内。", image_bytes=img, mime_type="image/png")
print(f"[图片] {time.time()-t0:.1f}s -> {text2[:200]}")
