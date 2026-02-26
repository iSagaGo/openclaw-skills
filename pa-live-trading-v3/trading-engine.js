/**
 * trading-engine.js — 统一交易引擎
 * 
 * 实盘和回测共用，不含任何 IO 操作（无 API 调用、无文件读写、无通知）
 * 所有副作用通过回调/返回值传递给调用方
 */

const { generateSignal } = require('./trading-functions.js');

// ==================== 检查出场 ====================

function checkExit(position, currentKline, rrRatio = 1.0) {
  let exitPrice = null;
  let exitReason = '';

  if (position.direction === 'long') {
    if (currentKline.low <= position.stopLoss) {
      exitPrice = position.stopLoss;
      exitReason = '触及止损位';
    } else {
      const maxPnl = (currentKline.high - position.entry) / position.entry;
      if (maxPnl >= position.priceRisk * rrRatio) {
        exitPrice = position.entry + (position.entry * position.priceRisk * rrRatio);
        exitReason = rrRatio === 1.0 ? '1比1止盈' : `${rrRatio}R止盈`;
      }
    }
  } else {
    if (currentKline.high >= position.stopLoss) {
      exitPrice = position.stopLoss;
      exitReason = '触及止损位';
    } else {
      const maxPnl = (position.entry - currentKline.low) / position.entry;
      if (maxPnl >= position.priceRisk * rrRatio) {
        exitPrice = position.entry - (position.entry * position.priceRisk * rrRatio);
        exitReason = rrRatio === 1.0 ? '1比1止盈' : `${rrRatio}R止盈`;
      }
    }
  }

  return { exitPrice, exitReason };
}

// ==================== 计算盈亏 ====================

function calculatePnL(position, exitPrice, balance, leverage, takerFee) {
  // P0-3: 边界条件检查，防止除零和NaN
  if (!position.priceRisk || position.priceRisk <= 0 || isNaN(position.priceRisk)) {
    console.error('calculatePnL: priceRisk异常:', position.priceRisk);
    return { pnl: 0, profit: 0, totalFee: 0 };
  }
  if (!position.riskPerTrade || position.riskPerTrade <= 0 || position.riskPerTrade > 1) {
    console.error('calculatePnL: riskPerTrade异常:', position.riskPerTrade);
    return { pnl: 0, profit: 0, totalFee: 0 };
  }
  if (!position.allocation || position.allocation <= 0 || position.allocation > 1) {
    console.error('calculatePnL: allocation异常:', position.allocation);
    return { pnl: 0, profit: 0, totalFee: 0 };
  }

  const pnl = position.direction === 'long'
    ? (exitPrice - position.entry) / position.entry
    : (position.entry - exitPrice) / position.entry;

  // 固定风险金额模型：仓位价值由 riskPerTrade/priceRisk 决定，杠杆只影响保证金
  const actualPositionValue = balance * position.allocation * position.riskPerTrade / position.priceRisk;
  // 上限检查：仓位价值不能超过 balance * allocation * leverage
  const maxPositionValue = balance * position.allocation * leverage;
  const cappedPositionValue = Math.min(actualPositionValue, maxPositionValue);
  const totalFee = cappedPositionValue * takerFee * 2; // 开仓+平仓
  const profit = cappedPositionValue * pnl - totalFee;

  return { pnl, profit, totalFee };
}

// ==================== 处理单个交易对 ====================

/**
 * 处理一个交易对的一根 K 线
 * 
 * @param {Object} params
 * @param {string} params.symbol - 交易对
 * @param {Array} params.klines - 到当前为止的所有 K 线
 * @param {Object} params.positions - 当前所有持仓 { symbol: position }
 * @param {number} params.balance - 当前余额
 * @param {Object} params.config - 交易配置 { leverage, takerFee, rrRatio, ... }
 * @param {number} [params.currentIdx] - 当前 K 线索引（回测用，实盘不传）
 * 
 * @returns {Object} { action, data }
 *   action: 'none' | 'exit' | 'entry'
 *   data: 出场/入场的详细信息
 */
function processBar(params) {
  const { symbol, klines, positions, balance, config, currentIdx } = params;
  const currentKline = klines[klines.length - 1];
  const position = positions[symbol];
  const rrRatio = config.rrRatio || 1.0;
  const leverage = config.leverage || 5;
  const takerFee = config.takerFee || 0.0005;

  // 有持仓 → 检查出场
  if (position) {
    // P1-5: 同步持仓标记为手动管理，跳过自动出场
    if (position.manualOnly) {
      return { action: 'none' };
    }

    // 回测模式：前瞻偏差保护
    if (currentIdx !== undefined && currentIdx <= position.entryIdx) {
      return { action: 'none' };
    }

    const { exitPrice, exitReason } = checkExit(position, currentKline, rrRatio);

    if (exitPrice) {
      const { pnl, profit, totalFee } = calculatePnL(
        position, exitPrice, balance, leverage, takerFee
      );

      return {
        action: 'exit',
        data: {
          symbol, position, exitPrice, exitReason,
          pnl, profit, fee: totalFee,
          exitTime: currentKline.time
        }
      };
    }

    return { action: 'none' };
  }

  // 无持仓 → 检查入场
  let usedAllocation = 0;
  for (const key in positions) {
    const alloc = positions[key].allocation;
    usedAllocation += (typeof alloc === 'number' && !isNaN(alloc)) ? alloc : 1.0;
  }
  const remainingAllocation = 1.0 - usedAllocation;

  if (remainingAllocation < 0.01) {
    return { action: 'none' };
  }

  const intervalKey = symbol === 'SOLUSDT' ? 'sol_1h' : `${symbol.replace('USDT','').toLowerCase()}_1h`;
  
  // 动态风险阶梯：初始3%，盈利每+10%风险+1%，底线3%，上限20%
  const initialBalance = config.initialBalance || 100;
  const profitPct = (balance - initialBalance) / initialBalance * 100;
  const peakProfitPct = config.peakProfitPct || 0; // 历史最高盈利百分比
  // 动态风险：初始5%，盈利每+10%加1%，上限10%
  // 盈利>=50%时锁定10%底线，盈利跌回50%以下则解除锁定，重新按阶梯算
  const minRisk = profitPct >= 50 ? 0.10 : 0.05;
  const baseRisk = Math.max(minRisk, Math.min(0.10, 0.05 + Math.floor(profitPct / 10) * 0.01));
  const dynamicConfig = {
    ...config,
    riskSOL: baseRisk,
    riskWithoutBOS: baseRisk,
    riskWithBOS: Math.min(baseRisk * 2, 0.20) // BOS双倍风险，上限20%
  };
  
  const signal = generateSignal(klines, intervalKey, dynamicConfig);

  if (signal) {
    // P0-3: 信号完整性验证
    if (!signal.entry || signal.entry <= 0 ||
        !signal.stopLoss || signal.stopLoss <= 0 ||
        !signal.priceRisk || signal.priceRisk <= 0 || signal.priceRisk > 0.15 ||
        !signal.riskPerTrade || signal.riskPerTrade <= 0 || signal.riskPerTrade > 0.25) {
      console.error('信号数据异常，已拒绝:', JSON.stringify({ entry: signal.entry, stopLoss: signal.stopLoss, priceRisk: signal.priceRisk, riskPerTrade: signal.riskPerTrade }));
      return { action: 'none' };
    }
    // 验证止损方向
    if (signal.direction === 'long' && signal.stopLoss >= signal.entry) {
      console.error('做多信号止损异常（应低于入场价）:', signal.stopLoss, '>=', signal.entry);
      return { action: 'none' };
    }
    if (signal.direction === 'short' && signal.stopLoss <= signal.entry) {
      console.error('做空信号止损异常（应高于入场价）:', signal.stopLoss, '<=', signal.entry);
      return { action: 'none' };
    }

    return {
      action: 'entry',
      data: {
        symbol,
        signal,
        allocation: remainingAllocation,
        entryIdx: currentIdx,
        entryTime: currentKline.time
      }
    };
  }

  return { action: 'none' };
}

module.exports = { checkExit, calculatePnL, processBar };
