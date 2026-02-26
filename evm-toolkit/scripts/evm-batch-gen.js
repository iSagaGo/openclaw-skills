#!/usr/bin/env node
/**
 * EVM 批量生成地址工具
 * 批量生成地址并导出为不同格式
 * 
 * 使用方法：
 *   ./evm-batch-gen.js --count 10                    # 生成10个地址
 *   ./evm-batch-gen.js --count 10 --format csv       # 导出为 CSV
 *   ./evm-batch-gen.js --count 10 --save             # 保存到 vault/
 */

const { Wallet } = require('ethers');
const fs = require('fs');
const path = require('path');
const { VAULT_DIR } = require('./evm-common');

// 批量生成地址
function batchGenerate(count) {
  console.log(`\n🔐 批量生成 ${count} 个 EVM 地址...\n`);
  
  const wallets = [];
  
  for (let i = 0; i < count; i++) {
    const wallet = Wallet.createRandom();
    
    wallets.push({
      index: i + 1,
      address: wallet.address,
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null
    });
    
    console.log(`[${i + 1}/${count}] ${wallet.address}`);
  }
  
  console.log(`\n✅ 生成完成！\n`);
  
  return wallets;
}

// 导出为 JSON
function exportJSON(wallets, filename) {
  const filepath = path.resolve(filename);
  fs.writeFileSync(filepath, JSON.stringify(wallets, null, 2), { mode: 0o600 });
  console.log(`📄 已导出为 JSON: ${filepath}（权限 600）`);
  return filepath;
}

// 导出为 CSV
function exportCSV(wallets, filename) {
  const filepath = path.resolve(filename);
  
  let csv = 'Index,Address,PrivateKey,Mnemonic\n';
  
  for (const wallet of wallets) {
    const esc = (s) => `"${(s || '').replace(/"/g, '""')}"`;
    csv += `${wallet.index},${esc(wallet.address)},${esc(wallet.privateKey)},${esc(wallet.mnemonic)}\n`;
  }
  
  fs.writeFileSync(filepath, csv, { mode: 0o600 });
  console.log(`📄 已导出为 CSV: ${filepath}（权限 600）`);
  return filepath;
}

// 导出为纯地址列表
function exportAddressList(wallets, filename) {
  const filepath = path.resolve(filename);
  
  const addresses = wallets.map(w => w.address).join('\n');
  
  fs.writeFileSync(filepath, addresses);
  console.log(`📄 已导出地址列表: ${filepath}`);
  return filepath;
}

// 保存到 vault（分别保存每个钱包）
function saveToVault(wallets) {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { mode: 0o700 });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchId = `batch-${timestamp}`;
  
  console.log(`\n💾 保存到 vault/ 目录...\n`);
  
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const filename = `${batchId}-${i + 1}.json`;
    const filepath = path.join(VAULT_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(wallet, null, 2), { mode: 0o600 });
    console.log(`[${i + 1}/${wallets.length}] ${filename}`);
  }
  
  // 同时保存一个汇总文件
  const summaryFile = `${batchId}-summary.json`;
  const summaryPath = path.join(VAULT_DIR, summaryFile);
  fs.writeFileSync(summaryPath, JSON.stringify(wallets, null, 2), { mode: 0o600 });
  
  console.log(`\n✅ 已保存 ${wallets.length} 个钱包到 vault/`);
  console.log(`📋 汇总文件: ${summaryFile}`);
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔐 EVM 批量地址生成工具

使用方法：

1. 生成地址（仅显示）:
   ./evm-batch-gen.js --count 10

2. 导出为 JSON:
   ./evm-batch-gen.js --count 10 --format json --output wallets.json

3. 导出为 CSV:
   ./evm-batch-gen.js --count 10 --format csv --output wallets.csv

4. 导出地址列表:
   ./evm-batch-gen.js --count 10 --format list --output addresses.txt

5. 保存到 vault/:
   ./evm-batch-gen.js --count 10 --save

6. 同时导出多种格式:
   ./evm-batch-gen.js --count 10 --save --format csv --output wallets.csv

参数说明：
  --count <n>          生成数量
  --format <type>      导出格式（json/csv/list）
  --output <file>      输出文件名
  --save               保存到 vault/ 目录
  --help               显示帮助

⚠️  安全提醒：
  - 私钥是资产的唯一凭证，请妥善保管
  - 使用 --save 会将私钥保存到 vault/ 目录（权限 600）
  - 导出的文件也包含私钥，请注意安全
  - 不要将私钥分享给任何人
    `);
    process.exit(0);
  }
  
  // 解析参数
  let count = 1;
  let format = null;
  let output = null;
  let save = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = parseInt(args[i + 1]);
      if (isNaN(count)) { console.error('❌ --count 必须是数字'); process.exit(1); }
      i++;
    } else if (args[i] === '--format' && args[i + 1]) {
      format = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    } else if (args[i] === '--save') {
      save = true;
    }
  }
  
  // 验证参数
  if (count < 1 || count > 1000) {
    console.error('❌ 数量必须在 1-1000 之间');
    process.exit(1);
  }
  
  // 生成地址
  const wallets = batchGenerate(count);
  
  // 导出
  if (format && output) {
    switch (format) {
      case 'json':
        exportJSON(wallets, output);
        break;
      case 'csv':
        exportCSV(wallets, output);
        break;
      case 'list':
        exportAddressList(wallets, output);
        break;
      default:
        console.error(`❌ 不支持的格式: ${format}`);
        process.exit(1);
    }
  } else if (format && !output) {
    console.error('❌ 使用 --format 时必须同时指定 --output');
    process.exit(1);
  }
  
  // 保存到 vault
  if (save) {
    saveToVault(wallets);
  }
  
  // 输出统计
  console.log(`\n📊 统计信息:`);
  console.log(`  - 生成数量: ${wallets.length}`);
  if (wallets.length > 0) {
    console.log(`  - 地址示例: ${wallets[0].address}`);
  }
  
  if (!format && !save) {
    console.log(`\n💡 提示: 使用 --format 或 --save 参数导出地址`);
  }
  
  console.log(`\n⚠️  警告: 请妥善保管私钥，不要泄露给任何人！\n`);
}

if (require.main === module) {
  main();
}

module.exports = { batchGenerate, exportJSON, exportCSV, exportAddressList, saveToVault };
