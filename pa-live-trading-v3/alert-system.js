/**
 * alert-system.js — 预警机制
 *
 * 每次平仓后调用 checkAlerts()，根据统计数据判断预警等级。
 * 不直接发通知，通过回调函数通知调用方。
 *
 * 预警等级：
 *   🟢 normal  — 正常
 *   🟡 yellow  — 黄色预警（需关注）
 *   🔴 red     — 红色预警（需干预）
 *   ⛔ pause   — 建议暂停交易
 */

const tradeStats = require('./trade-stats.js');

// ==================== 预警阈值 ====================

const THRESHOLDS = {
  yellow: {
    winRate7d: 0.45,       // 7天胜率 < 45%
    consecutiveLosses: 3,  // 连续亏损 >= 3次
    drawdown: 0.10         // 回撤 > 10%
  },
  red: {
    winRate7d: 0.40,       // 7天胜率 < 40%
    consecutiveLosses: 5,  // 连续亏损 >= 5次
    drawdown: 0.15         // 回撤 > 15%
  },
  pause: {
    winRate7d: 0.35,       // 7天胜率 < 35%
    consecutiveLosses: 7,  // 连续亏损 >= 7次
    drawdown: 0.20         // 回撤 > 20%
  }
};

// ==================== 预警检查 ====================

/**
 * 检查预警状态
 * @param {string} mode - simulation / real
 * @param {Function} [onAlert] - 回调 (level, reasons) => void
 * @returns {{ level: string, reasons: string[], emoji: string }}
 */
function checkAlerts(mode, onAlert) {
  const stats7d = tradeStats.getStats(mode, 7);
  const drawdown = tradeStats.getDrawdown(mode);
  const consecutiveLosses = tradeStats.getConsecutiveLosses(mode);

  const reasons = [];
  let level = 'normal';

  // 检查暂停条件（最严重）
  if (checkLevel('pause', stats7d, drawdown, consecutiveLosses, reasons)) {
    level = 'pause';
  }
  // 检查红色预警
  else if (checkLevel('red', stats7d, drawdown, consecutiveLosses, reasons)) {
    level = 'red';
  }
  // 检查黄色预警
  else if (checkLevel('yellow', stats7d, drawdown, consecutiveLosses, reasons)) {
    level = 'yellow';
  }

  const emojiMap = {
    normal: '🟢',
    yellow: '🟡',
    red: '🔴',
    pause: '⛔'
  };

  const result = {
    level,
    reasons,
    emoji: emojiMap[level] || '🟢'
  };

  // 有预警时调用回调
  if (level !== 'normal' && typeof onAlert === 'function') {
    onAlert(level, reasons, result);
  }

  return result;
}

/**
 * 检查某个等级的条件是否触发
 */
function checkLevel(levelName, stats7d, drawdown, consecutiveLosses, reasons) {
  const t = THRESHOLDS[levelName];
  let triggered = false;

  // 至少有3笔交易才检查胜率
  if (stats7d.count >= 3 && stats7d.winRate < t.winRate7d) {
    reasons.push(`7天胜率 ${(stats7d.winRate * 100).toFixed(1)}% < ${(t.winRate7d * 100)}%`);
    triggered = true;
  }

  if (consecutiveLosses >= t.consecutiveLosses) {
    reasons.push(`连续亏损 ${consecutiveLosses}次 >= ${t.consecutiveLosses}次`);
    triggered = true;
  }

  if (drawdown.currentDrawdown > t.drawdown) {
    reasons.push(`当前回撤 ${(drawdown.currentDrawdown * 100).toFixed(1)}% > ${(t.drawdown * 100)}%`);
    triggered = true;
  }

  return triggered;
}

// ==================== 生成预警消息 ====================

/**
 * 生成预警消息文本（适合 Telegram）
 */
function formatAlertMessage(alertResult) {
  const { level, reasons, emoji } = alertResult;

  const levelNames = {
    normal: '正常',
    yellow: '⚠️ 黄色预警',
    red: '🚨 红色预警',
    pause: '🛑 建议暂停交易'
  };

  let msg = `${emoji} 预警状态: ${levelNames[level]}`;
  if (reasons.length > 0) {
    msg += '\n原因:\n' + reasons.map(r => `  - ${r}`).join('\n');
  }
  return msg;
}

// ==================== 导出 ====================

module.exports = {
  checkAlerts,
  formatAlertMessage,
  THRESHOLDS
};
