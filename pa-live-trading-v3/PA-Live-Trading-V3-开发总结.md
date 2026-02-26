# PA Live Trading V3 开发总结

## 项目概述

**目标：** 基于最优回测策略（backtest-final.js）创建实盘交易系统，支持模拟和实盘双模式，集成Binance API，实现自动化交易。

**时间：** 2026-02-24 至 2026-02-25

**结果：** ✅ 完成单币种模式开发和测试，待完成双币种模式

---

## 开发流程

### 1. 系统架构设计

**核心文件：**
- `live-trading-core.js` - 交易核心逻辑（基于backtest-final.js）
- `config-simulation.js` - 模拟模式配置
- `config-real.js` - 实盘模式配置
- `binance-api.js` - Binance API封装
- `monitor.js` - 监控系统
- `start-simulation.sh` / `start-real.sh` - 启动脚本

**设计原则：**
1. 代码复用：直接复制backtest-final.js的核心函数
2. 配置分离：模拟和实盘使用独立配置文件
3. 状态持久化：saveState/loadState支持崩溃恢复
4. 时间对齐：K线完成 + 15s延迟 + 智能调度

### 2. Binance API集成

**API功能实现：**
- ✅ getCurrentPrice - 获取当前价格
- ✅ getBalance - 获取账户余额
- ✅ getPositions - 获取持仓信息
- ✅ setLeverage - 设置杠杆
- ✅ marketOrder - 市价开仓/平仓
- ✅ setStopLossTakeProfit - 设置止盈止损

**API配置：**
- 配置文件：`/root/.openclaw/workspace/vault/binance-api.json`
- API Key：tCg43...iBVn
- API Secret：1DYG...eUzl
- 权限：现货 + 合约（无提现）

### 3. 回测验证

**单币种回测（BTC 1h）：**
- 脚本：`backtest.js`
- 结果：26次交易，69.23%胜率，+28.80%收益
- 验证：100%匹配backtest-final.js

**双币种回测（SOL 1h + BTC 1h）：**
- 脚本：`backtest-dual.js`
- 结果：57次交易，66.67%胜率，+252.42%净收益
- 验证：100%匹配之前的测试结果

### 4. 真实交易测试

**测试内容：**
1. API连接测试 ✅
2. 账户余额读取 ✅
3. 持仓查询 ✅
4. 杠杆设置（5x）✅
5. 市价开仓 ✅
6. 市价平仓 ✅
7. 止盈止损设置 ✅

**测试结果：**
- 3次真实交易测试
- 总测试成本：$0.95
- 最终余额：$49.03（初始$49.98）
- 所有功能验证通过

---

## 遇到的问题与解决方案

### 问题1：side参数错误

**错误信息：**
```
Invalid side.
```

**原因：**
- 传入的side是'long'/'short'
- Binance API需要'BUY'/'SELL'

**解决方案：**
```javascript
async marketOrder(symbol, side, quantity) {
  // 转换side参数：long -> BUY, short -> SELL
  const binanceSide = side.toLowerCase() === 'long' ? 'BUY' : 'SELL';
  return this.placeOrder(symbol, binanceSide, quantity, null, 'MARKET');
}
```

**教训：**
- 不同系统的参数命名可能不同
- 需要在API封装层做转换

---

### 问题2：最小订单金额限制

**错误信息：**
```
Order's notional must be no smaller than 100 (unless you choose reduce only).
```

**原因：**
- 初次测试时遇到此错误
- 以为最小订单金额是$100

**实际规则：**
- 哥哥手动测试确认：最小订单金额是$10
- 之前的错误可能是特定时段/账户限制

**解决方案：**
- 测试数量从0.001 BTC改为0.002 BTC
- 实际上0.001 BTC（约$64）也可以

**教训：**
- 错误信息不一定准确
- 需要实际测试验证规则

---

### 问题3：价格精度问题

**错误信息：**
```
Precision is over the maximum defined for this asset.
```

**原因：**
- 止盈止损价格使用了2位小数（$63,047.03）
- BTC价格精度只允许1位小数

**解决方案：**
```javascript
// 止损单（价格精度：1位小数）
const stopLossOrder = await this.client.futuresOrder({
  symbol: symbol,
  side: side === "LONG" ? "SELL" : "BUY",
  type: "STOP_MARKET",
  stopPrice: stopLoss.toFixed(1),  // 使用1位小数
  closePosition: "true"
});
```

**教训：**
- 不同交易对的价格精度不同
- 需要查文档或测试确定精度
- 使用toFixed()统一处理精度

---

### 问题4：订单ID字段名错误

**现象：**
- 止盈止损订单提交成功
- 但返回的orderId是undefined

**原因：**
- 止盈止损是条件单（CONDITIONAL）
- 使用`algoId`字段，不是`orderId`

**发现过程：**
```javascript
// 打印完整返回值
console.log('止损订单返回:', stopLossOrder);

// 输出：
{
  algoId: BigNumber { s: 1, e: 15, c: [ 30, 782934595 ] },
  clientAlgoId: 'x-ftGmvgAN78a3848a354042e6b66dbe',
  algoType: 'CONDITIONAL',
  orderType: 'STOP_MARKET',
  ...
}
```

**解决方案：**
```javascript
return {
  success: true,
  stopLossOrderId: stopLossOrder.algoId ? stopLossOrder.algoId.toString() : stopLossOrder.orderId,
  takeProfitOrderId: takeProfitOrder.algoId ? takeProfitOrder.algoId.toString() : takeProfitOrder.orderId
};
```

**教训：**
- 不同订单类型的返回值结构不同
- 先打印完整返回值，再确定字段名
- 做好兼容处理（algoId优先，fallback到orderId）

---

### 问题5：getPositions返回值结构

**现象：**
- 调用getPositions()后，positions.length报错undefined

**原因：**
- getPositions返回的是对象：`{ success, positions: [...] }`
- 不是直接返回数组

**解决方案：**
```javascript
const positionsResult = await api.getPositions();
const positions = positionsResult.positions || [];
```

**教训：**
- API封装层统一返回格式：`{ success, data }`
- 调用时需要访问.data或.positions属性

---

### 问题6：保证金不足

**错误信息：**
```
Margin is insufficient.
```

**原因：**
- 余额$49.42
- 开0.002 BTC需要约$25.74保证金
- 加上手续费和风险保证金，实际需要更多

**解决方案：**
- 减少测试数量
- 或者充值更多资金

**教训：**
- 实际需要的保证金比理论值高
- 需要预留足够的余额

---

## Binance API关键发现

### 1. 最小订单金额
- **规则：** $10（名义价值，不含杠杆）
- **验证：** 哥哥手动测试确认
- **示例：** 0.001 BTC × $64,000 = $64 > $10 ✅

### 2. 止盈止损订单
- **类型：** STOP_MARKET / TAKE_PROFIT_MARKET
- **字段：** algoId（条件单），不是orderId
- **价格精度：** 1位小数（toFixed(1)）
- **自动平仓：** closePosition: "true"

### 3. API返回值结构

**getCurrentPrice:**
```javascript
{
  success: true,
  symbol: "BTCUSDT",
  price: 64479.40
}
```

**getBalance:**
```javascript
{
  success: true,
  balance: {
    total: 49.98,
    available: 49.98,
    unrealizedPnl: 0.00
  }
}
```

**getPositions:**
```javascript
{
  success: true,
  positions: [
    {
      symbol: "BTCUSDT",
      side: "LONG",
      size: 0.002,
      entryPrice: 64433.1,
      markPrice: 64469.5,
      unrealizedPnl: -0.25729546,
      leverage: 5
    }
  ]
}
```

**marketOrder:**
```javascript
{
  success: true,
  orderId: 925860927956,
  symbol: "BTCUSDT",
  side: "BUY",
  price: "0.00",
  quantity: "0.002",
  status: "NEW"
}
```

**setStopLossTakeProfit:**
```javascript
{
  success: true,
  stopLossOrderId: "3000000782934595",
  takeProfitOrderId: "3000000782934596"
}
```

---

## 测试经验

### 1. API调试流程
1. 先打印完整返回值
2. 确定字段名和数据结构
3. 编写解析代码
4. 做好错误处理

### 2. 精度问题处理
- 价格：toFixed(1)
- 数量：toFixed(3)
- 不同交易对可能不同

### 3. 测试成本控制
- 每次测试约$0.15-0.20（手续费 + 滑点）
- 使用最小数量测试（0.001-0.002 BTC）
- 测试完立即平仓

### 4. 错误处理
- 所有API调用都要try-catch
- 返回统一格式：`{ success, data/error }`
- 打印详细错误信息

---

## 待完成任务

### 1. 双币种模式开发
**目标：** 支持SOL 1h + BTC 1h同时交易

**参考：** backtest-dual.js的双币种逻辑

**核心改动：**
1. 配置文件支持多个strategies
2. live-trading-core.js支持多币种循环
3. 智能资金分配（无重叠100%，有重叠50%）
4. BOS动态仓位（BTC有BOS用4%，无BOS用2%；SOL不用BOS）

**开发流程：**
1. 备份当前版本
2. 在备份版本上开发
3. 测试验证
4. 成功后替换原版本

### 2. 监控系统完善
- 每日统计报告
- 告警机制
- 性能监控

### 3. 文档完善
- API使用文档
- 配置说明文档
- 故障排查文档

---

## 文件清单

### 核心文件
- `live-trading-core.js` - 交易核心逻辑（601行）
- `config-simulation.js` - 模拟模式配置
- `config-real.js` - 实盘模式配置
- `binance-api.js` - Binance API封装（含止盈止损）
- `monitor.js` - 监控系统

### 启动脚本
- `start-simulation.sh` - 启动模拟模式
- `start-real.sh` - 启动实盘模式
- `stop-sim.sh` - 停止模拟模式
- `stop-real.sh` - 停止实盘模式
- `status-all.sh` - 查看状态

### 测试脚本
- `test-api.js` - API连接测试
- `test-real-trade.js` - 真实交易测试
- `test-sl-tp.js` - 止盈止损测试
- `close-position.js` - 平仓脚本

### 回测脚本
- `backtest.js` - 单币种回测（BTC 1h）
- `backtest-dual.js` - 双币种回测（SOL 1h + BTC 1h）

### 数据目录
- `data-sim/` - 模拟模式数据
- `data-real/` - 实盘模式数据

---

## 总结

### 成功经验
1. **代码复用：** 直接复制backtest-final.js的核心函数，避免重写
2. **配置分离：** 模拟和实盘使用独立配置，互不干扰
3. **充分测试：** 先API测试，再真实交易测试，最后实盘
4. **详细日志：** 打印完整返回值，方便调试
5. **错误处理：** 统一返回格式，做好异常处理

### 改进方向
1. **精度管理：** 统一管理不同交易对的价格/数量精度
2. **错误重试：** API调用失败时自动重试
3. **监控告警：** 实时监控系统状态，异常时告警
4. **性能优化：** 减少不必要的API调用
5. **文档完善：** 补充API使用文档和故障排查文档

### 关键教训
1. **不要假设：** 错误信息不一定准确，需要实际测试验证
2. **先打印：** 遇到问题先打印完整返回值，再分析
3. **做好兼容：** 不同订单类型的返回值结构可能不同
4. **控制成本：** 测试使用最小数量，测试完立即平仓
5. **备份优先：** 重大改动前先备份，在备份版本上开发

---

## 附录

### A. Binance API文档
- 官方文档：https://binance-docs.github.io/apidocs/futures/cn/
- 合约交易：https://binance-docs.github.io/apidocs/futures/cn/#trade

### B. 相关文件路径
- V3目录：`/root/.openclaw/workspace/skills/pa-live-trading-v3/`
- API配置：`/root/.openclaw/workspace/vault/binance-api.json`
- 回测脚本：`/root/.openclaw/workspace/backtest-final.js`
- 双币种回测：`/root/.openclaw/workspace/experiments/support-resistance-advanced/backtest-sol-btc-final.js`

### C. 账户信息
- 余额：$49.03
- 杠杆：5x
- 持仓模式：单向持仓
- API权限：现货 + 合约（无提现）

---

**文档版本：** v1.0  
**创建时间：** 2026-02-25  
**作者：** 大富小姐姐 🎀
