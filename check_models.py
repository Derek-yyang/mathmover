import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# 配置代理
os.environ['HTTP_PROXY'] = 'http://127.0.0.1:11719'
os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:11719'

api_key = os.getenv('GOOGLE_API_KEY')
if not api_key:
    print("Error: GOOGLE_API_KEY not set")
    exit(1)

genai.configure(api_key=api_key)

print("Listing available models...")
try:
    for m in genai.list_models():
        if 'generateContent' in m.supported_generation_methods:
            print(f"- {m.name}")
except Exception as e:
    print(f"Error listing models: {e}")
