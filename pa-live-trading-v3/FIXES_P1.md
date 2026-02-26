# P1 级问题修复方案

本文档提供 6 个 P1 级问题的详细修复代码。

---

## P1-1: 杠杆上限检查不完整

### 问题描述
开仓时有杠杆上限检查，但平仓时未检查 Binance 返回的实际持仓数量是否与本地一致。

### 修复方案
在 `live-trading-core-dual.js` 第 398 行（平仓逻辑开始处）修改：

```javascript
// 修复前（第 398-410 行）
if (binanceAPI && d.position.orderId) {
  let closeSuccess = false;
  try {
    const positionsResult = await binanceAPI.getPositions();
    const positions = positionsResult.positions || [];
    const binancePosition = positions.find(p => p.symbol === symbol);
    
    if (binancePosition) {
      const quantity = Math.abs(parseFloat(binancePosition.size || binancePosition.positionAmt || 0));
      const side = d.position.direction === "long" ? "short" : "long";
      const order = await binanceAPI.marketOrder(symbol, side, quantity);
      console.log(`  Binance平仓订单: ${order.orderId}`);
      closeSuccess = true;
    }

// 修复后
if (binanceAPI && d.position.orderId) {
  let closeSuccess = false;
  try {
    const positionsResult = await binanceAPI.getPositions();
    const positions = positionsResult.positions || [];
    const binancePosition = positions.find(p => p.symbol === symbol);
    
    if (binancePosition) {
      const actualQty = Math.abs(parseFloat(binancePosition.size || binancePosition.positionAmt || 0));
      
      // 🔧 新增：计算本地预期数量
      const expectedPositionValue = state.balance * d.position.allocation * d.position.riskPerTrade / d.position.priceRisk;
      const maxPositionValue = state.balance * d.position.allocation * CONFIG.leverage;
      const cappedPositionValue = Math.min(expectedPositionValue, maxPositionValue);
      const expectedQty = cappedPositionValue / d.position.entry;
      const formattedExpectedQty = formatQuantity(symbol, expectedQty);
      
      // 🔧 新增：数量偏差检查（超过5%报警）
      if (actualQty > 0 && formattedExpectedQty > 0) {
        const deviation = Math.abs(actualQty - formattedExpectedQty) / formattedExpectedQty;
        if (deviation > 0.05) {
          console.warn(`⚠️ ${symbol} 持仓数量偏差 ${(deviation * 100).toFixed(1)}%: 本地${formattedExpectedQty} vs Binance${actualQty}`);
          await sendNotification(`⚠️ ${symbol} 持仓数量偏差 ${(deviation * 100).toFixed(1)}%\n本地预期: ${formattedExpectedQty}\nBinance实际: ${actualQty}\n将使用Binance实际数量平仓`);
        }
      }
      
      // 🔧 修改：使用 Binance 实际数量平仓（更安全）
      const side = d.position.direction === "long" ? "short" : "long";
      const order = await binanceAPI.marketOrder(symbol, side, actualQty);
      console.log(`  Binance平仓订单: ${order.orderId} (数量: ${actualQty})`);
      closeSuccess = true;
    }
```

---

## P1-2: API 返回值处理不一致

### 问题描述
`setStopLossTakeProfit` 返回 `algoId` 或 `orderId`，但调用方未统一处理。

### 修复方案
在 `binance-api.js` 第 178-195 行修改：

```javascript
// 修复前
return {
  success: true,
  stopLossOrderId: stopLossOrder.algoId ? stopLossOrder.algoId.toString() : stopLossOrder.orderId,
  takeProfitOrderId: takeProfitOrder.algoId ? takeProfitOrder.algoId.toString() : takeProfitOrder.orderId,
  stopLossOrder: stopLossOrder,
  takeProfitOrder: takeProfitOrder
};

// 修复后
// 🔧 新增：统一提取订单ID的辅助函数
const extractOrderId = (order) => {
  // 优先使用 algoId（条件单），其次 orderId（普通单）
  if (order.algoId) return { id: order.algoId.toString(), type: 'algo' };
  if (order.orderId) return { id: order.orderId.toString(), type: 'order' };
  // 兜底：尝试从原始响应中提取
  if (order.clientAlgoId) return { id: order.clientAlgoId, type: 'algo' };
  console.warn('无法提取订单ID:', order);
  return { id: null, type: 'unknown' };
};

const slInfo = extractOrderId(stopLossOrder);
const tpInfo = extractOrderId(takeProfitOrder);

return {
  success: true,
  stopLoss: {
    id: slInfo.id,
    type: slInfo.type,
    price: stopLoss,
    rawOrder: stopLossOrder
  },
  takeProfit: {
    id: tpInfo.id,
    type: tpInfo.type,
    price: takeProfit,
    rawOrder: takeProfitOrder
  },
  // 🔧 保留旧字段以兼容现有代码
  stopLossOrderId: slInfo.id,
  takeProfitOrderId: tpInfo.id
};
```

### 同时在 `live-trading-core-dual.js` 中更新调用方（第 470 行）

```javascript
// 修复前
if (slTpResult.success) {
  console.log(`  止盈止损已设置 (第${attempt}次)`);
  slTpSuccess = true;
  break;
}

// 修复后
if (slTpResult.success) {
  // 🔧 新增：记录止盈止损订单信息
  state.positions[symbol].stopLossOrder = slTpResult.stopLoss;
  state.positions[symbol].takeProfitOrder = slTpResult.takeProfit;
  console.log(`  止盈止损已设置 (第${attempt}次)`);
  console.log(`    止损: ${slTpResult.stopLoss.type} ${slTpResult.stopLoss.id} @ $${slTpResult.stopLoss.price}`);
  console.log(`    止盈: ${slTpResult.takeProfit.type} ${slTpResult.takeProfit.id} @ $${slTpResult.takeProfit.price}`);
  slTpSuccess = true;
  break;
}
```

---

## P1-3: 启动时同步持仓未验证止盈止损

### 问题描述
启动时同步 Binance 持仓，但未检查是否有止盈止损订单。

### 修复方案
在 `live-trading-core-dual.js` 第 577-612 行修改：

```javascript
// 在第 605 行后添加止盈止损检查
state.positions[sym] = {
  symbol: sym,
  direction,
  entry: entryPrice,
  stopLoss: 0,
  takeProfit: 0,
  riskPerTrade: 0,
  priceRisk: 0,
  hasBOS: false,
  allocation: 1,
  entryTime: new Date().toISOString(),
  syncedFromBinance: true,
  manualOnly: true
};

// 🔧 新增：检查止盈止损订单
try {
  const openOrders = await binanceAPI.client.futuresOpenOrders({ symbol: sym });
  const stopLossOrder = openOrders.find(o => 
    o.type === 'STOP_MARKET' || o.type === 'STOP'
  );
  const takeProfitOrder = openOrders.find(o => 
    o.type === 'TAKE_PROFIT_MARKET' || o.type === 'TAKE_PROFIT'
  );
  
  let warnings = [];
  
  if (stopLossOrder) {
    state.positions[sym].stopLoss = parseFloat(stopLossOrder.stopPrice);
    state.positions[sym].stopLossOrder = {
      id: stopLossOrder.orderId || stopLossOrder.algoId,
      type: stopLossOrder.type,
      price: parseFloat(stopLossOrder.stopPrice)
    };
    console.log(`  ✓ 发现止损订单: ${stopLossOrder.type} @ $${stopLossOrder.stopPrice}`);
  } else {
    warnings.push('❌ 无止损订单');
  }
  
  if (takeProfitOrder) {
    state.positions[sym].takeProfit = parseFloat(takeProfitOrder.stopPrice);
    state.positions[sym].takeProfitOrder = {
      id: takeProfitOrder.orderId || takeProfitOrder.algoId,
      type: takeProfitOrder.type,
      price: parseFloat(takeProfitOrder.stopPrice)
    };
    console.log(`  ✓ 发现止盈订单: ${takeProfitOrder.type} @ $${takeProfitOrder.stopPrice}`);
  } else {
    warnings.push('❌ 无止盈订单');
  }
  
  if (warnings.length > 0) {
    const warningMsg = `⚠️ 重启同步: ${sym} ${direction.toUpperCase()} @ $${entryPrice}\n${warnings.join('\n')}\n已标记为手动管理，不会自动出场。\n🚨 请立即手动设置止盈止损！`;
    console.log(warningMsg);
    await sendNotification(warningMsg);
  } else {
    // 有完整的止盈止损，可以考虑恢复自动管理（但需要验证价格合理性）
    const slValid = direction === 'long' 
      ? state.positions[sym].stopLoss < entryPrice
      : state.positions[sym].stopLoss > entryPrice;
    const tpValid = direction === 'long'
      ? state.positions[sym].takeProfit > entryPrice
      : state.positions[sym].takeProfit < entryPrice;
    
    if (slValid && tpValid) {
      console.log(`  ✓ 止盈止损价格合理，可考虑恢复自动管理（当前仍为手动）`);
      await sendNotification(`✅ 重启同步: ${sym} ${direction.toUpperCase()} @ $${entryPrice}\n止损: $${state.positions[sym].stopLoss}\n止盈: $${state.positions[sym].takeProfit}\n已同步，当前为手动管理模式`);
    } else {
      warnings.push('⚠️ 止盈止损价格异常');
      await sendNotification(`⚠️ 重启同步: ${sym} ${direction.toUpperCase()} @ $${entryPrice}\n止损/止盈价格异常！\n止损: $${state.positions[sym].stopLoss}\n止盈: $${state.positions[sym].takeProfit}\n请检查！`);
    }
  }
} catch (orderCheckError) {
  console.error(`  检查止盈止损订单失败:`, orderCheckError.message);
  await sendNotification(`⚠️ ${sym} 无法检查止盈止损订单: ${orderCheckError.message}\n请手动验证！`);
}

console.log(`⚠️ 发现 Binance 持仓但本地无记录: ${sym} ${direction.toUpperCase()} @ $${entryPrice}`);
saveState();
```

---

## P1-4: 动态风险计算未考虑连续亏损

### 问题描述
动态风险阶梯只考虑盈利，未考虑连续亏损时应降低风险。

### 修复方案
在 `trading-engine.js` 第 103-110 行修改：

```javascript
// 修复前
const minRisk = profitPct >= 50 ? 0.10 : 0.05;
const baseRisk = Math.max(minRisk, Math.min(0.10, 0.05 + Math.floor(profitPct / 10) * 0.01));
const dynamicConfig = {
  ...config,
  riskSOL: baseRisk,
  riskWithoutBOS: baseRisk,
  riskWithBOS: Math.min(baseRisk * 2, 0.20)
};

// 修复后
const minRisk = profitPct >= 50 ? 0.10 : 0.05;
let baseRisk = Math.max(minRisk, Math.min(0.10, 0.05 + Math.floor(profitPct / 10) * 0.01));

// 🔧 新增：连续亏损时降低风险
// 需要从外部传入 consecutiveLosses，或从 positions 中推断
let consecutiveLosses = 0;
// 简单推断：检查最近的持仓是否都是亏损（需要历史记录）
// 这里暂时使用配置传入的方式
if (config.consecutiveLosses !== undefined) {
  consecutiveLosses = config.consecutiveLosses;
}

if (consecutiveLosses >= 3) {
  const reductionFactor = Math.min(0.5, 0.2 * consecutiveLosses); // 每次连亏降低20%，最多50%
  baseRisk = baseRisk * (1 - reductionFactor);
  console.log(`⚠️ 连续亏损${consecutiveLosses}次，风险降低至 ${(baseRisk * 100).toFixed(1)}%`);
}

// 🔧 新增：回撤保护（回撤超过15%时降低风险）
const currentDrawdownPct = config.currentDrawdownPct || 0;
if (currentDrawdownPct > 15) {
  baseRisk = baseRisk * 0.7; // 降低30%
  console.log(`⚠️ 当前回撤${currentDrawdownPct.toFixed(1)}%，风险降低至 ${(baseRisk * 100).toFixed(1)}%`);
}

// 确保风险不低于最小值
baseRisk = Math.max(0.02, baseRisk);

const dynamicConfig = {
  ...config,
  riskSOL: baseRisk,
  riskWithoutBOS: baseRisk,
  riskWithBOS: Math.min(baseRisk * 2, 0.20)
};
```

### 同时在 `live-trading-core-dual.js` 中传入连续亏损数据（第 290 行）

```javascript
// 在调用 processBar 前添加
// 🔧 新增：计算连续亏损次数
const tradeStats = require('./trade-stats.js');
const consecutiveLosses = tradeStats.getConsecutiveLosses(mode);
const drawdown = tradeStats.getDrawdown(mode);

CONFIG.consecutiveLosses = consecutiveLosses;
CONFIG.currentDrawdownPct = drawdown.currentDrawdown * 100;

const result = processBar({
  symbol, klines, positions: state.positions,
  balance: state.balance, config: CONFIG
});
```

---

## P1-5: 同步持仓标记 manualOnly 但未提供恢复机制

### 问题描述
同步的持仓标记为 `manualOnly=true`，不参与自动出场，但未提供恢复自动管理的机制。

### 修复方案
创建新文件 `resume-auto-trading.js`：

```javascript
#!/usr/bin/env node
/**
 * resume-auto-trading.js — 恢复自动交易管理
 * 
 * 用法:
 *   node resume-auto-trading.js --mode simulation --symbol BTCUSDT
 *   node resume-auto-trading.js --mode real --symbol SOLUSDT --force
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const modeIdx = args.indexOf('--mode');
const symbolIdx = args.indexOf('--symbol');
const force = args.includes('--force');

if (modeIdx < 0 || symbolIdx < 0) {
  console.error('用法: node resume-auto-trading.js --mode <simulation|real> --symbol <SYMBOL> [--force]');
  process.exit(1);
}

const mode = args[modeIdx + 1];
const symbol = args[symbolIdx + 1];

const stateFile = path.join(__dirname, `data-${mode}`, 'live-state.json');

if (!fs.existsSync(stateFile)) {
  console.error(`状态文件不存在: ${stateFile}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

if (!state.positions || !state.positions[symbol]) {
  console.error(`未找到 ${symbol} 的持仓`);
  process.exit(1);
}

const position = state.positions[symbol];

console.log(`\n当前持仓状态:`);
console.log(`  币种: ${symbol}`);
console.log(`  方向: ${position.direction?.toUpperCase()}`);
console.log(`  入场: $${position.entry}`);
console.log(`  止损: $${position.stopLoss || '未设置'}`);
console.log(`  止盈: $${position.takeProfit || '未设置'}`);
console.log(`  手动管理: ${position.manualOnly ? 'YES' : 'NO'}`);
console.log(`  无止损保护: ${position.noStopLoss ? 'YES' : 'NO'}`);
console.log(`  待平仓: ${position.pendingClose ? 'YES' : 'NO'}`);

// 安全检查
const warnings = [];
if (!position.stopLoss || position.stopLoss === 0) {
  warnings.push('⚠️ 未设置止损');
}
if (!position.takeProfit || position.takeProfit === 0) {
  warnings.push('⚠️ 未设置止盈');
}
if (position.noStopLoss) {
  warnings.push('🚨 标记为无止损保护');
}
if (position.pendingClose) {
  warnings.push('⚠️ 有待处理的平仓操作');
}

if (warnings.length > 0 && !force) {
  console.log(`\n检测到以下问题:`);
  warnings.forEach(w => console.log(`  ${w}`));
  console.log(`\n如果确认要恢复自动管理，请添加 --force 参数`);
  process.exit(1);
}

// 恢复自动管理
delete position.manualOnly;
delete position.noStopLoss;
delete position.pendingClose;
delete position.syncedFromBinance;
delete position.totalRetries;

fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

console.log(`\n✅ ${symbol} 已恢复自动交易管理`);
console.log(`   系统将在下次检查时自动管理该持仓的出场`);
```

### 使用说明
在 `live-trading-core-dual.js` 启动日志中添加提示：

```javascript
// 在第 612 行后添加
if (state.positions[sym].manualOnly) {
  console.log(`  ℹ️ 如需恢复自动管理，运行: node resume-auto-trading.js --mode ${mode} --symbol ${sym}`);
}
```

---

## P1-6: generateSignal 未验证返回值完整性

### 问题描述
`generateSignal` 返回的信号对象未验证必需字段。

### 修复方案
**已在 P0-3 的修复中包含**，参见 `FIXES_P0.md` 中 `trading-functions.js` 第 295 行后的修改。

---

## 测试建议

### P1-1 测试
1. 手动在 Binance 上修改持仓数量（加仓/减仓）
2. 触发平仓，验证是否检测到数量偏差
3. 验证是否使用 Binance 实际数量平仓

### P1-2 测试
1. 检查止盈止损订单返回的 ID 格式
2. 验证是否正确记录到 `state.positions[symbol]`
3. 验证日志中是否显示订单类型（algo/order）

### P1-3 测试
1. 在 Binance 上手动开仓（不设置止盈止损）
2. 重启程序，验证是否检测到缺失止盈止损
3. 验证是否发送警报通知

### P1-4 测试
1. 模拟连续亏损3次
2. 验证下次开仓风险是否降低
3. 验证日志中是否显示风险调整信息

### P1-5 测试
1. 运行 `resume-auto-trading.js` 恢复自动管理
2. 验证状态文件中 `manualOnly` 是否被删除
3. 验证下次检查时是否恢复自动出场

---

## 部署步骤

1. **应用 P1-1 到 P1-4 的修复**（修改现有文件）

2. **创建 P1-5 的新文件**
   ```bash
   cd /root/.openclaw/workspace/skills/pa-live-trading-v3
   # 创建 resume-auto-trading.js（内容见上文）
   chmod +x resume-auto-trading.js
   ```

3. **模拟模式测试**
   ```bash
   PA_MODE=simulation node live-trading-core-dual.js
   ```

4. **验证修复**
   - 检查平仓时是否有数量偏差检查
   - 检查止盈止损订单信息是否完整记录
   - 检查启动同步时是否验证止盈止损
   - 检查连续亏损时风险是否降低

---

**修复方案编写完成时间**: 2026-02-25 15:40 UTC
