#!/usr/bin/env node
/**
 * EVM 地址列表提取工具
 * 从钱包文件中提取纯地址列表
 * 
 * 使用方法：
 *   ./evm-extract-addresses.js --file sub-wallets-1-20.json
 *   ./evm-extract-addresses.js --file sub-wallets-1-20.json --output addresses.txt
 */

const fs = require('fs');
const { readJSON } = require('./evm-common');

// 提取地址列表
function extractAddresses(wallets) {
  return wallets.map(w => w.address);
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📋 EVM 地址列表提取工具

使用方法：

1. 提取地址列表（显示）:
   ./evm-extract-addresses.js --file sub-wallets-1-20.json

2. 提取并保存到文件:
   ./evm-extract-addresses.js --file sub-wallets-1-20.json --output addresses.txt

3. 提取并保存为 JSON:
   ./evm-extract-addresses.js --file sub-wallets-1-20.json --output addresses.json --format json

参数说明：
  --file <path>        钱包文件路径
  --output <path>      输出文件路径（可选）
  --format <type>      输出格式（text/json，默认: text）
  --help               显示帮助
    `);
    process.exit(0);
  }
  
  // 解析参数
  let file = null;
  let output = null;
  let format = 'text';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      file = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    } else if (args[i] === '--format' && args[i + 1]) {
      format = args[i + 1];
      i++;
    }
  }
  
  // 验证参数
  if (!file) {
    console.error('❌ 请指定 --file');
    process.exit(1);
  }
  
  // 读取钱包文件
  let wallets;
  try {
    wallets = readJSON(file);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(wallets) || wallets.length === 0) {
    console.error('❌ 文件为空或格式错误');
    process.exit(1);
  }
  const addresses = extractAddresses(wallets);
  
  console.log(`\n📋 提取了 ${addresses.length} 个地址\n`);
  
  // 输出
  if (output) {
    if (format === 'json') {
      fs.writeFileSync(output, JSON.stringify(addresses, null, 2));
      console.log(`✅ 已保存为 JSON: ${output}`);
    } else {
      fs.writeFileSync(output, addresses.join('\n'));
      console.log(`✅ 已保存为文本: ${output}`);
    }
  } else {
    // 显示前10个地址
    console.log('前10个地址:');
    addresses.slice(0, 10).forEach((addr, i) => {
      console.log(`${i + 1}. ${addr}`);
    });
    
    if (addresses.length > 10) {
      console.log(`... 还有 ${addresses.length - 10} 个地址`);
    }
  }
  
  console.log('');
}

if (require.main === module) {
  main();
}

module.exports = { extractAddresses };
