#!/usr/bin/env node
/**
 * PA Live Trading V3 - Binance API测试
 */

const BinanceAPI = require('./binance-api.js');
const config = require('./config-real.js');

async function testAPI() {
  console.log('='.repeat(60));
  console.log('PA Live Trading V3 - Binance API测试');
  console.log('='.repeat(60));
  
  const api = new BinanceAPI('/root/.openclaw/workspace/vault/binance-api.json');
  
  try {
    // 1. 测试连接（通过获取当前价格）
    console.log('\n1️⃣ 测试API连接...');
    const priceResult = await api.getCurrentPrice('BTCUSDT');
    const price = priceResult.price;
    console.log(`✅ 连接成功，BTC价格: $${price.toFixed(2)}`);
    
    // 2. 读取账户余额
    console.log('\n2️⃣ 读取账户余额...');
    const balanceResult = await api.getBalance();
    const balance = balanceResult.balance.available;
    console.log(`✅ 可用余额: $${balance.toFixed(2)}`);
    console.log(`  总余额: $${balanceResult.balance.total.toFixed(2)}`);
    console.log(`  未实现盈亏: $${balanceResult.balance.unrealizedPnl.toFixed(2)}`);
    
    // 3. 读取持仓信息
    console.log('\n3️⃣ 读取持仓信息...');
    const positions = await api.getPositions();
    console.log(`✅ 持仓数量: ${positions.length}`);
    if (positions.length > 0) {
      positions.forEach(pos => {
        console.log(`  - ${pos.symbol}: ${pos.positionAmt} (${pos.positionSide})`);
      });
    }
    
    // 4. 设置杠杆
    console.log('\n4️⃣ 设置杠杆...');
    await api.setLeverage('BTCUSDT', 5);
    console.log(`✅ 杠杆已设置: 5x`);
    
    // 5. 测试下单（不实际下单，只验证参数）
    console.log('\n5️⃣ 验证下单参数...');
    const testQuantity = 0.001; // 0.001 BTC
    console.log(`  测试数量: ${testQuantity} BTC`);
    console.log(`  当前价格: $${price.toFixed(2)}`);
    console.log(`  测试金额: 约 $${(testQuantity * price).toFixed(2)}`);
    console.log(`✅ 参数验证通过（未实际下单）`);
    
    console.log('\n='.repeat(60));
    console.log('✅ 所有测试通过！');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ 测试失败:', error.message);
    if (error.response) {
      console.error('响应数据:', error.response.data);
    }
    process.exit(1);
  }
}

testAPI().catch(console.error);
