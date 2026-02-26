#!/bin/bash

# PA Live Trading V3 启动脚本

MODE=${1:-simulation}

echo "启动 PA Live Trading V3 (${MODE} 模式)..."

cd "$(dirname "$0")"

# 设置环境变量
export PA_MODE=$MODE

# 启动
node live-trading-core.js

echo "PA Live Trading V3 已停止"
