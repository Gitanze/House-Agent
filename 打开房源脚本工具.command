#!/bin/bash
set -e

APP_URL="http://127.0.0.1:5173/"
NODE_URL="https://nodejs.org/"

cd "$(dirname "$0")"

echo ""
echo "================================"
echo " 房源脚本工具 - Mac 一键启动"
echo "================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。"
  echo "请安装 Node.js LTS 后再双击本文件。"
  open "$NODE_URL"
  read -r -p "安装完成后请重新双击本文件。按回车退出。"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm。请重新安装 Node.js LTS。"
  open "$NODE_URL"
  read -r -p "安装完成后请重新双击本文件。按回车退出。"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "当前 Node.js 主版本为 $NODE_MAJOR，低于本工具要求的 Node.js LTS 20+。"
  echo "请安装 Node.js LTS 后再双击本文件。"
  open "$NODE_URL"
  read -r -p "安装完成后请重新双击本文件。按回车退出。"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "首次运行需要安装依赖，正在执行 npm install ..."
  npm install
fi

echo "正在检查服务是否已经运行..."
if curl -fsS --max-time 2 "$APP_URL" >/dev/null 2>&1; then
  echo "服务已经在运行，正在打开页面..."
  open "$APP_URL"
  exit 0
fi

echo "服务未运行，正在启动 npm run dev..."
npm run dev &
SERVER_PID=$!

echo "等待服务启动..."
for i in {1..20}; do
  if curl -fsS --max-time 2 "$APP_URL" >/dev/null 2>&1; then
    open "$APP_URL"
    echo "已打开页面。关闭本终端窗口后，网页工具会停止运行。"
    wait "$SERVER_PID"
    exit 0
  fi
  sleep 1
done

open "$APP_URL"
echo "已尝试打开页面。如果暂时打不开，请等服务启动完成后刷新。"
echo "关闭本终端窗口后，网页工具会停止运行。"
wait "$SERVER_PID"
