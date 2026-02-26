/**
 * daily-report.js — 每日报告生成
 *
 * 可被 cron / heartbeat 调用，生成纯文本报告（适合 Telegram）。
 * 不直接发送通知，返回报告字符串。
 */

const tradeStats = require('./trade-stats.js');
const alertSystem = require('./alert-system.js');
const fs = require('fs');
const path = require('path');

// ==================== 报告生成 ====================

/**
 * 生成每日报告
 * @param {string} mode - simulation / real
 * @returns {string} 报告文本
 */
function generateReport(mode) {
  const trades = tradeStats.loadTrades(mode);
  const rolling = tradeStats.getRollingComparison(mode);
  const drawdown = tradeStats.getDrawdown(mode);
  const consecutiveLosses = tradeStats.getConsecutiveLosses(mode);
  const alert = alertSystem.checkAlerts(mode);

  // 今日交易（UTC 当天）
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayTrades = trades.filter(t => new Date(t.time) >= todayStart);
  const todayWins = todayTrades.filter(t => t.profit > 0).length;
  const todayLosses = todayTrades.length - todayWins;
  const todayProfit = todayTrades.reduce((s, t) => s + t.profit, 0);

  // 当前余额：优先从 state 文件读取，其次从 trades 推算
  let lastBalance = 0;
  try {
    const stateFile = path.join(__dirname, `data-${mode}`, 'live-state.json');
    if (fs.existsSync(stateFile)) {
      const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      lastBalance = st.balance || 0;
    }
  } catch (e) {}
  if (!lastBalance && trades.length > 0) {
    lastBalance = trades[trades.length - 1].balance;
  }

  // 模式前缀
  const prefix = mode === 'real' ? '📊 实盘日报' : '📊 模拟日报';
  const date = new Date().toISOString().slice(0, 10);

  const lines = [
    `${prefix} (${date})`,
    '─'.repeat(20),
    '',
    `📈 今日交易: ${todayTrades.length}笔，${todayWins}胜${todayLosses}负`,
    `💰 今日盈亏: ${todayProfit >= 0 ? '+' : ''}$${todayProfit.toFixed(2)}`,
    '',
    `📊 7天胜率: ${(rolling['7d'].winRate * 100).toFixed(1)}%` +
      ` (vs 30天 ${(rolling['30d'].winRate * 100).toFixed(1)}%)`,
    `📊 7天交易: ${rolling['7d'].count}笔，盈利 ${rolling['7d'].totalProfit >= 0 ? '+' : ''}$${rolling['7d'].totalProfit.toFixed(2)}`,
    `📊 盈亏比: ${rolling['7d'].profitFactor === Infinity ? '∞' : rolling['7d'].profitFactor.toFixed(2)}`,
    '',
    `💼 当前余额: $${lastBalance.toFixed(2)}`,
    `📉 当前回撤: ${(drawdown.currentDrawdown * 100).toFixed(1)}%`,
    `📉 最大回撤: ${(drawdown.maxDrawdown * 100).toFixed(1)}%`,
    `🔻 连续亏损: ${consecutiveLosses}次`,
    '',
    `${alert.emoji} 预警状态: ${formatLevel(alert.level)}`
  ];

  // 有预警原因时附加
  if (alert.reasons.length > 0) {
    lines.push('原因:');
    alert.reasons.forEach(r => lines.push(`  - ${r}`));
  }

  // 全部统计摘要
  lines.push('');
  lines.push(`📋 累计: ${rolling['all'].count}笔，胜率 ${(rolling['all'].winRate * 100).toFixed(1)}%，总盈亏 ${rolling['all'].totalProfit >= 0 ? '+' : ''}$${rolling['all'].totalProfit.toFixed(2)}`);

  return lines.join('\n');
}

/**
 * 预警等级中文名
 */
function formatLevel(level) {
  const map = {
    normal: '正常',
    yellow: '⚠️ 警告',
    red: '🚨 危险',
    pause: '🛑 建议暂停'
  };
  return map[level] || level;
}

// ==================== 导出 ====================

module.exports = { generateReport };
