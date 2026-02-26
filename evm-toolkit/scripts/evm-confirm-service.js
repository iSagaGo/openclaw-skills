#!/usr/bin/env node
/**
 * EVM Gas 确认服务（getUpdates 临时接管版）
 * 
 * 监听 /tmp/evm-confirm-request.json，出现时：
 * 1. 通过 curl 发确认消息（带 inline button + 20秒倒计时）
 * 2. 用 getUpdates 短轮询等回调（20秒硬超时）
 * 3. 收到回调 → 写响应文件
 * 4. 超时/完成 → 停止轮询，OpenClaw 自动恢复
 * 
 * 全程不经过 AI，不用 webhook。
 * 风险：20秒内 OpenClaw 收不到消息，finally 兜底不会永久失联。
 */

const fs = require('fs');
const { execSync } = require('child_process');

// 配置
const CHAT_ID = '6311362800';
const REQUEST_FILE = '/tmp/evm-confirm-request.json';
const RESPONSE_FILE = '/tmp/evm-confirm-response.json';
const POLL_INTERVAL = 300; // 监听请求文件间隔
const CONFIRM_TIMEOUT = 20000; // 20秒确认超时

// 从 OpenClaw 配置读取 bot token
function loadBotToken() {
  try {
    const config = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
    return config.channels.telegram.botToken;
  } catch (e) {
    console.error('❌ 无法读取 bot token:', e.message);
    process.exit(1);
  }
}

const BOT_TOKEN = loadBotToken();

// curl 调 Telegram API（用临时文件传 body，避免 shell 转义问题）
function tgApi(method, body) {
  const tmpFile = `/tmp/tg-api-${process.pid}.json`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(body || {}));
    const result = execSync(
      `curl -s --connect-timeout 10 --max-time 15 -X POST "https://api.telegram.org/bot${BOT_TOKEN}/${method}" -H "Content-Type: application/json" -d @${tmpFile}`,
      { encoding: 'utf8', timeout: 20000 }
    );
    return JSON.parse(result);
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// 构建确认消息文本
function buildConfirmText(info, remaining) {
  const bar = '█'.repeat(Math.ceil(remaining / 2)) + '░'.repeat(10 - Math.ceil(remaining / 2));
  return `⚠️ Gas 费用确认\n\n` +
    `单笔 Gas: ${info.perTxGas} ETH\n` +
    `总 Gas: ${info.totalGas} ETH (${info.txCount} 笔)\n` +
    `正常阈值: ${info.threshold} ETH/笔\n\n` +
    `⏱ 剩余 ${remaining} 秒 ${bar}`;
}

// 发确认消息
function sendConfirmMessage(info) {
  const text = buildConfirmText(info, 20);
  const result = tgApi('sendMessage', {
    chat_id: CHAT_ID,
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ 确认执行', callback_data: 'evm_gas_yes' },
        { text: '❌ 取消', callback_data: 'evm_gas_no' }
      ]]
    }
  });

  if (result.ok) {
    console.log(`📤 确认消息已发送 (msgId: ${result.result.message_id})`);
    return result.result.message_id;
  }
  console.error('❌ 发送失败:', JSON.stringify(result));
  return null;
}

// 编辑消息（纯文本，移除按钮）
function editMessage(messageId, text) {
  if (!messageId) return;
  try {
    tgApi('editMessageText', { chat_id: CHAT_ID, message_id: messageId, text });
  } catch {}
}

// 编辑消息（保留按钮，用于倒计时更新）
function editMessageWithButtons(messageId, text) {
  if (!messageId) return;
  try {
    tgApi('editMessageText', {
      chat_id: CHAT_ID,
      message_id: messageId,
      text,
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ 确认执行', callback_data: 'evm_gas_yes' },
          { text: '❌ 取消', callback_data: 'evm_gas_no' }
        ]]
      }
    });
  } catch {}
}

// 等待回调（getUpdates 短轮询，20秒超时，带倒计时）
function waitForCallback(messageId, info) {
  const deadline = Date.now() + CONFIRM_TIMEOUT;
  let offset = 0; // 从 0 开始，靠 messageId 过滤
  let lastCountdown = 20;

  while (Date.now() < deadline) {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));

    // 每 5 秒更新倒计时
    const countdownStep = Math.ceil(remaining / 5) * 5;
    if (countdownStep < lastCountdown && remaining > 0) {
      lastCountdown = countdownStep;
      editMessageWithButtons(messageId, buildConfirmText(info, remaining));
    }

    try {
      const waitSec = Math.min(2, Math.max(1, remaining));
      const tmpFile = `/tmp/tg-poll-${process.pid}.json`;
      fs.writeFileSync(tmpFile, JSON.stringify({ offset, timeout: waitSec, allowed_updates: ["callback_query"] }));
      const result = execSync(
        `curl -s --connect-timeout 5 --max-time ${waitSec + 3} -X POST "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates" -H "Content-Type: application/json" -d @${tmpFile}`,
        { encoding: 'utf8', timeout: (waitSec + 5) * 1000 }
      );
      try { fs.unlinkSync(tmpFile); } catch {}

      const data = JSON.parse(result);
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          const cb = update.callback_query;
          if (!cb) continue;
          // 只处理我们发的那条消息的回调
          if (!cb.message || cb.message.message_id !== messageId) continue;

          // 应答回调
          try { tgApi('answerCallbackQuery', { callback_query_id: cb.id }); } catch {}

          if (cb.data === 'evm_gas_yes') {
            return true;
          } else if (cb.data === 'evm_gas_no') {
            return false;
          }
        }
      }
    } catch {
      // 网络错误，继续重试
    }
  }

  return null; // 超时
}

// 处理一次确认请求
function handleConfirmRequest(info) {
  let messageId = null;

  try {
    // 1. 发确认消息
    messageId = sendConfirmMessage(info);
    if (!messageId) {
      // 发送失败，写取消响应
      fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ confirmed: false }));
      console.error('❌ 无法发送确认消息，自动取消');
      return;
    }

    // 2. 等待回调
    const result = waitForCallback(messageId, info);

    // 3. 写响应
    if (result === true) {
      fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ confirmed: true }));
      editMessage(messageId, '✅ 已确认，执行中...');
      console.log(`✅ [${new Date().toLocaleTimeString()}] 用户确认`);
    } else if (result === false) {
      fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ confirmed: false }));
      editMessage(messageId, '❌ 交易已取消');
      console.log(`❌ [${new Date().toLocaleTimeString()}] 用户取消`);
    } else {
      // 超时
      fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ confirmed: false }));
      editMessage(messageId, '⏱ 确认超时（20秒），已自动取消');
      console.log(`⏱ [${new Date().toLocaleTimeString()}] 确认超时`);
    }
  } catch (e) {
    console.error('处理异常:', e.message);
    // 兜底：写取消响应
    if (!fs.existsSync(RESPONSE_FILE)) {
      fs.writeFileSync(RESPONSE_FILE, JSON.stringify({ confirmed: false }));
    }
    if (messageId) {
      editMessage(messageId, '❌ 处理异常，已自动取消');
    }
  }
  // finally: getUpdates 停止调用，OpenClaw 自动恢复轮询
}

// 主循环：监听请求文件
async function main() {
  console.log('🔄 EVM Gas 确认服务已启动');
  console.log(`   监听: ${REQUEST_FILE}`);
  console.log(`   超时: ${CONFIRM_TIMEOUT / 1000}秒`);
  console.log(`   Chat: ${CHAT_ID}\n`);

  let lastMtime = 0;

  while (true) {
    if (fs.existsSync(REQUEST_FILE)) {
      try {
        const stat = fs.statSync(REQUEST_FILE);
        if (stat.mtimeMs > lastMtime) {
          lastMtime = stat.mtimeMs;
          const info = JSON.parse(fs.readFileSync(REQUEST_FILE, 'utf8'));
          console.log(`\n📋 检测到确认请求`);
          handleConfirmRequest(info);
        }
      } catch (e) {
        console.error('读取请求失败:', e.message);
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
}

// 异常保护
process.on('uncaughtException', (e) => {
  console.error('未捕获异常:', e.message);
});
process.on('unhandledRejection', (e) => {
  console.error('未处理 Promise:', e.message || e);
});

main().catch(e => {
  console.error('❌ 服务异常:', e.message);
  process.exit(1);
});
