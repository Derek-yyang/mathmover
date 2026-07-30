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

def generate_random_string(length=16):
    """生成指定长度的大写字母+数字随机字符串"""
    # 使用 hex 风格或者纯大写字母+数字
    # JS 版本用的是 hex，这里我们也用 hex 风格保持一致，或者用字母+数字
    # 既然是会员码，通常长一点，16位 hex 是比较常见的
    # JS version: crypto.randomBytes(8).toString('hex').toUpperCase() -> 16 chars 0-9 A-F
    # Python equivalent:
    return ''.join(random.choices('0123456789ABCDEF', k=length))

def main():
    parser = argparse.ArgumentParser(description='Generate membership codes for MathMover')
    parser.add_argument('--count', type=int, default=1, help='Number of codes to generate')
    parser.add_argument('--days', type=int, required=True, help='Duration in days (e.g., 30, 365)')
    parser.add_argument('--tier', type=str, required=True, choices=['basic', 'pro'], help="Membership tier ('basic' or 'pro')")
    args = parser.parse_args()

    # 初始化 Supabase 客户端
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Error: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not found in .env")
        print(f"Loaded .env from: {dotenv_path}")
        # 尝试打印一下当前目录下有什么文件，帮助调试
        # print(f"Current dir: {os.getcwd()}")
        # print(f"Parent dir files: {os.listdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))}")
        return

    try:
        supabase: Client = create_client(url, key)
    except Exception as e:
        print(f"Error connecting to Supabase: {e}")
        return

    print(f"Starting generation of {args.count} codes for {args.days} days of {args.tier} membership...")

    codes_to_insert = []
    generated_codes_set = set()

    # 1. 生成不重复的码 (内存去重)
    while len(codes_to_insert) < args.count:
        new_code = generate_random_string(16)
        if new_code not in generated_codes_set:
            generated_codes_set.add(new_code)
            codes_to_insert.append({
                "code": new_code,
                "duration_days": args.days,
                "subscription_tier": args.tier,
                "is_used": False
            })

    # 2. 批量插入数据库
    try:
        # Supabase 的 insert 支持列表，直接批量插入
        response = supabase.table("membership_codes").insert(codes_to_insert).execute()
        
        inserted_data = response.data
        
        # 3. 确认插入成功并导出
        if inserted_data and len(inserted_data) > 0:
            count = len(inserted_data)
            print(f"Successfully inserted {count} codes to database.")
            
            # 导出到文件
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            # 文件名：membership_codes_pro_30days_10x_20240523_120000.txt
            filename = f"membership_codes_{args.tier}_{args.days}days_{count}x_{timestamp}.txt"
            # 保存到 scripts 目录同级，或者直接在当前运行目录
            output_path = os.path.join(os.getcwd(), filename)
            
            with open(output_path, "w", encoding='utf-8') as f:
                for item in inserted_data:
                    # 格式：CODE (TIER, DAYS days)
                    f.write(f"{item['code']} ({item['subscription_tier']}, {item['duration_days']} days)\n")
            
            print(f"Codes exported to: {output_path}")
            print("Done!")
            
            # 打印到控制台
            print('\nGenerated codes:')
            print('----------------------------------------')
            for item in inserted_data:
                 print(f"{item['code']} ({item['subscription_tier']}, {item['duration_days']} days)")
            print('----------------------------------------')
            
        else:
            print("Warning: Database returned empty response. Check permissions or table structure.")

    except Exception as e:
        print(f"Error inserting codes: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
