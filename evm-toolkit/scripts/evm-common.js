/**
 * EVM 工具集公共模块
 * 共享常量、ABI、工具函数
 */

const path = require('path');
const fs = require('fs');

// 默认 RPC
const DEFAULT_RPC = 'https://eth.llamarpc.com';

// vault 目录
const VAULT_DIR = path.join(__dirname, '..', '..', '..', 'vault');

// ERC20 ABI
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)'
];

// 加载主钱包（requireKey=true 时校验私钥）
function loadMainWallet(requireKey = true) {
  const { isAddress } = require('ethers');
  const walletPath = path.join(VAULT_DIR, 'evm-wallet-main.json');
  if (!fs.existsSync(walletPath)) {
    throw new Error('主钱包不存在，请先配置主地址');
  }
  let walletData;
  try {
    walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  } catch (e) {
    throw new Error(`主钱包文件解析失败: ${e.message}`);
  }
  if (!walletData.address || !isAddress(walletData.address)) {
    throw new Error('主钱包地址无效');
  }
  if (requireKey && !walletData.privateKey) {
    throw new Error('主钱包私钥缺失');
  }
  return walletData;
}

// 安全读取 JSON 文件
function readJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    throw new Error(`文件解析失败: ${filePath} (${e.message})`);
  }
}

// 安全读取文本文件（按行分割）
function readLines(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').map(l => l.trim()).filter(l => l.length > 0);
  } catch (e) {
    throw new Error(`文件读取失败: ${filePath} (${e.message})`);
  }
}

// Gas 费用异常确认
// ETH 转账正常单笔 ~0.000005 ETH，ERC20 ~0.00002 ETH
// 超过阈值时要求用户确认
const GAS_THRESHOLDS = {
  eth: 0.0005,   // 单笔 ETH 转账 gas > 0.0005 ETH 视为异常
  erc20: 0.001   // 单笔 ERC20 转账 gas > 0.001 ETH 视为异常
};

// 默认单笔 gas 硬上限（未指定 --max-fee 时生效）
const DEFAULT_MAX_FEE_PER_TX = 0.005; // 0.005 ETH/笔
const GAS_CONFIG_FILE = '/tmp/evm-gas-config.json';

// 读取 gas 快捷配置（Telegram 面板设置）
function loadGasConfig() {
  try {
    return JSON.parse(fs.readFileSync(GAS_CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// 保存 gas 快捷配置
function saveGasConfig(config) {
  fs.writeFileSync(GAS_CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// 解析 gas 相关 CLI 参数（--gas-price, --max-fee）
// 优先级：CLI 参数 > 快捷配置 > 默认值
function parseGasArgs(args) {
  const { parseUnits } = require('ethers');
  const config = loadGasConfig();
  let gasPrice = null;
  let maxFee = null;
  let gasWar = config.gasWar || false;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gas-price' && args[i + 1]) {
      const val = Number(args[i + 1]);
      if (isNaN(val) || val <= 0) { console.error('❌ --gas-price 必须是正数（单位 Gwei）'); process.exit(1); }
      gasPrice = parseUnits(args[i + 1], 'gwei');
      i++;
    } else if (args[i] === '--max-fee' && args[i + 1]) {
      const val = Number(args[i + 1]);
      if (isNaN(val) || val <= 0) { console.error('❌ --max-fee 必须是正数（单位 ETH）'); process.exit(1); }
      maxFee = parseUnits(args[i + 1], 'ether');
      i++;
    } else if (args[i] === '--gas-war') {
      gasWar = true;
    }
  }
  
  // gas-war 模式：不设上限
  if (gasWar) {
    console.log('🔥 Gas War 模式：已取消 gas 费用硬上限\n');
    maxFee = null;
  } else if (!maxFee) {
    // 快捷配置 > 默认值
    const cfgMaxFee = config.maxFee;
    if (cfgMaxFee && cfgMaxFee > 0) {
      maxFee = parseUnits(cfgMaxFee.toString(), 'ether');
      console.log(`⚙️  使用快捷配置 max-fee: ${cfgMaxFee} ETH/笔`);
    } else {
      maxFee = parseUnits(DEFAULT_MAX_FEE_PER_TX.toString(), 'ether');
    }
  }
  
  return { gasPrice, maxFee };
}

// 获取 gas 价格（优先用户指定，否则从链上获取）
async function getGasPrice(provider, userGasPrice = null) {
  if (userGasPrice) {
    const { formatUnits } = require('ethers');
    console.log(`⛽ 使用手动 Gas 价格: ${formatUnits(userGasPrice, 'gwei')} Gwei`);
    return userGasPrice;
  }
  const feeData = await provider.getFeeData();
  return feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
}

// 检查单笔 gas 费用是否超过 --max-fee 上限
function checkMaxFee(perTxGasCost, maxFee) {
  if (maxFee && perTxGasCost > maxFee) {
    const { formatEther } = require('ethers');
    const msg = `当前 Gas ${formatEther(perTxGasCost)} ETH 超过 max-fee ${formatEther(maxFee)} ETH，已终止。\n请输入【gas 设置】唤醒设置面板`;
    throw new Error(msg);
  }
}

async function confirmGasCost(totalGasCost, txCount, type = 'eth') {
  if (!txCount || txCount <= 0) return;
  const { formatEther } = require('ethers');
  const perTxGas = Number(formatEther(totalGasCost / BigInt(txCount)));
  const threshold = GAS_THRESHOLDS[type] || GAS_THRESHOLDS.eth;
  
  if (perTxGas <= threshold) return;
  
  // 超阈值：打警告，继续执行（安全性靠 --max-fee 硬上限兜底）
  console.log(`\n⚠️  Gas 费用偏高（单笔 ${formatEther(totalGasCost / BigInt(txCount))} ETH，阈值 ${threshold} ETH），继续执行...`);
}

module.exports = {
  DEFAULT_RPC,
  VAULT_DIR,
  ERC20_ABI,
  GAS_THRESHOLDS,
  DEFAULT_MAX_FEE_PER_TX,
  GAS_CONFIG_FILE,
  loadGasConfig,
  saveGasConfig,
  loadMainWallet,
  readJSON,
  readLines,
  confirmGasCost,
  parseGasArgs,
  getGasPrice,
  checkMaxFee
};
