#!/usr/bin/env bash
# 测谎系统 - 一键启动脚本
# 启动后端服务并自动打开浏览器

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${CEHUANG_API_PORT:-9000}"
LOG_FILE="/tmp/cehuang_server.log"
URL="http://localhost:${PORT}"

cd "$PROJECT_DIR" || exit 1
export PYTHONPATH="$PROJECT_DIR"

# 如果已有服务在运行，先停掉
if fuser "${PORT}/tcp" >/dev/null 2>&1; then
    echo "端口 ${PORT} 已被占用，正在关闭旧进程…"
    fuser -k "${PORT}/tcp" >/dev/null 2>&1
    sleep 2
fi

echo "======================================="
echo "  测谎系统启动中…"
echo "  项目目录: ${PROJECT_DIR}"
echo "  访问地址: ${URL}"
echo "  日志文件: ${LOG_FILE}"
echo "======================================="

# 启动后端（后台运行，日志写入文件）
nohup python3 -m uvicorn backend.main:app \
    --host 0.0.0.0 \
    --port "$PORT" \
    --log-level info \
    > "$LOG_FILE" 2>&1 &

SERVER_PID=$!
echo "服务进程 PID: ${SERVER_PID}"

# 等待服务就绪（最多等 60 秒）
echo "等待服务启动…"
for i in $(seq 1 60); do
    if curl -s -o /dev/null -w "" "$URL" 2>/dev/null; then
        echo "服务已就绪！正在打开浏览器…"
        xdg-open "$URL" 2>/dev/null &
        echo ""
        echo "======================================="
        echo "  ✅ 测谎系统已启动"
        echo "  地址: ${URL}"
        echo "  关闭: 按 Ctrl+C 或关闭此窗口"
        echo "======================================="
        # 保持前台运行，方便用户按 Ctrl+C 停止
        wait $SERVER_PID
        exit 0
    fi
    sleep 1
done

echo "❌ 服务启动超时，请检查日志: ${LOG_FILE}"
tail -20 "$LOG_FILE"
exit 1
