#!/usr/bin/env node
/**
 * backtest-runner.js — 统一回测入口
 * 
 * 使用 trading-engine.js（与实盘完全相同的引擎）
 * 只负责：加载缓存K线 → 逐根喂入引擎 → 收集结果 → 输出报告
 * 
 * 用法:
 *   node backtest-runner.js                      # 默认 SOL+BTC 180天 RR1.0
 *   node backtest-runner.js --btc-only           # 仅 BTC
 *   node backtest-runner.js --sol-only           # 仅 SOL
 *   node backtest-runner.js --rr 1.7             # 指定盈亏比
 *   node backtest-runner.js --days 360           # 指定天数
 *   node backtest-runner.js --drawdown           # 显示回撤分析
 *   node backtest-runner.js --rr-sweep           # 盈亏比扫描 1.0~2.0
 *   node backtest-runner.js --rr-sweep --drawdown # 扫描+回撤
 */

const { getKlinesFromCache } = require('../../kline-cache.js');
const { processBar } = require('./trading-engine.js');

// ==================== 参数解析 ====================

const args = process.argv.slice(2);
const btcOnly = args.includes('--btc-only');
const solOnly = args.includes('--sol-only');
const rrIdx = args.indexOf('--rr');
const rrRatio = rrIdx >= 0 ? parseFloat(args[rrIdx + 1]) : 1.6;
const daysIdx = args.indexOf('--days');
const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1]) : 180;
const showDrawdown = args.includes('--drawdown');
const rrSweep = args.includes('--rr-sweep');

const leverage = 5;
const takerFee = 0.0005;
const initialBalance = 100;

function getStrategies() {
  const s = [];
  if (!btcOnly) s.push({ symbol: 'SOLUSDT', interval: '1h', name: 'SOL 1h' });
  if (!solOnly) s.push({ symbol: 'BTCUSDT', interval: '1h', name: 'BTC 1h' });
  return s;
}

// ==================== 策略配置（从 config-simulation.js 加载，保持同步） ====================

const SIM_CONFIG = require('./config-simulation.js');
const STRATEGY_CONFIG = {
  riskWithBOS: SIM_CONFIG.riskWithBOS,
  riskWithoutBOS: SIM_CONFIG.riskWithoutBOS,
  riskSOL: SIM_CONFIG.riskWithoutBOS,  // SOL 固定使用无BOS风险
  rapidMoveThreshold: SIM_CONFIG.rapidMoveThreshold,
  historicalLookback: SIM_CONFIG.historicalLookback,
  touchTolerance: SIM_CONFIG.touchTolerance,
  bosLookback: SIM_CONFIG.bosLookback,
  minBreakAmount: SIM_CONFIG.minBreakAmount,
  requireCloseConfirm: SIM_CONFIG.requireCloseConfirm,
  slBuffer: SIM_CONFIG.slBuffer,
  takerFee: SIM_CONFIG.takerFee,
  rrRatio: SIM_CONFIG.rrRatio
};

// ==================== 单次回测 ====================

function runBacktest(rr, strategies) {
  const klinesMap = {};
  let minLen = Infinity;
  for (const s of strategies) {
    klinesMap[s.symbol] = getKlinesFromCache(s.symbol, s.interval, days);
    if (!rrSweep) console.log(`${s.name}: ${klinesMap[s.symbol].length} 根`);
    minLen = Math.min(minLen, klinesMap[s.symbol].length);
  }

  const config = { ...STRATEGY_CONFIG, leverage, takerFee, rrRatio: rr };
  let balance = initialBalance;
  const positions = {};
  const trades = [];
  const stats = { totalTrades: 0, wins: 0, losses: 0, bySymbol: {} };
  let peakProfitPct = 0;
  for (const s of strategies) {
    stats.bySymbol[s.symbol] = { trades: 0, wins: 0, losses: 0, pnl: 0 };
  }

  for (let i = 100; i < minLen; i++) {
    // 更新历史最高盈利
    const currentProfitPct = (balance - initialBalance) / initialBalance * 100;
    if (currentProfitPct > peakProfitPct) peakProfitPct = currentProfitPct;
    config.peakProfitPct = peakProfitPct;

    for (const strategy of strategies) {
      const { symbol } = strategy;
      const klines = klinesMap[symbol].slice(0, i + 1);

      const result = processBar({
        symbol, klines, positions, balance, config, currentIdx: i
      });

      if (result.action === 'exit') {
        const d = result.data;
        balance += d.profit;
        stats.totalTrades++;
        stats.bySymbol[d.symbol].trades++;
        if (d.pnl > 0) { stats.wins++; stats.bySymbol[d.symbol].wins++; }
        else { stats.losses++; stats.bySymbol[d.symbol].losses++; }
        stats.bySymbol[d.symbol].pnl += d.profit;

        trades.push({
          ...d, balance,
          hasBOS: d.position.hasBOS,
          allocation: d.position.allocation,
          riskPerTrade: d.position.riskPerTrade,
          priceRisk: d.position.priceRisk,
          direction: d.position.direction
        });
        delete positions[symbol];
      } else if (result.action === 'entry') {
        const d = result.data;
        positions[d.symbol] = {
          ...d.signal, symbol: d.symbol,
          allocation: d.allocation, entryIdx: d.entryIdx
        };
      }
    }
  }

  return { balance, trades, stats };
}

// ==================== 回撤计算 ====================

function calcDrawdown(trades) {
  let peak = initialBalance, maxDD = 0, maxDDFrom = 0, maxDDTo = 0;
  let maxConsLoss = 0, curCons = 0;
  for (const t of trades) {
    if (t.balance > peak) peak = t.balance;
    const dd = (peak - t.balance) / peak * 100;
    if (dd > maxDD) { maxDD = dd; maxDDFrom = peak; maxDDTo = t.balance; }
    if (t.pnl < 0) { curCons++; maxConsLoss = Math.max(maxConsLoss, curCons); }
    else curCons = 0;
  }
  return { maxDD, maxDDFrom, maxDDTo, maxConsLoss, peak };
}

// ==================== 输出报告 ====================

function printReport(result, rr, strategies) {
  const { balance, trades, stats } = result;
  console.log('\n' + '='.repeat(60));

  for (const s of strategies) {
    const st = stats.bySymbol[s.symbol];
    if (st.trades > 0) {
      console.log(`\n【${s.name}】`);
      console.log(`交易次数: ${st.trades}`);
      console.log(`胜率: ${(st.wins / st.trades * 100).toFixed(1)}% (${st.wins}胜 ${st.losses}负)`);
      console.log(`盈亏: $${st.pnl.toFixed(2)}`);
    }
  }

  const totalFee = trades.reduce((s, t) => s + t.fee, 0);
  console.log(`\n【总体结果】`);
  console.log(`交易次数: ${stats.totalTrades}`);
  console.log(`胜率: ${(stats.wins / stats.totalTrades * 100).toFixed(1)}% (${stats.wins}胜 ${stats.losses}负)`);
  console.log(`初始资金: $${initialBalance}`);
  console.log(`最终资金: $${balance.toFixed(2)}`);
  console.log(`总收益: ${((balance - initialBalance) / initialBalance * 100).toFixed(1)}%`);
  console.log(`手续费: $${totalFee.toFixed(2)}`);

  const full = trades.filter(t => t.allocation >= 0.99);
  const partial = trades.filter(t => t.allocation < 0.99);
  console.log(`\n【资金分配】`);
  console.log(`全仓: ${full.length}次 | 部分仓位: ${partial.length}次`);

  const withBOS = trades.filter(t => t.hasBOS);
  const noBOS = trades.filter(t => !t.hasBOS);
  console.log(`\n【BOS统计】`);
  console.log(`有BOS: ${withBOS.length}次, 胜率${withBOS.length > 0 ? (withBOS.filter(t => t.pnl > 0).length / withBOS.length * 100).toFixed(1) : 0}%`);
  console.log(`无BOS: ${noBOS.length}次, 胜率${noBOS.length > 0 ? (noBOS.filter(t => t.pnl > 0).length / noBOS.length * 100).toFixed(1) : 0}%`);

  if (showDrawdown) {
    const dd = calcDrawdown(trades);
    console.log(`\n【回撤分析】`);
    console.log(`最大回撤: ${dd.maxDD.toFixed(1)}% ($${dd.maxDDFrom.toFixed(0)} → $${dd.maxDDTo.toFixed(0)})`);
    console.log(`最大连续亏损: ${dd.maxConsLoss}次`);
    console.log(`峰值: $${dd.peak.toFixed(2)}`);
  }

  console.log('\n' + '='.repeat(60));
}

// ==================== RR 扫描 ====================

function runSweep(strategies) {
  console.log('\nRR扫描: 1.0 ~ 2.0 (步长0.1)\n');
  const results = [];

  for (let rr = 1.0; rr <= 2.05; rr += 0.1) {
    rr = Math.round(rr * 10) / 10;
    const result = runBacktest(rr, strategies);
    const dd = calcDrawdown(result.trades);
    const ret = ((result.balance - initialBalance) / initialBalance * 100);
    const ratio = dd.maxDD > 0 ? (ret / dd.maxDD) : 0;

    results.push({ rr, ...result, dd, ret, ratio });

    const flag = ret === Math.max(...results.map(r => r.ret)) ? ' ⭐' : '';
    console.log(`RR ${rr.toFixed(1)} | ${result.stats.totalTrades}次 | 胜率${(result.stats.wins / result.stats.totalTrades * 100).toFixed(1)}% | 收益${ret >= 0 ? '+' : ''}${ret.toFixed(1)}% | 回撤${dd.maxDD.toFixed(1)}% | 连亏${dd.maxConsLoss} | 收益/回撤${ratio.toFixed(2)}${flag}`);
  }

  const best = results.reduce((a, b) => a.ret > b.ret ? a : b);
  const safest = results.reduce((a, b) => a.dd.maxDD < b.dd.maxDD ? a : b);
  const bestRatio = results.reduce((a, b) => a.ratio > b.ratio ? a : b);

  console.log(`\n最高收益: RR ${best.rr} (+${best.ret.toFixed(1)}%)`);
  console.log(`最低回撤: RR ${safest.rr} (${safest.dd.maxDD.toFixed(1)}%)`);
  console.log(`最佳收益/回撤: RR ${bestRatio.rr} (${bestRatio.ratio.toFixed(2)})`);
}

// ==================== 启动 ====================

const strategies = getStrategies();

if (rrSweep) {
  console.log(`实盘引擎回测 | ${strategies.map(s => s.name).join(' + ')} | ${days}天 | ${leverage}x`);
  console.log('='.repeat(60));
  runSweep(strategies);
} else {
  console.log(`实盘引擎回测 | ${strategies.map(s => s.name).join(' + ')} | ${days}天 | ${leverage}x | RR ${rrRatio}`);
  console.log('='.repeat(60));
  const result = runBacktest(rrRatio, strategies);
  printReport(result, rrRatio, strategies);
}
