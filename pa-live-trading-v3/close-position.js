#!/usr/bin/env node
/**
 * PA Live Trading V3 - 平仓脚本
 */

const BinanceAPI = require('./binance-api.js');

async function closePosition() {
  console.log('='.repeat(60));
  console.log('PA Live Trading V3 - 平仓');
  console.log('='.repeat(60));
  
  const api = new BinanceAPI('/root/.openclaw/workspace/vault/binance-api.json');
  
  try {
    // 1. 查看持仓
    console.log('\n1️⃣ 查看持仓...');
    const positionsResult = await api.getPositions();
    const positions = positionsResult.positions || [];
    console.log(`  持仓数量: ${positions.length}`);
    
    if (positions.length === 0) {
      console.log('❌ 没有持仓');
      return;
    }
    
    // 2. 平仓所有持仓
    for (const position of positions) {
      console.log(`\n2️⃣ 平仓 ${position.symbol}...`);
      console.log(`  持仓方向: ${position.side}`);
      console.log(`  持仓数量: ${position.size}`);
      console.log(`  入场价: $${position.entryPrice}`);
      console.log(`  未实现盈亏: $${position.unrealizedPnl}`);
      
      const quantity = position.size;
      const side = position.side === 'LONG' ? 'short' : 'long';
      
      const closeResult = await api.marketOrder(position.symbol, side, quantity);
      
      if (closeResult.success) {
        console.log(`✅ 平仓成功`);
        console.log(`  订单ID: ${closeResult.orderId}`);
      } else {
        console.log(`❌ 平仓失败: ${closeResult.error}`);
      }
    }
    
    // 3. 查看最终余额
    console.log('\n3️⃣ 查看最终余额...');
    const balanceResult = await api.getBalance();
    console.log(`✅ 可用余额: $${balanceResult.balance.available.toFixed(2)}`);
    console.log(`  总余额: $${balanceResult.balance.total.toFixed(2)}`);
    console.log(`  未实现盈亏: $${balanceResult.balance.unrealizedPnl.toFixed(2)}`);
    
    console.log('\n='.repeat(60));
    console.log('✅ 平仓完成！');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('\n❌ 平仓失败:', error.message);
    if (error.response) {
      console.error('响应数据:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

closePosition().catch(console.error);
