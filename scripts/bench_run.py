# -*- coding: utf-8 -*-
"""
基线批量跑分：把全部案例的题目图批量提交到 MathMover 后端，
保存每题的候选指令，并对照金标准 expected_objects.json 判分。

前置条件：
  1. 本地后端已启动（python app.py，端口 5000）
  2. 提供一个可用的测试账号（需要足够积分或有效 BYOK 订阅）：
     --token <Supabase access_token>  或  --email/--password（用匿名 key 登录换取）

用法:
  python scripts/bench_run.py --email a@b.com --password pw --label pre_p0
  python scripts/bench_run.py --token eyJ... --label post_p0 --fresh
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.benchmark import score_case, CASES_DIR  # noqa: E402
from ggb_parser import parse_commands  # noqa: E402

ENV_LOCAL = ROOT / "math-mover-next" / ".env.local"


def load_env_local() -> dict:
    env = {}
    if ENV_LOCAL.exists():
        for line in ENV_LOCAL.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env


def get_access_token(args) -> str:
    if args.token:
        return args.token
    email, password = args.email, args.password
    if not (email and password):
        acct_file = ROOT / ".secrets" / "bench_account.json"
        if acct_file.exists():
            acct = json.loads(acct_file.read_text(encoding="utf-8"))
            email, password = acct["email"], acct["password"]
    if not (email and password):
        raise SystemExit("缺少 --token / --email+--password，且 .secrets/bench_account.json 不存在")
    env = load_env_local()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    anon = env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not (url and anon):
        raise SystemExit("缺少 --token，且 math-mover-next/.env.local 中没有 Supabase 匿名配置")
    resp = requests.post(
        f"{url}/auth/v1/token?grant_type=password",
        headers={"apikey": anon, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=30,
    )
    if resp.status_code != 200:
        raise SystemExit(f"登录失败: {resp.status_code} {resp.text[:200]}")
    return resp.json()["access_token"]


def generate_once(backend: str, token: str, image: Path, channel_retries: int = 5):
    """提交一题，返回 (status, payload)。status: completed | error | exception
    遇到 Gemini 地域拦截（代理出口被 Google 拒）时等待后重试，容忍代理节点抖动。"""
    attempts = 0
    while True:
        attempts += 1
        try:
            with image.open("rb") as f:
                resp = requests.post(
                    f"{backend}/api/upload",
                    headers={"Authorization": f"Bearer {token}"},
                    files={"file": (image.name, f, "image/png")},
                    data={"text": "", "responseMode": "stream"},
                    stream=True, timeout=(15, 900),
                )
            if resp.status_code != 200:
                return "error", {"message": f"HTTP {resp.status_code}: {resp.text[:200]}"}
            final = None
            for raw in resp.iter_lines(decode_unicode=True):
                if not raw or not raw.strip():
                    continue  # 心跳
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                final = event
                if event.get("status") in ("completed", "error"):
                    break
            if final is None:
                return "error", {"message": "流结束但无事件"}
            msg = str(final.get("message", ""))
            if final.get("status") == "error" and "User location is not supported" in msg:
                if attempts <= channel_retries:
                    print(f"    ... 通道抖动，等待 60s 重试（{attempts}/{channel_retries}）")
                    time.sleep(60)
                    continue
            return ("completed" if final.get("status") == "completed" else "error"), final
        except requests.RequestException as e:
            if attempts <= channel_retries:
                print(f"    ... 网络异常，等待 30s 重试（{attempts}/{channel_retries}）: {str(e)[:60]}")
                time.sleep(30)
                continue
            return "exception", {"message": str(e)}


def wait_for_channel(max_wait_minutes: int = 15) -> bool:
    """跑批前确认 Gemini 通道可用（用 .env 的 key 走 7897 代理探测）。"""
    env = {}
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    key = env.get("GOOGLE_API_KEY")
    if not key:
        print("警告: .env 无 GOOGLE_API_KEY，跳过通道检查")
        return True
    deadline = time.time() + max_wait_minutes * 60
    while time.time() < deadline:
        try:
            r = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                params={"key": key},
                proxies={"http": "http://127.0.0.1:7897", "https": "http://127.0.0.1:7897"},
                timeout=15,
            )
            if r.status_code == 200:
                print("通道检查: OK")
                return True
            print(f"通道检查: HTTP {r.status_code}（节点被 Gemini 拒绝），60s 后重查…")
        except requests.RequestException as e:
            print(f"通道检查: 网络异常 {str(e)[:50]}，60s 后重查…")
        time.sleep(60)
    print("通道长时间不可用，放弃本轮")
    return False


def cmd_run(args):
    if not args.skip_channel_check and not wait_for_channel():
        raise SystemExit(1)
    token = get_access_token(args)
    cases = sorted(p.parent for p in CASES_DIR.rglob("problem.png"))
    if args.limit:
        cases = cases[:args.limit]
    print(f"共 {len(cases)} 个案例，后端 {args.backend}，标签 {args.label}\n")

    results = []
    unknown_counter = {}
    for i, case in enumerate(cases, 1):
        name = str(case.relative_to(CASES_DIR)).replace("\\", "/")
        cand_path = case / "candidate_commands.txt"
        if cand_path.exists() and not args.fresh:
            print(f"[{i:>2}/{len(cases)}] {name}: 已有候选，跳过（--fresh 重跑）")
            continue
        status, payload = generate_once(args.backend, token, case / "problem.png")
        if status == "error" and "HTTP 401" in str(payload.get("message", "")):
            print("    ... token 过期，重新登录后重试")
            token = get_access_token(args)
            status, payload = generate_once(args.backend, token, case / "problem.png")
        if status != "completed":
            results.append({"case": name, "status": status, "error": payload.get("message", "")})
            print(f"[{i:>2}/{len(cases)}] {name}: ❌ {payload.get('message', '')[:80]}")
            continue
        commands = payload.get("commands") or []
        cand_path.write_text("\n".join(commands) + "\n", encoding="utf-8")
        result = score_case(case, "\n".join(commands))
        result["status"] = "completed"
        gen_validation = payload.get("validation") or {}
        result["gen_validity"] = gen_validation.get("validity")
        result["gen_retried"] = gen_validation.get("retried")
        results.append(result)
        mark = "PASS" if result["pass"] else "FAIL"
        extra = f" 缺失{result['missing'][:4]}" if result["missing"] else ""
        retry_note = " [已重试]" if result.get("gen_retried") else ""
        print(f"[{i:>2}/{len(cases)}] {name}: {mark} "
              f"{result['matched']}/{result['expected']}{extra}{retry_note}")

    done = [r for r in results if r.get("status") == "completed"]
    passed = sum(1 for r in done if r["pass"])
    summary = {
        "label": args.label,
        "backend": args.backend,
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "total": len(cases),
        "completed": len(done),
        "failed_requests": len(results) - len(done),
        "pass": passed,
        "pass_rate": round(passed / len(done), 4) if done else 0,
        "unknown_commands": unknown_counter,
        "results": results,
    }
    report_dir = ROOT / "benchmarks" / "reports"
    report_dir.mkdir(exist_ok=True)
    report_path = report_dir / f"{args.label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n===== 结果：{passed}/{len(done)} PASS（可用率 {summary['pass_rate']:.0%}），"
          f"请求失败 {summary['failed_requests']} =====")
    print(f"报告已写入 {report_path.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="基线批量跑分")
    ap.add_argument("--backend", default="http://127.0.0.1:5000")
    ap.add_argument("--token", help="Supabase access_token（与 email/password 二选一）")
    ap.add_argument("--email")
    ap.add_argument("--password")
    ap.add_argument("--label", default="run", help="报告标签，如 pre_p0 / post_p0")
    ap.add_argument("--fresh", action="store_true", help="忽略已有候选，全部重跑")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 个案例（调试用）")
    ap.add_argument("--skip-channel-check", action="store_true", help="跳过跑批前的 Gemini 通道检查")
    args = ap.parse_args()
    cmd_run(args)


if __name__ == "__main__":
    main()
