#!/usr/bin/env bash
# 在项目根 cehuangxitong 下启动后端 API
set -e
cd "$(dirname "$0")/.."
export PYTHONPATH=.

PORT="${CEHUANG_API_PORT:-9000}"
# 若端口被占用则自动释放（仅针对本机 9000）
if [ "$PORT" = "9000" ]; then
  if command -v fuser &>/dev/null; then
    fuser -k 9000/tcp 2>/dev/null && echo "已释放端口 9000，正在启动..." || true
    sleep 1
  fi
fi

exec uvicorn backend.main:app --host "${CEHUANG_API_HOST:-0.0.0.0}" --port "$PORT"
