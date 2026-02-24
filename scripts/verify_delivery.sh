#!/usr/bin/env bash
# 测谎系统 - 交付校验（见 docs/TECH.md §4.3）
set -e
cd "$(dirname "$0")/.."
export PYTHONPATH=.

echo "[1/4] 后端启动..."
timeout 10 uvicorn backend.main:app --host 127.0.0.1 --port 9000 &
UV_PID=$!
sleep 3

echo "[2/4] 健康检查..."
curl -sf http://127.0.0.1:9000/health | grep -q '"status":"ok"'

echo "[3/4] 会话创建与结束..."
SID=$(curl -sf -X POST http://127.0.0.1:9000/sessions -H "Content-Type: application/json" -d '{}' | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])")
curl -sf -X POST "http://127.0.0.1:9000/sessions/$SID/end" -H "Content-Type: application/json" -d '{}' > /dev/null

echo "[4/4] 报告查询..."
curl -sf "http://127.0.0.1:9000/sessions/$SID/report" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'summary' in d and 'timeline' in d"

kill $UV_PID 2>/dev/null || true
echo "校验通过。"
