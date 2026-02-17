import os
import google.generativeai as genai
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# 配置代理
os.environ['HTTP_PROXY'] = 'http://127.0.0.1:11719'
os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:11719'

api_key = os.getenv('GOOGLE_API_KEY')
print(f"API Key present: {bool(api_key)}")

genai.configure(api_key=api_key)

model_name = 'gemini-3-flash-preview'
print(f"Testing model: {model_name}")

try:
    model = genai.GenerativeModel(model_name)
    response = model.generate_content("Hello, this is a test connection. Reply with 'OK' if you receive this.")
    print("\n--- Response from Gemini ---")
    print(response.text)
    print("----------------------------")
    print("Test SUCCESS!")
except Exception as e:
    print("\n--- Error ---")
    print(e)
    print("-------------")
    print("Test FAILED.")
