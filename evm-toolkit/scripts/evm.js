#!/usr/bin/env node
/**
 * EVM 工具集管理器
 * 统一管理所有 EVM 工具
 * 
 * 使用方法：
 *   ./evm.js --help                    # 显示帮助
 *   ./evm.js gen --count 5             # 生成地址
 *   ./evm.js balance --address 0x...   # 查询余额
 *   ./evm.js transfer --help           # 转账帮助
 */

const { spawn } = require('child_process');
const path = require('path');

// 工具列表
const TOOLS = {
  'gen': {
    script: 'evm-wallet-gen.js',
    description: '生成钱包地址'
  },
  'batch-gen': {
    script: 'evm-batch-gen.js',
    description: '批量生成地址'
  },
  'transfer': {
    script: 'evm-batch-transfer.js',
    description: '批量转账'
  },
  'collect': {
    script: 'evm-collect.js',
    description: '资金归集'
  },
  'balance': {
    script: 'evm-balance.js',
    description: '余额查询'
  },
  'batch-query': {
    script: 'evm-batch-query.js',
    description: '批量查询'
  },
  'info': {
    script: 'evm-info.js',
    description: '地址信息'
  },
  'history': {
    script: 'evm-tx-history.js',
    description: '交易历史'
  },
  'labels': {
    script: 'evm-labels.js',
    description: '标签管理'
  },
  'validate': {
    script: 'evm-validate.js',
    description: '地址验证'
  },
  'extract': {
    script: 'evm-extract-addresses.js',
    description: '地址提取'
  }
};

// 显示帮助
function showHelp() {
  console.log(`
🔐 EVM 工具集管理器

使用方法：
  ./evm.js <command> [options]

可用命令：

  gen              生成钱包地址
  batch-gen        批量生成地址（支持导出 CSV/JSON）
  transfer         批量转账（ETH 或 ERC20）
  collect          资金归集到主地址
  balance          查询余额
  batch-query      批量查询余额
  info             查询地址详细信息
  history          查询交易历史
  labels           标签管理
  validate         地址验证
  extract          地址提取

快速示例：

  # 生成5个地址
  ./evm.js gen --count 5 --save

  # 批量生成并导出 CSV
  ./evm.js batch-gen --count 10 --format csv --output wallets.csv

  # 查询余额
  ./evm.js balance --address 0x...

  # 查询地址信息
  ./evm.js info --address 0x...

  # 批量转账（模拟）
  ./evm.js transfer --eth --file recipients.json --dry-run

  # 归集资金
  ./evm.js collect --eth --file wallets.json

查看命令详细帮助：
  ./evm.js <command> --help

文档：
  - SKILL.md（完整文档）
  `);
}

// 执行工具
function runTool(toolName, args) {
  const tool = TOOLS[toolName];
  
  if (!tool) {
    console.error(`❌ 未知命令: ${toolName}`);
    console.log(`\n可用命令: ${Object.keys(TOOLS).join(', ')}`);
    console.log(`使用 ./evm.js --help 查看帮助`);
    process.exit(1);
  }
  
  const scriptPath = path.join(__dirname, tool.script);
  
  // 使用 spawn 执行脚本
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    cwd: __dirname
  });
  
  child.on('error', (error) => {
    console.error(`❌ 执行失败: ${error.message}`);
    process.exit(1);
  });
  
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    process.exit(0);
  }
  
  const command = args[0];
  const commandArgs = args.slice(1);
  
  runTool(command, commandArgs);
}

if (require.main === module) {
  main();
}
