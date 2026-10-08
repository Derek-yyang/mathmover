import os
import json
import base64
import io
from datetime import datetime
from flask import Flask, request, jsonify, Response, stream_with_context
from dotenv import load_dotenv
from flask_cors import CORS
import openai
import requests
import re
from urllib.parse import urlparse
import sys

# GGB 指令解析器（P0 指令校验层：specialist 输出的合法性检查与清洗）
import ggb_parser
import semantic_guard
from expert_prompts import EXPERT_PROMPTS, assemble_expert_prompt, router_sop_catalog, load_sop_index
import decision_router

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

MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024
DEFAULT_MODEL_TIMEOUT = int(os.getenv('MODEL_TIMEOUT_SECONDS', '75'))
# 支持的 wire 协议白名单：配置归一与 /api/config 校验共用此单一来源
SUPPORTED_PROTOCOLS = ('openai_chat', 'openai_responses', 'anthropic')

# --- 本地模型配置层（去 SaaS 化）---
# 运行时模型配置存于本地 config.json（可经 /api/config 修改），替代原 Supabase profiles。
# 优先级：config.json > .env SYSTEM_*。
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
CONFIG_KEYS = ('provider', 'api_protocol', 'base_url', 'api_key', 'model_name', 'timeout_seconds', 'max_tokens',
               'router_mode', 'perplexity_api_key', 'decisions_threshold', 'decisions_model')


def load_local_model_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding='utf-8') as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        # OSError 覆盖 FileNotFoundError 与 IsADirectoryError——后者是 Docker
        # bind mount 的已知坑：宿主机缺 config.json 时 Docker 会建出同名目录。
        # 配置缺失一律视为未配置，回落 env，不阻断启动。
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
    """config.json 缺项时回落到 .env SYSTEM_*。"""
    cfg['timeout_seconds'] = cfg.get('timeout_seconds') or str(DEFAULT_MODEL_TIMEOUT)
    cfg['router_mode'] = cfg.get('router_mode') or (os.getenv('ROUTER_MODE') or 'llm')
    cfg['decisions_model'] = (cfg.get('decisions_model') or '').strip() or decision_router.DECISIONS_MODEL
    cfg['decisions_threshold'] = cfg.get('decisions_threshold') or (os.getenv('DECISIONS_THRESHOLD') or '0.8')
    cfg['perplexity_api_key'] = cfg.get('perplexity_api_key') or (os.getenv('PERPLEXITY_API_KEY') or '')
    cfg['provider'] = 'openai_compatible'
    # api_protocol 是 wire 协议的唯一事实来源；历史配置里的 gemini 已随
    # GeminiAdapter 一并退役，此处归一到 openai_chat，避免老配置直接报错
    protocol = (cfg.get('api_protocol') or '').strip()
    cfg['api_protocol'] = protocol if protocol in SUPPORTED_PROTOCOLS else 'openai_chat'
    cfg['base_url'] = cfg.get('base_url') or (os.getenv('SYSTEM_BASE_URL') or '')
    cfg['api_key'] = cfg.get('api_key') or (os.getenv('SYSTEM_API_KEY') or '')
    cfg['model_name'] = cfg.get('model_name') or (os.getenv('SYSTEM_MODEL_NAME') or '')
    return cfg


# --- Prompt Definitions (保留原有的 Prompt) ---
ROUTER_PROMPT = """
你是数学题目分类器。请根据图片内容及补充文字，通读题干与各小问，选择专家类别和生成图形需要的指令参考。

分类标准：
A：函数与图像（一次函数、开口向上/向下的二次函数（抛物线）、三角函数、导数、一般函数）
B：平面几何（圆、多边形、角平分线、平面向量）
C：解析几何（椭圆、双曲线、开口向左/向右的抛物线、圆锥曲线）
D：立体几何（正方体、四面体、空间动点、球、旋转体）

要求：
- 请严格以 JSON 格式返回，不要包含任何 markdown 格式化（如 ```json ... ```）。
- 格式如下：
{"category": "A", "reason": "简要理由", "sops": ["function-object"], "sop_uncertain": false}
- category 只能是 A、B、C 或 D。
- sops 从下列索引选择；覆盖各小问需要的操作与支撑构造，允许多个类别的二维能力组合，不因题干未出现命令名而漏选。不需要的操作不选。
- 动点的既定路径与派生点轨迹不同，只有需要轨迹才选 locus；区域内运动选 moving-point-region。空间专用卡只在 D 类选择。
- 视图、点样式、隐藏计算对象由程序常驻加载，卡片依赖由程序补齐，不必重复选。
- 读图不清、复合构造无法确定完整参考集时设 sop_uncertain=true，程序会加载该类别完整卡片集；不要猜测后声称确定。

可选参考卡片：
{sop_catalog}
"""

PROMPT_MAP = EXPERT_PROMPTS


def build_allowed_commands_suffix(category: str) -> str:
    """从 ggb_commands.json（单一事实来源）生成 prompt 的允许命令集。

    与解析器同源；名称许可不代表参数/对象类型正确，未知命令另行记录。
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
        + "- 上述为输入栏命令，不是 JavaScript API。坐轴/网格用 ShowAxes/ShowGrid；"
          "标签模式用 SetLabelMode，平行平面用 Plane(点,平面)。"
          "命令重载按对象类型选择，不能把函数当圆锥曲线或把点当数值。\n"
    )


# --- Model Factory & Adapters ---

class ModelAdapter:
    def generate(self, prompt, image_bytes=None, mime_type=None):
        raise NotImplementedError

class OpenAICompatibleAdapter(ModelAdapter):
    def __init__(self, api_key, base_url, model_name, timeout_seconds=None, max_tokens=None):
        api_key = (api_key or '').strip()
        base_url = (base_url or '').strip().rstrip('/')
        model_name = (model_name or '').strip()
        client_kwargs = {}
        if 'opencode.ai' in base_url:
            # opencode zen go 端点要求随请求携带稳定会话标识（路由/缓存优化），
            # 缺失时网关直接 400 MissingSessionID
            client_kwargs['default_headers'] = {
                'x-opencode-session': 'mathmover-backend',
                'User-Agent': 'mathmover-backend/1.0',
            }
        self.client = openai.OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=int(timeout_seconds or DEFAULT_MODEL_TIMEOUT),
            **client_kwargs,
        )
        # 输出上限可按模型在 config.json 配置；不设 max_tokens 的请求会被
        # 部分网关（如 b.ai）直接掐断，故始终发送有限值。默认 4096 对
        # 思考型模型够用（思考吃满时由 generate 内降级重试兜底），
        # 长输出的非思考模型（如 deepseek 指令流）可配 16384。
        try:
            self.max_tokens = int(max_tokens) if max_tokens else 4096
        except (TypeError, ValueError):
            self.max_tokens = 4096
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
                timeout=DEFAULT_MODEL_TIMEOUT,
            )
        self.model_name = model_name

    @staticmethod
    def _enhance_image(image_bytes):
        """读数增强：2x 放大，提升小字号系数/指数的可读性。

        实测（deepseek@AMD, A-二次函数2）裸图读错系数、2x 放大后读题全对；
        截图类题目图多为低分辨率长条图，放大显著提升字号可读性。
        不做裁边（裁边收益小、有误伤边界内容的理论风险，已移除）。
        失败或无收益时返回原 bytes。"""
        try:
            from PIL import Image
            buf = io.BytesIO(image_bytes)
            with Image.open(buf) as im:
                im = im.convert('RGB')
                # 2x 放大（LANCZOS），但限制长边不超过 3400 防载荷爆炸
                im = im.resize((min(im.width * 2, 3400), min(im.height * 2, 3400)),
                               Image.LANCZOS)
                out = io.BytesIO()
                im.save(out, format='PNG', optimize=True)
                data = out.getvalue()
            return data
        except Exception:
            pass
        return image_bytes

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

            # 载荷序列（可读性优先）：增强图（2x 放大）为首选读数版本，
            # 退让序：原图 -> 1400px -> 1000px（保字号优先于压体积，
            # 仅当网关拒收时逐级退让；部分上游对大请求体直接掐断连接）
            raw_attempts = []
            if image_bytes:
                enhanced = self._enhance_image(image_bytes)
                raw_attempts.append((enhanced, 'image/png'))
                if enhanced is not image_bytes:
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
                if b64img:
                    user_content = [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime};base64,{b64img}"
                            }
                        },
                        {"type": "text", "text": "请根据图片内容执行任务。"},
                    ]
                else:
                    # 纯文本模式（无图请求：题目内容/任务都在 system prompt 里）
                    user_content = [{"type": "text",
                                     "text": "请根据系统指令中给出的题目内容执行任务。"}]
                return [
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_content},
                ]

            response = None
            last_primary_error = None
            win_attempt = (base64_image, mime_type or 'image/png')
            for idx, (b64img, mime) in enumerate(attempts):
                if attempts == [(None, 'image/png')] and idx > 0:
                    continue
                try:
                    response = self.client.chat.completions.create(
                        model=self.model_name,
                        messages=_build_messages(b64img, mime),
                        # 不带输出上限的请求会被部分上游网关直接掐断连接，
                        # 首选值可按模型在 config.json 配置（max_tokens 键）；
                        # 思考型模型吃满预算时由下方降级重试兜底
                        max_tokens=self.max_tokens,
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


# --- 通用 HTTP 小工具（Responses / Anthropic 两个协议适配器共用）---

def _http_error_text(resp):
    """从错误响应体提取可读 message（兼容 OpenAI/Anthropic 两种 error 结构）。"""
    try:
        err = resp.json().get('error')
        if isinstance(err, dict):
            return err.get('message') or str(err)[:200]
        return (str(err) if err else resp.text)[:200]
    except Exception:
        return resp.text[:200]


def _payload_ladder(image_bytes, mime_type):
    """多协议共用的图像载荷退让序列：增强图(2x) -> 原图 -> 1400px -> 1000px。

    返回 [(base64_str, mime), ...]；无图时 [(None, 'image/png')]。
    """
    if not image_bytes:
        return [(None, 'image/png')]
    raw = [(OpenAICompatibleAdapter._enhance_image(image_bytes), 'image/png')]
    if raw[0][0] is not image_bytes:
        raw.append((image_bytes, mime_type or 'image/png'))
    for max_side, quality in ((1400, 85), (1000, 78)):
        shrunk = OpenAICompatibleAdapter._shrink_image(image_bytes, max_side, quality)
        if shrunk is not image_bytes and all(shrunk != r[0] for r in raw):
            raw.append((shrunk, 'image/jpeg'))
    return [(base64.b64encode(r[0]).decode('utf-8'), r[1]) for r in raw]


def _request_with_ladder(url, headers, build_body, attempts, timeout):
    """按载荷退让序列 POST；网络级失败/413 退让下一档，401/403 归一为 invalid_api_key，其余错误直抛。

    返回 (响应 JSON, 胜出的 (b64img, mime))。
    """
    last_error = None
    for idx, (b64img, mime) in enumerate(attempts):
        try:
            resp = requests.post(url, headers=headers, json=build_body(b64img, mime), timeout=timeout)
        except requests.RequestException as e:
            last_error = e
            if idx + 1 < len(attempts):
                print(f"WARNING: payload rejected ({str(e)[:80]}), retrying with compressed image")
                continue
            raise
        if resp.status_code == 413 and idx + 1 < len(attempts):
            print("WARNING: payload too large (413), retrying with compressed image")
            continue
        if resp.status_code in (401, 403):
            raise RuntimeError(f"invalid_api_key: {_http_error_text(resp)}")
        if resp.status_code != 200:
            raise RuntimeError(f"HTTP {resp.status_code}: {_http_error_text(resp)}")
        return resp.json(), (b64img, mime)
    raise last_error if last_error else RuntimeError('请求失败：无可用载荷')


class OpenAIResponsesAdapter(ModelAdapter):
    """OpenAI Responses 协议：POST {base_url}/responses，Bearer 鉴权。

    与 Chat Completions 的差别只在 wire 格式：system prompt 走 instructions 字段，
    图片走 input_image（data URL），输出从 output[].content[].text 聚合。
    """

    def __init__(self, api_key, base_url, model_name, timeout_seconds=None, max_tokens=None):
        self.api_key = (api_key or '').strip()
        self.base_url = (base_url or '').strip().rstrip('/')
        self.model_name = (model_name or '').strip()
        self.timeout = int(timeout_seconds or DEFAULT_MODEL_TIMEOUT)
        try:
            self.max_tokens = int(max_tokens) if max_tokens else 4096
        except (TypeError, ValueError):
            self.max_tokens = 4096

    @staticmethod
    def _extract_text(data):
        parts = []
        for item in data.get('output', []) or []:
            if item.get('type') == 'message':
                for c in item.get('content', []) or []:
                    if c.get('type') in ('output_text', 'text') and c.get('text'):
                        parts.append(c['text'])
        return "\n".join(parts) or (data.get('output_text') or '')

    def generate(self, prompt, image_bytes=None, mime_type=None):
        def _build_body(b64img, mime, max_tokens):
            if b64img:
                user_content = [
                    {"type": "input_image", "image_url": f"data:{mime};base64,{b64img}"},
                    {"type": "input_text", "text": "请根据图片内容执行任务。"},
                ]
            else:
                user_content = [{"type": "input_text",
                                 "text": "请根据系统指令中给出的题目内容执行任务。"}]
            return {
                "model": self.model_name,
                "instructions": prompt,
                "input": [{"role": "user", "content": user_content}],
                "max_output_tokens": max_tokens,
            }

        headers = {'Authorization': f'Bearer {self.api_key}', 'content-type': 'application/json'}
        attempts = _payload_ladder(image_bytes, mime_type)
        data, win = _request_with_ladder(f'{self.base_url}/responses', headers,
                                        lambda b, m: _build_body(b, m, self.max_tokens),
                                        attempts, self.timeout)
        text = self._extract_text(data)
        if not text.strip() and data.get('status') == 'incomplete':
            # 输出预算被思考吃光致正文为空——提额重试一次（与 Chat 适配器同策略）
            print("WARNING: empty content (status=incomplete), retrying with max_output_tokens=16384")
            try:
                data, _ = _request_with_ladder(f'{self.base_url}/responses', headers,
                                              lambda b, m: _build_body(b, m, 16384),
                                              [win], self.timeout)
                text = self._extract_text(data)
            except Exception as retry_error:
                print(f"WARNING: elevated retry failed: {str(retry_error)[:80]}")
        return text


class AnthropicMessagesAdapter(ModelAdapter):
    """Anthropic Messages 协议：POST {base_url}/messages，x-api-key + anthropic-version 鉴权。

    base_url 约定与 OpenAI 相同（含 /v1 前缀），官方地址 https://api.anthropic.com/v1。
    图片走 image source（base64 + media_type），system prompt 走 system 字段，
    max_tokens 为 Anthropic 必填项。
    """

    def __init__(self, api_key, base_url, model_name, timeout_seconds=None, max_tokens=None):
        self.api_key = (api_key or '').strip()
        self.base_url = (base_url or '').strip().rstrip('/')
        self.model_name = (model_name or '').strip()
        self.timeout = int(timeout_seconds or DEFAULT_MODEL_TIMEOUT)
        try:
            self.max_tokens = int(max_tokens) if max_tokens else 4096
        except (TypeError, ValueError):
            self.max_tokens = 4096

    @staticmethod
    def _extract_text(data):
        return "\n".join(bl.get('text', '') for bl in data.get('content', []) or []
                        if bl.get('type') == 'text')

    def generate(self, prompt, image_bytes=None, mime_type=None):
        headers = {'x-api-key': self.api_key, 'anthropic-version': '2023-06-01',
                   'content-type': 'application/json'}

        def _build_body(b64img, mime, max_tokens):
            if b64img:
                content = [
                    {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64img}},
                    {"type": "text", "text": "请根据图片内容执行任务。"},
                ]
            else:
                content = [{"type": "text", "text": "请根据系统指令中给出的题目内容执行任务。"}]
            return {
                "model": self.model_name,
                "max_tokens": max_tokens,
                "system": prompt,
                "messages": [{"role": "user", "content": content}],
            }

        attempts = _payload_ladder(image_bytes, mime_type)
        data, win = _request_with_ladder(f'{self.base_url}/messages', headers,
                                        lambda b, m: _build_body(b, m, self.max_tokens),
                                        attempts, self.timeout)
        text = self._extract_text(data)
        if not text.strip() and data.get('stop_reason') == 'max_tokens':
            print("WARNING: empty content (stop_reason=max_tokens), retrying with max_tokens=16384")
            try:
                data, _ = _request_with_ladder(f'{self.base_url}/messages', headers,
                                              lambda b, m: _build_body(b, m, 16384),
                                              [win], self.timeout)
                text = self._extract_text(data)
            except Exception as retry_error:
                print(f"WARNING: elevated retry failed: {str(retry_error)[:80]}")
        return text


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
        api_protocol: openai_chat | openai_responses | anthropic
        """
        cfg = apply_env_defaults(dict(local_cfg or {}))
        protocol = cfg.get('api_protocol') or 'openai_chat'
        api_key = (cfg.get('api_key') or '').strip()
        base_url = (cfg.get('base_url') or '').strip().rstrip('/')
        model_name = (cfg.get('model_name') or '').strip()

        if not (api_key and base_url and model_name):
            raise ValueError('模型配置不完整：请在设置中填写 API 密钥、API 地址和模型 ID')
        validate_custom_base_url(base_url)
        print(f"DEBUG: Using model {model_name} @ {base_url} [{protocol}] (timeout {cfg.get('timeout_seconds')}s)")
        if protocol == 'anthropic':
            return AnthropicMessagesAdapter(api_key, base_url, model_name,
                                           cfg.get('timeout_seconds'), cfg.get('max_tokens'))
        if protocol == 'openai_responses':
            return OpenAIResponsesAdapter(api_key, base_url, model_name,
                                          cfg.get('timeout_seconds'), cfg.get('max_tokens'))
        return OpenAICompatibleAdapter(api_key, base_url, model_name, cfg.get('timeout_seconds'),
                                       cfg.get('max_tokens'))


def llm_classify(model_adapter, image_data, mime_type, text_prompt):
    """LLM 路由分类：组装 ROUTER_PROMPT 调对话模型，返回其原始输出文本。"""
    router_prompt_to_use = ROUTER_PROMPT.replace('{sop_catalog}', router_sop_catalog())
    if not image_data:
        router_prompt_to_use = router_prompt_to_use.replace("根据图片内容", "根据题目文字内容")
    final_router_prompt = router_prompt_to_use
    if text_prompt:
        final_router_prompt = f"待分类的题目内容/补充说明如下：\n{text_prompt}\n\n" + router_prompt_to_use
    return model_adapter.generate(final_router_prompt, image_data, mime_type)


def route_classify(router_cfg, model_adapter, image_data, mime_type, text_prompt, meta_out):
    """路由分发（设置里可切换）：decisions=Perplexity 决策模型（概率+置信度）；llm=对话模型分类。

    decisions 调用失败或置信度低于阈值时自动回退 llm，回退事实记入 meta_out 透出给前端。
    两种后端统一返回 router JSON 文本（{"category","reason"}），下游解析逻辑通用。
    """
    mode = (router_cfg.get('router_mode') or 'llm')
    meta = {'mode': mode}
    meta_out.append(meta)
    if mode == 'decisions':
        try:
            decisions_model = (router_cfg.get('decisions_model') or '').strip()
            res = decision_router.classify(router_cfg.get('perplexity_api_key', ''),
                                           image_data, mime_type, text_prompt,
                                           model=decisions_model)
            meta['model'] = decisions_model or decision_router.DECISIONS_MODEL
            meta['confidence'] = res['confidence']
            meta['probabilities'] = res['probabilities']
            threshold = float(router_cfg.get('decisions_threshold') or 0.8)
            if res['confidence'] >= threshold:
                meta['effective'] = 'decisions'
                return json.dumps({
                    'category': res['category'],
                    'reason': f"决策模型 {meta['model']}，confidence={res['confidence']:.2f}",
                    'router': meta,
                }, ensure_ascii=False)
            meta['fallback_to_llm'] = True
            meta['fallback_reason'] = f"置信度 {res['confidence']:.2f} 低于阈值 {threshold:.2f}"
        except decision_router.DecisionRouterError as e:
            meta['fallback_to_llm'] = True
            meta['fallback_reason'] = str(e)
            print(f"ERROR: decisions router failed, falling back to llm: {e}")
    meta['effective'] = 'llm'
    return llm_classify(model_adapter, image_data, mime_type, text_prompt)


def parse_router_result(raw):
    """解析路由模型输出为 (category, reason)；完全失败返回 (None, None)。

    三层兜底：
      1. 严格 JSON（剥掉 markdown 围栏后解析，category 必须 ∈ {A,B,C,D}）
      2. 键值对形态："category": "D" / 'category'：D（键值引号可省、容忍全角冒号）
      3. 独立字母：仅认两侧都不是 ASCII 字母的 A/B/C/D，
         排除 AI / API / OK 等单词内字母的误判（旧正则 r'([ABCD])' 的缺陷）
    """
    clean = raw.strip()
    if clean.startswith('```json'):
        clean = clean[7:]
    if clean.startswith('```'):
        clean = clean[3:]
    if clean.endswith('```'):
        clean = clean[:-3]
    try:
        data = json.loads(clean.strip())
        cat = str(data.get('category') or '').strip().upper()
        if cat in ('A', 'B', 'C', 'D'):
            return cat, str(data.get('reason') or '')
    except (json.JSONDecodeError, AttributeError, ValueError):
        pass
    m = re.search(r"['\"]?category['\"]?\s*[:：]\s*['\"]?([ABCD])['\"]?", raw)
    if m:
        return m.group(1), ''
    m = re.search(r'(?<![A-Za-z])([ABCD])(?![A-Za-z])', raw)
    if m:
        return m.group(1), ''
    return None, None

# --- Routes ---

@app.route('/api/config', methods=['GET', 'POST'])
def api_config():
    """本地模型配置读写。GET 返回配置（key 掩码），POST 保存并即时生效。"""
    if request.method == 'GET':
        cfg = apply_env_defaults(load_local_model_config())
        masked = dict(cfg)
        for secret_key in ('api_key', 'perplexity_api_key'):
            k = (masked.get(secret_key) or '').strip()
            if k:
                masked[secret_key + '_masked'] = (k[:6] + '***' + k[-4:]) if len(k) > 12 else '***'
            masked.pop(secret_key, None)
        masked['configured'] = True
        return jsonify(masked)

    body = request.get_json(silent=True) or {}
    current = load_local_model_config()
    # 未提供 api_key 时保留旧值，避免设置页回显掩码后误存
    if not (body.get('api_key') or '').strip():
        body['api_key'] = current.get('api_key', '')
    if not (body.get('perplexity_api_key') or '').strip():
        body['perplexity_api_key'] = current.get('perplexity_api_key', '')
    # 路由后端与置信度阈值校验
    router_mode = (str(body.get('router_mode') or '').strip() or current.get('router_mode') or 'llm')
    if router_mode not in ('llm', 'decisions'):
        return jsonify({'error': 'router_mode 必须是 llm 或 decisions'}), 400
    body['router_mode'] = router_mode
    threshold_raw = str(body.get('decisions_threshold') or '').strip() or current.get('decisions_threshold') or '0.8'
    try:
        threshold = float(threshold_raw)
        if not (0 < threshold <= 1):
            raise ValueError
    except ValueError:
        return jsonify({'error': 'decisions_threshold 必须是 (0, 1] 内的数字'}), 400
    body['decisions_threshold'] = threshold_raw
    # 决策模型 ID：留空回落默认模型；router_mode=decisions 时保存前实测图片支持
    decisions_model = (str(body.get('decisions_model') or '').strip() or decision_router.DECISIONS_MODEL)
    body['decisions_model'] = decisions_model
    # API 协议校验（与设置页下拉、apply_env_defaults 共用 SUPPORTED_PROTOCOLS）
    protocol = (str(body.get('api_protocol') or '').strip() or current.get('api_protocol') or '')
    if protocol and protocol not in SUPPORTED_PROTOCOLS:
        return jsonify({'error': f'未知 API 协议: {protocol}'}), 400
    body['api_protocol'] = protocol
    if 'provider' in body and body['provider'] != 'openai_compatible':
        return jsonify({'error': 'provider 必须是 openai_compatible'}), 400
    # 决策模型保存校验：用 64x64 测试图实测该模型是否接受图片输入。
    # 纯文本决策模型、无效 key、不存在的模型名在此直接拒绝，不落盘坏配置。
    if router_mode == 'decisions':
        probe_key = (body.get('perplexity_api_key') or '').strip() or (current.get('perplexity_api_key') or '').strip()
        if not probe_key:
            return jsonify({'error': '决策模型路由需要先配置 Perplexity API Key'}), 400
        probe_error = decision_router.probe_image_support(probe_key, decisions_model)
        if probe_error:
            return jsonify({'error': probe_error}), 400
    saved = save_local_model_config({**current, **body})
    if saved.get('provider') == 'openai_compatible' and saved.get('base_url'):
        try:
            validate_custom_base_url(saved['base_url'])
        except ValueError as e:
            save_local_model_config(current)
            return jsonify({'error': str(e)}), 400
    print(f"DEBUG: 模型配置已更新 -> provider={saved.get('provider')}, model={saved.get('model_name')}")
    return jsonify({'ok': True})


@app.route('/api/config/models', methods=['POST'])
def api_config_models():
    """拉取 OpenAI 兼容端点的模型目录（GET {base_url}/models）。

    base_url/api_key 未传时回落到已保存配置——设置页「获取可用模型」按钮用。
    走同一套 validate_custom_base_url SSRF 防护。
    """
    body = request.get_json(silent=True) or {}
    current = apply_env_defaults(load_local_model_config())
    base_url = (body.get('base_url') or current.get('base_url') or '').strip().rstrip('/')
    api_key = (body.get('api_key') or '').strip() or current.get('api_key', '')
    if not base_url:
        return jsonify({'error': '请先填写 API 地址'}), 400
    try:
        validate_custom_base_url(base_url)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    protocol = (str(body.get('api_protocol') or '').strip() or current.get('api_protocol') or 'openai_chat')
    if protocol == 'anthropic':
        headers = {'x-api-key': api_key, 'anthropic-version': '2023-06-01'}
    else:
        headers = {'Authorization': f'Bearer {api_key}'} if api_key else {}
    try:
        resp = requests.get(f'{base_url}/models', headers=headers, timeout=15)
    except requests.RequestException as e:
        return jsonify({'error': f'连接失败: {e}'}), 502
    if resp.status_code != 200:
        try:
            msg = resp.json().get('error', {}).get('message', resp.text[:200])
        except Exception:
            msg = resp.text[:200]
        return jsonify({'error': f'HTTP {resp.status_code}: {msg}'}), 502
    try:
        items = resp.json().get('data', [])
        ids = sorted({m['id'] for m in items if isinstance(m, dict) and m.get('id')})
    except (ValueError, TypeError, AttributeError):
        return jsonify({'error': '模型目录响应结构异常'}), 502
    return jsonify({'models': ids})

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
            # 限制文件大小为 5MB
            file.seek(0, os.SEEK_END)
            file_size = file.tell()
            file.seek(0)
            if file_size > MAX_UPLOAD_IMAGE_BYTES:
                return jsonify({'error': '上传的图片不能超过 5MB'}), 400

            image_data = file.read()
            mime_type = file.mimetype
            print(f"DEBUG: 从文件上传中读取图片, size: {len(image_data)} bytes, type: {mime_type}")

    if not image_data and not text_prompt.strip():
        return jsonify({'error': '请先上传图片或输入题目文字内容'}), 400

    runtime_cfg = apply_env_defaults(load_local_model_config())
    router_cfg = runtime_cfg  # 路由后端配置（router_mode / perplexity_api_key / decisions_threshold）
    try:
        model_adapter = ModelFactory.create(runtime_cfg)
    except Exception as e:
        return jsonify({'error': f'Model configuration error: {str(e)}'}), 500

    def generate():
        try:
            # Yield initial status immediately to flush headers and prevent proxy timeout
            yield json.dumps({'status': 'processing', 'message': '已收到请求，正在分析题目类型...'}) + '\n'
            
            # --- Step 1: Router ---
            print("DEBUG: Calling Router...")
            try:
                # 路由后端由 route_classify 按 router_cfg 分发（decisions 决策模型 / llm 对话模型），
                # 统一返回 {"category","reason"} JSON 文本，下方解析逻辑两种后端通用。
                router_side = []
                
                # （router prompt 组装与用户文本拼接已并入 route_classify / llm_classify）
                
                # Use run_with_heartbeats to avoid proxy timeout during blocking API call
                router_result_text = None
                for status, val in run_with_heartbeats(route_classify, router_cfg, model_adapter,
                                                       image_data, mime_type, text_prompt, router_side):
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

            # --- 路由结果解析：三层兜底，失败回灌重试一次，仍失败默认 A 并显式标记 ---
            category, reason = parse_router_result(router_result_text)
            router_parse_failed = False
            if category is None:
                # 解析失败不静默吞掉：回灌要求严格 JSON 重试一次
                print("WARNING: 路由输出无法解析，回灌重试一次（要求严格 JSON）")
                yield json.dumps({'status': 'processing',
                                  'message': '分类结果无法解析，正在要求模型重试...'}) + '\n'
                corrective = ("你上一次的输出无法被解析。请只输出一行严格 JSON，不要 markdown、不要任何其他文字："
                              '{"category": "A/B/C/D 之一", "reason": "简要理由", '
                              '"sops": ["索引中的卡片名"], "sop_uncertain": false}')
                retry_input = f"{text_prompt}\n\n{corrective}" if text_prompt else corrective
                try:
                    router_retry_text = None
                    for status, val in run_with_heartbeats(route_classify, router_cfg, model_adapter,
                                                           image_data, mime_type, retry_input, router_side):
                        if status == 'heartbeat':
                            yield val
                        elif status == 'error':
                            raise val
                        elif status == 'result':
                            router_retry_text = val
                    if router_retry_text:
                        category, reason = parse_router_result(router_retry_text)
                        router_result_text = router_retry_text
                except Exception as router_retry_e:
                    print(f"WARNING: 路由解析重试失败: {router_retry_e}")
                if category is None:
                    category = 'A'
                    reason = '路由输出两次均无法解析，默认按 A 类（函数与图像）处理'
                    router_parse_failed = True

            if category not in PROMPT_MAP:
                category = 'B' # Default to Geometry
                
            router_meta = router_side[-1] if router_side else {'mode': 'llm'}  # 取最近一次（含解析重试）
            if router_meta.get('fallback_to_llm'):
                reason = (reason + ' ' if reason else '') + f"（决策模型回退 LLM：{router_meta.get('fallback_reason', '')}）"
            print(f"DEBUG: Classified as: {category}, Reason: {reason}, Router: {router_meta}")
            # 每题始终加载完整 skill；仅指令参考按路由结果选择。旧/无效输出回退完整集。
            prompt_assembly = assemble_expert_prompt(
                category, '' if router_parse_failed else router_result_text)
            prompt_meta = dict(prompt_assembly.metadata)

            # Send classification status with reason（解析兜底失败时显式标记，前端可提示）
            classified_event = {'status': 'classified', 'category': category,
                                'reason': reason, 'router': router_meta, 'prompt': prompt_meta}
            if router_parse_failed:
                classified_event['router_parse_failed'] = True
            yield json.dumps(classified_event) + '\n'

            # --- Step 2: Specialist ---
            # 单段式：专家直接看图作图（模型内部先试 2x 增强图、失败回退原图）。
            # 不做两段式转录：转接多一层就多一次信息损耗，且第二段不回看图时读错无从纠正。
            command_suffix = build_allowed_commands_suffix(category)
            selected_prompt = prompt_assembly.text + command_suffix
            prompt_meta['system_characters'] = len(selected_prompt)
            if text_prompt:
                selected_prompt = f"用户补充说明：{text_prompt}\n\n" + selected_prompt
            prompt_meta['input_characters'] = len(selected_prompt)
            prompt_meta['retry_reference_mode'] = None

            def correction_base_prompt():
                # 发生已有校验错误时扩大参考范围，不额外增加模型调用。
                # 纠错不能被首次路由漏选限制；完整 skill、图片和题意始终保留。
                prompt_meta['retry_reference_mode'] = 'full'
                # 复合题可能首次选择了类别默认集以外的合法能力，纠错也须保留。
                retry_cards = list(dict.fromkeys(
                    load_sop_index()['categories'][category] + prompt_meta['cards']))
                expanded = assemble_expert_prompt(category, json.dumps({
                    'category': category, 'sops': retry_cards, 'sop_uncertain': False}))
                full = expanded.text + command_suffix
                prompt_meta['retry_cards'] = expanded.metadata['cards']
                if text_prompt:
                    full = f"用户补充说明：{text_prompt}\n\n" + full
                return full

            print(f"DEBUG: Prompt references: {prompt_meta}")
            specialist_image, specialist_mime = image_data, mime_type
            
            print(f"DEBUG: Calling Specialist {category}...")
            try:
                yield json.dumps({'status': 'processing', 'message': '正在调用专家模型生成指令...'}) + '\n'
                
                # Use run_with_heartbeats to avoid proxy timeout during blocking API call
                specialist_result_text = None
                for status, val in run_with_heartbeats(model_adapter.generate, selected_prompt,
                                                       specialist_image, specialist_mime):
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
            if (not validation['ok'] and (validation['validity'] < 0.95 or validation['has_command_errors'])
                    and not specialist_result_text.startswith("Error:")):
                invalid_preview = '\n'.join(validation['invalid_lines'][:10])
                if validation['command_errors']:
                    invalid_preview += '\n' + '\n'.join(
                        f"{item['line']}: {'; '.join(item['errors'])}"
                        for item in validation['command_errors'][:10])
                print(f"WARNING: 指令校验未通过 (有效率 {validation['validity']})，自动重试一次。"
                      f"无效行: {validation['invalid_lines'][:5]}")
                yield json.dumps({'status': 'processing', 'message': '发现无效指令，正在自动修正...'}) + '\n'
                retry_prompt = (
                    correction_base_prompt()
                    + "\n\n【修正要求】你上一次输出的以下行不是合法的 GeoGebra 命令，"
                      "请重新输出完整指令列表，确保每一行都是可被 GeoGebra evalCommand 执行的命令，"
                      "不要输出任何注释、说明文字或无法解析的内容：\n"
                    + invalid_preview
                )
                try:
                    retry_result_text = None
                    for status, val in run_with_heartbeats(model_adapter.generate, retry_prompt, specialist_image, specialist_mime):
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

            # --- 语义校验闭环：类别结构化自查 -> 失败明细回灌重试（最多 2 次）---
            # 金标准判分只能离线用；此处按类别做通用结构检查（动点/滑块/圆锥曲线/
            # 3D 模式/文字残留），失败原因作为修正要求回灌，与 P0 语法闭环同构。
            semantic_state = semantic_guard.semantic_check(category, specialist_result_text)
            semantic_retries = 0
            while (not semantic_state['ok'] and semantic_retries < 2
                    and not specialist_result_text.startswith("Error:")):
                semantic_retries += 1
                print(f"WARNING: 语义校验未通过（第 {semantic_retries} 次），回灌重试: "
                      f"{semantic_state['summary']}")
                yield json.dumps({'status': 'processing',
                                  'message': f'图形结构自检未通过，正在自动修正（{semantic_retries}/2）...'}) + '\n'
                failure_lines = '\n'.join(f"- {f['detail']}" for f in semantic_state['failures'])
                sem_retry_prompt = (
                    correction_base_prompt()
                    + "\n\n【结构自检修正要求】你上一次生成的指令通过了语法检查，但存在以下结构问题：\n"
                    + failure_lines
                    + "\n\n请重新输出完整指令列表（保留上一次正确的部分），修复上述全部问题。"
                      "特别注意：动点按题意保留自由度，可直接拖动路径/区域点或由参数驱动，"
                      "解析几何必须显式构造圆锥曲线对象，立体几何必须 MODE: 3D + 空间坐标，"
                      "不要生成任何 Text 文字对象。"
                )
                try:
                    sem_retry_text = None
                    for status, val in run_with_heartbeats(model_adapter.generate, sem_retry_prompt,
                                                           specialist_image, specialist_mime):
                        if status == 'heartbeat':
                            yield val
                        elif status == 'error':
                            raise val
                        elif status == 'result':
                            sem_retry_text = val
                    if sem_retry_text:
                        new_state = semantic_guard.semantic_check(category, sem_retry_text)
                        print(f"DEBUG: 语义重试后 ok={new_state['ok']} (原 {semantic_state['ok']})")
                        new_validation = ggb_parser.validate_text(sem_retry_text)
                        if (not new_validation['has_command_errors']
                                and (new_state['ok'] or len(new_state['failures']) < len(semantic_state['failures']))):
                            specialist_result_text = sem_retry_text
                            semantic_state = new_state
                except Exception as sem_e:
                    print(f"WARNING: 语义重试失败，沿用当前结果: {sem_e}")
                    break

            # --- D 规则过滤：删除残留的 Text 文字对象行（比 prompt 约束更可靠）---
            filtered_text = semantic_guard.strip_text_objects(specialist_result_text)
            if filtered_text != specialist_result_text:
                print("DEBUG: 已过滤残留 Text 文字对象")
                specialist_result_text = filtered_text
                semantic_state = semantic_guard.semantic_check(category, specialist_result_text)

            commands = ggb_parser.extract_valid_commands(specialist_result_text)
            # 语义修正和 Text 过滤可能更换最终文本；返回最终结果的校验与遥测。
            validation = ggb_parser.validate_text(specialist_result_text)

            yield json.dumps({
                'status': 'completed',
                'commands': commands,
                'category': category,
                'prompt': prompt_meta,
                'validation': {
                    'validity': validation['validity'],
                    'retried': retried,
                    'unknown_commands': validation['unknown_commands'],
                    'command_errors': validation['command_errors'],
                    'semantic_ok': semantic_state['ok'],
                    'semantic_failures': [f['check'] for f in semantic_state['failures']],
                    'semantic_retries': semantic_retries,
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
