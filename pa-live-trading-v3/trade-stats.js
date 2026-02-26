/**
 * trade-stats.js — 交易记录持久化 & 滚动窗口统计
 *
 * 职责：
 *   1. 追加写入每笔交易到 data-{mode}/trades.json
 *   2. 提供 getStats / getRollingComparison / getDrawdown / getConsecutiveLosses
 *
 * 不含任何通知逻辑，纯数据层。
 */

const fs = require('fs');
const path = require('path');

// ==================== 文件路径 ====================

function tradesFile(mode) {
  return path.join(__dirname, `data-${mode}`, 'trades.json');
}

// ==================== 读写交易记录 ====================

/**
 * 读取所有交易记录
 */
function loadTrades(mode) {
  const file = tradesFile(mode);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('读取 trades.json 失败:', e.message);
    return [];
  }
}

/**
 * 追加一笔交易记录
 * @param {string} mode - simulation / real
 * @param {Object} trade - 交易详情
 * @returns {Object} 写入的完整记录
 */
function recordTrade(mode, trade) {
  const trades = loadTrades(mode);
  const record = {
    id: trades.length + 1,
    time: trade.time || new Date().toISOString(),
    symbol: trade.symbol,
    direction: trade.direction,
    entry: trade.entry,
    exit: trade.exit,
    pnlPct: trade.pnlPct,       // 盈亏百分比（如 0.02 = 2%）
    profit: trade.profit,         // 利润 $
    balance: trade.balance,       // 平仓后余额
    hasBOS: trade.hasBOS || false,
    rr: trade.rr || 0,           // 实际盈亏比
    exitReason: trade.exitReason || '',
    entryTime: trade.entryTime || null  // 开仓时间（用于统计持仓时间）
  };

  trades.push(record);

  // 确保目录存在
  const dir = path.dirname(tradesFile(mode));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tmpFile = tradesFile(mode) + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(trades, null, 2));
  fs.renameSync(tmpFile, tradesFile(mode));
  return record;
}

// ==================== 统计函数 ====================

/**
 * 过滤最近 N 天的交易
 */
function filterByDays(trades, days) {
  if (!days) return trades;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return trades.filter(t => new Date(t.time).getTime() >= cutoff);
}

/**
 * 计算一组交易的统计数据
 */
function calcStats(trades) {
  if (trades.length === 0) {
    return { count: 0, wins: 0, losses: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, totalProfit: 0 };
  }

  const wins = trades.filter(t => t.profit > 0);
  const losses = trades.filter(t => t.profit <= 0);
  const totalWin = wins.reduce((s, t) => s + t.profit, 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));

  return {
    count: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    avgWin: wins.length > 0 ? totalWin / wins.length : 0,
    avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
    profitFactor: totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0,
    totalProfit: trades.reduce((s, t) => s + t.profit, 0)
  };
}

/**
 * 获取最近 N 天的统计
 * @param {string} mode
 * @param {number} [days] - 不传则统计全部
 */
function getStats(mode, days) {
  const trades = loadTrades(mode);
  const filtered = filterByDays(trades, days);
  return calcStats(filtered);
}

/**
 * 滚动对比：7天 vs 30天 vs 全部
 */
function getRollingComparison(mode) {
  const trades = loadTrades(mode);
  return {
    '7d': calcStats(filterByDays(trades, 7)),
    '30d': calcStats(filterByDays(trades, 30)),
    'all': calcStats(trades)
  };
}

/**
 * 计算回撤
 * @returns {{ currentDrawdown: number, maxDrawdown: number, peakBalance: number }}
 */
function getDrawdown(mode) {
  const trades = loadTrades(mode);
  if (trades.length === 0) {
    return { currentDrawdown: 0, maxDrawdown: 0, peakBalance: 0 };
  }

  let peak = trades[0].balance - trades[0].profit; // 第一笔交易前的余额
  let maxDD = 0;

  for (const t of trades) {
    if (t.balance > peak) peak = t.balance;
    const dd = (peak - t.balance) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastBalance = trades[trades.length - 1].balance;
  const currentDD = peak > 0 ? (peak - lastBalance) / peak : 0;

  return {
    currentDrawdown: currentDD,
    maxDrawdown: maxDD,
    peakBalance: peak
  };
}

/**
 * 当前连续亏损次数
 */
function getConsecutiveLosses(mode) {
  const trades = loadTrades(mode);
  let count = 0;
  // 从最后一笔往前数
  for (let i = trades.length - 1; i >= 0; i--) {
    if (trades[i].profit <= 0) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

// ==================== 导出 ====================

module.exports = {
  loadTrades,
  recordTrade,
  getStats,
  getRollingComparison,
  getDrawdown,
  getConsecutiveLosses
};
