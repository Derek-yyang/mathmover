#!/usr/bin/env bash
# MathMover 一键部署脚本
# 用法: ./scripts/deploy.sh [git-ref]
#   不传参数  -> 部署当前 HEAD（要求工作区干净）
#   传入 ref  -> 部署指定提交/分支（用于回滚，例如 ./scripts/deploy.sh 755bf36）
#
# 原理：把 git archive 打出的“已提交快照”流式传到服务器解压，
#       用 rsync 覆盖到 ~/math_app（保留服务器上的 .env 等本地文件），
#       然后在服务器上 docker compose up -d --build 滚动重建。
set -euo pipefail

# ---- 配置 ----
SSH_KEY="$(cd "$(dirname "$0")/.." && pwd)/.secrets/codex.pem"
SERVER="ubuntu@43.134.64.95"
APP_DIR="math_app"                 # 服务器上的项目目录（容器名前缀来源，勿改）
TMP_DIR="math_app_deploy_tmp"      # 服务器上的临时解压目录
# --------------

REF="${1:-HEAD}"
SSH_OPTS=(-i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=10)

# 部署 HEAD 时要求工作区干净，保证线上版本可回溯
if [[ "$REF" == "HEAD" && -n "$(git status --porcelain)" ]]; then
  echo "✗ 工作区有未提交的改动。请先 commit，或显式指定要部署的 ref。"
  exit 1
fi

COMMIT="$(git rev-parse --short "$REF")"
echo "==> 部署 $REF ($COMMIT) 到 $SERVER:~/$APP_DIR"

echo "==> 1/4 上传代码快照"
git archive "$REF" | ssh "${SSH_OPTS[@]}" "$SERVER" \
  "rm -rf ~/$TMP_DIR && mkdir ~/$TMP_DIR && tar -x -C ~/$TMP_DIR"

echo "==> 2/4 同步到项目目录（保留 .env / node_modules / .next）"
ssh "${SSH_OPTS[@]}" "$SERVER" "rsync -a \
  --exclude='.env' \
  --exclude='math-mover-next/.env.local' \
  --exclude='math-mover-next/node_modules' \
  --exclude='math-mover-next/.next' \
  ~/$TMP_DIR/ ~/$APP_DIR/ && rm -rf ~/$TMP_DIR"

echo "==> 3/4 重建并滚动重启容器"
ssh "${SSH_OPTS[@]}" "$SERVER" \
  "cd ~/$APP_DIR && sudo -n docker compose up -d --build 2>&1 | tail -20"

echo "==> 4/4 健康检查"
ssh "${SSH_OPTS[@]}" "$SERVER" '
  sleep 5
  sudo -n docker ps --filter name=math_app --format "{{.Names}}\t{{.Status}}"
  curl -sf -o /dev/null -w "本地 /api/ -> HTTP %{http_code}\n" http://localhost/api/
'

echo "==> 完成: $COMMIT 已上线 https://mathmover.top"
