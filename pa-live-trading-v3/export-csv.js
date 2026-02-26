// 从backtest-dual.js导出CSV
const { getKlinesFromCache } = require('../../kline-cache.js');

// 运行回测
const backtest = require('./backtest-dual.js');

// 等待回测完成后导出
setTimeout(() => {
  console.log('回测完成，开始导出CSV...');
}, 5000);
