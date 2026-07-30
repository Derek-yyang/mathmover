# 统计 Supabase Storage 各桶的实际用量（递归分页遍历）
import os, sys
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

from supabase import create_client

sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

def list_all(bucket, prefix=""):
    """递归列出桶内所有文件对象，返回 (数量, 字节数)"""
    count, total = 0, 0
    offset = 0
    while True:
        items = sb.storage.from_(bucket).list(prefix, {"limit": 100, "offset": offset})
        if not items:
            break
        for it in items:
            name = it.get("name", "")
            # 文件夹条目没有 id；且 metadata 为 None
            if it.get("id") is None:
                sub_prefix = f"{prefix}/{name}" if prefix else name
                c, b = list_all(bucket, sub_prefix)
                count += c
                total += b
            else:
                count += 1
                meta = it.get("metadata") or {}
                total += int(meta.get("size") or 0)
        if len(items) < 100:
            break
        offset += 100
    return count, total

def human(n):
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024

grand_c, grand_b = 0, 0
for b in sb.storage.list_buckets():
    name = b.name if hasattr(b, "name") else b.get("name")
    c, size = list_all(name)
    grand_c += c
    grand_b += size
    print(f"{name}: {c} 个对象, {human(size)}")

print(f"\n总计: {grand_c} 个对象, {human(grand_b)}")
print(f"免费额度 1 GB 水位: {grand_b / (1024**3) * 100:.1f}%")
