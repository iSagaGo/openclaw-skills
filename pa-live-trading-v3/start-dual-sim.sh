#!/bin/bash
# PA Live Trading V3 - 启动双币种模拟模式

echo "=========================================="
echo "PA自动交易系统 - 启动双币种模拟盘"
echo "=========================================="

# 停止旧进程
./stop-sim.sh 2>/dev/null

# 创建数据目录
mkdir -p data-simulation

# 启动模拟盘（使用双币种核心）
echo "启动模拟盘..."
PA_MODE=simulation nohup node live-trading-core-dual.js > data-simulation/live-trading.log 2>&1 &
PID=$!

sleep 2

if ps -p $PID > /dev/null; then
  echo "✅ 模拟盘启动成功"
  echo "进程ID: $PID"
  echo ""
  echo "监控命令:"
  echo "查看日志: tail -f data-simulation/live-trading.log"
  echo "查看状态: cat data-simulation/live-state.json | jq"
  echo "停止系统: ./stop-sim.sh"
else
  echo "❌ 模拟盘启动失败"
  echo "查看日志: cat data-simulation/live-trading.log"
  exit 1
fi
