#!/bin/bash
# BTC单币种 RR扫描 1.0~2.0 步长0.1
cd "$(dirname "$0")"

echo "BTC RR扫描 | 180天 | 5x杠杆"
echo "============================================================"

for rr in 1.0 1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 2.0; do
  result=$(timeout 120 node backtest-runner.js --btc-only --rr $rr --drawdown 2>&1)
  trades=$(echo "$result" | grep "交易次数" | head -1 | grep -oP '\d+')
  winrate=$(echo "$result" | grep "胜率" | tail -1 | grep -oP '[\d.]+%' | head -1)
  ret=$(echo "$result" | grep "总收益" | grep -oP '[\-\d.]+%')
  maxdd=$(echo "$result" | grep "最大回撤" | grep -oP '[\d.]+%' | head -1)
  conloss=$(echo "$result" | grep "最大连续亏损" | grep -oP '\d+')
  final=$(echo "$result" | grep "最终资金" | grep -oP '\$[\d.]+')
  
  # 计算收益/回撤比
  ret_num=$(echo "$ret" | tr -d '%')
  dd_num=$(echo "$maxdd" | tr -d '%')
  if [ -n "$dd_num" ] && [ "$dd_num" != "0" ]; then
    ratio=$(echo "scale=2; $ret_num / $dd_num" | bc 2>/dev/null || echo "N/A")
  else
    ratio="N/A"
  fi
  
  echo "RR $rr | ${trades}次 | 胜率${winrate} | 收益${ret} | 回撤${maxdd} | 连亏${conloss} | 收益/回撤${ratio} | ${final}"
done

echo "============================================================"
echo "扫描完成"
