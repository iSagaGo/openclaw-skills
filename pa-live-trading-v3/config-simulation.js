module.exports = {
  // 模式
  mode: 'simulation',
  name: 'PA Live Trading V3 - Simulation',
  
  // 交易配置（双币种）
  strategies: [
    { symbol: 'BTCUSDT', interval: '1h', name: 'BTC 1h' }
  ],
  initialBalance: 100,
  leverage: 5, // 5倍杠杆
  rrRatio: 1.4, // 盈亏比（稳健选择：76%胜率+回撤25.4%）
  
  // 策略配置
  riskWithBOS: 0.04,      // 有BOS：4%风险
  riskWithoutBOS: 0.02,   // 无BOS：2%风险
  
  // 增强配置
  rapidMoveThreshold: 0.02,
  historicalLookback: 100,
  touchTolerance: 0.01,
  
  // BOS配置
  bosLookback: 20,
  minBreakAmount: 0.001,
  requireCloseConfirm: true,
  
  // 风控配置
  riskControl: {
    dailyMaxLossPct: 15,        // 单日最大亏损百分比，超过暂停开仓
    maxDrawdownPct: 30,          // 总回撤熔断百分比（从峰值），超过暂停开仓
    maxSingleLossPct: 8,         // 单笔最大亏损百分比（跳空保护）
    apiFailThreshold: 3,         // 连续API失败次数，超过暂停开仓
    balanceDeviationPct: 5,      // 本地与Binance余额偏差百分比，超过发警报
    priceAnomalyPct: 10,         // K线价格异常变化百分比，超过跳过开仓
    circuitBreakerCooldownMin: 60, // 熔断后冷却时间（分钟），到期自动恢复检查但不自动恢复交易
  },

  // 止损/手续费配置
  slBuffer: 0.0015,
  takerFee: 0.0005,
  
  // 时间同步配置
  klineDelay: 15 * 1000,  // K线完成后延迟15秒
  checkInterval: 60 * 1000, // 检查间隔60秒
  maxRetries: 3,
  
  // 通知配置
  notificationFile: './notification-simulation.txt',
  stateFile: './state-simulation.json',
  
  // Binance API配置（模拟模式不需要）
  binance: null
};
