#!/usr/bin/env node
/**
 * EVM 地址验证工具
 * 验证地址格式和校验和
 * 
 * 使用方法：
 *   ./evm-validate.js --address 0x...
 *   ./evm-validate.js --file addresses.txt
 */

const { getAddress } = require('ethers');
const fs = require('fs');
const { readLines } = require('./evm-common');

// 验证单个地址
function validateAddress(address) {
  try {
    // 检查格式
    if (!address.startsWith('0x')) {
      return {
        address,
        valid: false,
        error: '地址必须以 0x 开头'
      };
    }
    
    if (address.length !== 42) {
      return {
        address,
        valid: false,
        error: `地址长度错误（应为42个字符，实际${address.length}个）`
      };
    }
    
    // 使用 ethers.js 验证
    const checksumAddress = getAddress(address);
    
    // 检查校验和
    const hasCorrectChecksum = address === checksumAddress;
    
    return {
      address,
      checksumAddress,
      valid: true,
      hasCorrectChecksum,
      warning: hasCorrectChecksum ? null : '校验和不正确（但地址有效）'
    };
  } catch (error) {
    return {
      address,
      valid: false,
      error: error.message
    };
  }
}

// 批量验证
function batchValidate(addresses) {
  console.log(`\n🔍 验证 ${addresses.length} 个地址...\n`);
  
  const results = [];
  let validCount = 0;
  let invalidCount = 0;
  let checksumWarnings = 0;
  
  for (let i = 0; i < addresses.length; i++) {
    const address = addresses[i];
    const result = validateAddress(address);
    
    results.push(result);
    
    if (result.valid) {
      validCount++;
      if (!result.hasCorrectChecksum) {
        checksumWarnings++;
      }
    } else {
      invalidCount++;
    }
    
    // 输出结果
    console.log(`[${i + 1}/${addresses.length}] ${address}`);
    
    if (result.valid) {
      if (result.hasCorrectChecksum) {
        console.log(`  ✅ 有效（校验和正确）`);
      } else {
        console.log(`  ⚠️  有效但校验和不正确`);
        console.log(`  正确格式: ${result.checksumAddress}`);
      }
    } else {
      console.log(`  ❌ 无效: ${result.error}`);
    }
    
    console.log('');
  }
  
  // 输出汇总
  console.log('📊 验证结果汇总:\n');
  console.log(`✅ 有效: ${validCount}`);
  console.log(`❌ 无效: ${invalidCount}`);
  if (checksumWarnings > 0) {
    console.log(`⚠️  校验和警告: ${checksumWarnings}`);
  }
  
  return results;
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🔍 EVM 地址验证工具

使用方法：

1. 验证单个地址:
   ./evm-validate.js --address 0x...

2. 验证多个地址（逗号分隔）:
   ./evm-validate.js --addresses 0x...,0x...

3. 从文件读取地址列表:
   ./evm-validate.js --file addresses.txt

4. 修复校验和并输出:
   ./evm-validate.js --file addresses.txt --fix --output fixed-addresses.txt

参数说明：
  --address <addr>     单个地址
  --addresses <list>   地址列表（逗号分隔）
  --file <path>        地址列表文件
  --fix                修复校验和
  --output <path>      输出文件（仅与 --fix 一起使用）
  --help               显示帮助

地址格式:
  - 必须以 0x 开头
  - 长度必须为 42 个字符（0x + 40 个十六进制字符）
  - 建议使用正确的校验和格式（大小写混合）
    `);
    process.exit(0);
  }
  
  // 解析参数
  let addresses = [];
  let fix = false;
  let output = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--address' && args[i + 1]) {
      addresses = [args[i + 1]];
      i++;
    } else if (args[i] === '--addresses' && args[i + 1]) {
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
    } else if (args[i] === '--fix') {
      fix = true;
    } else if (args[i] === '--output' && args[i + 1]) {
      output = args[i + 1];
      i++;
    }
  }
  
  // 验证参数
  if (addresses.length === 0) {
    console.error('❌ 请指定 --address、--addresses 或 --file');
    process.exit(1);
  }
  
  // 执行验证
  const results = batchValidate(addresses);
  
  // 修复校验和
  if (fix) {
    const fixedAddresses = results
      .filter(r => r.valid)
      .map(r => r.checksumAddress);
    
    if (output) {
      fs.writeFileSync(output, fixedAddresses.join('\n'));
      console.log(`\n✅ 已修复并保存到: ${output}`);
    } else {
      console.log('\n📋 修复后的地址:\n');
      fixedAddresses.forEach((addr, i) => {
        console.log(`${i + 1}. ${addr}`);
      });
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateAddress, batchValidate };
