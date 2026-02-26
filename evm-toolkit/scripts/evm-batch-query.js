#!/usr/bin/env node
/**
 * EVM 批量查询工具
 * 快速查询多个地址的余额和信息
 * 
 * 使用方法：
 *   ./evm-batch-query.js --addresses 0x...,0x... 
 *   ./evm-batch-query.js --file addresses.txt
 */

const { JsonRpcProvider, Contract, formatEther, formatUnits, Interface } = require('ethers');
const { ERC20_ABI, DEFAULT_RPC, readLines } = require('./evm-common');

// Multicall3 合约（所有主流 EVM 链通用地址）
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'
];

// 检测链上是否部署了 Multicall3
async function hasMulticall(provider) {
  try {
    const code = await provider.getCode(MULTICALL3_ADDRESS);
    return code !== '0x';
  } catch { return false; }
}

// Multicall 批量查询（ETH 或 ERC20，一次 RPC 调用）
async function batchQueryMulticall(provider, addresses, tokenAddress, tokenSymbol, tokenDecimals) {
  const multicall = new Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const iface = tokenAddress
    ? new Interface(ERC20_ABI)
    : new Interface(['function getEthBalance(address) view returns (uint256)']);
  
  // 构建 calls
  const calls = addresses.map(addr => ({
    target: tokenAddress || MULTICALL3_ADDRESS,
    allowFailure: true,
    callData: tokenAddress
      ? iface.encodeFunctionData('balanceOf', [addr])
      : iface.encodeFunctionData('getEthBalance', [addr])
  }));
  
  const results = await multicall.aggregate3(calls);
  
  const parsed = [];
  let totalBalance = 0n;
  
  for (let i = 0; i < addresses.length; i++) {
    const { success, returnData } = results[i];
    
    if (success && returnData !== '0x') {
      const balance = BigInt(returnData);
      totalBalance += balance;
      
      if (tokenAddress) {
        const balanceFormatted = formatUnits(balance, tokenDecimals);
        console.log(`[${i + 1}/${addresses.length}] ${addresses[i]}`);
        console.log(`  💰 ${balanceFormatted} ${tokenSymbol}\n`);
        parsed.push({ address: addresses[i], balance: balanceFormatted, symbol: tokenSymbol, decimals: Number(tokenDecimals), success: true });
      } else {
        const balanceFormatted = formatEther(balance);
        console.log(`[${i + 1}/${addresses.length}] ${addresses[i]}`);
        console.log(`  💰 ${balanceFormatted} ETH\n`);
        parsed.push({ address: addresses[i], balance: balanceFormatted, success: true });
      }
    } else {
      console.log(`[${i + 1}/${addresses.length}] ${addresses[i]}`);
      console.log(`  ❌ 查询失败\n`);
      parsed.push({ address: addresses[i], error: 'multicall failed', success: false });
    }
  }
  
  return { results: parsed, totalBalance };
}

// 批量查询余额（自动选择 multicall 或逐个查询）
async function batchQuery(provider, addresses, tokenAddress = null) {
  console.log(`\n📊 批量查询 ${addresses.length} 个地址...\n`);
  
  // 代币信息只查一次
  let tokenSymbol, tokenDecimals, tokenContract;
  if (tokenAddress) {
    tokenContract = new Contract(tokenAddress, ERC20_ABI, provider);
    [tokenSymbol, tokenDecimals] = await Promise.all([
      tokenContract.symbol(),
      tokenContract.decimals()
    ]);
    console.log(`🪙 代币: ${tokenSymbol} (精度: ${tokenDecimals})\n`);
  }
  
  // 尝试 multicall（地址数 >= 3 时有优势）
  if (addresses.length >= 3 && await hasMulticall(provider)) {
    console.log(`⚡ 使用 Multicall3 批量查询\n`);
    const { results, totalBalance } = await batchQueryMulticall(provider, addresses, tokenAddress, tokenSymbol, tokenDecimals);
    
    // 输出汇总
    console.log('📊 汇总统计:\n');
    const successCount = results.filter(r => r.success).length;
    console.log(`✅ 成功: ${successCount}`);
    console.log(`❌ 失败: ${results.length - successCount}`);
    if (successCount > 0) {
      if (tokenAddress) {
        console.log(`💰 总余额: ${formatUnits(totalBalance, tokenDecimals)} ${tokenSymbol}`);
      } else {
        console.log(`💰 总余额: ${formatEther(totalBalance)} ETH`);
      }
    }
    return results;
  }
  
  // 回退：逐个查询
  const results = [];
  let totalBalance = 0n;
  
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    
    try {
      if (tokenAddress) {
        const balance = await tokenContract.balanceOf(address);
        
        totalBalance = totalBalance + balance;
        const balanceFormatted = formatUnits(balance, tokenDecimals);
        
        console.log(`[${i + 1}/${addresses.length}] ${address}`);
        console.log(`  💰 ${balanceFormatted} ${tokenSymbol}`);
        
        results.push({
          address,
          balance: balanceFormatted,
          symbol: tokenSymbol,
          decimals: Number(tokenDecimals),
          success: true
        });
      } else {
        // 查询 ETH 余额
        const balance = await provider.getBalance(address);
        const balanceFormatted = formatEther(balance);
        
        totalBalance = totalBalance + balance;
        
        console.log(`[${i + 1}/${addresses.length}] ${address}`);
        console.log(`  💰 ${balanceFormatted} ETH`);
        
        results.push({
          address,
          balance: balanceFormatted,
          success: true
        });
      }
    } catch (error) {
      console.log(`[${i + 1}/${addresses.length}] ${address}`);
      console.log(`  ❌ 查询失败: ${error.message}`);
      
      results.push({
        address,
        error: error.message,
        success: false
      });
    }
    
    console.log('');
  }
  
  // 输出汇总
  console.log('📊 汇总统计:\n');
  const successCount = results.filter(r => r.success).length;
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${results.length - successCount}`);
  
  if (successCount > 0) {
    if (tokenAddress) {
      console.log(`💰 总余额: ${formatUnits(totalBalance, tokenDecimals)} ${tokenSymbol}`);
    } else {
      console.log(`💰 总余额: ${formatEther(totalBalance)} ETH`);
    }
  }
  
  return results;
}

// 主函数
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
📊 EVM 批量查询工具

使用方法：

1. 查询多个地址（逗号分隔）:
   ./evm-batch-query.js --addresses 0x...,0x...

2. 从文件读取地址列表:
   ./evm-batch-query.js --file addresses.txt

3. 查询代币余额:
   ./evm-batch-query.js --file addresses.txt --token 0xTokenAddress

4. 使用自定义 RPC:
   ./evm-batch-query.js --file addresses.txt --rpc https://mainnet.base.org

参数说明：
  --addresses <list>   地址列表（逗号分隔）
  --file <path>        地址列表文件（每行一个地址）
  --token <address>    代币合约地址（可选）
  --rpc <url>          RPC 节点地址（默认: https://eth.llamarpc.com）
  --help               显示帮助

地址列表文件格式:
0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
0x1234567890123456789012345678901234567890
    `);
    process.exit(0);
  }
  
  // 解析参数
  let addresses = [];
  let tokenAddress = null;
  let rpcUrl = DEFAULT_RPC;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--addresses' && args[i + 1]) {
      addresses = args[i + 1].split(',').map(a => a.trim());
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      try {
        addresses = readLines(args[i + 1]);
      } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--token' && args[i + 1]) {
      tokenAddress = args[i + 1];
      i++;
    } else if (args[i] === '--rpc' && args[i + 1]) {
      rpcUrl = args[i + 1];
      i++;
    }
  }
  
  // 验证参数
  if (addresses.length === 0) {
    console.error('❌ 请指定 --addresses 或 --file');
    process.exit(1);
  }
  
  // 连接 RPC
  console.log(`🌐 连接 RPC: ${rpcUrl}`);
  const provider = new JsonRpcProvider(rpcUrl);
  
  // 执行查询
  await batchQuery(provider, addresses, tokenAddress);
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ 错误:', error.message);
    process.exit(1);
  });
}

module.exports = { batchQuery };
