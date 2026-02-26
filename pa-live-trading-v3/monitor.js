#!/usr/bin/env node
/**
 * PA Live Trading V3 - 监控脚本
 * 
 * 每日统计报告
 */

const fs = require('fs');
const path = require('path');

// 读取状态文件
function loadState(mode) {
  const stateFile = path.join(__dirname, `data-${mode}/live-state.json`);
  if (fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  }
  return null;
}

// 生成监控报告
function generateReport(mode) {
  const state = loadState(mode);
  if (!state) {
    return `${mode} 模式：无状态数据`;
  }
  
  const winRate = state.stats.totalTrades > 0 
    ? (state.stats.wins / state.stats.totalTrades * 100).toFixed(2) 
    : 0;
  
  const avgPnL = state.stats.totalTrades > 0
    ? (state.stats.totalPnL / state.stats.totalTrades).toFixed(2)
    : 0;
  
  let report = `\n【${mode.toUpperCase()} 模式】\n`;
  report += `余额: $${state.balance.toFixed(2)}\n`;
  report += `持仓: ${state.position ? state.position.direction.toUpperCase() : '无'}\n`;
  report += `总交易: ${state.stats.totalTrades}次\n`;
  report += `胜率: ${winRate}% (${state.stats.wins}胜 ${state.stats.losses}负)\n`;
  report += `总盈亏: $${state.stats.totalPnL.toFixed(2)}\n`;
  report += `平均盈亏: $${avgPnL}\n`;
  
  if (state.position) {
    report += `\n当前持仓:\n`;
    report += `  方向: ${state.position.direction.toUpperCase()}\n`;
    report += `  入场: $${state.position.entry.toFixed(2)}\n`;
    report += `  止损: $${state.position.stopLoss.toFixed(2)}\n`;
    report += `  止盈: $${state.position.takeProfit.toFixed(2)}\n`;
    report += `  风险: ${(state.position.riskPerTrade * 100).toFixed(0)}%\n`;
    report += `  BOS: ${state.position.hasBOS ? 'YES' : 'NO'}\n`;
  }
  
  return report;
}

// 生成警告
function generateAlerts(mode) {
  const state = loadState(mode);
  if (!state) return [];
  
  const alerts = [];
  
  // 胜率警告
  if (state.stats.totalTrades >= 10) {
    const winRate = state.stats.wins / state.stats.totalTrades;
    if (winRate < 0.5) {
      alerts.push(`⚠️ 胜率低于50% (${(winRate * 100).toFixed(2)}%)`);
    }
  }
  
  // 连续亏损警告
  if (state.stats.losses >= 3) {
    alerts.push(`🚨 连续${state.stats.losses}次亏损`);
  }
  
  // 余额警告
  const initialBalance = mode === 'simulation' ? 100 : 50;
  const drawdown = (initialBalance - state.balance) / initialBalance;
  if (drawdown > 0.2) {
    alerts.push(`🔴 回撤超过20% (${(drawdown * 100).toFixed(2)}%)`);
  }
  
  return alerts;
}

// 主函数
function main() {
  console.log('='.repeat(60));
  console.log('PA Live Trading V3 - 监控报告');
  console.log('='.repeat(60));
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  
  // 模拟模式报告
  const simReport = generateReport('simulation');
  console.log(simReport);
  
  // 实盘模式报告
  const realReport = generateReport('real');
  console.log(realReport);
  
  // 警告
  const simAlerts = generateAlerts('simulation');
  const realAlerts = generateAlerts('real');
  
  if (simAlerts.length > 0 || realAlerts.length > 0) {
    console.log('\n【警告】');
    if (simAlerts.length > 0) {
      console.log('模拟模式:');
      simAlerts.forEach(alert => console.log(`  ${alert}`));
    }
    if (realAlerts.length > 0) {
      console.log('实盘模式:');
      realAlerts.forEach(alert => console.log(`  ${alert}`));
    }
  }
  
  console.log('='.repeat(60));
}

if (require.main === module) {
  main();
}

module.exports = { generateReport, generateAlerts };
