#!/usr/bin/env node
/**
 * PA Live Trading V3 - 双币种实盘交易核心
 * 
 * 策略：SOL 1h + BTC 1h
 * - 增强密集区识别
 * - BTC使用BOS（有BOS 4%，无BOS 2%）
 * - SOL不使用BOS（固定2%）
 * - 智能资金分配（无重叠100%，有重叠50%）
 */

const { getKlinesFromCache, updateCache } = require('../../kline-cache.js');
const fs = require('fs');
const path = require('path');
const { processBar, checkExit } = require('./trading-engine.js');
const tradeStats = require('./trade-stats.js');
const alertSystem = require('./alert-system.js');

// ==================== 加载配置 ====================

const BASE_DIR = __dirname;
const mode = process.env.PA_MODE || 'simulation';
const CONFIG = require(`./config-${mode}.js`);

console.log(`加载配置: ${CONFIG.name}`);
console.log(`交易对: ${CONFIG.strategies.map(s => s.symbol).join(', ')}`);

// ==================== Binance API ====================

let binanceAPI = null;
if (CONFIG.mode === 'real' && CONFIG.binance) {
  const BinanceAPI = require('./binance-api.js');
  binanceAPI = new BinanceAPI('/root/.openclaw/workspace/vault/binance-api.json');
  console.log('Binance API 已初始化');
}

// ==================== 状态管理 ====================

let state = {
  balance: CONFIG.initialBalance,
  positions: {}, // { 'SOLUSDT': {...}, 'BTCUSDT': {...} }
  lastCheck: {},
  peakProfitPct: 0,
  stats: {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0,
    bySymbol: {}
  }
};

// 初始化每个交易对的统计
CONFIG.strategies.forEach(strategy => {
  state.stats.bySymbol[strategy.symbol] = {
    trades: 0,
    wins: 0,
    losses: 0,
    pnl: 0
  };
});

// ==================== 风控系统 ====================

const RC = CONFIG.riskControl || {};
const riskState = {
  dailyLossPct: 0,           // 当日累计亏损百分比
  dailyStartBalance: 0,      // 当日起始余额
  currentDay: '',             // 当前日期（用于重置日统计）
  peakBalance: CONFIG.initialBalance, // 历史峰值余额
  circuitBreaker: false,     // 熔断状态
  circuitBreakerReason: '',  // 熔断原因
  circuitBreakerTime: 0,     // 熔断触发时间
  apiFailCount: 0,           // 连续API失败次数
  lastPrices: {},            // 上一根K线收盘价 { symbol: price }
};

// ==================== 自检系统 ====================
const selfCheck = {
  failures: {},  // { 'setTPSL': { count: 0, lastError: '', lastTime: 0 }, ... }
  maxConsecutive: 3,  // 同一操作连续失败N次触发熔断
  cooldownMs: 3600000, // 自检熔断冷却1小时
};

function recordFailure(operation, errorMsg) {
  if (!selfCheck.failures[operation]) {
    selfCheck.failures[operation] = { count: 0, lastError: '', lastTime: 0 };
  }
  const f = selfCheck.failures[operation];
  f.count++;
  f.lastError = (errorMsg || '').slice(0, 500);
  f.lastTime = Date.now();

  console.error(`[自检] ${operation} 连续失败 ${f.count}次: ${errorMsg}`);

  if (f.count >= selfCheck.maxConsecutive) {
    // 触发熔断
    riskState.circuitBreaker = true;
    riskState.circuitBreakerReason = `自检熔断: ${operation} 连续失败${f.count}次`;
    riskState.circuitBreakerTime = Date.now();
    saveRiskState();

    // 诊断并通知
    const diagnosis = diagnoseSelfCheck(operation, errorMsg);
    const msg = `🚨 自检熔断！\n操作: ${operation}\n连续失败: ${f.count}次\n错误: ${errorMsg}\n\n🔍 诊断: ${diagnosis}\n\n⚠️ 已暂停交易，请检查后手动解除`;
    sendNotification(msg).catch(console.error);
  }
}

function recordSuccess(operation) {
  if (selfCheck.failures[operation]) {
    selfCheck.failures[operation].count = 0;
  }
}

function diagnoseSelfCheck(operation, errorMsg) {
  const msg = errorMsg.toLowerCase();
  if (msg.includes('not supported') || msg.includes('algo order')) {
    return 'API端点变更，币安可能升级了接口，需要更新代码适配新API';
  }
  if (msg.includes('insufficient') || msg.includes('margin')) {
    return '余额不足，检查账户资金或降低仓位大小';
  }
  if (msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('network')) {
    return '网络问题，检查服务器网络连接和币安API可达性';
  }
  if (msg.includes('invalid') || msg.includes('precision') || msg.includes('notional')) {
    return '参数错误，可能是价格精度或最小下单量不满足要求';
  }
  if (msg.includes('banned') || msg.includes('429') || msg.includes('rate')) {
    return 'API限流或IP被封，需要降低请求频率';
  }
  if (msg.includes('key') || msg.includes('signature') || msg.includes('permission')) {
    return 'API密钥问题，检查Key权限或是否过期';
  }
  return `未知错误类型，建议检查币安API文档和最近的变更公告。原始错误: ${errorMsg}`;
}

// 加载风控状态
function loadRiskState() {
  const file = path.join(BASE_DIR, `data-${mode}`, 'risk-state.json');
  if (fs.existsSync(file)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(riskState, loaded);
    } catch (e) {
      console.error('风控状态文件损坏，使用默认状态:', e.message);
      fs.copyFileSync(file, file + '.corrupt.' + Date.now());
    }
  }
  // 检查是否新的一天，重置日统计
  const today = new Date().toISOString().slice(0, 10);
  if (riskState.currentDay !== today) {
    riskState.currentDay = today;
    riskState.dailyStartBalance = state.balance;
    riskState.dailyLossPct = 0;
  }
}

// 保存风控状态
function saveRiskState() {
  const file = path.join(BASE_DIR, `data-${mode}`, 'risk-state.json');
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(riskState, null, 2));
  fs.renameSync(tmp, file);
}

// 更新峰值余额
function updatePeakBalance() {
  if (state.balance > riskState.peakBalance) {
    riskState.peakBalance = state.balance;
  }
}

// 风控检查1：单日最大亏损
function checkDailyLoss() {
  if (!RC.dailyMaxLossPct) return { pass: true };
  const today = new Date().toISOString().slice(0, 10);
  if (riskState.currentDay !== today) {
    riskState.currentDay = today;
    riskState.dailyStartBalance = state.balance;
    riskState.dailyLossPct = 0;
  }
  if (!riskState.dailyStartBalance || riskState.dailyStartBalance <= 0) {
    riskState.dailyStartBalance = state.balance || CONFIG.initialBalance;
  }
  const dailyPnlPct = (state.balance - riskState.dailyStartBalance) / riskState.dailyStartBalance * 100;
  if (isNaN(dailyPnlPct)) return { pass: true };
  if (dailyPnlPct < 0) riskState.dailyLossPct = Math.abs(dailyPnlPct);
  if (riskState.dailyLossPct >= RC.dailyMaxLossPct) {
    return { pass: false, reason: `单日亏损${riskState.dailyLossPct.toFixed(1)}%，超过${RC.dailyMaxLossPct}%上限` };
  }
  return { pass: true };
}

// 风控检查2：总回撤熔断
function checkMaxDrawdown() {
  if (!RC.maxDrawdownPct) return { pass: true };
  updatePeakBalance();
  const drawdownPct = (riskState.peakBalance - state.balance) / riskState.peakBalance * 100;
  if (drawdownPct >= RC.maxDrawdownPct) {
    return { pass: false, reason: `总回撤${drawdownPct.toFixed(1)}%（峰值$${riskState.peakBalance.toFixed(2)}→当前$${state.balance.toFixed(2)}），超过${RC.maxDrawdownPct}%上限` };
  }
  return { pass: true };
}

// 风控检查3：价格异常检测
function checkPriceAnomaly(symbol, currentPrice) {
  if (!RC.priceAnomalyPct) return { pass: true };
  const lastPrice = riskState.lastPrices[symbol];
  riskState.lastPrices[symbol] = currentPrice; // 无论是否异常都更新，避免连锁误判
  if (lastPrice) {
    const changePct = Math.abs(currentPrice - lastPrice) / lastPrice * 100;
    if (changePct >= RC.priceAnomalyPct) {
      return { pass: false, reason: `${symbol} 价格异常变化${changePct.toFixed(1)}%（$${lastPrice.toFixed(2)}→$${currentPrice.toFixed(2)}），超过${RC.priceAnomalyPct}%阈值`, skipOnly: true };
    }
  }
  return { pass: true };
}

// 风控检查4：API连接中断保护
function checkApiHealth() {
  if (!RC.apiFailThreshold) return { pass: true };
  if (riskState.apiFailCount >= RC.apiFailThreshold) {
    return { pass: false, reason: `连续${riskState.apiFailCount}次API失败，超过${RC.apiFailThreshold}次阈值` };
  }
  return { pass: true };
}

// 风控检查5：余额异常检测（实盘）
async function checkBalanceDeviation() {
  if (!binanceAPI || !RC.balanceDeviationPct) return { pass: true };
  try {
    const result = await binanceAPI.getBalance();
    if (result.success && result.balance) {
      const binanceBalance = result.balance.total;
      if (binanceBalance > 0) {
        const deviation = Math.abs(state.balance - binanceBalance) / binanceBalance * 100;
        if (deviation >= RC.balanceDeviationPct) {
          return { pass: false, reason: `余额偏差${deviation.toFixed(1)}%（本地$${state.balance.toFixed(2)} vs Binance$${binanceBalance.toFixed(2)}），超过${RC.balanceDeviationPct}%阈值`, alert: true };
        }
      }
      riskState.apiFailCount = 0; // API成功，重置失败计数
    }
  } catch (error) {
    riskState.apiFailCount++;
    console.error(`余额检查API失败 (连续${riskState.apiFailCount}次):`, error.message);
  }
  return { pass: true };
}

// 综合风控检查（开仓前调用）
async function riskControlCheck(symbol, currentPrice) {
  // 检查是否在熔断状态
  if (riskState.circuitBreaker) {
    return { pass: false, reason: `熔断中: ${riskState.circuitBreakerReason}` };
  }

  const checks = [
    checkDailyLoss(),
    checkMaxDrawdown(),
    checkPriceAnomaly(symbol, currentPrice),
    checkApiHealth(),
  ];

  // 余额检查是异步的
  if (binanceAPI) {
    checks.push(await checkBalanceDeviation());
  }

  for (const check of checks) {
    if (!check.pass) {
      // alert类型只报警不熔断，skipOnly类型只跳过当次不熔断
      if (!check.alert && !check.skipOnly) {
        riskState.circuitBreaker = true;
        riskState.circuitBreakerReason = check.reason;
        riskState.circuitBreakerTime = Date.now();
        saveRiskState();
      }
      return check;
    }
  }

  return { pass: true };
}

// 单笔亏损异常检测（平仓后调用）
function checkSingleLossAnomaly(pnlPct) {
  if (!RC.maxSingleLossPct) return;
  const lossPct = Math.abs(pnlPct * 100);
  if (pnlPct < 0 && lossPct >= RC.maxSingleLossPct) {
    return `⚠️ 单笔亏损${lossPct.toFixed(1)}%，超过${RC.maxSingleLossPct}%预期（可能跳空穿透止损）`;
  }
  return null;
}

// ==================== 币种精度配置 ====================

const SYMBOL_PRECISION = {
  'BTCUSDT': {
    price: 1,      // 价格精度（小数位）
    quantity: 3    // 数量精度
  },
  'SOLUSDT': {
    price: 2,
    quantity: 1
  },
  'ETHUSDT': {
    price: 2,
    quantity: 3
  }
};

// 获取币种精度
function getPrecision(symbol) {
  return SYMBOL_PRECISION[symbol] || { price: 2, quantity: 3 };
}

// 格式化价格
function formatPrice(symbol, price) {
  const precision = getPrecision(symbol);
  return parseFloat(price.toFixed(precision.price));
}

// 格式化数量
function formatQuantity(symbol, quantity) {
  const precision = getPrecision(symbol);
  return parseFloat(quantity.toFixed(precision.quantity));
}

// ==================== 工具函数 ====================

function saveState() {
  const stateFile = path.join(BASE_DIR, `data-${mode}`, 'live-state.json');
  const tmp = stateFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, stateFile);
}

function loadState() {
  const stateFile = path.join(BASE_DIR, `data-${mode}`, 'live-state.json');
  if (fs.existsSync(stateFile)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      state = { ...state, ...loaded };
      console.log('状态已加载');
    } catch (e) {
      console.error('状态文件损坏，使用默认状态:', e.message);
      fs.copyFileSync(stateFile, stateFile + '.corrupt.' + Date.now());
    }
  }
}

// 通知限流
const notifyRateLimit = { timestamps: [], maxPerMinute: 10 };

async function sendNotification(message) {
  const notificationFile = path.join(BASE_DIR, `data-${mode}`, 'notification.txt');
  const timestamp = new Date().toISOString();
  const fullMessage = `[${timestamp}] ${message}\n`;

  // 写入文件（始终记录）
  fs.appendFileSync(notificationFile, fullMessage);
  console.log(`通知: ${message}`);

  // 限流检查
  const now = Date.now();
  notifyRateLimit.timestamps = notifyRateLimit.timestamps.filter(t => now - t < 60000);
  if (notifyRateLimit.timestamps.length >= notifyRateLimit.maxPerMinute) {
    console.warn('通知限流：1分钟内已发送' + notifyRateLimit.maxPerMinute + '条，跳过Telegram发送');
    return;
  }
  notifyRateLimit.timestamps.push(now);
  
  // 发送Telegram通知
  try {
    const { execFile } = require('child_process');
    const util = require('util');
    const execFilePromise = util.promisify(execFile);
    
    const prefix = CONFIG.mode === 'real' ? '[实盘]' : '[模拟]';
    const telegramMessage = `${prefix} ${message}`;
    
    await execFilePromise('openclaw', ['message', 'send', '--target', '6311362800', '--message', telegramMessage]);
  } catch (error) {
    console.error('Telegram通知发送失败:', error.message);
  }
}

// ==================== 主循环 ====================

async function checkAndTrade() {
  try {
    console.log(`\n[${new Date().toISOString()}] 开始检查交易信号...`);
    
    // 风控：熔断状态下仍检查持仓出场，但不开新仓
    if (riskState.circuitBreaker) {
      const elapsed = (Date.now() - riskState.circuitBreakerTime) / 60000;
      console.log(`🛑 熔断中 (${elapsed.toFixed(0)}分钟): ${riskState.circuitBreakerReason}`);
      
      // 检查自动冷却（仅自检熔断，非风控熔断）
      const cooldownMin = RC.circuitBreakerCooldownMin || 60;
      if (riskState.circuitBreakerReason.startsWith('自检熔断') && elapsed >= cooldownMin) {
        console.log(`✅ 自检熔断已冷却 ${cooldownMin} 分钟，自动恢复交易`);
        await sendNotification(`✅ 自检熔断已冷却 ${cooldownMin}分钟，自动恢复交易\n原因: ${riskState.circuitBreakerReason}`);
        riskState.circuitBreaker = false;
        riskState.circuitBreakerReason = '';
        riskState.circuitBreakerTime = 0;
        // 重置自检计数
        Object.keys(selfCheck.failures).forEach(k => selfCheck.failures[k].count = 0);
        saveRiskState();
        return; // 本轮不开仓
      }

      // 检查手动解除熔断文件
      const resetFile = path.join(BASE_DIR, `data-${mode}`, 'reset-circuit-breaker');
      if (fs.existsSync(resetFile)) {
        console.log('✅ 检测到手动解除熔断文件，恢复交易');
        await sendNotification(`✅ 熔断已手动解除，恢复交易\n原因: ${riskState.circuitBreakerReason}`);
        riskState.circuitBreaker = false;
        riskState.circuitBreakerReason = '';
        riskState.circuitBreakerTime = 0;
        saveRiskState();
        fs.unlinkSync(resetFile);
      } else {
        // 未解除熔断：实盘模式下强制平仓所有持仓
        if (binanceAPI) {
        for (const sym of Object.keys(state.positions)) {
          if (state.positions[sym].pendingClose) continue;
          console.log(`🛑 熔断强制平仓 ${sym}...`);
          try {
            const posResult = await binanceAPI.getPositions();
            if (!posResult.success) {
              state.positions[sym].closeRetries = (state.positions[sym].closeRetries || 0) + 1;
              console.error(`  ❌ 查询持仓失败 (第${state.positions[sym].closeRetries}次)，跳过 ${sym}:`, posResult.error);
              if (state.positions[sym].closeRetries >= 10) {
                state.positions[sym].manualOnly = true;
                await sendNotification(`🚨 ${sym} 熔断平仓重试10次失败，已转手动管理`);
              } else {
                await sendNotification(`🚨 熔断平仓 ${sym} 查询持仓失败: ${posResult.error}，请手动处理！`);
              }
              saveState();
              continue;
            }
            const binPos = (posResult.positions || []).find(p => p.symbol === sym);
            if (binPos && binPos.size > 0) {
              const side = state.positions[sym].direction === 'long' ? 'short' : 'long';
              const order = await binanceAPI.marketOrder(sym, side, binPos.size);
              if (order.success) {
                console.log(`  ✅ 熔断平仓成功: ${order.orderId}`);
                try { await binanceAPI.cancelAllOrders(sym); } catch (e) {}
                // 同步余额并记录交易
                try {
                  const balResult = await binanceAPI.getBalance();
                  if (balResult.success) {
                    const oldBal = state.balance;
                    state.balance = balResult.balance.total;
                    const cbProfit = state.balance - oldBal;
                    const cbPos = state.positions[sym];
                    state.stats.totalTrades++;
                    state.stats.bySymbol[sym] = state.stats.bySymbol[sym] || { trades: 0, wins: 0, losses: 0, pnl: 0 };
                    state.stats.bySymbol[sym].trades++;
                    if (cbProfit > 0) { state.stats.wins++; state.stats.bySymbol[sym].wins++; }
                    else { state.stats.losses++; state.stats.bySymbol[sym].losses++; }
                    state.stats.totalPnL += cbProfit;
                    state.stats.bySymbol[sym].pnl += cbProfit;
                    tradeStats.recordTrade(mode, {
                      time: new Date().toISOString(), symbol: sym, direction: cbPos.direction,
                      entry: cbPos.entry, exit: 0, pnlPct: 0,
                      profit: cbProfit, balance: state.balance, hasBOS: cbPos.hasBOS || false,
                      rr: 0, exitReason: '熔断强制平仓', entryTime: cbPos.entryTime || null
                    });
                    updatePeakBalance();
                    saveRiskState();
                  }
                } catch (statErr) { console.error('熔断平仓记录交易失败:', statErr.message); }
                await sendNotification(`🛑 熔断强制平仓 ${sym} 成功`);
                delete state.positions[sym];
              } else {
                console.error(`  ❌ 熔断平仓失败: ${order.error}`);
                state.positions[sym].manualOnly = true;
                await sendNotification(`🚨 熔断强制平仓 ${sym} 失败: ${order.error}，已转手动管理！`);
              }
            } else {
              console.log(`  ${sym} 币安无持仓，清除本地记录`);
              try { await binanceAPI.cancelAllOrders(sym); } catch (e) {}
              delete state.positions[sym];
            }
          } catch (e) {
            console.error(`  熔断平仓异常:`, e.message);
            await sendNotification(`🚨 熔断强制平仓 ${sym} 异常: ${e.message}，请手动处理！`);
          }
        }
        // 同步余额
        try {
          const balResult = await binanceAPI.getBalance();
          if (balResult.success) {
            state.balance = balResult.balance.total;
            updatePeakBalance();
            saveRiskState();
          }
        } catch (e) {}
        saveState();
        }
        return; // 熔断中不进入策略循环
      }
      // 刚解除熔断，本轮不开仓，等下一个检查周期
      return;
    }
    
    for (const strategy of CONFIG.strategies) {
      const { symbol, interval } = strategy;
      
      console.log(`\n检查 ${symbol} ${interval}...`);
      
      // P0-4: 重试之前失败的平仓
      if (state.positions[symbol] && state.positions[symbol].pendingClose) {
        // 模拟模式下不应有 pendingClose，直接清除
        if (!binanceAPI) {
          delete state.positions[symbol];
          saveState();
          continue;
        }
        
        console.log(`${symbol} 有待重试的平仓操作...`);
        
        // P0-4: 检查总重试次数，防止无限循环
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
            if (!positionsResult.success) {
              throw new Error(positionsResult.error || 'getPositions failed');
            }
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
          // 取消该币种所有挂单
          try {
            await binanceAPI.cancelAllOrders(symbol);
            console.log(`  已取消 ${symbol} 所有挂单`);
          } catch (cancelErr) {
            console.error(`  取消挂单失败:`, cancelErr.message);
          }
          delete state.positions[symbol];
          saveState();
          await sendNotification(`✅ ${symbol} 重试平仓成功`);
        } else {
          state.positions[symbol].totalRetries += retryCount;
          saveState();
          console.error(`  ⚠️ ${symbol} pendingClose ${MAX_PENDING_RETRIES}次重试均失败，累计${state.positions[symbol].totalRetries}次`);
          await sendNotification(`🚨🚨 ${symbol} 平仓重试${MAX_PENDING_RETRIES}次均失败（累计${state.positions[symbol].totalRetries}次）！请立即手动检查Binance持仓！`);
        }
        continue;
      }
      
      await updateCache(symbol, interval, 100);
      
      const klines = getKlinesFromCache(symbol, interval, 100);
      if (!klines || klines.length < 100) {
        console.log(`${symbol} K线数据不足，跳过`);
        continue;
      }
      
      const currentKline = klines[klines.length - 1];
      console.log(`当前价格: $${currentKline.close.toFixed(2)}`);
      
      if (state.positions[symbol]) {
        console.log(`当前持仓: ${state.positions[symbol].direction.toUpperCase()} @ $${state.positions[symbol].entry.toFixed(2)}`);
        
        // 实盘模式：检查币安是否已被 TP/SL 平仓
        if (binanceAPI && state.positions[symbol].orderId) {
          try {
            const posResult = await binanceAPI.getPositions();
            if (!posResult.success) {
              console.error(`  币安持仓查询失败，跳过同步:`, posResult.error);
            } else {
            const binPos = (posResult.positions || []).find(p => p.symbol === symbol);
            if (!binPos || binPos.size === 0) {
              console.log(`  ⚠️ 币安已无 ${symbol} 持仓，可能被 TP/SL 触发`);
              
              // 取消残留挂单
              try {
                await binanceAPI.cancelAllOrders(symbol);
              } catch (e) {}
              
              // 同步余额
              const balResult = await binanceAPI.getBalance();
              let profit = 0;
              if (balResult.success) {
                const oldBalance = state.balance;
                state.balance = balResult.balance.total;
                profit = state.balance - oldBalance;
                console.log(`  余额同步: $${oldBalance.toFixed(2)} → $${state.balance.toFixed(2)} (${profit >= 0 ? '+' : ''}$${profit.toFixed(2)})`);
                
                // 记录交易统计
                const pos = state.positions[symbol];
                const pnlPct = pos.entry > 0
                  ? (pos.direction === 'long'
                    ? (currentKline.close - pos.entry) / pos.entry
                    : (pos.entry - currentKline.close) / pos.entry)
                  : 0;
                state.stats.totalTrades++;
                state.stats.bySymbol[symbol] = state.stats.bySymbol[symbol] || { trades: 0, wins: 0, losses: 0, pnl: 0 };
                state.stats.bySymbol[symbol].trades++;
                if (profit > 0) { state.stats.wins++; state.stats.bySymbol[symbol].wins++; }
                else { state.stats.losses++; state.stats.bySymbol[symbol].losses++; }
                state.stats.totalPnL += profit;
                state.stats.bySymbol[symbol].pnl += profit;

                try {
                  tradeStats.recordTrade(mode, {
                    time: new Date().toISOString(),
                    symbol,
                    direction: pos.direction,
                    entry: pos.entry,
                    exit: currentKline.close,
                    pnlPct: pnlPct,
                    profit: profit,
                    balance: state.balance,
                    hasBOS: pos.hasBOS || false,
                    rr: 0,
                    exitReason: '币安TP/SL触发',
                    entryTime: pos.entryTime || null
                  });
                } catch (e) { console.error('记录交易失败:', e.message); }

                try {
                  alertSystem.checkAlerts(mode, async (level, reasons) => {
                    const msg = alertSystem.formatAlertMessage({ level, reasons, emoji: level === 'pause' ? '⛔' : level === 'red' ? '🔴' : '🟡' });
                    await sendNotification(msg);
                  });
                } catch (e) { console.error('告警检查失败:', e.message); }

                updatePeakBalance();
                saveRiskState();
              } else {
                console.error('  余额同步失败:', balResult.error);
                await sendNotification(`⚠️ ${symbol} 平仓后余额同步失败，余额可能不准确`);
              }
              
              const closedPos = state.positions[symbol];
              await sendNotification(`📊 ${symbol} 已被币安 TP/SL 平仓\n方向: ${closedPos.direction.toUpperCase()}\n入场: $${closedPos.entry.toFixed(2)}\n盈亏: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}\n余额: $${state.balance.toFixed(2)}`);
              delete state.positions[symbol];
              saveState();
              continue;
            }
            // 币安有持仓，验证 TP/SL 是否仍然存在
            if (!state.positions[symbol].manualOnly) {
              try {
                const algoOrders = await binanceAPI.getOpenAlgoOrders(symbol);
                const hasSL = algoOrders.some(o => (o.orderType || o.type) === 'STOP_MARKET');
                const hasTP = algoOrders.some(o => (o.orderType || o.type) === 'TAKE_PROFIT_MARKET');
                if (!hasSL || !hasTP) {
                  console.warn(`  ⚠️ ${symbol} TP/SL 缺失！SL=${hasSL}, TP=${hasTP}，尝试重设...`);
                  const pos = state.positions[symbol];
                  const slTp = await binanceAPI.setStopLossTakeProfit(
                    symbol,
                    pos.direction === 'long' ? 'LONG' : 'SHORT',
                    formatPrice(symbol, pos.stopLoss),
                    formatPrice(symbol, pos.takeProfit)
                  );
                  if (slTp.success) {
                    console.log(`  ✅ TP/SL 重新设置成功`);
                    await sendNotification(`⚠️ ${symbol} TP/SL 缺失已自动重设`);
                  } else {
                    recordFailure('verifyTPSL', slTp.error || '重设失败');
                    await sendNotification(`🚨 ${symbol} TP/SL 缺失且重设失败: ${slTp.error}，请手动检查！`);
                  }
                }
              } catch (tpslErr) {
                console.error(`  TP/SL验证失败:`, tpslErr.message);
              }
            }
            }
          } catch (e) {
            console.error(`  币安持仓检查失败:`, e.message);
          }
        }
      }
      
      // 跳过 manualOnly 持仓的自动出场
      if (state.positions[symbol] && state.positions[symbol].manualOnly) {
        console.log(`${symbol} 标记为手动管理，跳过自动出场`);
        continue;
      }
      
      // 更新历史最高盈利
      const currentProfitPct = (state.balance - CONFIG.initialBalance) / CONFIG.initialBalance * 100;
      if (currentProfitPct > state.peakProfitPct) state.peakProfitPct = currentProfitPct;
      CONFIG.peakProfitPct = state.peakProfitPct;
      
      const result = processBar({
        symbol, klines, positions: state.positions,
        balance: state.balance, config: CONFIG
      });
      
      if (result.action === 'exit') {
        const d = result.data;
        
        // 实盘模式：不主动平仓，出场完全依赖币安 TP/SL
        // 引擎只记录信号，实际出场在上面的币安持仓检查中同步
        if (binanceAPI) {
          console.log(`\n📋 引擎检测到出场信号 ${symbol} ${d.position.direction.toUpperCase()}`);
          console.log(`  ${d.exitReason} (由币安 TP/SL 执行，引擎不主动平仓)`);
          // 验证 TP/SL 是否仍然存在
          try {
            const algoOrders = await binanceAPI.getOpenAlgoOrders(symbol);
            const hasSL = algoOrders.some(o => (o.orderType || o.type) === 'STOP_MARKET');
            const hasTP = algoOrders.some(o => (o.orderType || o.type) === 'TAKE_PROFIT_MARKET');
            if (!hasSL || !hasTP) {
              console.error(`  🚨 TP/SL 已失效！SL=${hasSL}, TP=${hasTP}`);
              await sendNotification(`🚨 ${symbol} TP/SL 已失效！SL=${hasSL} TP=${hasTP}\n尝试重新设置...`);
              // 尝试重新设置
              const pos = state.positions[symbol];
              const slTp = await binanceAPI.setStopLossTakeProfit(
                symbol,
                pos.direction === 'long' ? 'LONG' : 'SHORT',
                formatPrice(symbol, pos.stopLoss),
                formatPrice(symbol, pos.takeProfit)
              );
              if (slTp.success) {
                console.log(`  ✅ TP/SL 重新设置成功`);
                await sendNotification(`✅ ${symbol} TP/SL 已重新设置`);
              } else {
                console.error(`  ❌ TP/SL 重新设置失败: ${slTp.error}`);
                await sendNotification(`🚨🚨 ${symbol} TP/SL 重设失败！执行紧急市价平仓`);
                // 紧急平仓
                try {
                  const posResult = await binanceAPI.getPositions();
                  const binPos = (posResult.positions || []).find(p => p.symbol === symbol);
                  if (binPos && binPos.size > 0) {
                    const side = pos.direction === 'long' ? 'short' : 'long';
                    const closeResult = await binanceAPI.marketOrder(symbol, side, binPos.size);
                    if (closeResult.success) {
                      await binanceAPI.cancelAllOrders(symbol);
                      // 同步余额
                      const balResult = await binanceAPI.getBalance();
                      if (balResult.success) {
                        const oldBal = state.balance;
                        state.balance = balResult.balance.total;
                        const emergProfit = state.balance - oldBal;
                        // 记录交易
                        try {
                          const emergPnlPct = pos.entry > 0
                            ? (pos.direction === 'long'
                              ? (currentKline.close - pos.entry) / pos.entry
                              : (pos.entry - currentKline.close) / pos.entry)
                            : 0;
                          state.stats.totalTrades++;
                          state.stats.bySymbol[symbol] = state.stats.bySymbol[symbol] || { trades: 0, wins: 0, losses: 0, pnl: 0 };
                          state.stats.bySymbol[symbol].trades++;
                          if (emergProfit > 0) { state.stats.wins++; state.stats.bySymbol[symbol].wins++; }
                          else { state.stats.losses++; state.stats.bySymbol[symbol].losses++; }
                          state.stats.totalPnL += emergProfit;
                          state.stats.bySymbol[symbol].pnl += emergProfit;
                          tradeStats.recordTrade(mode, {
                            time: new Date().toISOString(), symbol, direction: pos.direction,
                            entry: pos.entry, exit: currentKline.close, pnlPct: emergPnlPct,
                            profit: emergProfit, balance: state.balance, hasBOS: pos.hasBOS || false,
                            rr: 0, exitReason: 'TP/SL失效紧急平仓', entryTime: pos.entryTime || null
                          });
                        } catch (e) { console.error('紧急平仓记录交易失败:', e.message); }
                        updatePeakBalance();
                        saveRiskState();
                      }
                      delete state.positions[symbol];
                    } else {
                      state.positions[symbol].manualOnly = true;
                      await sendNotification(`🚨 ${symbol} 紧急平仓失败: ${closeResult.error}，已转手动管理！`);
                    }
                  }
                } catch (closeErr) {
                  state.positions[symbol].manualOnly = true;
                  await sendNotification(`🚨🚨🚨 ${symbol} 紧急平仓异常: ${closeErr.message}，已转手动管理！`);
                }
                saveState();
              }
            } else {
              console.log(`  ✅ TP/SL 仍有效，等待币安执行`);
            }
          } catch (checkErr) {
            console.error(`  验证 TP/SL 失败:`, checkErr.message);
            recordFailure('verifyTPSL', checkErr.message);
            await sendNotification(`⚠️ ${symbol} TP/SL 验证查询失败: ${checkErr.message}，请手动确认止损是否存在`);
          }
        } else {
          // 模拟模式：引擎直接处理平仓
          state.balance += d.profit;
          state.stats.totalTrades++;
          state.stats.bySymbol[symbol].trades++;
          if (d.pnl > 0) { state.stats.wins++; state.stats.bySymbol[symbol].wins++; }
          else { state.stats.losses++; state.stats.bySymbol[symbol].losses++; }
          state.stats.totalPnL += d.profit;
          state.stats.bySymbol[symbol].pnl += d.profit;
          
          console.log(`\n✅ 平仓 ${symbol} ${d.position.direction.toUpperCase()}`);
          console.log(`  进场: $${d.position.entry.toFixed(2)} → 出场: $${d.exitPrice.toFixed(2)}`);
          console.log(`  ${d.exitReason} | 盈亏: ${(d.pnl * 100).toFixed(2)}%`);
          console.log(`  利润: $${d.profit.toFixed(2)}`);
          console.log(`  余额: $${state.balance.toFixed(2)}`);
          
          await sendNotification(`平仓 ${symbol} ${d.position.direction.toUpperCase()}\n${d.exitReason}\n盈亏: ${(d.pnl * 100).toFixed(2)}%\n利润: $${d.profit.toFixed(2)}\n余额: $${state.balance.toFixed(2)}`);
          
          // 风控：单笔亏损异常检测（跳空穿透）
          const singleLossAlert = checkSingleLossAnomaly(d.pnl);
          if (singleLossAlert) {
            console.log(singleLossAlert);
            await sendNotification(singleLossAlert);
          }
          
          updatePeakBalance();
          saveRiskState();
          
          try {
            tradeStats.recordTrade(mode, {
              time: new Date().toISOString(),
              symbol,
              direction: d.position.direction,
              entry: d.position.entry,
              exit: d.exitPrice,
              pnlPct: d.pnl,
              profit: d.profit,
              balance: state.balance,
              hasBOS: d.position.hasBOS || false,
              rr: d.pnl > 0 ? d.pnl / d.position.priceRisk : -(Math.abs(d.pnl) / d.position.priceRisk),
              exitReason: d.exitReason,
              entryTime: d.position.entryTime || null
            });
            alertSystem.checkAlerts(mode, async (level, reasons) => {
              const msg = alertSystem.formatAlertMessage({ level, reasons, emoji: level === 'pause' ? '⛔' : level === 'red' ? '🔴' : '🟡' });
              await sendNotification(msg);
            });
          } catch (monitorErr) {
            console.error('监控记录失败:', monitorErr.message);
            await sendNotification(`⚠️ ${symbol} 交易记录写入失败: ${monitorErr.message}，请手动补录`);
          }
          
          delete state.positions[symbol];
          saveState();
        }
        
      } else if (result.action === 'entry') {
        const d = result.data;
        const signal = d.signal;
        
        // 风控检查：开仓前必须通过
        const rcCheck = await riskControlCheck(symbol, signal.entry);
        if (!rcCheck.pass) {
          console.log(`\n🛑 风控拦截 ${symbol}: ${rcCheck.reason}`);
          await sendNotification(`🛑 风控拦截开仓 ${symbol} ${signal.direction.toUpperCase()} @ $${signal.entry.toFixed(2)}\n原因: ${rcCheck.reason}`);
          continue;
        }
        
        state.positions[symbol] = { ...signal, symbol, allocation: d.allocation, entryTime: new Date().toISOString() };
        
        console.log(`\n🎯 开仓 ${symbol} ${signal.direction.toUpperCase()}`);
        console.log(`  价格: $${signal.entry.toFixed(2)}`);
        console.log(`  止损: $${signal.stopLoss.toFixed(2)} (风险${(signal.priceRisk * 100).toFixed(2)}%)`);
        console.log(`  止盈: $${signal.takeProfit.toFixed(2)}`);
        console.log(`  风险: ${(signal.riskPerTrade * 100).toFixed(0)}%`);
        console.log(`  资金分配: ${(d.allocation * 100).toFixed(0)}%`);
        console.log(`  BOS: ${signal.hasBOS ? 'YES' : 'NO'}`);
        console.log(`  强度: ${signal.zoneStrength}`);
        
        await sendNotification(`开仓 ${symbol} ${signal.direction.toUpperCase()} @ $${signal.entry.toFixed(2)}\n止损: $${signal.stopLoss.toFixed(2)}\n止盈: $${signal.takeProfit.toFixed(2)}\n风险: ${(signal.riskPerTrade * 100).toFixed(0)}%\n分配: ${(d.allocation * 100).toFixed(0)}%\nBOS: ${signal.hasBOS ? 'YES' : 'NO'}`);
        
        // 实盘模式：调用Binance API开仓
        if (binanceAPI) {
          try {
            await binanceAPI.setLeverage(symbol, CONFIG.leverage);
            
            const quantity = (state.balance * d.allocation * signal.riskPerTrade) / (signal.entry * signal.priceRisk);
            // P1-1: 杠杆上限检查，防止仓位超过杠杆允许的最大值
            const maxQuantity = (state.balance * d.allocation * CONFIG.leverage) / signal.entry;
            let cappedQuantity = Math.min(quantity, maxQuantity);
            
            // MIN_NOTIONAL 检查：币安合约各币种最低名义值不同
            const MIN_NOTIONAL_MAP = { 'BTCUSDT': 105, 'ETHUSDT': 25, 'SOLUSDT': 8 };
            const minNotional = MIN_NOTIONAL_MAP[symbol] || 105;
            const notionalValue = cappedQuantity * signal.entry;
            if (notionalValue < minNotional) {
              const minQuantity = minNotional / signal.entry;
              const minMarginRequired = minQuantity * signal.entry / CONFIG.leverage;
              if (minMarginRequired > state.balance * d.allocation) {
                console.log(`  ⚠️ 名义值 $${notionalValue.toFixed(2)} < $${minNotional}，调整后保证金 $${minMarginRequired.toFixed(2)} 超过可用资金，跳过开仓`);
                await sendNotification(`⚠️ ${symbol} 跳过开仓：资金不足满足最低名义值 $${minNotional}`);
                delete state.positions[symbol];
                saveState();
                continue;
              }
              console.log(`  ⚠️ 名义值 $${notionalValue.toFixed(2)} < $${minNotional}，调整至最低 $${minNotional}`);
              cappedQuantity = minQuantity;
            }
            
            const formattedQuantity = formatQuantity(symbol, cappedQuantity);
            const order = await binanceAPI.marketOrder(symbol, signal.direction, formattedQuantity);
            
            if (order.success) {
              state.positions[symbol].orderId = order.orderId;
              console.log(`  Binance开仓订单: ${order.orderId}`);
              recordSuccess('openOrder');
              saveState(); // 先保存持仓记录，防止后续崩溃丢失
              
              // 止盈止损设置，最多重试3次
              let slTpSuccess = false;
              let lastSlTpError = '未知错误';
              for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                  const slTpResult = await binanceAPI.setStopLossTakeProfit(
                    symbol,
                    signal.direction === 'long' ? 'LONG' : 'SHORT',
                    formatPrice(symbol, signal.stopLoss),
                    formatPrice(symbol, signal.takeProfit)
                  );
                  
                  if (slTpResult.success) {
                    console.log(`  止盈止损已设置 (第${attempt}次)`);
                    slTpSuccess = true;
                    recordSuccess('setTPSL');
                    
                    // 验证：查询 Algo Orders 确认 TP/SL 存在
                    try {
                      const algoOrders = await binanceAPI.getOpenAlgoOrders(symbol);
                      const hasSL = algoOrders.some(o => (o.orderType || o.type) === 'STOP_MARKET');
                      const hasTP = algoOrders.some(o => (o.orderType || o.type) === 'TAKE_PROFIT_MARKET');
                      if (hasSL && hasTP) {
                        console.log(`  ✅ 验证通过：止损和止盈Algo挂单均存在`);
                      } else {
                        console.warn(`  ⚠️ 验证异常：SL=${hasSL}, TP=${hasTP}`);
                        // 取消刚创建的挂单再重试
                        await binanceAPI.cancelAllAlgoOrders(symbol);
                        slTpSuccess = false;
                        lastSlTpError = `验证失败: SL=${hasSL}, TP=${hasTP}`;
                        continue;
                      }
                    } catch (verifyErr) {
                      console.error(`  验证查询失败:`, verifyErr.message);
                      // 验证失败不影响，API返回成功就信任
                    }
                    
                    break;
                  }
                  lastSlTpError = slTpResult.error || '未知错误';
                  console.error(`  止盈止损设置失败 (第${attempt}次): ${lastSlTpError}`);
                } catch (slTpError) {
                  lastSlTpError = slTpError.message;
                  console.error(`  止盈止损设置异常 (第${attempt}次): ${lastSlTpError}`);
                }
                if (attempt < 3) {
                  await new Promise(resolve => setTimeout(resolve, 2000));
                }
              }
              
              // 3次都失败：立即市价平仓
              if (!slTpSuccess) {
                recordFailure('setTPSL', lastSlTpError);
                console.error(`  ⚠️ 止盈止损3次设置均失败，立即市价平仓`);
                await sendNotification(`🚨 ${symbol} 止盈止损设置3次失败！紧急市价平仓`);
                let emergencyCloseSuccess = false;
                try {
                  // 从币安查实际持仓数量
                  const posResult = await binanceAPI.getPositions();
                  const binPos = (posResult.positions || []).find(p => p.symbol === symbol);
                  const closeQty = binPos ? binPos.size : formattedQuantity;
                  const closeOrder = await binanceAPI.marketOrder(
                    symbol,
                    signal.direction === 'long' ? 'short' : 'long',
                    closeQty
                  );
                  if (closeOrder.success) {
                    console.log(`  紧急平仓订单: ${closeOrder.orderId}`);
                    await sendNotification(`✅ ${symbol} 紧急平仓成功`);
                    emergencyCloseSuccess = true;
                  }
                } catch (closeError) {
                  console.error(`  紧急平仓异常:`, closeError.message);
                }
                if (emergencyCloseSuccess) {
                  try { await binanceAPI.cancelAllOrders(symbol); } catch (e) {}
                  delete state.positions[symbol];
                } else {
                  state.positions[symbol].manualOnly = true;
                  state.positions[symbol].noStopLoss = true;
                  await sendNotification(`🚨🚨🚨 ${symbol} 紧急平仓失败！持仓无止损保护！\n请立即手动平仓或设置止损！`);
                }
              }
            } else {
              console.error(`Binance开仓失败: ${order.error}`);
              recordFailure('openOrder', order.error);
              await sendNotification(`⚠️ ${symbol} Binance开仓失败: ${order.error}`);
              delete state.positions[symbol];
            }
            
            // 开仓后从币安同步实际余额
            try {
              const balResult = await binanceAPI.getBalance();
              if (balResult.success) {
                state.balance = balResult.balance.total;
                updatePeakBalance();
                saveRiskState();
              }
            } catch (e) {
              console.error('  开仓后余额同步失败:', e.message);
            }
          } catch (error) {
            console.error(`Binance开仓失败:`, error.message);
            recordFailure('openOrder', error.message);
            await sendNotification(`⚠️ ${symbol} Binance开仓失败: ${error.message}`);
            delete state.positions[symbol];
          }
        }
        
        saveState();
      }
    }
    
    console.log(`\n当前余额: $${state.balance.toFixed(2)}`);
    console.log(`持仓数量: ${Object.keys(state.positions).length}`);
    
  } catch (error) {
    console.error('检查交易信号失败:', error);
    await sendNotification(`⚠️ 检查交易信号失败: ${error.message}`);
  }
}

// ==================== 优化功能 ====================

const TIMING_CONFIG = {
  klineDelay: 10 * 1000,
  maxRetries: 3,
  retryDelay: 5 * 1000,
  heartbeatInterval: 60 * 1000,
  maxSilentTime: 15 * 60 * 1000
};

function getNextCheckTime() {
  const now = Date.now();
  const nextTime = new Date(now);
  const currentMinute = nextTime.getMinutes();
  
  // 固定10分钟间隔：00:10, 10:10, 20:10, 30:10, 40:10, 50:10
  const nextSlot = Math.ceil((currentMinute + 1) / 10) * 10;
  if (nextSlot >= 60) {
    nextTime.setHours(nextTime.getHours() + 1, 0, 10, 0);
  } else {
    nextTime.setMinutes(nextSlot, 10, 0);
  }
  
  return nextTime.getTime();
}

function scheduleNextCheck() {
  const nextTime = getNextCheckTime();
  const delay = Math.max(nextTime - Date.now(), 1000); // 至少等1秒，防止时钟跳变导致快速循环
  
  console.log(`下次检查: ${new Date(nextTime).toISOString()} (${Math.round(delay / 1000)}秒后)`);
  
  setTimeout(async () => {
    await checkAndTradeWithRetry();
    scheduleNextCheck();
  }, delay);
}

async function checkAndTradeWithRetry() {
  let lastError = null;
  
  for (let attempt = 1; attempt <= TIMING_CONFIG.maxRetries; attempt++) {
    try {
      await checkAndTrade();
      return;
    } catch (error) {
      lastError = error;
      console.error(`检查失败 (尝试 ${attempt}/${TIMING_CONFIG.maxRetries}):`, error.message);
      
      if (attempt < TIMING_CONFIG.maxRetries) {
        console.log(`${TIMING_CONFIG.retryDelay / 1000}秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, TIMING_CONFIG.retryDelay));
      }
    }
  }
  
  console.error('所有重试失败:', lastError.message);
  await sendNotification(`⚠️ 检查失败（${TIMING_CONFIG.maxRetries}次重试）: ${lastError.message}`);
}

function startHeartbeat() {
  setInterval(() => {
    const heartbeat = {
      timestamp: new Date().toISOString(),
      mode: mode,
      balance: state.balance,
      positions: Object.keys(state.positions).length,
      positionDetails: Object.entries(state.positions).map(([sym, p]) => ({
        symbol: sym,
        direction: p.direction,
        entry: p.entry,
        stopLoss: p.stopLoss,
        takeProfit: p.takeProfit,
        hasBOS: p.hasBOS,
        entryTime: p.entryTime
      })),
      trades: state.stats.totalTrades,
      selfCheck: Object.entries(selfCheck.failures).filter(([_, f]) => f.count > 0).map(([op, f]) => ({
        operation: op, count: f.count, lastError: f.lastError
      })),
      riskControl: {
        circuitBreaker: riskState.circuitBreaker,
        circuitBreakerReason: riskState.circuitBreakerReason || '',
        dailyLossPct: riskState.dailyLossPct,
        peakBalance: riskState.peakBalance,
        drawdownPct: riskState.peakBalance > 0 ? ((riskState.peakBalance - state.balance) / riskState.peakBalance * 100) : 0,
        apiFailCount: riskState.apiFailCount
      }
    };
    
    const heartbeatFile = path.join(BASE_DIR, `data-${mode}`, 'heartbeat.json');
    const tmpHb = heartbeatFile + '.tmp';
    fs.writeFileSync(tmpHb, JSON.stringify(heartbeat, null, 2));
    fs.renameSync(tmpHb, heartbeatFile);
  }, TIMING_CONFIG.heartbeatInterval);
}

// ==================== 优雅退出 ====================
let isShuttingDown = false;
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n收到 ${signal}，开始优雅退出...`);
  try {
    saveState();
    saveRiskState();
    console.log('状态已保存');
    await sendNotification(`⚠️ [${CONFIG.mode}] 系统收到 ${signal}，已保存状态并退出`);
  } catch (e) {
    console.error('退出时保存状态失败:', e.message);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  console.error('未捕获异常:', error);
  sendNotification(`⚠️ 系统异常: ${error.message}`).catch(console.error);
});

process.on('unhandledRejection', (reason) => {
  console.error('未处理的Promise拒绝:', reason);
  sendNotification(`⚠️ Promise拒绝: ${reason}`).catch(console.error);
});

// ==================== 启动 ====================

async function start() {
  console.log('='.repeat(60));
  console.log(`PA Live Trading V3 - 双币种模式 (${CONFIG.name})`);
  console.log('='.repeat(60));
  
  loadState();
  loadRiskState();
  
  // 风控状态报告
  console.log(`\n🛡️ 风控系统已加载:`);
  console.log(`  单日最大亏损: ${RC.dailyMaxLossPct || '未设置'}%`);
  console.log(`  总回撤熔断: ${RC.maxDrawdownPct || '未设置'}%`);
  console.log(`  单笔亏损上限: ${RC.maxSingleLossPct || '未设置'}%`);
  console.log(`  API失败阈值: ${RC.apiFailThreshold || '未设置'}次`);
  console.log(`  余额偏差阈值: ${RC.balanceDeviationPct || '未设置'}%`);
  console.log(`  价格异常阈值: ${RC.priceAnomalyPct || '未设置'}%`);
  if (riskState.circuitBreaker) {
    console.log(`  ⚠️ 当前处于熔断状态: ${riskState.circuitBreakerReason}`);
  }
  console.log('');
  
  // P1-3: 实盘模式下同步 Binance 持仓
  if (binanceAPI) {
    try {
      console.log('正在同步 Binance 持仓...');
      const positionsResult = await binanceAPI.getPositions();
      if (!positionsResult.success) {
        throw new Error(positionsResult.error || 'getPositions failed');
      }
      const positions = positionsResult.positions || [];
      const activePositions = positions.filter(p => p.symbol && parseFloat(p.size || p.positionAmt || 0) !== 0);
      
      for (const bp of activePositions) {
        const sym = bp.symbol;
        const isTracked = CONFIG.strategies.some(s => s.symbol === sym);
        if (!isTracked) continue;
        
        if (!state.positions[sym]) {
          const size = parseFloat(bp.size || bp.positionAmt || 0);
          const entryPrice = parseFloat(bp.entryPrice || 0);
          const direction = size > 0 ? 'long' : 'short';
          
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
            manualOnly: true  // P1-5: 同步持仓不参与自动出场，需人工处理
          };
          
          console.log(`⚠️ 发现 Binance 持仓但本地无记录: ${sym} ${direction.toUpperCase()} @ $${entryPrice}`);
          await sendNotification(`⚠️ 重启同步: 发现 ${sym} ${direction.toUpperCase()} 持仓 @ $${entryPrice}，已同步到本地。\n⚠️ 止盈止损未知，已标记为手动管理，不会自动出场。请手动检查Binance止盈止损设置！`);
          saveState();
        }
      }
      
      // 检查本地有持仓但 Binance 没有的情况
      for (const sym of Object.keys(state.positions)) {
        const binanceHas = activePositions.some(p => p.symbol === sym);
        if (!binanceHas) {
          console.log(`⚠️ 本地有 ${sym} 持仓但 Binance 无持仓，可能已被 TP/SL 触发`);
          await sendNotification(`⚠️ 重启同步: 本地有 ${sym} 持仓但 Binance 无持仓，已清除本地记录。`);
          delete state.positions[sym];
          saveState();
        }
      }
      
      console.log('Binance 持仓同步完成');
      
      // 从 Binance 获取实际余额
      const balResult = await binanceAPI.getBalance();
      if (balResult.success) {
        state.balance = balResult.balance.total;
        riskState.peakBalance = Math.max(riskState.peakBalance, state.balance);
        console.log(`Binance 实际余额: $${state.balance.toFixed(2)}`);
      }
    } catch (error) {
      console.error('Binance 持仓同步失败:', error.message);
      await sendNotification(`⚠️ 启动时 Binance 持仓同步失败: ${error.message}`);
    }
  }
  
  console.log(`初始余额: $${state.balance.toFixed(2)}`);
  console.log(`杠杆: ${CONFIG.leverage}x`);
  console.log(`交易对: ${CONFIG.strategies.map(s => `${s.symbol} ${s.interval}`).join(', ')}`);
  console.log('');
  
  console.log('✨ 优化功能：');
  console.log(`  - 时间同步: K线完成后${TIMING_CONFIG.klineDelay / 1000}秒检查`);
  console.log(`  - 错误重试: 最多${TIMING_CONFIG.maxRetries}次，间隔${TIMING_CONFIG.retryDelay / 1000}秒`);
  console.log(`  - 心跳检测: 每${TIMING_CONFIG.heartbeatInterval / 1000}秒`);
  console.log(`  - 智能调度: 自动计算下次检查时间`);
  console.log('');
  
  startHeartbeat();
  console.log('✅ 心跳检测已启动');
  
  await checkAndTradeWithRetry();
  
  scheduleNextCheck();
  console.log('✅ 智能调度已启动');
}

start().catch(console.error);
