#!/usr/bin/env node
/**
 * EVM 代币归集工具
 * 从多个地址收集 ETH 或 ERC20 代币到主地址
 * 
 * 使用方法：
 *   ./evm-collect.js --help                           # 显示帮助
 *   ./evm-collect.js --eth --file wallets.json       # 归集 ETH
 *   ./evm-collect.js --token 0x... --file wallets.json  # 归集代币
 */

const { Wallet, JsonRpcProvider, formatEther, formatUnits, Contract } = require('ethers');
const { ERC20_ABI, DEFAULT_RPC, loadMainWallet, readJSON, confirmGasCost, parseGasArgs, getGasPrice, checkMaxFee } = require('./evm-common');

// 归集 ETH
async function collectETH(provider, wallets, mainAddress, dryRun = false, gasOpts = {}) {
  console.log('\n📥 归集 ETH 到主地址\n');
  console.log(`🎯 主地址: ${mainAddress}\n`);
  
  const collections = [];
  
  // 获取当前 gas 价格（一次性）
  const gasPrice = await getGasPrice(provider, gasOpts.gasPrice);
  const gasLimit = 21000n;
  const gasCost = gasPrice * gasLimit;
  // 预留 10% gas 波动余量
  const gasCostWithBuffer = gasCost + gasCost / 10n;
  
  // 检查 --max-fee 单笔上限
  checkMaxFee(gasCostWithBuffer, gasOpts.maxFee);
  
  console.log(`⛽ 当前 Gas: ${formatEther(gasCost)} ETH (含10%余量: ${formatEther(gasCostWithBuffer)} ETH)\n`);
  
  // 检查每个钱包的余额
  for (const walletData of wallets) {
    const wallet = new Wallet(walletData.privateKey, provider);
    const balance = await provider.getBalance(wallet.address);
    
    if (balance > 0n) {
      // 可转账金额 = 余额 - gas 费用（含余量）
      const transferAmount = balance - gasCostWithBuffer;
      
      if (transferAmount > 0n) {
        collections.push({
          wallet,
          address: wallet.address,
          balance: balance,
          transferAmount: transferAmount,
          gasCost: gasCostWithBuffer
        });
        
        console.log(`✅ ${wallet.address}`);
        console.log(`   余额: ${formatEther(balance)} ETH`);
        console.log(`   Gas: ${formatEther(gasCostWithBuffer)} ETH`);
        console.log(`   可归集: ${formatEther(transferAmount)} ETH\n`);
      } else {
        console.log(`⚠️  ${wallet.address}`);
        console.log(`   余额不足支付 gas 费用\n`);
      }
    } else {
      console.log(`⏭️  ${wallet.address} (余额为 0)\n`);
    }
  }
  
  if (collections.length === 0) {
    console.log('❌ 没有可归集的余额');
    return;
  }
  
  const totalAmount = collections.reduce((sum, c) => sum + c.transferAmount, 0n);
  const totalGas = collections.reduce((sum, c) => sum + c.gasCost, 0n);
  console.log(`📊 归集统计:`);
  console.log(`  - 地址数: ${collections.length}`);
  console.log(`  - 总金额: ${formatEther(totalAmount)} ETH`);
  console.log(`  - 总 Gas: ${formatEther(totalGas)} ETH\n`);
  
  // Gas 异常确认
  if (!dryRun) {
    await confirmGasCost(totalGas, collections.length, 'eth');
  }
  
  if (dryRun) {
    console.log('🔍 模拟模式，不会实际发送交易\n');
    return;
  }
  
  console.log('⚠️  即将发送真实交易，请确认...\n');
  
  const results = [];
  for (let i = 0; i < collections.length; i++) {
    const c = collections[i];
    console.log(`[${i + 1}/${collections.length}] 归集 ${formatEther(c.transferAmount)} ETH 从 ${c.address}...`);
    
    try {
      const txResponse = await c.wallet.sendTransaction({
        to: mainAddress,
        value: c.transferAmount,
        gasLimit: 21000n,
        gasPrice
      });
      
      console.log(`  ✅ 交易已发送: ${txResponse.hash}`);
      console.log(`  ⏳ 等待确认...`);
      
      const receipt = await txResponse.wait(1, 120000);
      console.log(`  ✅ 已确认 (区块 ${receipt.blockNumber})\n`);
      
      results.push({
        success: true,
        from: c.address,
        amount: formatEther(c.transferAmount),
        hash: txResponse.hash,
        blockNumber: receipt.blockNumber
      });
    } catch (error) {
      console.log(`  ❌ 失败: ${error.message}\n`);
      results.push({
        success: false,
        from: c.address,
        error: error.message
      });
    }
  }
  
  return results;
}

// 归集 ERC20 代币
async function collectToken(provider, wallets, tokenAddress, mainAddress, dryRun = false, gasOpts = {}) {
  console.log('\n📥 归集 ERC20 代币到主地址\n');
  console.log(`🎯 主地址: ${mainAddress}\n`);
  
  // 获取代币信息
  const tempWallet = new Wallet(wallets[0].privateKey, provider);
  const token = new Contract(tokenAddress, ERC20_ABI, tempWallet);
  
  const [symbol, decimals] = await Promise.all([
    token.symbol(),
    token.decimals()
  ]);
  
  console.log(`🪙 代币信息:`);
  console.log(`  - 合约地址: ${tokenAddress}`);
  console.log(`  - 代币符号: ${symbol}`);
  console.log(`  - 精度: ${decimals}\n`);
  
  const collections = [];
  
  // 获取当前 gas 价格（一次性）
  const gasPrice = await getGasPrice(provider, gasOpts.gasPrice);
  const estimatedGas = 65000n;
  const gasCost = gasPrice * estimatedGas;
  const gasCostWithBuffer = gasCost + gasCost / 10n;
  
  // 检查 --max-fee 单笔上限
  checkMaxFee(gasCostWithBuffer, gasOpts.maxFee);
  
  console.log(`⛽ 当前 Gas: ${formatEther(gasCost)} ETH (含10%余量: ${formatEther(gasCostWithBuffer)} ETH)\n`);
  
  // 检查每个钱包的代币余额
  for (const walletData of wallets) {
    const wallet = new Wallet(walletData.privateKey, provider);
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, wallet);
    
    const [tokenBalance, ethBalance] = await Promise.all([
      tokenContract.balanceOf(wallet.address),
      provider.getBalance(wallet.address)
    ]);
    
    if (tokenBalance > 0n) {
      if (ethBalance >= gasCostWithBuffer) {
        collections.push({
          wallet,
          address: wallet.address,
          tokenBalance: tokenBalance,
          ethBalance: ethBalance,
          gasCost: gasCostWithBuffer
        });
        
        console.log(`✅ ${wallet.address}`);
        console.log(`   代币余额: ${formatUnits(tokenBalance, decimals)} ${symbol}`);
        console.log(`   ETH 余额: ${formatEther(ethBalance)} ETH`);
        console.log(`   预估 Gas: ${formatEther(gasCostWithBuffer)} ETH\n`);
      } else {
        console.log(`⚠️  ${wallet.address}`);
        console.log(`   代币余额: ${formatUnits(tokenBalance, decimals)} ${symbol}`);
        console.log(`   ETH 不足支付 gas (需要 ${formatEther(gasCostWithBuffer)} ETH)\n`);
      }
    } else {
      console.log(`⏭️  ${wallet.address} (代币余额为 0)\n`);
    }
  }
  
  if (collections.length === 0) {
    console.log('❌ 没有可归集的代币余额');
    return;
  }
  
  const totalAmount = collections.reduce((sum, c) => sum + c.tokenBalance, 0n);
  const totalGas = collections.reduce((sum, c) => sum + c.gasCost, 0n);
  console.log(`📊 归集统计:`);
  console.log(`  - 地址数: ${collections.length}`);
  console.log(`  - 总金额: ${formatUnits(totalAmount, decimals)} ${symbol}`);
  console.log(`  - 总 Gas: ${formatEther(totalGas)} ETH\n`);
  
  // Gas 异常确认
  if (!dryRun) {
    await confirmGasCost(totalGas, collections.length, 'erc20');
  }
  
  if (dryRun) {
    console.log('🔍 模拟模式，不会实际发送交易\n');
    return;
  }
  
  console.log('⚠️  即将发送真实交易，请确认...\n');
  
  const results = [];
  for (let i = 0; i < collections.length; i++) {
    const c = collections[i];
    const tokenContract = new Contract(tokenAddress, ERC20_ABI, c.wallet);
    
    console.log(`[${i + 1}/${collections.length}] 归集 ${formatUnits(c.tokenBalance, decimals)} ${symbol} 从 ${c.address}...`);
    
    try {
      const txResponse = await tokenContract.transfer(mainAddress, c.tokenBalance, { gasPrice });
      
      console.log(`  ✅ 交易已发送: ${txResponse.hash}`);
      console.log(`  ⏳ 等待确认...`);
      
      const receipt = await txResponse.wait(1, 120000);
      console.log(`  ✅ 已确认 (区块 ${receipt.blockNumber})\n`);
      
      results.push({
        success: true,
        from: c.address,
        amount: formatUnits(c.tokenBalance, decimals),
        hash: txResponse.hash,
        blockNumber: receipt.blockNumber
      });
    } catch (error) {
      console.log(`  ❌ 失败: ${error.message}\n`);
      results.push({
        success: false,
        from: c.address,
        error: error.message
      });
    }
  }
  
  return results;
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔄 EVM 代币归集工具

使用方法：

1. 归集 ETH:
   ./evm-collect.js --eth --file wallets.json

2. 归集 ERC20 代币:
   ./evm-collect.js --token 0x... --file wallets.json

3. 模拟模式（不实际发送）:
   ./evm-collect.js --eth --file wallets.json --dry-run

参数说明：
  --eth                归集 ETH
  --token <address>    归集 ERC20 代币（指定合约地址）
  --file <path>        钱包文件（JSON 格式）
  --rpc <url>          RPC 节点地址（默认: https://eth.llamarpc.com）
  --dry-run            模拟模式，不实际发送交易
  --help               显示帮助

钱包文件格式 (wallets.json):
[
  { "address": "0x...", "privateKey": "0x..." },
  { "address": "0x...", "privateKey": "0x..." }
]

⚠️  安全提醒：
  - 请先使用 --dry-run 模拟测试
  - 归集 ETH 时会自动扣除 gas 费用
  - 归集代币时需要确保每个地址有足够的 ETH 支付 gas
  - 建议先小额测试
    `);
    process.exit(0);
  }
  
  // 解析参数
  let isETH = false;
  let tokenAddress = null;
  let walletsFile = null;
  let rpcUrl = DEFAULT_RPC;
  let dryRun = false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--eth') {
      isETH = true;
    } else if (args[i] === '--token' && args[i + 1]) {
      tokenAddress = args[i + 1];
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      walletsFile = args[i + 1];
      i++;
    } else if (args[i] === '--rpc' && args[i + 1]) {
      rpcUrl = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  
  // 验证参数
  if (!isETH && !tokenAddress) {
    console.error('❌ 请指定 --eth 或 --token <address>');
    process.exit(1);
  }
  
  if (!walletsFile) {
    console.error('❌ 请指定钱包文件（--file）');
    process.exit(1);
  }
  
  // 加载钱包
  console.log('🔐 加载钱包...');
  let wallets;
  try {
    wallets = readJSON(walletsFile);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(wallets) || wallets.length === 0) {
    console.error('❌ 钱包文件为空或格式错误');
    process.exit(1);
  }
  
  // 校验子钱包格式
  for (let i = 0; i < wallets.length; i++) {
    if (!wallets[i].privateKey) {
      console.error(`❌ 钱包 #${i + 1} 缺少 privateKey`);
      process.exit(1);
    }
    if (!wallets[i].address) {
      console.error(`❌ 钱包 #${i + 1} 缺少 address`);
      process.exit(1);
    }
  }
  console.log(`✅ 加载了 ${wallets.length} 个钱包\n`);
  
  // 加载主地址
  const mainAddress = loadMainWallet(false).address;
  
  // 连接 RPC
  console.log(`🌐 连接 RPC: ${rpcUrl}`);
  const provider = new JsonRpcProvider(rpcUrl);
  
  // 解析 gas 参数
  const gasOpts = parseGasArgs(args);
  
  // 执行归集
  let results;
  if (isETH) {
    results = await collectETH(provider, wallets, mainAddress, dryRun, gasOpts);
  } else {
    results = await collectToken(provider, wallets, tokenAddress, mainAddress, dryRun, gasOpts);
  }
  
  // 输出结果
  if (results) {
    console.log('\n📊 归集结果汇总:\n');
    const success = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`✅ 成功: ${success}`);
    console.log(`❌ 失败: ${failed}`);
    
    if (failed > 0) {
      console.log('\n失败的交易:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.from}: ${r.error}`);
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

module.exports = { collectETH, collectToken };
