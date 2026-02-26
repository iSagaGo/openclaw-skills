#!/bin/bash

# PA Live Trading V3 - 实盘模式启动脚本

echo "启动 PA Live Trading V3 (实盘模式)..."

cd "$(dirname "$0")"

# 检查API密钥
if [ -z "$BINANCE_API_KEY" ] || [ -z "$BINANCE_API_SECRET" ]; then
  echo "错误: 未设置 BINANCE_API_KEY 或 BINANCE_API_SECRET"
  echo "请先设置环境变量："
  echo "  export BINANCE_API_KEY=your_api_key"
  echo "  export BINANCE_API_SECRET=your_api_secret"
  exit 1
fi

# 设置环境变量
export PA_MODE=real

# 启动
node live-trading-core.js

echo "PA Live Trading V3 (实盘模式) 已停止"
