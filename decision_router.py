# -*- coding: utf-8 -*-
"""
Router 后端 2：Perplexity Decisions API（决策模型 pplx-decider-v1-27b）。

与 LLM 分类（ROUTER_PROMPT + 对话模型）并列的可选路由后端：
决策模型不生成文本，直接返回带概率的结构化答案（choice + confidence），
省掉"从自然语言抠 JSON"这一步，并给出 LLM 路由给不了的置信度信号。

接口：
    classify(api_key, image_bytes, mime_type, text_prompt, timeout, model) -> dict
    返回 {'category': 'A'..'D', 'confidence': 0..1, 'probabilities': {...}}
    失败抛 DecisionRouterError（调用方决定回退还是报错）。
    probe_image_support(api_key, model) -> ''（模型支持图片输入）或错误说明字符串，
    供设置页保存时校验用户填入的决策模型。

图片与延迟（API 实测约束，文档 docs.perplexity.ai/docs/decisions/quickstart）：
    图片按 32x32 像素块计数，(w/32)*(h/32) 超过 2048 时不报 400 而是挂约 1 分钟后 504，
    所以发送前必须缩图（fit_image_for_decisions）。
    延迟随块数近似线性增长，而题型分类只需图形轮廓：主动缩到长边 384px
    （2026-10-08 实测同一张题图 1943 块 18~28s -> ~36 块 1.7~5.0s，
    384/256/512 三档在 9 道全类别题图上决策均 9/9 一致，256 更快但线性分辨率减半，
    对拍照类上传更冒险；384 为速度与稳健的平衡点）。
    另用进程级 Session 复用 TLS 连接，免去每次调用的重新握手。
"""

import base64
import io
import math
import time

import requests
from PIL import Image

DECISIONS_URL = 'https://api.perplexity.ai/v1/decisions'
DECISIONS_MODEL = 'pplx-decider-v1-27b'
DECISIONS_SIDE = 384      # 发送前主动缩到的长边上限（px），依据见 fit_image_for_decisions
MAX_TILES = 2048          # 32x32 像素块 API 硬上限；长边 384 时最多 12x12=144 块，此 cap 仅作防御
TILE = 32
REQUEST_TIMEOUT = 30.0    # 官方建议：小输入 10s 足够，上限内 30s 覆盖全部

# 进程级连接池：复用 TLS 连接，免去每次调用重新握手（冷启动 ~0.2-0.5s，仅进程首次付出）。
# urllib3 连接池本身线程安全；Flask 多线程并发调用安全。
_SESSION = requests.Session()

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
    """主动缩到长边 DECISIONS_SIDE，返回 PNG 的 base64 data URL。

    决策模型只做 A/B/C/D 分类，识别的是图形轮廓（抛物线/椭圆/多面体等），
    不需要看清小字：实测 384/512 两档的类别决策一致、置信度差 <0.01，
    而延迟随块数近似线性下降（同图 1943 块 18~28s -> ~36 块 1.7~5.0s）。
    thumbnail 等比缩放、只缩不放（小图原样通过）。

    API 硬上限：块数 (w/32)*(h/32) <= 2048，超限不报 400 而是挂约 1 分钟后 504。
    长边 384px 时最多 12x12=144 块，正常永不触发；下方 cap 仅作常数误调的防御。
    """
    try:
        im = Image.open(io.BytesIO(image_bytes)).convert('RGB')
    except Exception as e:
        raise DecisionRouterError(f'图片解码失败: {e}')

    if max(im.size) > DECISIONS_SIDE:
        im.thumbnail((DECISIONS_SIDE, DECISIONS_SIDE), Image.LANCZOS)

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


def _tiny_test_image() -> bytes:
    """64x64 纯色 PNG：仅验证模型接受图片输入，4 个像素块、探测延迟最小。"""
    im = Image.new('RGB', (64, 64), (250, 250, 248))
    buf = io.BytesIO()
    im.save(buf, format='PNG')
    return buf.getvalue()


def probe_image_support(api_key: str, model: str = '',
                        timeout: float = REQUEST_TIMEOUT) -> str:
    """用测试图实测决策模型是否接受图片输入（设置保存校验用）。

    返回空字符串 = 模型可用且接受图片；返回字符串 = 面向用户的错误说明
    （不支持图片 / key 无效 / 模型不存在 / 网络失败）。
    """
    try:
        classify(api_key, _tiny_test_image(), 'image/png', '配置校验：请分类这张测试图。',
                 timeout=timeout, model=model)
        return ''
    except DecisionRouterError as e:
        return f'决策模型校验失败：{e}'


def classify(api_key: str, image_bytes, mime_type, text_prompt: str = '',
             timeout: float = REQUEST_TIMEOUT, model: str = '') -> dict:
    """一次 Decisions 调用完成分类，返回 category/confidence/probabilities。

    model 为空时用默认决策模型（DECISIONS_MODEL）；模型拒绝图片输入时抛出
    带明确提示的 DecisionRouterError——设置保存校验与运行期回退原因共用该文案。
    """
    if not (api_key or '').strip():
        raise DecisionRouterError('未配置 Perplexity API Key（设置 → 分类路由）')
    model_name = (model or '').strip() or DECISIONS_MODEL

    state = []
    if text_prompt:
        state.append(f'用户补充说明/题目文字：{text_prompt}')
    if image_bytes:
        state.append({'type': 'image_url',
                      'image_url': {'url': fit_image_for_decisions(image_bytes)}})
    if not state:
        raise DecisionRouterError('无题图也无题目文字，无法分类')

    body = {
        'model': model_name,
        'state': state[0] if len(state) == 1 else state,
        'questions': {'category': _CATEGORY_QUESTION},
    }
    t0 = time.time()
    try:
        resp = _SESSION.post(
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
        low = str(msg).lower()
        if any(k in low for k in ('image', 'multimodal', 'vision', 'modality', 'visual')):
            raise DecisionRouterError(
                f'决策模型 {model_name} 不支持图片输入（API 返回: {msg}）')
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
    print(f"[decisions] category={category} confidence={confidence:.3f} "
          f"elapsed={time.time() - t0:.2f}s")
    return {'category': category, 'confidence': confidence, 'probabilities': probabilities}
