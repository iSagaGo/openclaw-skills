#!/usr/bin/env node
/**
 * 模拟开仓信号测试
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function simulateOpenSignal() {
  console.log('模拟开仓信号...');
  
  const message = `🎯 开仓 BTCUSDT LONG @ $66,016.66
止损: $65,350.00 (风险1.01%)
止盈: $66,683.32
风险: 2%
分配: 100%
BOS: NO`;
  
  try {
    const prefix = '[模拟]';
    const telegramMessage = `${prefix} ${message}`;
    const command = `openclaw message send --target 6311362800 --message "${telegramMessage.replace(/"/g, '\\"')}"`;
    const { stdout } = await execPromise(command);
    
    console.log('✅ 开仓通知发送成功');
    console.log(stdout);
  } catch (error) {
    console.error('❌ 通知发送失败:', error.message);
  }
}

simulateOpenSignal();
