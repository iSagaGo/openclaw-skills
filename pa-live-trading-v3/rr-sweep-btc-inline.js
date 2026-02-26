#!/usr/bin/env node
/**
 * BTC单币种 RR扫描 1.0~2.0 步长0.1
 * 单进程内顺序执行，避免反复fork
 */
const { getKlinesFromCache } = require('../../kline-cache.js');
const { processBar } = require('./trading-engine.js');
const SIM_CONFIG = require('./config-simulation.js');

const leverage = 5;
const takerFee = 0.0005;
const initialBalance = 100;

const STRATEGY_CONFIG = {
  riskWithBOS: SIM_CONFIG.riskWithBOS,
  riskWithoutBOS: SIM_CONFIG.riskWithoutBOS,
  riskSOL: SIM_CONFIG.riskWithoutBOS,
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

// 加载一次K线数据
const klinesBTC = getKlinesFromCache('BTCUSDT', '1h', 180);
console.log(`BTC 1h: ${klinesBTC.length} 根K线`);
console.log('BTC RR扫描 | 180天 | 5x杠杆');
console.log('='.repeat(80));

function runOne(rr) {
  const config = { ...STRATEGY_CONFIG, leverage, takerFee, rrRatio: rr };
  let balance = initialBalance;
  const positions = {};
  const trades = [];
  let wins = 0, losses = 0;
  let peakProfitPct = 0;

  for (let i = 100; i < klinesBTC.length; i++) {
    const currentProfitPct = (balance - initialBalance) / initialBalance * 100;
    if (currentProfitPct > peakProfitPct) peakProfitPct = currentProfitPct;
    config.peakProfitPct = peakProfitPct;

    const klines = klinesBTC.slice(0, i + 1);
    const result = processBar({ symbol: 'BTCUSDT', klines, positions, balance, config, currentIdx: i });

    if (result.action === 'exit') {
      const d = result.data;
      balance += d.profit;
      if (d.pnl > 0) wins++; else losses++;
      trades.push({ ...d, balance });
      delete positions['BTCUSDT'];
    } else if (result.action === 'entry') {
      const d = result.data;
      positions[d.symbol] = { ...d.signal, symbol: d.symbol, allocation: d.allocation, entryIdx: d.entryIdx };
    }
  }

  // 回撤
  let peak = initialBalance, maxDD = 0, maxDDFrom = 0, maxDDTo = 0;
  let maxConsLoss = 0, cur = 0;
  for (const t of trades) {
    if (t.balance > peak) peak = t.balance;
    const dd = (peak - t.balance) / peak * 100;
    if (dd > maxDD) { maxDD = dd; maxDDFrom = peak; maxDDTo = t.balance; }
    if (t.pnl < 0) { cur++; maxConsLoss = Math.max(maxConsLoss, cur); } else cur = 0;
  }

  const ret = (balance - initialBalance) / initialBalance * 100;
  const ratio = maxDD > 0 ? ret / maxDD : 0;
  return { rr, total: wins + losses, wins, losses, ret, maxDD, maxDDFrom, maxDDTo, maxConsLoss, ratio, balance };
}

const results = [];
for (let rr = 1.0; rr <= 2.05; rr += 0.1) {
  rr = Math.round(rr * 10) / 10;
  const r = runOne(rr);
  results.push(r);
  const flag = r.ret === Math.max(...results.map(x => x.ret)) ? ' ⭐' : '';
  console.log(`RR ${rr.toFixed(1)} | ${r.total}次 | 胜率${(r.wins/r.total*100).toFixed(1)}% (${r.wins}胜${r.losses}负) | 收益${r.ret>=0?'+':''}${r.ret.toFixed(1)}% | 回撤${r.maxDD.toFixed(1)}% ($${r.maxDDFrom.toFixed(0)}→$${r.maxDDTo.toFixed(0)}) | 连亏${r.maxConsLoss} | 收益/回撤${r.ratio.toFixed(2)}${flag}`);
}

console.log('\n' + '='.repeat(80));
const best = results.reduce((a, b) => a.ret > b.ret ? a : b);
const safest = results.reduce((a, b) => a.maxDD < b.maxDD ? a : b);
const bestRatio = results.reduce((a, b) => a.ratio > b.ratio ? a : b);
console.log(`最高收益: RR ${best.rr.toFixed(1)} | +${best.ret.toFixed(1)}% | 回撤${best.maxDD.toFixed(1)}% | $${best.balance.toFixed(2)}`);
console.log(`最低回撤: RR ${safest.rr.toFixed(1)} | +${safest.ret.toFixed(1)}% | 回撤${safest.maxDD.toFixed(1)}%`);
console.log(`最佳收益/回撤: RR ${bestRatio.rr.toFixed(1)} | +${bestRatio.ret.toFixed(1)}% | 回撤${bestRatio.maxDD.toFixed(1)}% | 比值${bestRatio.ratio.toFixed(2)}`);
