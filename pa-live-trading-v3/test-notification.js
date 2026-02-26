#!/usr/bin/env node
/**
 * 测试Telegram通知功能
 */

const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

async function testNotification() {
  console.log('测试Telegram通知...');
  
  const message = '[模拟] 🎯 测试通知\n开仓 BTCUSDT LONG @ $66,000\n止损: $65,000\n止盈: $67,000';
  
  try {
    const command = `openclaw message send --target 6311362800 --message "${message.replace(/"/g, '\\"')}"`;
    const { stdout, stderr } = await execPromise(command);
    
    console.log('✅ 通知发送成功');
    if (stdout) console.log('输出:', stdout);
    if (stderr) console.log('错误:', stderr);
  } catch (error) {
    console.error('❌ 通知发送失败:', error.message);
  }
}

testNotification();
