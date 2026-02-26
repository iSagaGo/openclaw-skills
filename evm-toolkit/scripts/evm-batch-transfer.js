#!/usr/bin/env node
/**
 * EVM 批量转账工具
 * 从主地址向多个地址批量发送 ETH 或 ERC20 代币
 * 
 * 使用方法：
 *   ./evm-batch-transfer.js --help                           # 显示帮助
 *   ./evm-batch-transfer.js --eth --to 0x... --amount 0.1   # 发送 ETH
 *   ./evm-batch-transfer.js --token 0x... --file list.json  # 批量发送代币
 */

const fs = require('fs');
const { Wallet, JsonRpcProvider, parseEther, formatEther, parseUnits, formatUnits, Contract, isAddress } = require('ethers');
const { ERC20_ABI, DEFAULT_RPC, loadMainWallet, readJSON, confirmGasCost, parseGasArgs, getGasPrice, checkMaxFee } = require('./evm-common');

// 批量发送 ETH
async function batchTransferETH(provider, wallet, recipients, dryRun = false, gasOpts = {}) {
  console.log('\n📤 批量发送 ETH\n');
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 主地址余额: ${formatEther(balance)} ETH\n`);
  
  let totalAmount = 0n;
  const transactions = [];
  
  for (const recipient of recipients) {
    const amount = parseEther(recipient.amount.toString());
    totalAmount += amount;
    
    transactions.push({
      to: recipient.address,
      amount: amount,
      amountStr: recipient.amount
    });
  }
  
  const totalGas = BigInt(recipients.length) * 21000n;
  const gasPrice = await getGasPrice(provider, gasOpts.gasPrice);
  const totalGasCost = gasPrice * totalGas;
  const perTxGasCost = gasPrice * 21000n;
  
  // 检查 --max-fee 单笔上限
  checkMaxFee(perTxGasCost, gasOpts.maxFee);
  
  console.log(`📊 转账统计:`);
  console.log(`  - 接收地址数: ${recipients.length}`);
  console.log(`  - 总金额: ${formatEther(totalAmount)} ETH`);
  console.log(`  - 预估 Gas: ${formatEther(totalGasCost)} ETH\n`);
  
  if (totalAmount + totalGasCost > balance) {
    throw new Error(`余额不足 (需要 ${formatEther(totalAmount + totalGasCost)} ETH，当前 ${formatEther(balance)} ETH)`);
  }
  
  // Gas 异常确认
  if (!dryRun) {
    await confirmGasCost(totalGasCost, transactions.length, 'eth');
  }
  
  // 断点续传：加载已处理的交易
  const progressFile = gasOpts.progressFile || null;
  let completedCount = 0;
  let previousResults = [];
  if (progressFile) {
    try {
      previousResults = readJSON(progressFile);
      completedCount = previousResults.length;
      if (completedCount > 0) {
        const successCount = previousResults.filter(r => r.success).length;
        console.log(`📋 断点续传：跳过已处理的 ${completedCount} 笔（${successCount} 成功，${completedCount - successCount} 失败）\n`);
      }
    } catch (e) { /* 文件不存在，从头开始 */ }
  }
  
  if (dryRun) {
    console.log('🔍 模拟模式，不会实际发送交易\n');
    transactions.forEach((tx, i) => {
      if (i < completedCount) {
        console.log(`${i + 1}. ⏭️  ${tx.to} → ${tx.amountStr} ETH（已完成）`);
      } else {
        console.log(`${i + 1}. ${tx.to} → ${tx.amountStr} ETH`);
      }
    });
    return;
  }
  
  console.log('⚠️  即将发送真实交易，请确认...\n');
  
  const results = [...previousResults];
  let nonce = await provider.getTransactionCount(wallet.address);
  
  // 断点续传：校验链上 nonce 与进度记录
  if (completedCount > 0) {
    const onChainNonce = nonce; // getTransactionCount 返回下一个可用 nonce
    const successInProgress = previousResults.filter(r => r.success).length;
    if (onChainNonce > successInProgress) {
      console.log(`⚠️  警告：链上 nonce(${onChainNonce}) > 进度成功数(${successInProgress})，可能有交易已上链但未记录`);
      console.log(`   建议检查链上交易记录，避免重复转账\n`);
    }
  }
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    
    // 跳过已完成的
    if (i < completedCount) {
      console.log(`[${i + 1}/${transactions.length}] ⏭️  跳过 ${tx.to}（已处理）\n`);
      continue;
    }
    
    console.log(`[${i + 1}/${transactions.length}] 发送 ${tx.amountStr} ETH 到 ${tx.to}...`);
    
    try {
      const txResponse = await wallet.sendTransaction({
        to: tx.to,
        value: tx.amount,
        nonce: nonce,
        gasLimit: 21000n,
        gasPrice
      });
      nonce++; // 只在成功发送后递增
      
      console.log(`  ✅ 交易已发送: ${txResponse.hash}`);
      console.log(`  ⏳ 等待确认...`);
      
      const receipt = await txResponse.wait(1, 120000); // 1个确认，120秒超时
      console.log(`  ✅ 已确认 (区块 ${receipt.blockNumber})\n`);
      
      results.push({
        success: true,
        to: tx.to,
        amount: tx.amountStr,
        hash: txResponse.hash,
        blockNumber: receipt.blockNumber
      });
    } catch (error) {
      console.log(`  ❌ 失败: ${error.message}\n`);
      results.push({
        success: false,
        to: tx.to,
        amount: tx.amountStr,
        error: error.message
      });
    }
    
    // 每笔交易后保存进度
    if (progressFile) {
      fs.writeFileSync(progressFile, JSON.stringify(results, null, 2));
    }
  }
  
  return results;
}

// 批量发送 ERC20 代币
async function batchTransferToken(provider, wallet, tokenAddress, recipients, dryRun = false, gasOpts = {}) {
  console.log('\n📤 批量发送 ERC20 代币\n');
  
  const token = new Contract(tokenAddress, ERC20_ABI, wallet);
  
  // 获取代币信息
  const [symbol, decimals, balance] = await Promise.all([
    token.symbol(),
    token.decimals(),
    token.balanceOf(wallet.address)
  ]);
  
  console.log(`🪙 代币信息:`);
  console.log(`  - 合约地址: ${tokenAddress}`);
  console.log(`  - 代币符号: ${symbol}`);
  console.log(`  - 精度: ${decimals}`);
  console.log(`  - 主地址余额: ${formatUnits(balance, decimals)} ${symbol}\n`);
  
  let totalAmount = 0n;
  const transactions = [];
  
  for (const recipient of recipients) {
    const amount = parseUnits(recipient.amount.toString(), decimals);
    totalAmount += amount;
    
    transactions.push({
      to: recipient.address,
      amount: amount,
      amountStr: recipient.amount
    });
  }
  
  console.log(`📊 转账统计:`);
  console.log(`  - 接收地址数: ${recipients.length}`);
  console.log(`  - 总金额: ${formatUnits(totalAmount, decimals)} ${symbol}`);
  
  // 检查 ETH 余额是否够付 gas
  const ethBalance = await provider.getBalance(wallet.address);
  const gasPrice = await getGasPrice(provider, gasOpts.gasPrice);
  const totalGasCost = gasPrice * 65000n * BigInt(recipients.length);
  const perTxGasCost = gasPrice * 65000n;
  
  // 检查 --max-fee 单笔上限
  checkMaxFee(perTxGasCost, gasOpts.maxFee);
  
  console.log(`  - 预估 Gas: ${formatEther(totalGasCost)} ETH (ETH余额: ${formatEther(ethBalance)} ETH)\n`);
  
  if (totalAmount > balance) {
    throw new Error(`代币余额不足 (需要 ${formatUnits(totalAmount, decimals)} ${symbol})`);
  }
  
  if (totalGasCost > ethBalance) {
    throw new Error(`ETH 余额不足支付 gas (需要 ${formatEther(totalGasCost)} ETH，当前 ${formatEther(ethBalance)} ETH)`);
  }
  
  // Gas 异常确认
  if (!dryRun) {
    await confirmGasCost(totalGasCost, transactions.length, 'erc20');
  }
  
  // 断点续传：加载已处理的交易
  const progressFile = gasOpts.progressFile || null;
  let completedCount = 0;
  let previousResults = [];
  if (progressFile) {
    try {
      previousResults = readJSON(progressFile);
      completedCount = previousResults.length;
      if (completedCount > 0) {
        const successCount = previousResults.filter(r => r.success).length;
        console.log(`📋 断点续传：跳过已处理的 ${completedCount} 笔（${successCount} 成功，${completedCount - successCount} 失败）\n`);
      }
    } catch (e) { /* 文件不存在，从头开始 */ }
  }
  
  if (dryRun) {
    console.log('🔍 模拟模式，不会实际发送交易\n');
    transactions.forEach((tx, i) => {
      if (i < completedCount) {
        console.log(`${i + 1}. ⏭️  ${tx.to} → ${tx.amountStr} ${symbol}（已完成）`);
      } else {
        console.log(`${i + 1}. ${tx.to} → ${tx.amountStr} ${symbol}`);
      }
    });
    return;
  }
  
  console.log('⚠️  即将发送真实交易，请确认...\n');
  
  const results = [...previousResults];
  let nonce = await provider.getTransactionCount(wallet.address);
  
  // 断点续传：校验链上 nonce 与进度记录
  if (completedCount > 0) {
    const onChainNonce = nonce;
    const successInProgress = previousResults.filter(r => r.success).length;
    if (onChainNonce > successInProgress) {
      console.log(`⚠️  警告：链上 nonce(${onChainNonce}) > 进度成功数(${successInProgress})，可能有交易已上链但未记录`);
      console.log(`   建议检查链上交易记录，避免重复转账\n`);
    }
  }
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    
    // 跳过已完成的
    if (i < completedCount) {
      console.log(`[${i + 1}/${transactions.length}] ⏭️  跳过 ${tx.to}（已处理）\n`);
      continue;
    }
    
    console.log(`[${i + 1}/${transactions.length}] 发送 ${tx.amountStr} ${symbol} 到 ${tx.to}...`);
    
    try {
      const txResponse = await token.transfer(tx.to, tx.amount, { nonce: nonce, gasPrice });
      nonce++; // 只在成功发送后递增
      
      console.log(`  ✅ 交易已发送: ${txResponse.hash}`);
      console.log(`  ⏳ 等待确认...`);
      
      const receipt = await txResponse.wait(1, 120000);
      console.log(`  ✅ 已确认 (区块 ${receipt.blockNumber})\n`);
      
      results.push({
        success: true,
        to: tx.to,
        amount: tx.amountStr,
        hash: txResponse.hash,
        blockNumber: receipt.blockNumber
      });
    } catch (error) {
      console.log(`  ❌ 失败: ${error.message}\n`);
      results.push({
        success: false,
        to: tx.to,
        amount: tx.amountStr,
        error: error.message
      });
    }
    
    // 每笔交易后保存进度
    if (progressFile) {
      fs.writeFileSync(progressFile, JSON.stringify(results, null, 2));
    }
  }
  
  return results;
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔄 EVM 批量转账工具

使用方法：

1. 发送 ETH:
   ./evm-batch-transfer.js --eth --to 0x... --amount 0.1
   ./evm-batch-transfer.js --eth --file recipients.json

2. 发送 ERC20 代币:
   ./evm-batch-transfer.js --token 0x... --to 0x... --amount 100
   ./evm-batch-transfer.js --token 0x... --file recipients.json

3. 模拟模式（不实际发送）:
   ./evm-batch-transfer.js --eth --file recipients.json --dry-run

参数说明：
  --eth                发送 ETH
  --token <address>    发送 ERC20 代币（指定合约地址）
  --to <address>       接收地址（单个转账）
  --amount <value>     转账金额（单个转账）
  --file <path>        批量转账文件（JSON 格式）
  --rpc <url>          RPC 节点地址（默认: https://eth.llamarpc.com）
  --gas-price <gwei>   手动指定 Gas 价格（单位 Gwei）
  --max-fee <eth>      单笔最大 Gas 费用上限（单位 ETH）
  --resume <path>      断点续传进度文件（自动跳过已成功的交易）
  --dry-run            模拟模式，不实际发送交易
  --help               显示帮助

批量转账文件格式 (recipients.json):
[
  { "address": "0x...", "amount": "0.1" },
  { "address": "0x...", "amount": "0.2" }
]

⚠️  安全提醒：
  - 请先使用 --dry-run 模拟测试
  - 确认接收地址和金额无误后再实际发送
  - 建议先小额测试
    `);
    process.exit(0);
  }
  
  // 解析参数
  let isETH = false;
  let tokenAddress = null;
  let recipients = [];
  let rpcUrl = DEFAULT_RPC;
  let dryRun = false;
  
  let singleTo = null;
  let singleAmount = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eth') {
      isETH = true;
    } else if (args[i] === '--token' && args[i + 1]) {
      tokenAddress = args[i + 1];
      i++;
    } else if (args[i] === '--to' && args[i + 1]) {
      singleTo = args[i + 1];
      i++;
    } else if (args[i] === '--amount' && args[i + 1]) {
      singleAmount = args[i + 1];
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      const filePath = args[i + 1];
      let fileData;
      try {
        fileData = readJSON(filePath);
      } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      }
      recipients = recipients.concat(fileData);
      i++;
    } else if (args[i] === '--rpc' && args[i + 1]) {
      rpcUrl = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  
  // 合并单个转账参数
  if (singleTo && singleAmount) {
    recipients.push({ address: singleTo, amount: singleAmount });
  } else if (singleTo && !singleAmount) {
    console.error('❌ 使用 --to 时必须同时指定 --amount');
    process.exit(1);
  } else if (!singleTo && singleAmount) {
    console.error('❌ 使用 --amount 时必须同时指定 --to');
    process.exit(1);
  }
  
  // 验证参数
  if (!isETH && !tokenAddress) {
    console.error('❌ 请指定 --eth 或 --token <address>');
    process.exit(1);
  }
  
  if (recipients.length === 0) {
    console.error('❌ 请指定接收地址（--to 或 --file）');
    process.exit(1);
  }
  
  // 校验所有接收地址格式
  for (const r of recipients) {
    if (!isAddress(r.address)) {
      console.error(`❌ 无效地址: ${r.address}`);
      process.exit(1);
    }
    if (!r.amount || isNaN(Number(r.amount)) || Number(r.amount) <= 0) {
      console.error(`❌ 无效金额: ${r.amount} (地址: ${r.address})`);
      process.exit(1);
    }
  }
  
  // 加载主钱包
  console.log('🔐 加载主钱包...');
  const walletData = loadMainWallet();
  console.log(`✅ 主地址: ${walletData.address}\n`);
  
  // 连接 RPC
  console.log(`🌐 连接 RPC: ${rpcUrl}`);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(walletData.privateKey, provider);
  
  // 解析 gas 参数
  const gasOpts = parseGasArgs(args);
  
  // 解析 --resume 断点续传
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--resume' && args[i + 1]) {
      gasOpts.progressFile = args[i + 1];
      break;
    }
  }
  
  // 执行转账
  let results;
  if (isETH) {
    results = await batchTransferETH(provider, wallet, recipients, dryRun, gasOpts);
  } else {
    results = await batchTransferToken(provider, wallet, tokenAddress, recipients, dryRun, gasOpts);
  }
  
  // 输出结果
  if (results) {
    console.log('\n📊 转账结果汇总:\n');
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✅ 成功: ${success}`);
    console.log(`❌ 失败: ${failed}`);
    
    if (failed > 0) {
      console.log('\n失败的交易:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.to}: ${r.error}`);
      });
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ 错误:', error.message);
    process.exit(1);
  });
}

module.exports = { batchTransferETH, batchTransferToken };
