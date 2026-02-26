#!/usr/bin/env node
/**
 * PA Live Trading V3 - 实盘交易核心
 * 
 * 基于最优策略：增强密集区 + BOS
 */

const { getKlinesFromCache, updateCache } = require('../../kline-cache.js');
const fs = require('fs');

// ==================== 加载配置 ====================

const mode = process.env.PA_MODE || 'simulation';
const CONFIG = require(`./config-${mode}.js`);

console.log(`加载配置: ${CONFIG.name}`);

// ==================== Binance API ====================

let binanceAPI = null;
if (CONFIG.mode === 'real' && CONFIG.binance) {
  const BinanceAPI = require('./binance-api.js');
  binanceAPI = new BinanceAPI(CONFIG.binance.apiKey, CONFIG.binance.apiSecret, CONFIG.binance.testnet);
  console.log('Binance API 已初始化');
}

// ==================== 状态管理 ====================

let state = {
  balance: CONFIG.initialBalance,
  position: null,
  lastCheck: null,
  stats: {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnL: 0
  }
};

// ==================== 交易逻辑函数 ====================

const {
  findConsolidationZones,
  enhanceConsolidationZones,
  detectBOS,
  getTrendAdvanced,
  findSupportZone,
  findResistanceZone,
  generateSignal
} = require('./trading-functions.js');

// ==================== 回测引擎 ====================

function backtest(klines) {
  let balance = CONFIG.initialBalance;
  let position = null;
  const trades = [];
  
  for (let i = 100; i < klines.length; i++) {
    const slice = klines.slice(0, i + 1);
    const currentKline = slice[slice.length - 1];
    const prevKline = slice[slice.length - 2];
    const currentPrice = currentKline.close;
    
    // 检查持仓
    if (position) {
      let exitPrice = null;
      let exitReason = '';
      
      if (position.direction === 'long') {
        if (currentKline.low <= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = '触及止损位';
        } else {
          const maxPnl = (currentKline.high - position.entry) / position.entry;
          if (maxPnl >= position.priceRisk) {
            exitPrice = position.entry + (position.entry * position.priceRisk);
            exitReason = '1比1止盈';
          }
        }
      } else {
        if (currentKline.high >= position.stopLoss) {
          exitPrice = position.stopLoss;
          exitReason = '触及止损位';
        } else {
          const maxPnl = (position.entry - currentKline.low) / position.entry;
          if (maxPnl >= position.priceRisk) {
            exitPrice = position.entry - (position.entry * position.priceRisk);
            exitReason = '1比1止盈';
          }
        }
      }
      
      if (exitPrice) {
        const pnl = position.direction === 'long' 
          ? (exitPrice - position.entry) / position.entry
          : (position.entry - exitPrice) / position.entry;
        
        const profit = balance * position.riskPerTrade * (pnl / position.priceRisk);
        balance += profit;
        
        trades.push({
          ...position,
          exit: exitPrice,
          exitReason: exitReason,
          pnl: pnl,
          profit: profit,
          balance: balance
        });
        
        position = null;
      }
      
      continue;
    }
    
    // 生成信号
    let consolidationZones = findConsolidationZones(slice);
    consolidationZones = enhanceConsolidationZones(slice, consolidationZones);
    
    const trend = getTrendAdvanced(slice);
    const supportZone = findSupportZone(slice, consolidationZones);
    const resistanceZone = findResistanceZone(slice, consolidationZones);
    
    // 做多信号
    if (trend === 'up' && supportZone) {
      const inZone = currentKline.low <= supportZone.high && currentKline.low >= supportZone.low;
      const bouncing = currentKline.close > prevKline.close;
      
      if (inZone && bouncing) {
        const stopLoss = supportZone.low;
        const priceRisk = (currentPrice - stopLoss) / currentPrice;
        
        if (priceRisk > 0.01 && priceRisk < 0.10) {
          // 检查BOS
          const bos = detectBOS(slice, 'up');
          const hasBOS = bos.broken;
          const riskPerTrade = hasBOS ? CONFIG.riskWithBOS : CONFIG.riskWithoutBOS;
          
          position = {
            direction: 'long',
            entry: currentPrice,
            stopLoss: stopLoss,
            priceRisk: priceRisk,
            riskPerTrade: riskPerTrade,
            takeProfit: currentPrice + (currentPrice * priceRisk),
            entryTime: currentKline.openTime,
            zoneStrength: supportZone.strength,
            zoneFeatures: supportZone.features,
            hasBOS: hasBOS
          };
        }
      }
    }
    
    // 做空信号
    if (trend === 'down' && resistanceZone) {
      const inZone = currentKline.high >= resistanceZone.low && currentKline.high <= resistanceZone.high;
      const falling = currentKline.close < prevKline.close;
      
      if (inZone && falling) {
        const stopLoss = resistanceZone.high;
        const priceRisk = (stopLoss - currentPrice) / currentPrice;
        
        if (priceRisk > 0.01 && priceRisk < 0.10) {
          // 检查BOS
          const bos = detectBOS(slice, 'down');
          const hasBOS = bos.broken;
          const riskPerTrade = hasBOS ? CONFIG.riskWithBOS : CONFIG.riskWithoutBOS;
          
          position = {
            direction: 'short',
            entry: currentPrice,
            stopLoss: stopLoss,
            priceRisk: priceRisk,
            riskPerTrade: riskPerTrade,
            takeProfit: currentPrice - (currentPrice * priceRisk),
            entryTime: currentKline.openTime,
            zoneStrength: resistanceZone.strength,
            zoneFeatures: resistanceZone.features,
            hasBOS: hasBOS
          };
        }
      }
    }
  }
  
  return { balance, trades };
}

// ==================== 主函数 ====================


// ==================== 实盘交易主循环 ====================

async function checkAndTrade() {
  try {
    console.log(`\n[${new Date().toISOString()}] 开始检查交易信号...`);
    
    // 更新K线缓存
    await updateCache(CONFIG.symbol, CONFIG.interval, 100);
    
    // 获取最新K线数据
    const klines = getKlinesFromCache(CONFIG.symbol, CONFIG.interval, 100);
    if (!klines || klines.length < 100) {
      console.log('K线数据不足，跳过本次检查');
      return;
    }
    
    const currentKline = klines[klines.length - 1];
    const prevKline = klines[klines.length - 2];
    const currentPrice = currentKline.close;
    
    console.log(`当前价格: $${currentPrice.toFixed(2)}`);
    console.log(`当前余额: $${state.balance.toFixed(2)}`);
    
    // 检查持仓
    if (state.position) {
      console.log(`当前持仓: ${state.position.direction.toUpperCase()} @ $${state.position.entry.toFixed(2)}`);
      
      let exitPrice = null;
      let exitReason = '';
      
      if (state.position.direction === 'long') {
        if (currentKline.low <= state.position.stopLoss) {
          exitPrice = state.position.stopLoss;
          exitReason = '触及止损位';
        } else {
          const maxPnl = (currentKline.high - state.position.entry) / state.position.entry;
          if (maxPnl >= state.position.priceRisk) {
            exitPrice = state.position.entry + (state.position.entry * state.position.priceRisk);
            exitReason = '1比1止盈';
          }
        }
      } else {
        if (currentKline.high >= state.position.stopLoss) {
          exitPrice = state.position.stopLoss;
          exitReason = '触及止损位';
        } else {
          const maxPnl = (state.position.entry - currentKline.low) / state.position.entry;
          if (maxPnl >= state.position.priceRisk) {
            exitPrice = state.position.entry - (state.position.entry * state.position.priceRisk);
            exitReason = '1比1止盈';
          }
        }
      }
      
      if (exitPrice) {
        const pnl = state.position.direction === 'long' 
          ? (exitPrice - state.position.entry) / state.position.entry
          : (state.position.entry - exitPrice) / state.position.entry;
        
        const profit = state.balance * state.position.riskPerTrade * (pnl / state.position.priceRisk);
        state.balance += profit;
        
        state.stats.totalTrades++;
        if (pnl > 0) {
          state.stats.wins++;
        } else {
          state.stats.losses++;
        }
        state.stats.totalPnL += profit;
        
        console.log(`\n✅ 平仓 ${state.position.direction.toUpperCase()}`);
        console.log(`  进场: $${state.position.entry.toFixed(2)} → 出场: $${exitPrice.toFixed(2)}`);
        console.log(`  ${exitReason} | 盈亏: ${(pnl * 100).toFixed(2)}%`);
        console.log(`  余额: $${state.balance.toFixed(2)}`);
        
        await sendNotification(`平仓 ${state.position.direction.toUpperCase()}\n${exitReason}\n盈亏: ${(pnl * 100).toFixed(2)}%\n余额: $${state.balance.toFixed(2)}`);
        
        // 实盘模式：调用Binance API平仓
        if (binanceAPI && state.position.orderId) {
          try {
            const positions = await binanceAPI.getPositions(CONFIG.symbol);
            if (positions.length > 0) {
              const position = positions[0];
              const quantity = Math.abs(parseFloat(position.positionAmt));
              const side = state.position.direction === "long" ? "short" : "long";
              const order = await binanceAPI.marketOrder(CONFIG.symbol, side, quantity.toFixed(3));
              console.log(`  Binance平仓订单: ${order.orderId}`);
            }
          } catch (error) {
            console.error("Binance平仓失败:", error);
            await sendNotification(`⚠️ Binance平仓失败: ${error.message}`);
          }
        }
        
        state.position = null;
        saveState();
      }
      
      return;
    }
    
    // 生成信号
    let consolidationZones = findConsolidationZones(klines);
    consolidationZones = enhanceConsolidationZones(klines, consolidationZones);
    
    const trend = getTrendAdvanced(klines);
    const supportZone = findSupportZone(klines, consolidationZones);
    const resistanceZone = findResistanceZone(klines, consolidationZones);
    
    console.log(`趋势: ${trend}`);
    console.log(`支撑区: ${supportZone ? `$${supportZone.low.toFixed(2)}-$${supportZone.high.toFixed(2)} (强度${supportZone.strength})` : '无'}`);
    console.log(`阻力区: ${resistanceZone ? `$${resistanceZone.low.toFixed(2)}-$${resistanceZone.high.toFixed(2)} (强度${resistanceZone.strength})` : '无'}`);
    
    // 做多信号
    if (trend === 'up' && supportZone) {
      const inZone = currentKline.low <= supportZone.high && currentKline.low >= supportZone.low;
      const bouncing = currentKline.close > prevKline.close;
      
      if (inZone && bouncing) {
        const stopLoss = supportZone.low;
        const priceRisk = (currentPrice - stopLoss) / currentPrice;
        
        if (priceRisk > 0.01 && priceRisk < 0.10) {
          const bos = detectBOS(klines, 'up');
          const hasBOS = bos.broken;
          const riskPerTrade = hasBOS ? CONFIG.riskWithBOS : CONFIG.riskWithoutBOS;
          
          state.position = {
            direction: 'long',
            entry: currentPrice,
            stopLoss: stopLoss,
            priceRisk: priceRisk,
            riskPerTrade: riskPerTrade,
            takeProfit: currentPrice + (currentPrice * priceRisk),
            entryTime: currentKline.time,
            zoneStrength: supportZone.strength,
            zoneFeatures: supportZone.features,
            hasBOS: hasBOS
          };
          
          console.log(`\n🎯 开仓 LONG`);
          console.log(`  价格: $${currentPrice.toFixed(2)}`);
          console.log(`  止损: $${stopLoss.toFixed(2)} (风险${(priceRisk * 100).toFixed(2)}%)`);
          console.log(`  止盈: $${state.position.takeProfit.toFixed(2)}`);
          console.log(`  风险: ${(riskPerTrade * 100).toFixed(0)}%`);
          console.log(`  BOS: ${hasBOS ? 'YES' : 'NO'}`);
          console.log(`  强度: ${supportZone.strength}`);
          
          await sendNotification(`开仓 LONG @ $${currentPrice.toFixed(2)}\n止损: $${stopLoss.toFixed(2)}\n止盈: $${state.position.takeProfit.toFixed(2)}\n风险: ${(riskPerTrade * 100).toFixed(0)}%\nBOS: ${hasBOS ? 'YES' : 'NO'}`);
          
          // 实盘模式：调用Binance API开仓
          if (binanceAPI) {
            try {
              const positionSize = state.balance * riskPerTrade / priceRisk;
              const quantity = (positionSize / currentPrice).toFixed(3);
              console.log(`  开仓数量: ${quantity} ${CONFIG.symbol}`);
              
              await binanceAPI.setLeverage(CONFIG.symbol, CONFIG.leverage);
              const order = await binanceAPI.marketOrder(CONFIG.symbol, "long", quantity);
              console.log(`  Binance订单: ${order.orderId}`);
              state.position.orderId = order.orderId;
            } catch (error) {
              console.error("Binance开仓失败:", error);
              await sendNotification(`⚠️ Binance开仓失败: ${error.message}`);
              state.position = null;
              saveState();
              return;
            }
          }
          
          saveState();
        }
      }
    }
    
    // 做空信号
    if (trend === 'down' && resistanceZone) {
      const inZone = currentKline.high >= resistanceZone.low && currentKline.high <= resistanceZone.high;
      const falling = currentKline.close < prevKline.close;
      
      if (inZone && falling) {
        const stopLoss = resistanceZone.high;
        const priceRisk = (stopLoss - currentPrice) / currentPrice;
        
        if (priceRisk > 0.01 && priceRisk < 0.10) {
          const bos = detectBOS(klines, 'down');
          const hasBOS = bos.broken;
          const riskPerTrade = hasBOS ? CONFIG.riskWithBOS : CONFIG.riskWithoutBOS;
          
          state.position = {
            direction: 'short',
            entry: currentPrice,
            stopLoss: stopLoss,
            priceRisk: priceRisk,
            riskPerTrade: riskPerTrade,
            takeProfit: currentPrice - (currentPrice * priceRisk),
            entryTime: currentKline.time,
            zoneStrength: resistanceZone.strength,
            zoneFeatures: resistanceZone.features,
            hasBOS: hasBOS
          };
          
          console.log(`\n🎯 开仓 SHORT`);
          console.log(`  价格: $${currentPrice.toFixed(2)}`);
          console.log(`  止损: $${stopLoss.toFixed(2)} (风险${(priceRisk * 100).toFixed(2)}%)`);
          console.log(`  止盈: $${state.position.takeProfit.toFixed(2)}`);
          console.log(`  风险: ${(riskPerTrade * 100).toFixed(0)}%`);
          console.log(`  BOS: ${hasBOS ? 'YES' : 'NO'}`);
          console.log(`  强度: ${resistanceZone.strength}`);
          
          await sendNotification(`开仓 SHORT @ $${currentPrice.toFixed(2)}\n止损: $${stopLoss.toFixed(2)}\n止盈: $${state.position.takeProfit.toFixed(2)}\n风险: ${(riskPerTrade * 100).toFixed(0)}%\nBOS: ${hasBOS ? 'YES' : 'NO'}`);
          
          // 实盘模式：调用Binance API开仓
          if (binanceAPI) {
            try {
              const positionSize = state.balance * riskPerTrade / priceRisk;
              const quantity = (positionSize / currentPrice).toFixed(3);
              console.log(`  开仓数量: ${quantity} ${CONFIG.symbol}`);
              
              await binanceAPI.setLeverage(CONFIG.symbol, CONFIG.leverage);
              const order = await binanceAPI.marketOrder(CONFIG.symbol, "short", quantity);
              console.log(`  Binance订单: ${order.orderId}`);
              state.position.orderId = order.orderId;
            } catch (error) {
              console.error("Binance开仓失败:", error);
              await sendNotification(`⚠️ Binance开仓失败: ${error.message}`);
              state.position = null;
              saveState();
              return;
            }
          }
          
          saveState();
        }
      }
    }
    
  } catch (error) {
    console.error('检查交易信号时出错:', error);
  }
}

// ==================== 状态持久化 ====================

function saveState() {
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

function loadState() {
  if (fs.existsSync(CONFIG.stateFile)) {
    state = JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
    console.log(`已加载状态: 余额$${state.balance.toFixed(2)}, 持仓${state.position ? state.position.direction : '无'}`);
  }
}

// ==================== 通知系统 ====================

async function sendNotification(message) {
  const timestamp = new Date().toISOString();
  const content = `[${timestamp}] ${message}\n`;
  
  // 写入文件
  fs.appendFileSync(CONFIG.notificationFile, content);
  console.log(`通知已写入: ${CONFIG.notificationFile}`);
  
  // TODO: 集成Telegram通知
}

// ==================== 时间对齐 ====================

function calculateNextCheck() {
  const now = Date.now();
  const interval = CONFIG.interval === '1h' ? 60 * 60 * 1000 : 60 * 1000;
  const nextKlineTime = Math.ceil(now / interval) * interval;
  const nextCheckTime = nextKlineTime + CONFIG.klineDelay;
  
  return nextCheckTime;
}

async function mainLoop() {
  console.log('='.repeat(60));
  console.log(CONFIG.name);
  console.log('='.repeat(60));
  console.log(`模式: ${CONFIG.mode}`);
  console.log(`交易对: ${CONFIG.symbol}`);
  console.log(`周期: ${CONFIG.interval}`);
  console.log(`初始资金: $${CONFIG.initialBalance}`);
  console.log('='.repeat(60));
  
  loadState();
  
  while (true) {
    try {
      const nextCheck = calculateNextCheck();
      const now = Date.now();
      const waitTime = nextCheck - now;
      
      if (waitTime > 0) {
        console.log(`\n等待 ${Math.round(waitTime / 1000)} 秒到下次检查时间...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      await checkAndTrade();
      
    } catch (error) {
      console.error('主循环出错:', error);
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

// ==================== 启动 ====================

if (require.main === module) {
  mainLoop().catch(console.error);
}
