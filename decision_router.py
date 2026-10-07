# -*- coding: utf-8 -*-
"""
Router 后端 2：Perplexity Decisions API（决策模型 pplx-decider-v1-27b）。

与 LLM 分类（ROUTER_PROMPT + 对话模型）并列的可选路由后端：
决策模型不生成文本，直接返回带概率的结构化答案（choice + confidence），
省掉"从自然语言抠 JSON"这一步，并给出 LLM 路由给不了的置信度信号。

接口：
    classify(api_key, image_bytes, mime_type, text_prompt, timeout) -> dict
    返回 {'category': 'A'..'D', 'confidence': 0..1, 'probabilities': {...}}
    失败抛 DecisionRouterError（调用方决定回退还是报错）。

图片限制（API 实测约束，文档 docs.perplexity.ai/docs/decisions/quickstart）：
    图片按 32x32 像素块计数，宽高各取整到 32 的倍数后 (w/32)*(h/32) <= 2048。
    超限不报 400 而是挂约 1 分钟后 504，所以发送前必须缩图（fit_image_for_decisions）。
"""

import base64
import io
import math

import requests
from PIL import Image

DECISIONS_URL = 'https://api.perplexity.ai/v1/decisions'
DECISIONS_MODEL = 'pplx-decider-v1-27b'
MAX_TILES = 2048          # 32x32 像素块上限（如 2048x1024、1440x1440）
TILE = 32
REQUEST_TIMEOUT = 30.0    # 官方建议：小输入 10s 足够，上限内 30s 覆盖全部

# 与 ROUTER_PROMPT 的分类标准一字不差——两个后端的类别语义必须对齐
CATEGORY_CRITERIA = {
    'A': '函数与图像（一次函数、开口向上/向下的二次函数（抛物线）、三角函数、导数、一般函数）',
    'B': '平面几何（圆、多边形、角平分线、平面向量）',
    'C': '解析几何（椭圆、双曲线、开口向左/向右的抛物线、圆锥曲线）',
    'D': '立体几何（正方体、四面体、空间动点、球、旋转体）',
}

_CATEGORY_QUESTION = {
    'type': 'choice',
    'instructions': '这道数学题属于哪一类？',
    'criteria': CATEGORY_CRITERIA,
}


class DecisionRouterError(RuntimeError):
    """Decisions API 调用失败（网络/鉴权/响应结构异常）。"""


def fit_image_for_decisions(image_bytes: bytes) -> str:
    """缩放到 2048 块以内，返回 PNG 的 base64 data URL。

    分类不需要看清小字，缩图无损决策质量；宁小勿大（超限会 504 挂死）。
    """
    try:
        im = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    except Exception as e:
        raise DecisionRouterError(f'图片解码失败: {e}')

    w, h = im.size
    tw, th = max(1, round(w / TILE)), max(1, round(h / TILE))
    if tw * th > MAX_TILES:
        scale = math.sqrt(MAX_TILES / (tw * th))
        # 向下取整到 32 的倍数，保证缩后块数一定 <= 2048
        w = max(TILE, int(w * scale) // TILE * TILE)
        h = max(TILE, int(h * scale) // TILE * TILE)
        im = im.resize((w, h), Image.LANCZOS)

    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii')


def classify(api_key: str, image_bytes, mime_type, text_prompt: str = '',
             timeout: float = REQUEST_TIMEOUT) -> dict:
    """一次 Decisions 调用完成分类，返回 category/confidence/probabilities。"""
    if not (api_key or '').strip():
        raise DecisionRouterError('未配置 Perplexity API Key（设置 → 分类路由）')

    state = []
    if text_prompt:
        state.append(f'用户补充说明/题目文字：{text_prompt}')
    if image_bytes:
        state.append({'type': 'image_url',
                      'image_url': {'url': fit_image_for_decisions(image_bytes)}})
    if not state:
        raise DecisionRouterError('无题图也无题目文字，无法分类')

    body = {
        'model': DECISIONS_MODEL,
        'state': state[0] if len(state) == 1 else state,
        'questions': {'category': _CATEGORY_QUESTION},
    }
    try:
        resp = requests.post(
            DECISIONS_URL,
            headers={'Authorization': f'Bearer {api_key.strip()}'},
            json=body,
            timeout=timeout,
        )
    except requests.RequestException as e:
        raise DecisionRouterError(f'网络错误: {e}')

    if resp.status_code != 200:
        try:
            msg = resp.json().get('error', {}).get('message', resp.text[:200])
        except Exception:
            msg = resp.text[:200]
        raise DecisionRouterError(f'HTTP {resp.status_code}: {msg}')

    try:
        ans = resp.json()['answers']['category']
        category = str(ans['choice']).upper()
        confidence = float(ans['confidence'])
        probabilities = {k: float(v) for k, v in ans['probabilities'].items()}
    except (KeyError, TypeError, ValueError) as e:
        raise DecisionRouterError(f'响应结构异常: {e}')

    if category not in CATEGORY_CRITERIA:
        raise DecisionRouterError(f'未知类别: {category!r}')
    return {'category': category, 'confidence': confidence, 'probabilities': probabilities}
