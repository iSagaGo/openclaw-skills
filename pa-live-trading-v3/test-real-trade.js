#!/usr/bin/env node
/**
 * PA Live Trading V3 - 真实交易测试
 */

const BinanceAPI = require('./binance-api.js');

async function testRealTrade() {
  console.log('='.repeat(60));
  console.log('PA Live Trading V3 - 真实交易测试');
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
    const quantity = 0.002; // 0.002 BTC ≈ $135
    console.log(`  数量: ${quantity} BTC`);
    console.log(`  预计金额: $${(quantity * price).toFixed(2)}`);
    
    const orderResult = await api.marketOrder('BTCUSDT', 'long', quantity);
    console.log(`✅ 订单已提交`);
    console.log(`  完整返回值:`, JSON.stringify(orderResult, null, 2));
    console.log(`  订单ID: ${orderResult.orderId}`);
    console.log(`  成功: ${orderResult.success}`);
    console.log(`  状态: ${orderResult.status}`);
    
    if (!orderResult.success) {
      console.log(`❌ 订单失败`);
      console.log(`  错误信息: ${orderResult.error}`);
      return;
    }
    
    // 4. 等待3秒
    console.log('\n4️⃣ 等待3秒...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 5. 查看持仓
    console.log('\n5️⃣ 查看持仓...');
    const posResult = await api.getPositions();
    const positions = posResult.positions || [];
    if (positions.length > 0) {
      const position = positions.find(p => p.symbol === 'BTCUSDT') || positions[0];
      console.log(`✅ 持仓确认`);
      console.log(`  方向: ${position.side}`);
      console.log(`  数量: ${position.size}`);
      console.log(`  入场价: $${position.entryPrice}`);
      console.log(`  未实现盈亏: $${position.unrealizedPnl}`);
      
      // 6. 平仓
      console.log('\n6️⃣ 平仓...');
      const closeSide = position.side === 'LONG' ? 'short' : 'long';
      const closeResult = await api.marketOrder('BTCUSDT', closeSide, position.size);
      console.log(`✅ 平仓完成`);
      console.log(`  订单ID: ${closeResult.orderId}`);
      
    } else {
      console.log('❌ 未找到持仓');
    }
    
    // 7. 查看最终余额
    console.log('\n7️⃣ 查看最终余额...');
    const balanceResult = await api.getBalance();
    console.log(`✅ 可用余额: $${balanceResult.balance.available.toFixed(2)}`);
    
    console.log('\n='.repeat(60));
    console.log('✅ 真实交易测试完成！');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    if (error.response) {
      console.error('响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testRealTrade().catch(console.error);
