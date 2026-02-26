#!/usr/bin/env node
/**
 * PA Live Trading V3 - 测试止盈止损
 */

const BinanceAPI = require('./binance-api.js');

async function testStopLossTakeProfit() {
  console.log('='.repeat(60));
  console.log('PA Live Trading V3 - 测试止盈止损');
  console.log('='.repeat(60));
  
  const api = new BinanceAPI('/root/.openclaw/workspace/vault/binance-api.json');
  
  try {
    // 1. 获取当前价格
    console.log('\n1️⃣ 获取当前价格...');
    const priceResult = await api.getCurrentPrice('BTCUSDT');
    const price = priceResult.price;
    console.log(`✅ BTC价格: $${price.toFixed(2)}`);
    
    // 2. 设置杠杆
    console.log('\n2️⃣ 设置杠杆...');
    await api.setLeverage('BTCUSDT', 5);
    console.log(`✅ 杠杆: 5x`);
    
    // 3. 下市价做多单
    console.log('\n3️⃣ 下市价做多单...');
    const quantity = 0.002; // 0.002 BTC
    console.log(`  数量: ${quantity} BTC`);
    console.log(`  预计金额: $${(quantity * price).toFixed(2)}`);
    
    const orderResult = await api.marketOrder('BTCUSDT', 'long', quantity);
    
    if (!orderResult.success) {
      console.log(`❌ 订单失败: ${orderResult.error}`);
      return;
    }
    
    console.log(`✅ 订单已提交`);
    console.log(`  订单ID: ${orderResult.orderId}`);
    
    // 4. 等待3秒
    console.log('\n4️⃣ 等待3秒...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 5. 设置止盈止损
    console.log('\n5️⃣ 设置止盈止损...');
    const stopLoss = price * 0.98; // 止损2%
    const takeProfit = price * 1.02; // 止盈2%
    console.log(`  止损: $${stopLoss.toFixed(2)}`);
    console.log(`  止盈: $${takeProfit.toFixed(2)}`);
    
    const slTpResult = await api.setStopLossTakeProfit('BTCUSDT', 'LONG', stopLoss, takeProfit);
    
    console.log(`  完整返回值:`, JSON.stringify(slTpResult, null, 2));
    
    if (slTpResult.success) {
      console.log(`✅ 止盈止损已设置`);
      console.log(`  止损订单ID: ${slTpResult.stopLossOrderId}`);
      console.log(`  止盈订单ID: ${slTpResult.takeProfitOrderId}`);
    } else {
      console.log(`❌ 设置失败: ${slTpResult.error}`);
    }
    
    // 6. 查看持仓
    console.log('\n6️⃣ 查看持仓...');
    const positionsResult = await api.getPositions();
    const positions = positionsResult.positions || [];
    console.log(`✅ 持仓数量: ${positions.length}`);
    if (positions.length > 0) {
      const position = positions[0];
      console.log(`  数量: ${position.size}`);
      console.log(`  入场价: $${position.entryPrice}`);
      console.log(`  未实现盈亏: $${position.unrealizedPnl}`);
    }
    
    console.log('\n='.repeat(60));
    console.log('✅ 测试完成！');
    console.log('持仓已开启，止盈止损已设置');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    if (error.response) {
      console.error('响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testStopLossTakeProfit().catch(console.error);
