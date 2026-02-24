#!/usr/bin/env bash
# 安装 WebSocket 依赖并启动后端（需在终端执行，会提示输入 sudo 密码）
set -e
cd "$(dirname "$0")/.."

echo "检查 WebSocket 支持..."
if ! python3 -c "import websockets" 2>/dev/null; then
  echo "未检测到 python3-websockets，正在安装（需要输入本机密码）..."
  sudo apt install -y python3-websockets
fi

echo "释放端口 9000..."
fuser -k 9000/tcp 2>/dev/null || true
sleep 1

echo "启动后端..."
export PYTHONPATH=.
exec uvicorn backend.main:app --host "${CEHUANG_API_HOST:-0.0.0.0}" --port "${CEHUANG_API_PORT:-9000}"
