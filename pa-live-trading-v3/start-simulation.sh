#!/bin/bash

# PA Live Trading V3 - 模拟模式启动脚本

echo "启动 PA Live Trading V3 (模拟模式)..."

cd "$(dirname "$0")"

# 设置环境变量
export PA_MODE=simulation

# 启动
node live-trading-core.js

echo "PA Live Trading V3 (模拟模式) 已停止"
