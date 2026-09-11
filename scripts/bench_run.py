# -*- coding: utf-8 -*-
"""
基线批量跑分：把全部案例的题目图批量提交到 MathMover 后端，
保存每题的候选指令，并以性质判分（L2）为主指标。严口径（L1）已退役。

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

from scripts.properties import evaluate_properties, CASES_DIR  # noqa: E402
from ggb_parser import parse_commands  # noqa: E402

ENV_LOCAL = ROOT / "math-mover-next" / ".env.local"

# 上游永久性错误特征（余额/鉴权/模型不存在），重试无意义
PERMANENT_ERROR_MARKERS = (
    "Insufficient balance", "insufficient balance", "Deposit required",
    "CreditsError", "model_not_found", "does not exist", "鉴权", "access_denied",
)


def is_permanent_error(message: str) -> bool:
    return any(k in message for k in PERMANENT_ERROR_MARKERS)




def generate_once(backend: str, image: Path, channel_retries: int = 5):
    """提交一题，返回 (status, payload)。status: completed | error | exception
    遇到 Gemini 地域拦截（代理出口被 Google 拒）时等待后重试，容忍代理节点抖动。"""
    attempts = 0
    while True:
        attempts += 1
        try:
            with image.open("rb") as f:
                resp = requests.post(
                    f"{backend}/api/upload",
                    files={"file": (image.name, f, "image/png")},
                    data={"text": "", "responseMode": "stream"},
                    stream=True, timeout=(15, 1800),
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
    cases = sorted(p.parent for p in CASES_DIR.rglob("problem.png"))
    if args.case:
        cases = [c for c in cases if c.name == args.case.split("/")[-1]
                 and args.case.split("/")[-2] in str(c.parent)]
    if args.limit:
        cases = cases[:args.limit]
    print(f"共 {len(cases)} 个案例，后端 {args.backend}，标签 {args.label}\n")

    results = []
    unknown_counter = {}
    for i, case in enumerate(cases, 1):
        name = str(case.relative_to(CASES_DIR)).replace("\\", "/")
        cand_path = case / "candidate_commands.txt"
        if args.fresh and cand_path.exists():
            cand_path.unlink()
        if cand_path.exists():
            print(f"[{i:>2}/{len(cases)}] {name}: 已有候选，跳过（--fresh 重跑）")
            continue
        status, payload = generate_once(args.backend, case / "problem.png")
        # 上游间歇性错误（分销商 5xx 抖动等）自动重试；余额/鉴权类永久错误不重试
        err_retries = 0
        while (status in ("error", "exception") and err_retries < 3
               and not is_permanent_error(str(payload.get("message", "")))):
            err_retries += 1
            print(f"    ... 上游错误，等待 30s 重试（{err_retries}/3）: "
                  f"{str(payload.get('message', ''))[:70]}")
            time.sleep(30)
            status, payload = generate_once(args.backend, case / "problem.png")
        if status != "completed":
            results.append({"case": name, "status": status, "error": payload.get("message", "")})
            print(f"[{i:>2}/{len(cases)}] {name}: ❌ {payload.get('message', '')[:80]}")
            continue
        commands = payload.get("commands") or []
        cand_text = "\n".join(commands)
        cand_path.write_text(cand_text + "\n", encoding="utf-8")
        cand_ir = parse_commands(cand_text)
        for u in cand_ir["unknown_commands"]:
            unknown_counter[u] = unknown_counter.get(u, 0) + 1
        # 主指标：性质判分（L2）。严口径（L1 金标准比对）已退役，见 benchmarks/README.md
        result = evaluate_properties(case, cand_text)
        result["status"] = "completed"
        gen_validation = payload.get("validation") or {}
        result["gen_validity"] = gen_validation.get("validity")
        result["gen_retried"] = gen_validation.get("retried")
        results.append(result)
        mark = "PASS" if result["pass"] else "FAIL"
        total = result.get("total", 0)
        hit = total - len(result.get("failed", []))
        fail_types = ",".join(sorted({f["type"] for f in result.get("failed", [])}))[:40]
        extra = f" 未过:{fail_types}" if result.get("failed") else ""
        retry_note = " [已重试]" if result.get("gen_retried") else ""
        print(f"[{i:>2}/{len(cases)}] {name}: {mark} "
              f"性质 {hit}/{total}{extra}{retry_note}")

    done = [r for r in results if r.get("status") == "completed"]
    passed = sum(1 for r in done if r["pass"])
    total_props = sum(r.get("total", 0) for r in done)
    hit_props = sum(r.get("total", 0) - len(r.get("failed", [])) for r in done)
    summary = {
        "label": args.label,
        "backend": args.backend,
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "total": len(cases),
        "completed": len(done),
        "failed_requests": len(results) - len(done),
        "pass": passed,
        "pass_rate": round(passed / len(done), 4) if done else 0,
        "property_hit_rate": round(hit_props / total_props, 4) if total_props else 0,
        "unknown_commands": unknown_counter,
        "results": results,
    }
    report_dir = ROOT / "benchmarks" / "reports"
    report_dir.mkdir(exist_ok=True)
    report_path = report_dir / f"{args.label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n===== 结果：{passed}/{len(done)} PASS（可用率 {summary['pass_rate']:.0%}，"
          f"性质命中 {summary['property_hit_rate']:.0%}），请求失败 {summary['failed_requests']} =====")
    print(f"报告已写入 {report_path.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser(description="基线批量跑分")
    ap.add_argument("--backend", default="http://127.0.0.1:5000")
    ap.add_argument("--label", default="run", help="报告标签，如 pre_p0 / post_p0")
    ap.add_argument("--fresh", action="store_true", help="忽略已有候选，全部重跑")
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 个案例（调试用）")
    ap.add_argument("--case", help="只跑指定案例，如 高中/D-球1")
    ap.add_argument("--skip-channel-check", action="store_true", help="跳过跑批前的 Gemini 通道检查")
    args = ap.parse_args()
    cmd_run(args)


if __name__ == "__main__":
    main()
