# PA Live Trading V3 - 双币种自动交易系统

基于最优回测策略的实盘交易系统，支持SOL 1h + BTC 1h双币种同时交易。

## 特性

- ✅ 双币种模式（SOL 1h + BTC 1h）
- ✅ 智能资金分配（无重叠100%，有重叠50%）
- ✅ 增强密集区识别（动态强度评分）
- ✅ BTC使用BOS（有BOS 4%，无BOS 2%）
- ✅ SOL不使用BOS（固定2%）
- ✅ Binance API集成（开仓/平仓/止盈止损）
- ✅ 双模式支持（模拟/实盘）
- ✅ 状态持久化（崩溃恢复）
- ✅ 时间对齐机制（K线完成 + 15s延迟）
- ✅ 监控系统（每日统计报告）

## 回测结果

**配置：** 初始资金$100，5倍杠杆，180天

**结果：**
- 交易次数：57次
- 胜率：66.67%（38胜 19负）
- 总收益：+320.43%
- 净收益：+252.42%（扣除手续费）
- 最终资金：$420.43

**各币种表现：**
- SOL 1h: 31次，61.29%胜率
- BTC 1h: 26次，73.08%胜率

**资金分配：**
- 全仓开单：52次（91.2%）
- 半仓开单：5次（8.8%）

## 安装

```bash
# 1. 解压skill
tar -xzf pa-live-trading-v3-dual.tar.gz
cd pa-live-trading-v3-dual

# 2. 安装依赖
npm install

# 3. 配置Binance API（实盘模式）
# 编辑 config-real.js，填入API Key和Secret
# 或使用vault/binance-api.json
```

## 配置

### 模拟模式（config-simulation.js）

```javascript
module.exports = {
  mode: 'simulation',
  name: 'PA Live Trading V3 - Simulation',
  
  strategies: [
    { symbol: 'SOLUSDT', interval: '1h', name: 'SOL 1h' },
    { symbol: 'BTCUSDT', interval: '1h', name: 'BTC 1h' }
  ],
  
  initialBalance: 100,
  leverage: 5,
  
  // 无需Binance API
};
```

### 实盘模式（config-real.js）

```javascript
module.exports = {
  mode: 'real',
  name: 'PA Live Trading V3 - Real',
  
  strategies: [
    { symbol: 'SOLUSDT', interval: '1h', name: 'SOL 1h' },
    { symbol: 'BTCUSDT', interval: '1h', name: 'BTC 1h' }
  ],
  
  initialBalance: 50,
  leverage: 5,
  
  binance: {
    apiKey: 'YOUR_API_KEY',
    apiSecret: 'YOUR_API_SECRET',
    testnet: false
  }
};
```

## 使用

### 启动模拟模式

```bash
./start-dual-sim.sh
```

### 启动实盘模式

```bash
./start-dual-real.sh
```

### 停止系统

```bash
./stop-sim.sh   # 停止模拟模式
./stop-real.sh  # 停止实盘模式
```

### 查看状态

```bash
# 查看日志
tail -f data-sim/live-trading.log
tail -f data-real/live-trading.log

# 查看状态
cat data-sim/live-state.json | jq
cat data-real/live-state.json | jq

# 查看通知
tail -f data-sim/notification.txt
tail -f data-real/notification.txt
```

### 监控报告

```bash
# 每日监控报告
node monitor.js
```

## 策略说明

### 信号生成

**做多信号：**
1. 趋势向上
2. 价格触及支撑带
3. 出现反弹（当前K线收盘价 > 前一根K线收盘价）
4. 止损位：支撑带下沿
5. 止盈位：1比1（盈利=风险）

**做空信号：**
1. 趋势向下
2. 价格触及阻力带
3. 出现回落（当前K线收盘价 < 前一根K线收盘价）
4. 止损位：阻力带上沿
5. 止盈位：1比1（盈利=风险）

### 风险管理

**BTC：**
- 有BOS：4%风险
- 无BOS：2%风险

**SOL：**
- 固定2%风险（不使用BOS）

### 资金分配

**智能分配：**
- 无持仓重叠：全仓开单（100%）
- 有持仓重叠：1:1分配（各50%）

**示例：**
1. SOL信号 → 100%资金开仓
2. BTC信号（SOL持仓中）→ SOL调整为50%，BTC开50%
3. SOL平仓 → BTC保持50%（不调整）
4. 下一个信号 → 100%资金开仓

## Binance API

### 最小订单要求

- 最小订单金额：$10（名义价值，不含杠杆）
- 价格精度：1位小数（toFixed(1)）
- 数量精度：3位小数（toFixed(3)）

### API功能

- ✅ getCurrentPrice - 获取当前价格
- ✅ getBalance - 获取账户余额
- ✅ getPositions - 获取持仓信息
- ✅ setLeverage - 设置杠杆
- ✅ marketOrder - 市价开仓/平仓
- ✅ setStopLossTakeProfit - 设置止盈止损

### 止盈止损

**订单类型：**
- 止损：STOP_MARKET
- 止盈：TAKE_PROFIT_MARKET

**字段名：**
- 条件单使用 `algoId`，不是 `orderId`

**自动平仓：**
- closePosition: "true"

## 文件结构

```
pa-live-trading-v3-dual/
├── live-trading-core-dual.js    # 双币种交易核心
├── config-simulation.js         # 模拟模式配置
├── config-real.js               # 实盘模式配置
├── binance-api.js               # Binance API封装
├── monitor.js                   # 监控系统
├── start-dual-sim.sh            # 启动模拟模式
├── start-dual-real.sh           # 启动实盘模式
├── stop-sim.sh                  # 停止模拟模式
├── stop-real.sh                 # 停止实盘模式
├── status-all.sh                # 查看状态
├── backtest.js                  # 单币种回测
├── backtest-dual.js             # 双币种回测
├── test-api.js                  # API测试
├── test-real-trade.js           # 真实交易测试
├── test-sl-tp.js                # 止盈止损测试
├── close-position.js            # 平仓脚本
├── PA-Live-Trading-V3-开发总结.md  # 开发总结
├── README.md                    # 本文件
├── package.json                 # 依赖配置
└── data-sim/                    # 模拟模式数据
    └── data-real/               # 实盘模式数据
```

## 常见问题

### 1. 订单失败："Invalid side"

**原因：** side参数错误

**解决：** 已修复，自动转换 long→BUY, short→SELL

### 2. 订单失败："Order's notional must be no smaller than 100"

**原因：** 订单金额太小

**解决：** 确保订单金额≥$10（实际测试确认）

### 3. 订单失败："Precision is over the maximum"

**原因：** 价格精度错误

**解决：** 已修复，使用toFixed(1)

### 4. 止盈止损订单ID为undefined

**原因：** 条件单使用algoId字段

**解决：** 已修复，优先使用algoId

### 5. 保证金不足

**原因：** 实际需要的保证金比理论值高

**解决：** 预留足够的余额（建议≥$50）

## 安全提示

1. **测试优先：** 先在模拟模式测试，确认无误后再启动实盘
2. **小额开始：** 实盘建议从小额开始（$50-100）
3. **监控告警：** 定期查看监控报告，及时发现异常
4. **备份数据：** 定期备份live-state.json
5. **API安全：** 不要泄露API Key和Secret

## 开发文档

详细的开发过程、问题与解决方案，请参考：
- `PA-Live-Trading-V3-开发总结.md`

## 版本历史

### v3.0.0 (2026-02-25)
- ✅ 双币种模式（SOL 1h + BTC 1h）
- ✅ 智能资金分配
- ✅ 增强密集区识别
- ✅ BOS动态仓位
- ✅ Binance API集成
- ✅ 止盈止损功能
- ✅ 完整测试验证

## 许可

MIT License

## 作者

大富小姐姐 🎀

---

**风险提示：** 加密货币交易存在高风险，请谨慎操作。本系统仅供学习和研究使用，不构成投资建议。
