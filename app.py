import os
import json
import base64
import io
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from google import genai
from google.genai import types
from dotenv import load_dotenv
from flask_cors import CORS
import openai
import requests
from urllib.parse import urlparse
import sys

# GGB 指令解析器（与基线判分工具 scripts/benchmark.py 共用同一实现）
import ggb_parser
from expert_prompts import EXPERT_PROMPTS

# 加载环境变量
load_dotenv()

app = Flask(__name__)
try:
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)
except Exception:
    pass

DEFAULT_CORS_ORIGINS = [
    "https://mathmover.top",
    "https://www.mathmover.top",
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3010",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3010",
]


def get_cors_origins() -> list[str]:
    extra_origins = [
        origin.strip()
        for origin in (os.getenv('CORS_ORIGINS') or '').split(',')
        if origin.strip()
    ]
    return DEFAULT_CORS_ORIGINS + extra_origins


CORS(app, origins=get_cors_origins())

MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_GEMINI_MODEL = os.getenv('GEMINI_MODEL_NAME', 'gemini-3-flash-preview')
DEFAULT_MODEL_TIMEOUT = int(os.getenv('MODEL_TIMEOUT_SECONDS', '75'))

# --- 本地模型配置层（去 SaaS 化）---
# 运行时模型配置存于本地 config.json（可经 /api/config 修改），替代原 Supabase profiles。
# 优先级：config.json > .env SYSTEM_* > Gemini 默认。
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
CONFIG_KEYS = ('provider', 'base_url', 'api_key', 'model_name', 'timeout_seconds')


def load_local_model_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            raw = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        raw = {}
    out = {}
    for k in CONFIG_KEYS:
        v = raw.get(k)
        out[k] = str(v).strip() if v is not None else ''
    return out


def save_local_model_config(cfg: dict) -> dict:
    clean = {}
    for k in CONFIG_KEYS:
        v = cfg.get(k)
        clean[k] = str(v).strip() if v is not None else '' 
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(clean, f, ensure_ascii=False, indent=2)
    return clean


def apply_env_defaults(cfg: dict) -> dict:
    """config.json 缺项时回落到 .env SYSTEM_* / Gemini。"""
    cfg['timeout_seconds'] = cfg.get('timeout_seconds') or str(DEFAULT_MODEL_TIMEOUT)
    if not cfg.get('provider'):
        env_provider = (os.getenv('SYSTEM_MODEL_PROVIDER') or '').strip().lower()
        cfg['provider'] = 'openai_compatible' if env_provider in ('openai', 'openai_compatible', 'openai-compatible') else 'gemini'
    if cfg['provider'] == 'openai_compatible':
        cfg['base_url'] = cfg.get('base_url') or (os.getenv('SYSTEM_BASE_URL') or '')
        cfg['api_key'] = cfg.get('api_key') or (os.getenv('SYSTEM_API_KEY') or '')
        cfg['model_name'] = cfg.get('model_name') or (os.getenv('SYSTEM_MODEL_NAME') or '')
    else:
        cfg['base_url'] = ''
        cfg['api_key'] = cfg.get('api_key') or (os.getenv('GOOGLE_API_KEY') or '')
        cfg['model_name'] = cfg.get('model_name') or DEFAULT_GEMINI_MODEL
    return cfg


# 默认 Gemini 配置
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')

# --- Prompt Definitions (保留原有的 Prompt) ---
ROUTER_PROMPT = """
你是一个数学题目分类器。请根据图片内容，判断题目属于以下哪一类，并仅返回对应的字母类别代码（A/B/C/D）。

分类标准：
A：函数与图像（一次函数、开口向上/向下的二次函数（抛物线）、三角函数、导数、一般函数）
B：平面几何（圆、多边形、角平分线、平面向量）
C：解析几何（椭圆、双曲线、开口向左/向右的抛物线、圆锥曲线）
D：立体几何（正方体、四面体、空间动点、球、旋转体）

要求：
- 请严格以 JSON 格式返回，不要包含任何 markdown 格式化（如 ```json ... ```）。
- 格式如下：
{"category": "A", "reason": "这里写你的解释..."}
- category 只能是 A、B、C 或 D。
"""

PROMPT_MAP = EXPERT_PROMPTS


def build_allowed_commands_suffix(category: str) -> str:
    """从 ggb_commands.json（单一事实来源）生成 prompt 的允许命令集。

    与校验白名单同源：这里列出什么，解析器就放行什么。
    """
    names = ggb_parser.whitelist_command_names()
    views = ["2d", "3d"] if category == 'D' else ["2d"]
    ctor_lines = []
    for v in views:
        label = "3D 专用" if v == "3d" else "2D"
        cmds = names.get(v, [])
        if cmds:
            ctor_lines.append(f"- {'3D ' if v == '3d' else ''}构造命令: {', '.join(cmds)}")
    return (
        "\n### 严格语法约束（系统自动生成，与校验白名单同源）\n"
        + "\n".join(ctor_lines)
        + f"\n- 属性命令: {', '.join(names['attributes'])}"
        + f"\n- 视图命令: {', '.join(names['globals'])}"
        + "\n- 仅可使用以上命令，不要使用任何其他命令，不要输出注释或说明文字。\n"
    )


# --- Model Factory & Adapters ---

class ModelAdapter:
    def generate(self, prompt, image_bytes=None, mime_type=None):
        raise NotImplementedError

class GeminiAdapter(ModelAdapter):
    def __init__(self, api_key=None, model_name=DEFAULT_GEMINI_MODEL, timeout_seconds=None):
        api_key = (api_key or '').strip()
        model_name = (model_name or DEFAULT_GEMINI_MODEL).strip()
        if not api_key:
            raise ValueError("GOOGLE_API_KEY is missing")

        self.client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=int(timeout_seconds or MODEL_TIMEOUT_SECONDS) * 1000),
        )
        self.model_name = model_name

    def generate(self, prompt, image_bytes=None, mime_type=None):
        content = [prompt]
        if image_bytes:
            content.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type or 'image/jpeg',
                )
            )

        response = self.client.models.generate_content(
            model=self.model_name,
            contents=content,
        )

        try:
            text = response.text
        except Exception:
            text = ""
        return (text or "").strip()

class OpenAICompatibleAdapter(ModelAdapter):
    def __init__(self, api_key, base_url, model_name, timeout_seconds=None):
        api_key = (api_key or '').strip()
        base_url = (base_url or '').strip().rstrip('/')
        model_name = (model_name or '').strip()
        self.client = openai.OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=int(timeout_seconds or MODEL_TIMEOUT_SECONDS),
        )
        # By default we do NOT cross-switch DashScope regions for BYOK.
        # A key can be region-scoped; automatic cross-region fallback can
        # turn transient timeout into deterministic invalid_api_key.
        allow_cross_region_fallback = (
            (os.getenv('ALLOW_DASHSCOPE_CROSS_REGION_FALLBACK') or '').strip().lower() == 'true'
        )
        self.fallback_client = None
        if allow_cross_region_fallback and base_url and 'dashscope-intl.aliyuncs.com' in base_url:
            fallback_url = base_url.replace('dashscope-intl.aliyuncs.com', 'dashscope.aliyuncs.com')
            self.fallback_client = openai.OpenAI(
                api_key=api_key,
                base_url=fallback_url,
                timeout=MODEL_TIMEOUT_SECONDS,
            )
        self.model_name = model_name

    @staticmethod
    def _shrink_image(image_bytes, max_side=1400, quality=85):
        """压缩图片用于对大载荷敏感的上游：等比缩到 max_side 内并转 JPEG。

        失败或压缩无收益时返回原 bytes。"""
        try:
            from PIL import Image
            buf = io.BytesIO(image_bytes)
            with Image.open(buf) as im:
                im = im.convert('RGB')
                im.thumbnail((max_side, max_side))
                out = io.BytesIO()
                im.save(out, format='JPEG', quality=quality)
                data = out.getvalue()
            if len(data) < len(image_bytes):
                return data
        except Exception:
            pass
        return image_bytes

    def generate(self, prompt, image_bytes=None, mime_type=None):
        try:
            # Image to Base64 if exists
            base64_image = None
            if image_bytes:
                base64_image = base64.b64encode(image_bytes).decode('utf-8')

            # 载荷降级序列：原图 -> 1400px -> 1000px（部分上游对大请求体直接掐断连接）
            raw_attempts = []
            if image_bytes:
                raw_attempts.append((image_bytes, mime_type or 'image/png'))
                for max_side, quality in ((1400, 85), (1000, 78)):
                    shrunk = self._shrink_image(image_bytes, max_side, quality)
                    if shrunk is not image_bytes and all(shrunk != r[0] for r in raw_attempts):
                        raw_attempts.append((shrunk, 'image/jpeg'))
                attempts = [(base64.b64encode(r[0]).decode('utf-8'), r[1])
                            for r in raw_attempts]
            else:
                attempts = [(None, 'image/png')]

            def _build_messages(b64img, mime):
                user_content = [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,{b64img}"
                        }
                    },
                    {"type": "text", "text": "请根据图片内容执行任务。"},
                ]
                return [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ]

            response = None
            last_primary_error = None
            win_attempt = (base64_image, mime_type or 'image/png')
            for idx, (b64img, mime) in enumerate(attempts):
                if not b64img:
                    continue
                try:
                    response = self.client.chat.completions.create(
                        model=self.model_name,
                        messages=_build_messages(b64img, mime),
                        # 不带输出上限的请求会被部分上游网关直接掐断连接，
                        # 先给 4096；推理模型思考吃满时由下方降级重试兜底
                        max_tokens=4096,
                    )
                    win_attempt = (b64img, mime)
                    break
                except Exception as primary_error:
                    last_primary_error = primary_error
                    etext = str(primary_error).lower()
                    transient = any(k in etext for k in (
                        'timeout', 'connection', 'max retries', 'apiconnection', 'apitimeout'))
                    if idx + 1 < len(attempts) and transient:
                        print(f"WARNING: full-size payload rejected ({str(primary_error)[:80]}), "
                              f"retrying with compressed image")
                        continue
                    raise

            if response is None and self.fallback_client:
                # DashScope 跨区回落（仅显式开启 ALLOW_DASHSCOPE_CROSS_REGION_FALLBACK 时存在）
                print(f"WARNING: primary endpoint failed, retrying DashScope mainland endpoint: {last_primary_error}")
                response = self.fallback_client.chat.completions.create(
                    model=self.model_name,
                    messages=_build_messages(base64_image, mime_type or 'image/png'),
                )
            if response is None:
                raise last_primary_error

            # 推理模型思考吃满 max_tokens 时正文为空（finish=length）——
            # 提额 + 降低思考力度重试一次（实测 glm-5.3-flash 16384+low 22s 出全文）
            try:
                _empty = not ((response.choices[0].message.content or '').strip())
                _truncated = response.choices[0].finish_reason == 'length'
                if _empty and _truncated:
                    print("WARNING: empty content (thinking consumed the token budget), "
                          "retrying with max_tokens=16384 + reasoning_effort=low")
                    response = self.client.chat.completions.create(
                        model=self.model_name,
                        messages=_build_messages(*win_attempt),
                        max_tokens=16384,
                        reasoning_effort='low',
                    )
            except Exception as retry_error:
                print(f"WARNING: elevated retry failed: {str(retry_error)[:80]}")

            # 检查停止原因
            finish_reason = response.choices[0].finish_reason
            if finish_reason == 'content_filter':
                print("WARNING: Response truncated by content filter")
            elif finish_reason == 'length':
                print("WARNING: Response truncated by length limit")

            content = response.choices[0].message.content
            refusal = getattr(response.choices[0].message, 'refusal', None)

            # 优先返回 refusal 信息
            if refusal:
                print(f"DEBUG: Model Refusal: {refusal}")
                return f"Error: Model Refused - {refusal}"

            return content if content else ""

        except Exception as e:
            print(f"OpenAI Adapter Error: {e}")
            raise e


def validate_custom_base_url(base_url: str) -> None:
    """BYOK 地址校验：仅允许 HTTPS 公网地址，阻断内网/本机/链路本地目标（SSRF 防护）。"""
    import ipaddress
    parsed = urlparse(base_url)
    if parsed.scheme != 'https':
        raise ValueError('自定义 Base URL 必须以 https:// 开头')
    if parsed.username or parsed.password:
        raise ValueError('自定义 Base URL 不允许包含账号密码')
    host = (parsed.hostname or '').strip().lower()
    if not host:
        raise ValueError('自定义 Base URL 缺少主机名')
    if host == 'localhost' or host.endswith(('.local', '.internal', '.lan')):
        raise ValueError('自定义 Base URL 不允许指向本机或内网域名')
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return  # 普通域名，放行
    if not ip.is_global:
        raise ValueError('自定义 Base URL 不允许指向内网或保留 IP 地址')


class ModelFactory:
    @staticmethod
    def create(local_cfg=None):
        """按本地配置创建模型适配器。

        local_cfg 来自 config.json（经 apply_env_defaults 补齐默认值）。
        provider: openai_compatible | gemini
        """
        cfg = apply_env_defaults(dict(local_cfg or {}))
        provider = cfg.get('provider')
        api_key = (cfg.get('api_key') or '').strip()
        base_url = (cfg.get('base_url') or '').strip().rstrip('/')
        model_name = (cfg.get('model_name') or '').strip()

        if provider == 'openai_compatible':
            if not (api_key and base_url and model_name):
                raise ValueError('模型配置不完整：请在设置中填写 API Key、Base URL 和模型名称')
            validate_custom_base_url(base_url)
            print(f"DEBUG: Using model {model_name} @ {base_url} (timeout {cfg.get('timeout_seconds')}s)")
            return OpenAICompatibleAdapter(api_key, base_url, model_name, cfg.get('timeout_seconds'))

        if not api_key:
            raise ValueError('缺少 GOOGLE_API_KEY：请在设置中填写 API Key 或切换到 OpenAI 兼容端点')
        print(f"DEBUG: Using Gemini model {model_name or DEFAULT_GEMINI_MODEL}")
        return GeminiAdapter(api_key=api_key, timeout_seconds=cfg.get('timeout_seconds'))

# --- Routes ---

@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    """本地模型配置读写。GET 返回配置（key 掩码），POST 保存并即时生效。"""
    if request.method == 'GET':
        cfg = apply_env_defaults(load_local_model_config())
        masked = dict(cfg)
        if masked.get('api_key'):
            k = masked['api_key']
            masked['api_key_masked'] = (k[:6] + '***' + k[-4:]) if len(k) > 12 else '***'
        masked.pop('api_key', None)
        masked['configured'] = True
        return jsonify(masked)

    body = request.get_json(silent=True) or {}
    current = load_local_model_config()
    # 未提供 api_key 时保留旧值，避免设置页回显掩码后误存
    if not (body.get('api_key') or '').strip():
        body['api_key'] = current.get('api_key', '')
    if 'provider' in body and body['provider'] not in ('openai_compatible', 'gemini'):
        return jsonify({'error': 'provider 必须是 openai_compatible 或 gemini'}), 400
    saved = save_local_model_config({**current, **body})
    if saved.get('provider') == 'openai_compatible' and saved.get('base_url'):
        try:
            validate_custom_base_url(saved['base_url'])
        except ValueError as e:
            save_local_model_config(current)
            return jsonify({'error': str(e)}), 400
    print(f"DEBUG: 模型配置已更新 -> provider={saved.get('provider')}, model={saved.get('model_name')}")
    return jsonify({'ok': True})

@app.errorhandler(500)
def internal_error(error):
    import traceback
    print(f"500 error: {error}")
    traceback.print_exc()
    return jsonify({'error': '服务器内部错误，请稍后重试'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    print(f"Unhandled exception: {type(e).__name__}: {e}")
    traceback.print_exc()
    return jsonify({'error': '服务器内部错误，请稍后重试'}), 500

@app.route('/api/', methods=['GET'])
def index():
    return "MathMover Backend is running."

def run_with_heartbeats(func, *args, **kwargs):
    import threading
    import queue
    q = queue.Queue()
    def worker():
        try:
            res = func(*args, **kwargs)
            q.put(('success', res))
        except Exception as e:
            q.put(('error', e))
            
    t = threading.Thread(target=worker)
    t.daemon = True
    t.start()
    
    while True:
        try:
            status, val = q.get(timeout=5)
            if status == 'success':
                yield ('result', val)
                return
            else:
                yield ('error', val)
                return
        except queue.Empty:
            yield ('heartbeat', '\n')

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """
    接收前端上传的图片文件或文本，并根据用户输入（可选）进行处理
    """
    print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] === 收到新生成请求 ===")
    
    image_data = None
    mime_type = None
    text_prompt = request.form.get('text', '')

    # 1. 优先检查是否有文件上传
    if 'file' in request.files:
        file = request.files['file']
        if file.filename != '':
            # 限制文件大小为 5MB (5 * 1024 * 1024 bytes)
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            if file_size > 5 * 1024 * 1024:
                return jsonify({'error': '上传的图片不能超过 5MB'}), 400

            image_data = file.read()
            mime_type = file.mimetype
            print(f"DEBUG: 从文件上传中读取图片, size: {len(image_data)} bytes, type: {mime_type}")

    if not image_data and not text_prompt.strip():
        return jsonify({'error': '请先上传图片或输入题目文字内容'}), 400

    try:
        model_adapter = ModelFactory.create(load_local_model_config())
    except Exception as e:
        return jsonify({'error': f'Model configuration error: {str(e)}'}), 500
        model_adapter = ModelFactory.create(user_profile)
    except Exception as e:
        return jsonify({'error': f'Model configuration error: {str(e)}'}), 500

    def generate():
        try:
            # Yield initial status immediately to flush headers and prevent proxy timeout
            yield json.dumps({'status': 'processing', 'message': '已收到请求，正在分析题目类型...'}) + '\n'
            
            # --- Step 1: Router ---
            print("DEBUG: Calling Router...")
            try:
                # 如果没有图片，修改 router prompt 描述
                router_prompt_to_use = ROUTER_PROMPT
                if not image_data:
                    router_prompt_to_use = router_prompt_to_use.replace("根据图片内容", "根据题目文字内容")
                
                # 确保将用户输入的文本也发给分类器
                final_router_prompt = router_prompt_to_use
                if text_prompt:
                    final_router_prompt = f"待分类的题目内容/补充说明如下：\n{text_prompt}\n\n" + router_prompt_to_use
                
                # Use run_with_heartbeats to avoid proxy timeout during blocking API call
                router_result_text = None
                for status, val in run_with_heartbeats(model_adapter.generate, final_router_prompt, image_data, mime_type):
                    if status == 'heartbeat':
                        yield val
                    elif status == 'error':
                        raise val
                    elif status == 'result':
                        router_result_text = val

                print(f"\n--- [DEBUG: RAW ROUTER OUTPUT] ---\n{router_result_text}\n------------------------------")
            except Exception as router_e:
                print(f"ERROR: Router failed: {router_e}")
                error_text = str(router_e)
                if 'timeout' in error_text.lower() or 'deadline' in error_text.lower():
                    error_text = '模型响应超时，请稍后重试或换一张更清晰的图片。'
                yield json.dumps({'status': 'error', 'message': f'分类模型调用失败: {error_text}'}) + '\n'
                return

            if not router_result_text:
                 yield json.dumps({'status': 'error', 'message': 'Router returned no content.'}) + '\n'
                 return

            # Parse JSON Router Result
            category = 'A' # Default
            reason = ''
            
            try:
                # 尝试清理可能存在的 markdown 标记
                clean_json = router_result_text.strip()
                if clean_json.startswith('```json'):
                    clean_json = clean_json[7:]
                if clean_json.startswith('```'):
                    clean_json = clean_json[3:]
                if clean_json.endswith('```'):
                    clean_json = clean_json[:-3]
                
                router_data = json.loads(clean_json.strip())
                category = router_data.get('category', 'A').upper()
                reason = router_data.get('reason', '')
                
                # Double check category validity
                if category not in ['A', 'B', 'C', 'D']:
                    category = 'A'
                    
            except json.JSONDecodeError:
                print("DEBUG: JSON decode failed, falling back to regex")
                # Fallback to regex if JSON fails
                import re
                match = re.search(r'"category":\s*"([ABCD])"', router_result_text)
                if not match:
                    match = re.search(r'([ABCD])', router_result_text)
                category = match.group(1) if match else 'A'

            if category not in PROMPT_MAP:
                category = 'B' # Default to Geometry
                
            print(f"DEBUG: Classified as: {category}, Reason: {reason}")
            
            # Send classification status with reason
            yield json.dumps({'status': 'classified', 'category': category, 'reason': reason}) + '\n'
            
            # --- Step 2: Specialist ---
            selected_prompt = PROMPT_MAP[category] + build_allowed_commands_suffix(category)
            if text_prompt:
                selected_prompt = f"用户补充说明：{text_prompt}\n\n" + selected_prompt
            
            print(f"DEBUG: Calling Specialist {category}...")
            try:
                yield json.dumps({'status': 'processing', 'message': '正在调用专家模型生成指令...'}) + '\n'
                
                # Use run_with_heartbeats to avoid proxy timeout during blocking API call
                specialist_result_text = None
                for status, val in run_with_heartbeats(model_adapter.generate, selected_prompt, image_data, mime_type):
                    if status == 'heartbeat':
                        yield val
                    elif status == 'error':
                        raise val
                    elif status == 'result':
                        specialist_result_text = val

                print(f"\n--- [DEBUG: RAW SPECIALIST OUTPUT] ---\n{specialist_result_text}\n------------------------------")
            except Exception as specialist_e:
                 print(f"ERROR: Specialist failed: {specialist_e}")
                 error_text = str(specialist_e)
                 if 'timeout' in error_text.lower() or 'deadline' in error_text.lower():
                     error_text = '模型响应超时，请稍后重试或换一张更清晰的图片。'
                 yield json.dumps({'status': 'error', 'message': f'专家模型调用失败: {error_text}'}) + '\n'
                 return

            # 防御性检查：确保模型返回了内容
            if not specialist_result_text or specialist_result_text.strip() == "":
                 print(f"DEBUG: 模型返回为空！可能是触发了安全过滤或网络问题。")
                 yield json.dumps({"status": "error", "message": "模型未能生成指令，请尝试更换题目图片或模型。"}) + '\n'
                 return

            print(f"DEBUG: Generated text length: {len(specialist_result_text)}")

            # --- P0 指令校验层：解析 -> 白名单校验 -> 低合格率自动重试一次 -> 清洗下发 ---
            validation = ggb_parser.validate_text(specialist_result_text)
            retried = False
            if (not validation['ok'] and validation['validity'] < 0.95
                    and not specialist_result_text.startswith("Error:")):
                invalid_preview = '\n'.join(validation['invalid_lines'][:10])
                print(f"WARNING: 指令校验未通过 (有效率 {validation['validity']})，自动重试一次。"
                      f"无效行: {validation['invalid_lines'][:5]}")
                yield json.dumps({'status': 'processing', 'message': '发现无效指令，正在自动修正...'}) + '\n'
                retry_prompt = (
                    selected_prompt
                    + "\n\n【修正要求】你上一次输出的以下行不是合法的 GeoGebra 命令，"
                      "请重新输出完整指令列表，确保每一行都是可被 GeoGebra evalCommand 执行的命令，"
                      "不要输出任何注释、说明文字或无法解析的内容：\n"
                    + invalid_preview
                )
                try:
                    retry_result_text = None
                    for status, val in run_with_heartbeats(model_adapter.generate, retry_prompt, image_data, mime_type):
                        if status == 'heartbeat':
                            yield val
                        elif status == 'error':
                            raise val
                        elif status == 'result':
                            retry_result_text = val
                    if retry_result_text:
                        retry_validation = ggb_parser.validate_text(retry_result_text)
                        print(f"DEBUG: 重试后有效率 {retry_validation['validity']} "
                              f"(原 {validation['validity']})")
                        if retry_validation['validity'] >= validation['validity']:
                            specialist_result_text = retry_result_text
                            validation = retry_validation
                        retried = True
                except Exception as retry_e:
                    print(f"WARNING: 校验重试失败，沿用原结果: {retry_e}")

            print(f"DEBUG: 指令校验完成: 有效率 {validation['validity']}, "
                  f"无效行 {validation['invalid_lines']}, 重试 {retried}")
            commands = ggb_parser.extract_valid_commands(specialist_result_text)

            yield json.dumps({
                'status': 'completed',
                'commands': commands,
                'category': category,
                'validation': {
                    'validity': validation['validity'],
                    'retried': retried,
                }
            }) + '\n'

        except Exception as e:
            print(f"CRITICAL ERROR: {str(e)}")
            import traceback
            traceback.print_exc()
            # 确保将错误返回给前端
            yield json.dumps({'status': 'error', 'message': f'系统内部错误: {str(e)}'}) + '\n'

    if request.form.get('responseMode') != 'stream':
        try:
            print("DEBUG: Using buffered upload response mode", flush=True)
            body = ''.join(generate())
        except Exception as e:
            print(f"CRITICAL BUFFERED ERROR: {str(e)}", flush=True)
            import traceback
            traceback.print_exc()
            body = json.dumps({'status': 'error', 'message': f'系统内部错误: {str(e)}'}) + '\n'

        return Response(body, mimetype='application/x-ndjson')

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson', headers={'X-Accel-Buffering': 'no'})

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
