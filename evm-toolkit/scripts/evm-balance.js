#!/usr/bin/env node
/**
 * EVM 余额查询工具
 * 查询地址的 ETH 和 ERC20 代币余额
 * 
 * 使用方法：
 *   ./evm-balance.js --address 0x...                    # 查询 ETH 余额
 *   ./evm-balance.js --address 0x... --token 0x...      # 查询代币余额
 *   ./evm-balance.js --file wallets.json                # 批量查询
 */

const { JsonRpcProvider, Contract, formatEther, formatUnits } = require('ethers');
const { ERC20_ABI, DEFAULT_RPC, readJSON } = require('./evm-common');

// 查询单个地址的 ETH 余额
async function queryETHBalance(provider, address) {
  const balance = await provider.getBalance(address);
  return {
    address,
    balance: formatEther(balance),
    balanceWei: balance.toString()
  };
}

// 查询单个地址的代币余额
async function queryTokenBalance(provider, address, tokenAddress) {
  const token = new Contract(tokenAddress, ERC20_ABI, provider);
  
  const [balance, symbol, decimals, name] = await Promise.all([
    token.balanceOf(address),
    token.symbol(),
    token.decimals(),
    token.name()
  ]);
  
  return {
    address,
    token: {
      address: tokenAddress,
      name,
      symbol,
      decimals: Number(decimals)
    },
    balance: formatUnits(balance, decimals),
    balanceRaw: balance.toString()
  };
}

// 批量查询
async function batchQuery(provider, addresses, tokenAddress = null) {
  console.log(`\n📊 批量查询余额 (${addresses.length} 个地址)\n`);
  
  const results = [];
  let totalBalance = 0n;
  
  // 代币信息只查一次
  let tokenInfo = null;
  if (tokenAddress) {
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals()
    ]);
    tokenInfo = { token, name, symbol, decimals };
    console.log(`🪙 代币: ${symbol} (${name}, 精度: ${decimals})\n`);
  }
  
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    console.log(`[${i + 1}/${addresses.length}] 查询 ${address}...`);
    
    try {
      let result;
      if (tokenInfo) {
        const balance = await tokenInfo.token.balanceOf(address);
        totalBalance += balance;
        const balanceFormatted = formatUnits(balance, tokenInfo.decimals);
        console.log(`  💰 余额: ${balanceFormatted} ${tokenInfo.symbol}\n`);
        result = {
          address,
          token: {
            address: tokenAddress,
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            decimals: Number(tokenInfo.decimals)
          },
          balance: balanceFormatted,
          balanceRaw: balance.toString()
        };
      } else {
        result = await queryETHBalance(provider, address);
        totalBalance += BigInt(result.balanceWei);
        console.log(`  💰 余额: ${result.balance} ETH\n`);
      }
      results.push(result);
    } catch (error) {
      console.log(`  ❌ 查询失败: ${error.message}\n`);
      results.push({
        address,
        error: error.message
      });
    }
  }
  
  // 输出汇总
  console.log('📊 汇总统计:\n');
  const successCount = results.filter(r => !r.error).length;
  console.log(`✅ 成功: ${successCount}`);
  console.log(`❌ 失败: ${results.length - successCount}`);
  
  if (successCount > 0) {
    if (tokenInfo) {
      console.log(`💰 总余额: ${formatUnits(totalBalance, tokenInfo.decimals)} ${tokenInfo.symbol}`);
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
💰 EVM 余额查询工具

使用方法：

1. 查询单个地址的 ETH 余额:
   ./evm-balance.js --address 0x...

2. 查询单个地址的代币余额:
   ./evm-balance.js --address 0x... --token 0x...

3. 批量查询 ETH 余额:
   ./evm-balance.js --file wallets.json

4. 批量查询代币余额:
   ./evm-balance.js --file wallets.json --token 0x...

参数说明：
  --address <addr>     查询地址
  --token <addr>       代币合约地址（可选，不指定则查询 ETH）
  --file <path>        批量查询文件（JSON 格式）
  --rpc <url>          RPC 节点地址（默认: https://eth.llamarpc.com）
  --help               显示帮助

批量查询文件格式 (wallets.json):
[
  "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "0x1234567890123456789012345678901234567890"
]

或者包含私钥的格式（会自动提取地址）:
[
  { "address": "0x...", "privateKey": "0x..." }
]
    `);
    process.exit(0);
  }
  
  // 解析参数
  let address = null;
  let tokenAddress = null;
  let file = null;
  let rpcUrl = DEFAULT_RPC;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--address' && args[i + 1]) {
      address = args[i + 1];
      i++;
    } else if (args[i] === '--token' && args[i + 1]) {
      tokenAddress = args[i + 1];
      i++;
    } else if (args[i] === '--file' && args[i + 1]) {
      file = args[i + 1];
      i++;
    } else if (args[i] === '--rpc' && args[i + 1]) {
      rpcUrl = args[i + 1];
      i++;
    }
  }
  
  // 验证参数
  if (!address && !file) {
    console.error('❌ 请指定 --address 或 --file');
    process.exit(1);
  }
  
  // 连接 RPC
  console.log(`🌐 连接 RPC: ${rpcUrl}`);
  const provider = new JsonRpcProvider(rpcUrl);
  
  // 执行查询
  if (file) {
    // 批量查询
    let data;
    try {
      data = readJSON(file);
    } catch (e) {
      console.error(`❌ ${e.message}`);
      process.exit(1);
    }
    let addresses;
    
    if (!Array.isArray(data) || data.length === 0) {
      console.error('❌ 文件为空或格式错误');
      process.exit(1);
    }
    
    if (typeof data[0] === 'string') {
      // 纯地址列表
      addresses = data;
    } else if (data[0].address) {
      // 包含地址的对象列表
      addresses = data.map(item => item.address);
    } else {
      console.error('❌ 文件格式错误');
      process.exit(1);
    }
    
    await batchQuery(provider, addresses, tokenAddress);
  } else {
    // 单个查询
    console.log(`\n📊 查询地址: ${address}\n`);
    
    try {
      let result;
      if (tokenAddress) {
        result = await queryTokenBalance(provider, address, tokenAddress);
        console.log(`🪙 代币信息:`);
        console.log(`  - 名称: ${result.token.name}`);
        console.log(`  - 符号: ${result.token.symbol}`);
        console.log(`  - 精度: ${result.token.decimals}`);
        console.log(`  - 合约: ${result.token.address}\n`);
        console.log(`💰 余额: ${result.balance} ${result.token.symbol}`);
      } else {
        result = await queryETHBalance(provider, address);
        console.log(`💰 ETH 余额: ${result.balance} ETH`);
      }
    } catch (error) {
      console.error(`❌ 查询失败: ${error.message}`);
      process.exit(1);
    }
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ 错误:', error.message);
    process.exit(1);
  });
}

module.exports = { queryETHBalance, queryTokenBalance, batchQuery };
