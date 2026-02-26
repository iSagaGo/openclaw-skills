#!/usr/bin/env node
/**
 * 币安API模块
 * 提供合约交易功能
 */

const Binance = require('binance-api-node').default;
const fs = require('fs');
const crypto = require('crypto');

// 币种精度配置
const SYMBOL_PRECISION = {
  'BTCUSDT': { price: 1, quantity: 3 },
  'SOLUSDT': { price: 2, quantity: 1 },
  'ETHUSDT': { price: 2, quantity: 3 }
};

function getPrecision(symbol) {
  return SYMBOL_PRECISION[symbol] || { price: 2, quantity: 3 };
}

class BinanceAPI {
  constructor(configPath = null) {
    // 从配置文件加载API密钥
    if (configPath) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      this.apiKey = config.apiKey;
      this.apiSecret = config.apiSecret;
    } else {
      // 从vault加载
      const vaultPath = '/root/.openclaw/workspace/vault/binance-api.json';
      if (fs.existsSync(vaultPath)) {
        const config = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
        this.apiKey = config.apiKey;
        this.apiSecret = config.apiSecret;
      }
    }
    
    // 初始化币安客户端
    this.client = Binance({
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
      futures: true  // 使用合约API
    });
  }
  
  /**
   * 标准化交易对名称
   */
  normalizeSymbol(symbol) {
    // SOL -> SOLUSDT, BTC -> BTCUSDT
    if (!symbol.includes('USDT')) {
      return symbol.toUpperCase() + 'USDT';
    }
    return symbol.toUpperCase();
  }
  
  /**
   * 下单
   * @param {string} symbol - 交易对（如'SOLUSDT'）
   * @param {string} side - 方向（'BUY' 或 'SELL'）
   * @param {number} quantity - 数量
   * @param {number} price - 价格（限价单）
   * @param {string} type - 订单类型（'LIMIT' 或 'MARKET'）
   */
  async placeOrder(symbol, side, quantity, price = null, type = 'LIMIT') {
    try {
      symbol = this.normalizeSymbol(symbol);
      
      const order = {
        symbol: symbol,
        side: side.toUpperCase(),
        type: type,
        quantity: quantity.toString()
      };
      
      if (type === 'LIMIT') {
        order.price = price.toString();
        order.timeInForce = 'GTC';  // Good til canceled
      }
      
      const result = await this.client.futuresOrder(order);
      
      return {
        success: true,
        orderId: result.orderId,
        symbol: result.symbol,
        side: result.side,
        price: result.price,
        quantity: result.origQty,
        status: result.status
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 市价单
   */
  async marketOrder(symbol, side, quantity) {
    // 转换side参数：long -> BUY, short -> SELL
    const binanceSide = side.toLowerCase() === 'long' ? 'BUY' : 'SELL';
    return this.placeOrder(symbol, binanceSide, quantity, null, 'MARKET');
  }
  
  /**
   * 取消订单
   */
  async cancelOrder(symbol, orderId) {
    try {
      symbol = this.normalizeSymbol(symbol);
      
      const result = await this.client.futuresCancelOrder({
        symbol: symbol,
        orderId: orderId
      });
      
      return {
        success: true,
        orderId: result.orderId,
        status: result.status
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 取消某币种所有挂单
   */
  async cancelAllOrders(symbol) {
    try {
      symbol = this.normalizeSymbol(symbol);
      
      // 取消普通挂单
      const result = await this.client.futuresCancelAllOpenOrders({
        symbol: symbol
      });
      
      // 同时取消 Algo 挂单
      try {
        await this.cancelAllAlgoOrders(symbol);
      } catch (algoErr) {
        console.error('取消Algo挂单失败:', algoErr.message);
      }
      
      return {
        success: true,
        result: result
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 获取持仓
   */
  async getPositions() {
    try {
      const positions = await this.client.futuresPositionRisk();
      
      // 过滤出有持仓的
      const activePositions = positions
        .filter(pos => parseFloat(pos.positionAmt) !== 0)
        .map(pos => ({
          symbol: pos.symbol,
          side: parseFloat(pos.positionAmt) > 0 ? 'LONG' : 'SHORT',
          size: Math.abs(parseFloat(pos.positionAmt)),
          entryPrice: parseFloat(pos.entryPrice),
          markPrice: parseFloat(pos.markPrice),
          unrealizedPnl: parseFloat(pos.unRealizedProfit),
          leverage: parseInt(pos.leverage)
        }));
      
      return {
        success: true,
        positions: activePositions
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 获取余额
   */
  async getBalance() {
    try {
      const account = await this.client.futuresAccountInfo();
      
      const balance = {
        total: parseFloat(account.totalWalletBalance),
        available: parseFloat(account.availableBalance),
        unrealizedPnl: parseFloat(account.totalUnrealizedProfit),
        equity: parseFloat(account.totalWalletBalance) + parseFloat(account.totalUnrealizedProfit)
      };
      
      return {
        success: true,
        balance: balance
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 设置杠杆
   */
  async setLeverage(symbol, leverage) {
    try {
      symbol = this.normalizeSymbol(symbol);
      
      const result = await this.client.futuresLeverage({
        symbol: symbol,
        leverage: leverage
      });
      
      return {
        success: true,
        symbol: result.symbol,
        leverage: result.leverage
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 设置保证金模式
   */
  async setMarginType(symbol, marginType = 'CROSSED') {
    try {
      symbol = this.normalizeSymbol(symbol);
      
      const result = await this.client.futuresMarginType({
        symbol: symbol,
        marginType: marginType  // CROSSED 或 ISOLATED
      });
      
      return {
        success: true,
        result: result
      };
      
    } catch (error) {
      // 如果已经是该模式，会报错，但不影响
      if (error.message.includes('No need to change')) {
        return {
          success: true,
          message: 'Already in this margin type'
        };
      }
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 设置持仓模式
   * @param {boolean} dualSide - true=双向持仓, false=单向持仓
   */
  async setPositionMode(dualSide = false) {
    try {
      const result = await this.client.futuresPositionModeChange({
        dualSidePosition: dualSide ? 'true' : 'false'
      });
      
      return {
        success: true,
        dualSide: dualSide,
        result: result
      };
      
    } catch (error) {
      // 如果已经是该模式，会报错，但不影响
      if (error.message.includes('No need to change')) {
        return {
          success: true,
          message: 'Already in this position mode'
        };
      }
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 获取当前价格
   */

  /**
   * 设置止盈止损（使用 Algo Order API）
   * @param {string} symbol - 交易对
   * @param {string} side - 方向 (LONG/SHORT)
   * @param {number} stopLoss - 止损价格
   * @param {number} takeProfit - 止盈价格
   * @param {number} quantity - 数量（可选，不传则使用当前持仓数量）
   */
  async setStopLossTakeProfit(symbol, side, stopLoss, takeProfit, quantity = null) {
    try {
      symbol = this.normalizeSymbol(symbol);
      const precision = getPrecision(symbol);
      const closeSide = side === "LONG" ? "SELL" : "BUY";

      // Algo Order REST API helper
      const algoOrder = async (params) => {
        const baseUrl = 'https://fapi.binance.com';
        params.timestamp = Date.now();
        params.recvWindow = 10000;
        const qs = new URLSearchParams(params).toString();
        const signature = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
        const url = `${baseUrl}/fapi/v1/algoOrder?${qs}&signature=${signature}`;
        const resp = await fetch(url, { method: 'POST', headers: { 'X-MBX-APIKEY': this.apiKey } });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }
        return resp.json();
      };

      // 取消 Algo Order helper
      const cancelAlgoOrder = async (algoId) => {
        const baseUrl = 'https://fapi.binance.com';
        const params = { algoId: algoId.toString(), timestamp: Date.now(), recvWindow: 10000 };
        const qs = new URLSearchParams(params).toString();
        const signature = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
        const url = `${baseUrl}/fapi/v1/algoOrder?${qs}&signature=${signature}`;
        const resp = await fetch(url, { method: 'DELETE', headers: { 'X-MBX-APIKEY': this.apiKey } });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
        }
        return resp.json();
      };

      // 止损单
      const slResult = await algoOrder({
        symbol, side: closeSide, positionSide: 'BOTH',
        algoType: 'CONDITIONAL', type: 'STOP_MARKET',
        triggerPrice: stopLoss.toFixed(precision.price),
        closePosition: 'true', workingType: 'CONTRACT_PRICE'
      });

      if (slResult.code) {
        return { success: false, error: `SL failed: ${slResult.msg}` };
      }
      console.log('止损Algo订单:', slResult.algoId);

      // 止盈单
      const tpResult = await algoOrder({
        symbol, side: closeSide, positionSide: 'BOTH',
        algoType: 'CONDITIONAL', type: 'TAKE_PROFIT_MARKET',
        triggerPrice: takeProfit.toFixed(precision.price),
        closePosition: 'true', workingType: 'CONTRACT_PRICE'
      });

      if (tpResult.code) {
        // 止盈失败，取消已设的止损单
        console.error('止盈单失败，取消止损单:', tpResult.msg);
        try { await cancelAlgoOrder(slResult.algoId); } catch (e) {}
        return { success: false, error: `TP failed: ${tpResult.msg}` };
      }
      console.log('止盈Algo订单:', tpResult.algoId);

      return {
        success: true,
        stopLossOrderId: slResult.algoId.toString(),
        takeProfitOrderId: tpResult.algoId.toString(),
        stopLossOrder: slResult,
        takeProfitOrder: tpResult
      };

    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 查询当前 Algo 挂单
   */
  async getOpenAlgoOrders(symbol) {
    const baseUrl = 'https://fapi.binance.com';
    const params = { timestamp: Date.now(), recvWindow: 10000 };
    if (symbol) params.symbol = this.normalizeSymbol(symbol);
    const qs = new URLSearchParams(params).toString();
    const signature = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
    const url = `${baseUrl}/fapi/v1/openAlgoOrders?${qs}&signature=${signature}`;
    const resp = await fetch(url, { method: 'GET', headers: { 'X-MBX-APIKEY': this.apiKey } });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`getOpenAlgoOrders HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    if (data && data.code) {
      throw new Error(`getOpenAlgoOrders failed: ${data.msg}`);
    }
    // 兼容两种格式：直接数组 或 { orders: [...] }
    const orders = Array.isArray(data) ? data : (data.orders || []);
    return orders;
  }

  /**
   * 取消指定币种的所有 Algo 挂单
   */
  async cancelAllAlgoOrders(symbol) {
    const orders = await this.getOpenAlgoOrders(symbol);
    const results = [];
    for (const o of orders) {
      const baseUrl = 'https://fapi.binance.com';
      const params = { algoId: o.algoId.toString(), timestamp: Date.now(), recvWindow: 10000 };
      const qs = new URLSearchParams(params).toString();
      const signature = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
      const url = `${baseUrl}/fapi/v1/algoOrder?${qs}&signature=${signature}`;
      const resp = await fetch(url, { method: 'DELETE', headers: { 'X-MBX-APIKEY': this.apiKey } });
      if (!resp.ok) {
        const text = await resp.text();
        console.error(`cancelAlgoOrder ${o.algoId} HTTP ${resp.status}: ${text.slice(0, 200)}`);
        continue;
      }
      results.push(await resp.json());
    }
    return results;
  }

  async getCurrentPrice(symbol) {
    try {
      symbol = this.normalizeSymbol(symbol);
      
      const ticker = await this.client.futuresPrices();
      const price = parseFloat(ticker[symbol]);
      
      return {
        success: true,
        symbol: symbol,
        price: price
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// 导出
module.exports = BinanceAPI;

// CLI测试
if (require.main === module) {
  const api = new BinanceAPI();
  
  const command = process.argv[2];
  
  (async () => {
    try {
      let result;
      
      if (command === 'balance') {
        result = await api.getBalance();
      } else if (command === 'positions') {
        result = await api.getPositions();
      } else if (command === 'price') {
        const symbol = process.argv[3] || 'BTCUSDT';
        result = await api.getCurrentPrice(symbol);
      } else if (command === 'leverage') {
        const symbol = process.argv[3];
        const leverage = parseInt(process.argv[4]);
        result = await api.setLeverage(symbol, leverage);
      } else if (command === 'order') {
        const symbol = process.argv[3];
        const side = process.argv[4];
        const quantity = parseFloat(process.argv[5]);
        const price = parseFloat(process.argv[6]);
        result = await api.placeOrder(symbol, side, quantity, price);
      } else {
        result = { error: 'Unknown command. Usage: balance|positions|price|leverage|order' };
      }
      
      console.log(JSON.stringify(result, null, 2));
      
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  })();
}
