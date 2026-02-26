module.exports = {
  // 交易配置
  symbol: 'BTCUSDT',
  interval: '1h',
  initialBalance: 100,
  leverage: 5,
  mode: 'simulation', // 'simulation' or 'real'
  name: 'PA Live Trading V3',
  
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
  
  // 时间同步配置
  klineDelay: 15 * 1000,  // K线完成后延迟15秒
  checkInterval: 60 * 1000, // 检查间隔60秒
  maxRetries: 3,
  
  // Binance API配置（从环境变量读取）
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: false
  }
};
