# -*- coding: utf-8 -*-
"""多供应商切换：从 providers.json 注册表把某个'供应商+模型'写入 config.json。

providers.json 与 config.json 同级敏感（均不入库）。切换后默认发 3 次探针验证
通道可用；后端每请求重读 config.json，切换即时生效、无需重启。

用法:
  python scripts/switch_provider.py list
  python scripts/switch_provider.py use <供应商key> [模型名] [--no-probe]

示例:
  python scripts/switch_provider.py use b_ai glm-5.3-flash
  python scripts/switch_provider.py use amd_radeon            # 用该商默认(首个)模型
  python scripts/switch_provider.py use b_ai qwen3.8-flash --no-probe
"""
import argparse
import json
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
PROVIDERS = ROOT / "providers.json"
CONFIG = ROOT / "config.json"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_config(provider_key, model, entry):
    try:
        cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        cfg = {}
    # 只覆盖模型通道键，保留 router_mode / perplexity_api_key 等路由设置
    cfg.update({
        "provider": "openai_compatible",
        "api_protocol": "openai_chat",
        "base_url": entry["base_url"].rstrip("/"),
        "api_key": entry["api_key"],
        "model_name": model,
        "timeout_seconds": str(entry.get("timeout_seconds", 240)),
        "max_tokens": str(entry.get("max_tokens") or ''),
    })
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=True), encoding="utf-8")
    return cfg


def probe(cfg, attempts=3):
    """小文本探针：3 次内任一 200 即视为通道可用。"""
    h = {"Authorization": f"Bearer {cfg['api_key']}"}
    for i in range(attempts):
        try:
            r = requests.post(
                f"{cfg['base_url']}/chat/completions", headers=h, timeout=45,
                json={"model": cfg["model_name"], "max_tokens": 10,
                      "messages": [{"role": "user", "content": "hi"}]},
            )
            if r.status_code == 200:
                return True, f"第{i + 1}次尝试 200"
            last = f"HTTP {r.status_code}: {r.text[:60]}"
        except Exception as e:
            last = str(e)[:60]
        time.sleep(5)
    return False, last


def cmd_list():
    data = load(PROVIDERS)
    cur = load(CONFIG) if CONFIG.exists() else {}
    print(f"当前 config.json: {cur.get('model_name', '?')} @ {cur.get('base_url', '?')}\n")
    for key, p in data["providers"].items():
        has_key = "✅" if p.get("api_key") else "⚠️ key 未登记"
        print(f"[{key}] {p['name']}  {p['base_url']}  {has_key}")
        if p.get("notes"):
            print(f"    备注: {p['notes']}")
        for m, status in p.get("models", {}).items():
            print(f"    - {m}: {status}")
        print()


def cmd_use(args):
    data = load(PROVIDERS)["providers"]
    if args.provider not in data:
        sys.exit(f"未知供应商 {args.provider}，可选: {', '.join(data)}")
    entry = data[args.provider]
    models = list(entry.get("models", {}))
    model = args.model or (models[0] if models else None)
    if not model:
        sys.exit(f"[{args.provider}] 未登记任何模型，请检查 providers.json")
    if args.model and args.model not in entry.get("models", {}):
        print(f"⚠️ {args.model} 不在 [{args.provider}] 登记清单中，仍按指定写入")
    if not entry.get("api_key"):
        sys.exit(f"[{args.provider}] api_key 未登记，请先填入 providers.json")

    cfg = write_config(args.provider, model, entry)
    print(f"config.json 已写入: {model} @ {cfg['base_url']}"
          f"（后端每请求重读，即时生效）")

    if args.no_probe:
        print("跳过探针（--no-probe）")
        return
    ok, detail = probe(cfg)
    print(f"探针: {'✅ 通道可用' if ok else f'❌ 不可用（{detail}）'}")
    if not ok:
        print("注意：config.json 已指向该通道但探针未通过，可用 `list` 查看其他供应商后重切。")
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description="供应商注册表切换")
    ap.add_argument("command", choices=["list", "use"])
    ap.add_argument("provider", nargs="?", help="providers.json 里的供应商 key")
    ap.add_argument("model", nargs="?", help="模型名（省略则用该商登记的第一个）")
    ap.add_argument("--no-probe", action="store_true", help="切换后不发探针")
    args = ap.parse_args()
    if args.command == "list":
        cmd_list()
    else:
        if not args.provider:
            sys.exit("用法: switch_provider.py use <供应商> [模型] [--no-probe]")
        cmd_use(args)


if __name__ == "__main__":
    main()
