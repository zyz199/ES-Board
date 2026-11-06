#!/bin/bash
# ES-Board (ES-King) 开发启动脚本
# 用法: ./start-dev.sh
# 说明: 先启动 Vite 前端开发服务器，再启动 Wails 桌面应用。
#       在系统自带的 Terminal.app 中运行，Dock 图标可正常显示。

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_BIN="$ROOT/app/build/bin/ES-King.app/Contents/MacOS/ES-King"
FRONTEND="$ROOT/app/frontend"
PORT=5174

if [ ! -x "$APP_BIN" ]; then
  echo "找不到应用二进制: $APP_BIN"
  echo "请先在项目根目录执行 wails dev 或 wails build 完成一次构建。"
  exit 1
fi

# 1. 启动前端开发服务器（若端口未占用）
if ! nc -z localhost $PORT 2>/dev/null; then
  echo "启动 Vite (端口 $PORT)..."
  (cd "$FRONTEND" && pnpm run dev > /tmp/es-king-vite.log 2>&1 &)
  for i in $(seq 1 30); do
    nc -z localhost $PORT 2>/dev/null && break
    sleep 1
  done
  nc -z localhost $PORT 2>/dev/null || { echo "Vite 启动失败，日志: /tmp/es-king-vite.log"; exit 1; }
  echo "Vite 已就绪: http://localhost:$PORT"
else
  echo "Vite 已在运行 (端口 $PORT)"
fi

# 2. 启动桌面应用
echo "启动 ES-King 应用..."
export devserver=localhost:34115
export frontenddevserverurl="http://localhost:$PORT"
exec "$APP_BIN"
