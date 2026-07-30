import os
import random
import string
import argparse
import datetime
from dotenv import load_dotenv
from supabase import create_client, Client

# 加载环境变量
# 注意：.. 表示上一级目录，即项目根目录
dotenv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
load_dotenv(dotenv_path)

def generate_random_string(length=8):
    """生成指定长度的大写字母+数字随机字符串"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choices(chars, k=length))

def generate_code_string():
    """生成格式为 MATH-XXXX-XXXX 的兑换码"""
    part1 = generate_random_string(4)
    part2 = generate_random_string(4)
    return f"MATH-{part1}-{part2}"

def main():
    parser = argparse.ArgumentParser(description='Generate redemption codes for MathMover')
    parser.add_argument('--count', type=int, default=10, help='Number of codes to generate')
    parser.add_argument('--points', type=int, default=50, help='Points value for each code')
    args = parser.parse_args()

    # 初始化 Supabase 客户端
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env")
        print(f"Loaded .env from: {dotenv_path}")
        return

    try:
        supabase: Client = create_client(url, key)
    except Exception as e:
        print(f"Error connecting to Supabase: {e}")
        return

    print(f"Starting generation of {args.count} codes with {args.points} points each...")

    codes_to_insert = []
    generated_codes_set = set()

    # 1. 生成不重复的码 (内存去重)
    while len(codes_to_insert) < args.count:
        new_code = generate_code_string()
        if new_code not in generated_codes_set:
            generated_codes_set.add(new_code)
            codes_to_insert.append({
                "code": new_code,
                "points": args.points,
                "is_used": False
            })

    # 2. 批量插入数据库
    try:
        # Supabase 的 insert 支持列表，直接批量插入
        # 注意：execute() 返回的是 APIResponse，包含 data 属性
        response = supabase.table("redemption_codes").insert(codes_to_insert).execute()
        
        inserted_data = response.data
        
        # 3. 确认插入成功并导出
        if inserted_data and len(inserted_data) > 0:
            count = len(inserted_data)
            print(f"Successfully inserted {count} codes to database.")
            
            # 导出到文件
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            # 文件名：codes_50pts_100x_20240523_120000.txt
            filename = f"codes_{args.points}pts_{count}x_{timestamp}.txt"
            # 保存到 scripts 目录同级，或者直接在当前运行目录
            output_path = os.path.join(os.getcwd(), filename)
            
            with open(output_path, "w", encoding='utf-8') as f:
                for item in inserted_data:
                    # 只写入卡密本身，方便复制
                    f.write(f"{item['code']}\n")
            
            print(f"Codes exported to: {output_path}")
            print("Done!")
        else:
            print("Warning: Database returned empty response. Check permissions or table structure.")

    except Exception as e:
        print(f"Error inserting codes: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
