# P0 级问题修复方案

本文档提供 4 个 P0 级问题的详细修复代码。

---

## P0-1: 平仓失败后状态不一致

### 问题描述
平仓失败重试10次后，标记 `pendingClose=true` 但未删除持仓，下次循环会继续检查出场逻辑，可能重复触发平仓。

### 修复方案
在 `live-trading-core-dual.js` 第 430 行后添加：

```javascript
// 修复前（第 428-430 行）
if (!closeSuccess) {
  console.error(`  ⚠️ 平仓${MAX_CLOSE_RETRIES}次重试均失败，标记pendingClose`);
  state.positions[symbol].pendingClose = true;
  await sendNotification(`🚨 ${symbol} 平仓${MAX_CLOSE_RETRIES}次失败！已标记待重试，请检查Binance持仓！`);
}

// 修复后
if (!closeSuccess) {
  console.error(`  ⚠️ 平仓${MAX_CLOSE_RETRIES}次重试均失败，标记pendingClose`);
  state.positions[symbol].pendingClose = true;
  state.positions[symbol].manualOnly = true; // 🔧 新增：标记为手动管理，跳过自动出场
  await sendNotification(`🚨 ${symbol} 平仓${MAX_CLOSE_RETRIES}次失败！已转为手动管理，请立即检查Binance持仓！`);
}
```

### 同时修复 pendingClose 重试逻辑（第 217-257 行）

```javascript
// 在第 217 行前添加总重试次数检查
if (state.positions[symbol] && state.positions[symbol].pendingClose) {
  console.log(`${symbol} 有待重试的平仓操作...`);
  
  // 🔧 新增：检查总重试次数
  if (!state.positions[symbol].totalRetries) {
    state.positions[symbol].totalRetries = 0;
  }
  
  if (state.positions[symbol].totalRetries >= 20) {
    console.error(`  ⚠️ ${symbol} 累计重试${state.positions[symbol].totalRetries}次，放弃自动重试`);
    state.positions[symbol].manualOnly = true;
    delete state.positions[symbol].pendingClose;
    await sendNotification(`🚨 ${symbol} 累计重试20次失败，已转为手动管理，请人工处理！`);
    saveState();
    continue;
  }
  
  const MAX_PENDING_RETRIES = 5;
  let retrySuccess = false;
  let retryCount = 0;
  
  while (!retrySuccess && retryCount < MAX_PENDING_RETRIES) {
    retryCount++;
    try {
      const positionsResult = await binanceAPI.getPositions();
      const positions = positionsResult.positions || [];
      const binancePosition = positions.find(p => p.symbol === symbol);
      
      if (binancePosition && parseFloat(binancePosition.size || binancePosition.positionAmt || 0) !== 0) {
        const quantity = Math.abs(parseFloat(binancePosition.size || binancePosition.positionAmt));
        const side = state.positions[symbol].direction === "long" ? "short" : "long";
        const order = await binanceAPI.marketOrder(symbol, side, quantity);
        console.log(`  Binance重试平仓成功: ${order.orderId}`);
        retrySuccess = true;
      } else {
        console.log(`  Binance上无持仓，可能已被TP/SL触发`);
        retrySuccess = true;
      }
    } catch (error) {
      const waitSec = Math.min(retryCount * 2, 30);
      console.error(`  重试 #${retryCount}/${MAX_PENDING_RETRIES} 失败:`, error.message);
      await sendNotification(`⚠️ ${symbol} 重试平仓 #${retryCount}/${MAX_PENDING_RETRIES} 失败: ${error.message}`);
      await new Promise(r => setTimeout(r, waitSec * 1000));
    }
  }
  
  if (retrySuccess) {
    delete state.positions[symbol];
    saveState();
    await sendNotification(`✅ ${symbol} 重试平仓成功`);
  } else {
    // 🔧 新增：累加总重试次数
    state.positions[symbol].totalRetries += retryCount;
    saveState();
    console.error(`  ⚠️ ${symbol} pendingClose ${MAX_PENDING_RETRIES}次重试均失败，累计${state.positions[symbol].totalRetries}次`);
    await sendNotification(`🚨 ${symbol} 平仓重试${MAX_PENDING_RETRIES}次均失败（累计${state.positions[symbol].totalRetries}次）！请立即手动检查Binance持仓！`);
  }
  continue;
}
```

---

## P0-2: 止盈止损设置失败后紧急平仓可能失败

### 问题描述
止盈止损3次设置失败后，紧急市价平仓也可能失败，持仓会留在 Binance 上无保护。

### 修复方案
在 `live-trading-core-dual.js` 第 476-492 行修改：

```javascript
// 修复前
if (!slTpSuccess) {
  console.error(`  ⚠️ 止盈止损3次设置均失败，立即市价平仓`);
  await sendNotification(`🚨 ${symbol} 止盈止损设置3次失败！紧急市价平仓`);
  try {
    const closeOrder = await binanceAPI.marketOrder(
      symbol,
      signal.direction === 'long' ? 'short' : 'long',
      formattedQuantity
    );
    console.log(`  紧急平仓订单: ${closeOrder.orderId}`);
    await sendNotification(`✅ ${symbol} 紧急平仓成功`);
  } catch (closeError) {
    console.error(`  紧急平仓也失败:`, closeError.message);
    await sendNotification(`🚨🚨 ${symbol} 紧急平仓也失败: ${closeError.message}\n请立即手动处理！`);
  }
  delete state.positions[symbol];
}

// 修复后
if (!slTpSuccess) {
  console.error(`  ⚠️ 止盈止损3次设置均失败，立即市价平仓`);
  await sendNotification(`🚨 ${symbol} 止盈止损设置3次失败！紧急市价平仓`);
  
  let emergencyCloseSuccess = false;
  try {
    const closeOrder = await binanceAPI.marketOrder(
      symbol,
      signal.direction === 'long' ? 'short' : 'long',
      formattedQuantity
    );
    
    if (closeOrder.success) {
      console.log(`  紧急平仓订单: ${closeOrder.orderId}`);
      await sendNotification(`✅ ${symbol} 紧急平仓成功`);
      emergencyCloseSuccess = true;
    } else {
      console.error(`  紧急平仓失败: ${closeOrder.error}`);
    }
  } catch (closeError) {
    console.error(`  紧急平仓异常:`, closeError.message);
  }
  
  // 🔧 新增：紧急平仓失败的处理
  if (!emergencyCloseSuccess) {
    // 保留持仓记录，标记为"无止损保护+手动管理"
    state.positions[symbol].manualOnly = true;
    state.positions[symbol].noStopLoss = true;
    state.positions[symbol].emergencyCloseFailedAt = new Date().toISOString();
    await sendNotification(`🚨🚨🚨 ${symbol} 紧急平仓失败！持仓无止损保护！\n请立即手动平仓或设置止损！\n方向: ${signal.direction.toUpperCase()}\n数量: ${formattedQuantity}`);
    saveState();
  } else {
    delete state.positions[symbol];
  }
}
```

---

## P0-3: 除零风险

### 问题描述
`trading-engine.js` 中 `calculatePnL` 函数的 `position.priceRisk` 可能为 0，导致除零错误。

### 修复方案
在 `trading-engine.js` 第 24 行（`calculatePnL` 函数开头）添加：

```javascript
function calculatePnL(position, exitPrice, balance, leverage, takerFee) {
  // 🔧 新增：边界条件检查
  if (!position || !position.priceRisk || position.priceRisk <= 0 || isNaN(position.priceRisk)) {
    console.error('calculatePnL: priceRisk 异常', {
      priceRisk: position?.priceRisk,
      position: position
    });
    return { pnl: 0, profit: 0, totalFee: 0 };
  }
  
  if (!position.allocation || position.allocation <= 0 || position.allocation > 1) {
    console.error('calculatePnL: allocation 异常', {
      allocation: position?.allocation,
      position: position
    });
    return { pnl: 0, profit: 0, totalFee: 0 };
  }
  
  if (!position.riskPerTrade || position.riskPerTrade <= 0 || position.riskPerTrade > 1) {
    console.error('calculatePnL: riskPerTrade 异常', {
      riskPerTrade: position?.riskPerTrade,
      position: position
    });
    return { pnl: 0, profit: 0, totalFee: 0 };
  }
  
  // 原有代码继续...
  const pnl = position.direction === 'long'
    ? (exitPrice - position.entry) / position.entry
    : (position.entry - exitPrice) / position.entry;

  const actualPositionValue = balance * position.allocation * position.riskPerTrade / position.priceRisk;
  const maxPositionValue = balance * position.allocation * leverage;
  const cappedPositionValue = Math.min(actualPositionValue, maxPositionValue);
  const totalFee = cappedPositionValue * takerFee * 2;
  const profit = cappedPositionValue * pnl - totalFee;

  return { pnl, profit, totalFee };
}
```

### 同时在 `trading-functions.js` 中添加信号验证（第 295 行后）

```javascript
// 在 generateSignal 返回前添加验证
if (signal) {
  // 🔧 新增：信号完整性验证
  if (!signal.entry || signal.entry <= 0 ||
      !signal.stopLoss || signal.stopLoss <= 0 ||
      !signal.takeProfit || signal.takeProfit <= 0 ||
      !signal.priceRisk || signal.priceRisk <= 0 || signal.priceRisk > 0.15 ||
      !signal.riskPerTrade || signal.riskPerTrade <= 0 || signal.riskPerTrade > 0.25) {
    console.error('信号数据异常，已拒绝:', {
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      priceRisk: signal.priceRisk,
      riskPerTrade: signal.riskPerTrade
    });
    return null;
  }
  
  // 验证止损方向
  if (signal.direction === 'long' && signal.stopLoss >= signal.entry) {
    console.error('做多信号止损价格异常（应低于入场价）:', signal);
    return null;
  }
  if (signal.direction === 'short' && signal.stopLoss <= signal.entry) {
    console.error('做空信号止损价格异常（应高于入场价）:', signal);
    return null;
  }
  
  return signal;
}
```

---

## P0-4: pendingClose 无限循环

### 问题描述
`pendingClose` 重试最多5次，但如果5次都失败，持仓仍保留 `pendingClose=true`，下次循环会再次重试5次。

### 修复方案
**已在 P0-1 的修复中包含**，参见上文第 217-257 行的修改。

核心改动：
1. 添加 `totalRetries` 字段记录累计重试次数
2. 累计重试 >= 20 次后，标记 `manualOnly=true` 并删除 `pendingClose`
3. 每次重试后累加 `totalRetries`

---

## 测试建议

### P0-1 & P0-4 测试
1. 模拟 Binance API 平仓失败（断网或返回错误）
2. 验证重试逻辑是否正确累加 `totalRetries`
3. 验证达到20次后是否转为手动管理
4. 验证 `manualOnly=true` 后是否跳过自动出场

### P0-2 测试
1. 模拟止盈止损设置失败3次
2. 模拟紧急平仓也失败
3. 验证持仓是否保留并标记 `noStopLoss=true`
4. 验证是否发送紧急通知

### P0-3 测试
1. 构造 `priceRisk=0` 的信号
2. 验证 `calculatePnL` 是否返回零值而非崩溃
3. 验证 `generateSignal` 是否拒绝异常信号

---

## 部署步骤

1. **备份当前代码**
   ```bash
   cd /root/.openclaw/workspace/skills/pa-live-trading-v3
   cp live-trading-core-dual.js live-trading-core-dual.js.backup
   cp trading-engine.js trading-engine.js.backup
   cp trading-functions.js trading-functions.js.backup
   ```

2. **应用修复**（按本文档修改代码）

3. **模拟模式测试**
   ```bash
   PA_MODE=simulation node live-trading-core-dual.js
   ```

4. **验证修复**
   - 检查日志中是否有新的边界条件检查
   - 模拟异常场景（如断网）验证重试逻辑

5. **实盘部署**（确认模拟模式无问题后）
   ```bash
   PA_MODE=real node live-trading-core-dual.js
   ```

---

## 回滚方案

如果修复后出现问题：

```bash
cd /root/.openclaw/workspace/skills/pa-live-trading-v3
cp live-trading-core-dual.js.backup live-trading-core-dual.js
cp trading-engine.js.backup trading-engine.js
cp trading-functions.js.backup trading-functions.js
```

---

**修复方案编写完成时间**: 2026-02-25 15:35 UTC
