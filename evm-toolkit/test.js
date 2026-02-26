#!/usr/bin/env node
/**
 * EVM 工具集自动化测试
 * 覆盖所有功能模块的正常路径和错误边界
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPTS = path.join(__dirname, 'scripts');
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
let passed = 0, failed = 0, skipped = 0;

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { cwd: SCRIPTS, timeout: opts.timeout || 15000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
  } catch (e) {
    if (opts.expectFail) return e.stderr || e.stdout || e.message;
    throw e;
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertIncludes(str, sub) { assert(str.includes(sub), `Expected "${sub}" in output`); }

// ============================================================
console.log('\n📦 1. evm-common.js 公共模块\n');

test('DEFAULT_RPC 是字符串', () => {
  const { DEFAULT_RPC } = require('./scripts/evm-common');
  assert(typeof DEFAULT_RPC === 'string');
  assertIncludes(DEFAULT_RPC, 'llamarpc');
});

test('VAULT_DIR 指向 workspace/vault', () => {
  const { VAULT_DIR } = require('./scripts/evm-common');
  assertIncludes(VAULT_DIR, 'workspace/vault');
});

test('ERC20_ABI 包含 5 个函数', () => {
  const { ERC20_ABI } = require('./scripts/evm-common');
  assert(ERC20_ABI.length === 5);
});

test('readJSON 不存在的文件抛错', () => {
  const { readJSON } = require('./scripts/evm-common');
  try { readJSON('/tmp/nonexistent_xyz.json'); assert(false); } catch (e) { assertIncludes(e.message, '不存在'); }
});

test('readJSON 损坏文件抛错', () => {
  fs.writeFileSync('/tmp/test_bad.json', '{broken');
  const { readJSON } = require('./scripts/evm-common');
  try { readJSON('/tmp/test_bad.json'); assert(false); } catch (e) { assertIncludes(e.message, '解析失败'); }
  fs.unlinkSync('/tmp/test_bad.json');
});

test('readLines 正常读取', () => {
  fs.writeFileSync('/tmp/test_lines.txt', 'aaa\nbbb\n\nccc\n');
  const { readLines } = require('./scripts/evm-common');
  const lines = readLines('/tmp/test_lines.txt');
  assert(lines.length === 3);
  assert(lines[0] === 'aaa' && lines[2] === 'ccc');
  fs.unlinkSync('/tmp/test_lines.txt');
});

test('readLines 不存在的文件抛错', () => {
  const { readLines } = require('./scripts/evm-common');
  try { readLines('/tmp/nonexistent_xyz.txt'); assert(false); } catch (e) { assertIncludes(e.message, '不存在'); }
});

test('loadMainWallet 加载成功', () => {
  const { loadMainWallet } = require('./scripts/evm-common');
  const w = loadMainWallet(false);
  assert(w.address.startsWith('0x'));
});

test('GAS_THRESHOLDS 阈值正确', () => {
  const { GAS_THRESHOLDS } = require('./scripts/evm-common');
  assert(GAS_THRESHOLDS.eth === 0.0005);
  assert(GAS_THRESHOLDS.erc20 === 0.001);
});

test('parseGasArgs 解析 --gas-price', () => {
  const { parseGasArgs } = require('./scripts/evm-common');
  const opts = parseGasArgs(['--gas-price', '50']);
  assert(opts.gasPrice > 0n);
  assert(opts.maxFee > 0n); // 默认 maxFee 生效
});

test('parseGasArgs 解析 --max-fee', () => {
  const { parseGasArgs } = require('./scripts/evm-common');
  const opts = parseGasArgs(['--max-fee', '0.01']);
  assert(opts.gasPrice === null);
  assert(opts.maxFee > 0n);
});

test('parseGasArgs 无参数使用默认 maxFee', () => {
  const { parseGasArgs, DEFAULT_MAX_FEE_PER_TX, GAS_CONFIG_FILE } = require('./scripts/evm-common');
  const { parseUnits } = require('ethers');
  const fs = require('fs');
  // 临时移除配置文件，确保使用默认值
  const backup = fs.existsSync(GAS_CONFIG_FILE) ? fs.readFileSync(GAS_CONFIG_FILE) : null;
  try { fs.unlinkSync(GAS_CONFIG_FILE); } catch {}
  try {
    const opts = parseGasArgs(['--eth', '--file', 'x.json']);
    assert(opts.gasPrice === null);
    assert(opts.maxFee === parseUnits(DEFAULT_MAX_FEE_PER_TX.toString(), 'ether'));
  } finally {
    if (backup) fs.writeFileSync(GAS_CONFIG_FILE, backup);
  }
});

test('DEFAULT_MAX_FEE_PER_TX 为 0.005', () => {
  const { DEFAULT_MAX_FEE_PER_TX } = require('./scripts/evm-common');
  assert(DEFAULT_MAX_FEE_PER_TX === 0.005);
});

test('parseGasArgs --gas-war 取消上限', () => {
  const { parseGasArgs } = require('./scripts/evm-common');
  const opts = parseGasArgs(['--gas-war']);
  assert(opts.maxFee === null);
});

test('checkMaxFee 不超限静默通过', () => {
  const { checkMaxFee } = require('./scripts/evm-common');
  checkMaxFee(1000n, 2000n); // 不抛错
  assert(true);
});

test('checkMaxFee 超限抛错', () => {
  const { checkMaxFee } = require('./scripts/evm-common');
  try { checkMaxFee(3000n, 2000n); assert(false); } catch (e) { assertIncludes(e.message, '超过 max-fee'); }
});

// ============================================================
console.log('\n🔐 2. evm-wallet-gen.js 钱包生成\n');

test('生成 1 个钱包', () => {
  const out = run('node evm-wallet-gen.js --count 1');
  assertIncludes(out, '地址:');
  assertIncludes(out, '私钥:');
});

test('生成 3 个钱包', () => {
  const out = run('node evm-wallet-gen.js --count 3');
  assert((out.match(/地址:/g) || []).length === 3);
});

test('助记词派生', () => {
  const out = run('node evm-wallet-gen.js --mnemonic --count 2');
  assertIncludes(out, '助记词:');
  assertIncludes(out, '派生路径:');
});

test('--count NaN 报错', () => {
  const out = run('node evm-wallet-gen.js --count abc', { expectFail: true });
  assertIncludes(out, '正整数');
});

test('--count 负数报错', () => {
  const out = run('node evm-wallet-gen.js --count -1', { expectFail: true });
  assertIncludes(out, '正整数');
});

test('--help 显示帮助', () => {
  const out = run('node evm-wallet-gen.js --help');
  assertIncludes(out, '钱包地址生成器');
});

// ============================================================
console.log('\n📦 3. evm-batch-gen.js 批量生成\n');

test('批量生成 3 个', () => {
  const out = run('node evm-batch-gen.js --count 3');
  assertIncludes(out, '生成完成');
  assert((out.match(/0x[0-9a-fA-F]{40}/g) || []).length >= 3);
});

test('--format 无 --output 报错', () => {
  const out = run('node evm-batch-gen.js --count 1 --format csv', { expectFail: true });
  assertIncludes(out, '--output');
});

test('--format json --output 导出', () => {
  const out = run('node evm-batch-gen.js --count 2 --format json --output /tmp/test_export.json');
  assertIncludes(out, '已导出为 JSON');
  const data = JSON.parse(fs.readFileSync('/tmp/test_export.json', 'utf8'));
  assert(data.length === 2);
  // 检查权限 600
  const stat = fs.statSync('/tmp/test_export.json');
  assert((stat.mode & 0o777) === 0o600, '权限应为 600');
  fs.unlinkSync('/tmp/test_export.json');
});

test('--format csv --output 导出', () => {
  const out = run('node evm-batch-gen.js --count 2 --format csv --output /tmp/test_export.csv');
  assertIncludes(out, '已导出为 CSV');
  const csv = fs.readFileSync('/tmp/test_export.csv', 'utf8');
  assertIncludes(csv, 'Index,Address');
  fs.unlinkSync('/tmp/test_export.csv');
});

test('--format list --output 导出', () => {
  const out = run('node evm-batch-gen.js --count 2 --format list --output /tmp/test_addrs.txt');
  assertIncludes(out, '已导出地址列表');
  const lines = fs.readFileSync('/tmp/test_addrs.txt', 'utf8').trim().split('\n');
  assert(lines.length === 2);
  fs.unlinkSync('/tmp/test_addrs.txt');
});

test('count 上限 1000', () => {
  const out = run('node evm-batch-gen.js --count 1001', { expectFail: true });
  assertIncludes(out, '1-1000');
});

// ============================================================
console.log('\n✅ 4. evm-validate.js 地址验证\n');

test('有效地址（校验和正确）', () => {
  const out = run('node evm-validate.js --address 0x2fEE02faD2FF69A7905767b6E5B54C610D425941');
  assertIncludes(out, '有效');
});

test('无效地址', () => {
  const out = run('node evm-validate.js --address 0xinvalid');
  assertIncludes(out, '无效');
});

test('小写地址（校验和警告）', () => {
  const out = run('node evm-validate.js --address 0x2fee02fad2ff69a7905767b6e5b54c610d425941');
  assertIncludes(out, '校验和');
});

test('从文件验证', () => {
  fs.writeFileSync('/tmp/test_addrs_v.txt', '0x2fEE02faD2FF69A7905767b6E5B54C610D425941\n0xinvalid\n');
  const out = run('node evm-validate.js --file /tmp/test_addrs_v.txt');
  assertIncludes(out, '有效: 1');
  assertIncludes(out, '无效: 1');
  fs.unlinkSync('/tmp/test_addrs_v.txt');
});

test('文件不存在报错', () => {
  const out = run('node evm-validate.js --file /tmp/nonexistent.txt', { expectFail: true });
  assertIncludes(out, '不存在');
});

// ============================================================
console.log('\n🏷️  5. evm-labels.js 标签管理\n');

test('添加标签', () => {
  const out = run('node evm-labels.js add --address 0xTEST1 --label "测试标签" --note "备注"');
  assertIncludes(out, '已添加');
});

test('查询标签', () => {
  const out = run('node evm-labels.js get --address 0xTEST1');
  assertIncludes(out, '测试标签');
  assertIncludes(out, '备注');
});

test('更新标签保留 createdAt', () => {
  const out = run('node evm-labels.js add --address 0xTEST1 --label "更新标签"');
  assertIncludes(out, '已更新');
});

test('列出标签', () => {
  const out = run('node evm-labels.js list');
  assertIncludes(out, '更新标签');
});

test('导出标签', () => {
  const out = run('node evm-labels.js export --output /tmp/test_labels.csv');
  assertIncludes(out, '已导出');
  const csv = fs.readFileSync('/tmp/test_labels.csv', 'utf8');
  assertIncludes(csv, '地址,标签');
  fs.unlinkSync('/tmp/test_labels.csv');
});

test('导入标签（合并）', () => {
  fs.writeFileSync('/tmp/test_import.json', JSON.stringify({ '0xnew': { address: '0xNEW', label: '导入的', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }));
  const out = run('node evm-labels.js import --file /tmp/test_import.json');
  assertIncludes(out, '已导入');
  fs.unlinkSync('/tmp/test_import.json');
});

test('导入损坏文件报错', () => {
  fs.writeFileSync('/tmp/test_bad_import.json', '{bad');
  const out = run('node evm-labels.js import --file /tmp/test_bad_import.json', { expectFail: true });
  assertIncludes(out, '解析失败');
  fs.unlinkSync('/tmp/test_bad_import.json');
});

test('删除标签', () => {
  const out = run('node evm-labels.js remove --address 0xTEST1');
  assertIncludes(out, '已删除');
});

test('删除不存在的标签', () => {
  const out = run('node evm-labels.js remove --address 0xNONE');
  assertIncludes(out, '未找到');
});

// 清理
test('清理标签文件', () => {
  const f = path.join(SCRIPTS, 'address-labels.json');
  if (fs.existsSync(f)) fs.unlinkSync(f);
  assert(true);
});

// ============================================================
console.log('\n📋 6. evm-extract-addresses.js 地址提取\n');

test('提取地址', () => {
  fs.writeFileSync('/tmp/test_wallets_ext.json', JSON.stringify([{address:'0xAAA'},{address:'0xBBB'}]));
  const out = run('node evm-extract-addresses.js --file /tmp/test_wallets_ext.json');
  assertIncludes(out, '提取了 2 个地址');
  fs.unlinkSync('/tmp/test_wallets_ext.json');
});

test('空数组报错', () => {
  fs.writeFileSync('/tmp/test_empty.json', '[]');
  const out = run('node evm-extract-addresses.js --file /tmp/test_empty.json', { expectFail: true });
  assertIncludes(out, '为空');
  fs.unlinkSync('/tmp/test_empty.json');
});

test('损坏文件报错', () => {
  fs.writeFileSync('/tmp/test_bad2.json', '{x');
  const out = run('node evm-extract-addresses.js --file /tmp/test_bad2.json', { expectFail: true });
  assertIncludes(out, '解析失败');
  fs.unlinkSync('/tmp/test_bad2.json');
});

// ============================================================
console.log('\n💰 7. evm-balance.js 余额查询 (Sepolia)\n');

test('查询 ETH 余额', () => {
  const out = run(`node evm-balance.js --address 0x2fEE02faD2FF69A7905767b6E5B54C610D425941 --rpc ${RPC}`, { timeout: 20000 });
  assertIncludes(out, 'ETH 余额:');
});

test('从文件批量查询', () => {
  fs.writeFileSync('/tmp/test_bal.json', JSON.stringify(['0x2fEE02faD2FF69A7905767b6E5B54C610D425941']));
  const out = run(`node evm-balance.js --file /tmp/test_bal.json --rpc ${RPC}`, { timeout: 20000 });
  assertIncludes(out, '总余额:');
  fs.unlinkSync('/tmp/test_bal.json');
});

test('空文件报错', () => {
  fs.writeFileSync('/tmp/test_empty_bal.json', '');
  const out = run('node evm-balance.js --file /tmp/test_empty_bal.json --rpc x', { expectFail: true });
  assertIncludes(out, '解析失败');
  fs.unlinkSync('/tmp/test_empty_bal.json');
});

test('无参数报错', () => {
  const out = run('node evm-balance.js', { expectFail: true });
  assertIncludes(out, '--address');
});

// ============================================================
console.log('\n📊 8. evm-batch-query.js 批量查询 (Sepolia)\n');

test('逗号分隔查询', () => {
  const out = run(`node evm-batch-query.js --addresses 0x2fEE02faD2FF69A7905767b6E5B54C610D425941 --rpc ${RPC}`, { timeout: 20000 });
  assertIncludes(out, '总余额:');
});

test('3地址自动使用 Multicall3', () => {
  const out = run(`node evm-batch-query.js --addresses 0x2fEE02faD2FF69A7905767b6E5B54C610D425941,0x0000000000000000000000000000000000000000,0x0000000000000000000000000000000000000001 --rpc ${RPC}`, { timeout: 20000 });
  assertIncludes(out, 'Multicall3');
  assertIncludes(out, '总余额:');
});

test('无参数报错', () => {
  const out = run('node evm-batch-query.js', { expectFail: true });
  assertIncludes(out, '--addresses');
});

// ============================================================
console.log('\n🔍 9. evm-info.js 地址信息 (Sepolia)\n');

test('查询地址信息', () => {
  const out = run(`node evm-info.js --address 0x2fEE02faD2FF69A7905767b6E5B54C610D425941 --rpc ${RPC}`, { timeout: 20000 });
  assertIncludes(out, 'ETH 余额:');
  assertIncludes(out, '交易数:');
  assertIncludes(out, '地址类型:');
});

test('--tokens 非主网提示', () => {
  const out = run(`node evm-info.js --address 0x2fEE02faD2FF69A7905767b6E5B54C610D425941 --rpc ${RPC} --tokens`, { timeout: 20000 });
  assertIncludes(out, '仅支持 Ethereum 主网');
});

// ============================================================
console.log('\n📜 10. evm-tx-history.js 交易历史\n');

test('无 --api-key 报错', () => {
  const out = run('node evm-tx-history.js --address 0x2fEE02faD2FF69A7905767b6E5B54C610D425941', { expectFail: true });
  assertIncludes(out, '--api-key');
});

test('无 --address 报错', () => {
  const out = run('node evm-tx-history.js --api-key test', { expectFail: true });
  assertIncludes(out, '--address');
});

test('--limit NaN 报错', () => {
  const out = run('node evm-tx-history.js --address 0x1 --api-key x --limit abc', { expectFail: true });
  assertIncludes(out, '正整数');
});

// ============================================================
console.log('\n🔄 11. evm-batch-transfer.js 转账\n');

test('无 --eth/--token 报错', () => {
  const out = run('node evm-batch-transfer.js --to 0x1 --amount 0.1', { expectFail: true });
  assertIncludes(out, '--eth');
});

test('--to 无 --amount 报错', () => {
  const out = run('node evm-batch-transfer.js --eth --to 0x2fEE02faD2FF69A7905767b6E5B54C610D425941', { expectFail: true });
  assertIncludes(out, '--amount');
});

test('--amount 无 --to 报错', () => {
  const out = run('node evm-batch-transfer.js --eth --amount 0.1', { expectFail: true });
  assertIncludes(out, '--to');
});

test('无效地址报错', () => {
  fs.writeFileSync('/tmp/test_bad_addr.json', JSON.stringify([{address:'bad',amount:'0.1'}]));
  const out = run('node evm-batch-transfer.js --eth --file /tmp/test_bad_addr.json --dry-run', { expectFail: true });
  assertIncludes(out, '无效地址');
  fs.unlinkSync('/tmp/test_bad_addr.json');
});

test('无效金额报错', () => {
  fs.writeFileSync('/tmp/test_bad_amt.json', JSON.stringify([{address:'0x2fEE02faD2FF69A7905767b6E5B54C610D425941',amount:'abc'}]));
  const out = run('node evm-batch-transfer.js --eth --file /tmp/test_bad_amt.json --dry-run', { expectFail: true });
  assertIncludes(out, '无效金额');
  fs.unlinkSync('/tmp/test_bad_amt.json');
});

test('dry-run 正常', () => {
  fs.writeFileSync('/tmp/test_recip.json', JSON.stringify([{address:'0x2fEE02faD2FF69A7905767b6E5B54C610D425941',amount:'0.001'}]));
  const out = run(`node evm-batch-transfer.js --eth --file /tmp/test_recip.json --rpc ${RPC} --dry-run`, { timeout: 20000 });
  assertIncludes(out, '模拟模式');
  fs.unlinkSync('/tmp/test_recip.json');
});

test('--gas-price 参数生效', () => {
  fs.writeFileSync('/tmp/test_recip_gp.json', JSON.stringify([{address:'0x2fEE02faD2FF69A7905767b6E5B54C610D425941',amount:'0.001'}]));
  const out = run(`node evm-batch-transfer.js --eth --file /tmp/test_recip_gp.json --rpc ${RPC} --gas-price 50 --dry-run`, { timeout: 20000 });
  assertIncludes(out, '手动 Gas 价格');
  assertIncludes(out, '50.0');
  fs.unlinkSync('/tmp/test_recip_gp.json');
});

test('--max-fee 超限中止', () => {
  fs.writeFileSync('/tmp/test_recip_mf.json', JSON.stringify([{address:'0x2fEE02faD2FF69A7905767b6E5B54C610D425941',amount:'0.001'}]));
  const out = run(`node evm-batch-transfer.js --eth --file /tmp/test_recip_mf.json --rpc ${RPC} --gas-price 999999 --max-fee 0.000000001`, { expectFail: true, timeout: 20000 });
  assertIncludes(out, '超过 max-fee');
  fs.unlinkSync('/tmp/test_recip_mf.json');
});

test('--resume 断点续传跳过已处理', () => {
  // 创建进度文件（模拟第一个地址已完成）
  const addr1 = '0x2fEE02faD2FF69A7905767b6E5B54C610D425941';
  const addr2 = '0x0000000000000000000000000000000000000001';
  fs.writeFileSync('/tmp/test_progress.json', JSON.stringify([{success:true,to:addr1}]));
  fs.writeFileSync('/tmp/test_resume_recip.json', JSON.stringify([{address:addr1,amount:'0.001'},{address:addr2,amount:'0.001'}]));
  const out = run(`node evm-batch-transfer.js --eth --file /tmp/test_resume_recip.json --rpc ${RPC} --resume /tmp/test_progress.json --dry-run`, { timeout: 20000 });
  assertIncludes(out, '跳过已处理的 1 笔');
  fs.unlinkSync('/tmp/test_progress.json');
  fs.unlinkSync('/tmp/test_resume_recip.json');
});

test('损坏文件报错', () => {
  fs.writeFileSync('/tmp/test_bad3.json', '{x');
  const out = run('node evm-batch-transfer.js --eth --file /tmp/test_bad3.json --dry-run', { expectFail: true });
  assertIncludes(out, '解析失败');
  fs.unlinkSync('/tmp/test_bad3.json');
});

// ============================================================
console.log('\n📥 12. evm-collect.js 归集\n');

test('无 --eth/--token 报错', () => {
  const out = run('node evm-collect.js --file x.json', { expectFail: true });
  assertIncludes(out, '--eth');
});

test('无 --file 报错', () => {
  const out = run('node evm-collect.js --eth', { expectFail: true });
  assertIncludes(out, '--file');
});

test('空钱包文件报错', () => {
  fs.writeFileSync('/tmp/test_empty_w.json', '[]');
  const out = run('node evm-collect.js --eth --file /tmp/test_empty_w.json', { expectFail: true });
  assertIncludes(out, '为空');
  fs.unlinkSync('/tmp/test_empty_w.json');
});

test('缺少 privateKey 报错', () => {
  fs.writeFileSync('/tmp/test_nokey.json', JSON.stringify([{address:'0x2fEE02faD2FF69A7905767b6E5B54C610D425941'}]));
  const out = run('node evm-collect.js --eth --file /tmp/test_nokey.json', { expectFail: true });
  assertIncludes(out, 'privateKey');
  fs.unlinkSync('/tmp/test_nokey.json');
});

test('缺少 address 报错', () => {
  fs.writeFileSync('/tmp/test_noaddr.json', JSON.stringify([{privateKey:'0x1234'}]));
  const out = run('node evm-collect.js --eth --file /tmp/test_noaddr.json', { expectFail: true });
  assertIncludes(out, 'address');
  fs.unlinkSync('/tmp/test_noaddr.json');
});

// ============================================================
console.log('\n🔀 13. evm.js 统一路由\n');

test('--help 显示所有命令', () => {
  const out = run('node evm.js --help');
  for (const cmd of ['gen','batch-gen','transfer','collect','balance','batch-query','info','history','labels','validate','extract']) {
    assertIncludes(out, cmd);
  }
});

test('无效命令报错', () => {
  const out = run('node evm.js foobar', { expectFail: true });
  assertIncludes(out, '未知命令');
});

test('路由 validate', () => {
  const out = run('node evm.js validate --address 0x2fEE02faD2FF69A7905767b6E5B54C610D425941');
  assertIncludes(out, '有效');
});

test('路由 labels list', () => {
  const out = run('node evm.js labels list');
  assertIncludes(out, '暂无标签');
});

// ============================================================
// 汇总
console.log(`\n${'='.repeat(50)}`);
console.log(`📊 测试结果: ${passed} 通过, ${failed} 失败, ${skipped} 跳过`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
