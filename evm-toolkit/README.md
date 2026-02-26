# EVM Toolkit 使用说明

EVM 兼容链的完整工具集，支持 Ethereum/Base/Arbitrum/Polygon 等所有 EVM 链。

## 快速开始

```bash
# 初始化（安装依赖、配置主钱包）
cd skills/evm-toolkit && bash scripts/evm-init.sh

# 生成钱包
node scripts/evm-wallet-gen.js --count 3 --save

# 查余额
node scripts/evm-balance.js --address 0x你的地址

# 转账（先模拟）
node scripts/evm-batch-transfer.js --eth --to 0x目标 --amount 0.01 --dry-run
```

## 功能一览

| 功能 | 脚本 | 说明 |
|------|------|------|
| 生成钱包 | `evm-wallet-gen.js` | 单个/批量，支持助记词 |
| 批量生成 | `evm-batch-gen.js` | 大批量 + 导出 JSON/CSV |
| 余额查询 | `evm-balance.js` | ETH/ERC20，支持批量 |
| 批量查询 | `evm-batch-query.js` | Multicall3 加速，3+ 地址自动启用 |
| 批量转账 | `evm-batch-transfer.js` | ETH/ERC20，断点续传 |
| 资金归集 | `evm-collect.js` | 多地址归集到主钱包 |
| 地址信息 | `evm-info.js` | 余额、nonce、合约检测 |
| 交易历史 | `evm-tx-history.js` | 需 Etherscan API Key |
| 地址验证 | `evm-validate.js` | 校验和检查，批量修复 |
| 标签管理 | `evm-labels.js` | 地址备注，导入导出 |
| 地址提取 | `evm-extract-addresses.js` | 从钱包 JSON 提取地址 |
| 统一入口 | `evm.js` | 子命令路由 |
| 交互菜单 | `evm-manager.sh` | 终端菜单式操作 |

## Gas 管理

### 三层保护机制

1. **警告层**：单笔 Gas 超过阈值（ETH 0.0005 / ERC20 0.001）时打印警告
2. **硬上限**：单笔 Gas 超过 max-fee 自动终止（默认 0.01 ETH/笔）
3. **Gas War**：取消所有上限，适合抢跑场景

### Telegram 快捷面板

发送 `gas 设置` 或 `gas面板` 唤醒设置面板，支持：
- 🛡 正常模式 / 🔥 Gas War 模式切换
- 快速设置 max-fee（0.005 / 0.01 / 0.02 / 0.05 / 0.1 ETH）
- 自定义 max-fee

也可以用文字命令：
```
gas war        → 切换 Gas War 模式
gas normal     → 切换正常模式
gas 0.05       → 设置 max-fee 为 0.05 ETH/笔
```

配置存储在 `/tmp/evm-gas-config.json`，脚本启动时自动读取。
CLI 参数（`--max-fee`、`--gas-war`）优先级高于面板配置。

### CLI Gas 参数

```bash
--gas-price 50     # 手动指定 Gas 价格（Gwei）
--max-fee 0.02     # 单笔最大 Gas 费用（ETH）
--gas-war          # 取消 Gas 硬上限
```

## 转账详解

### 基本用法

```bash
# 单笔 ETH 转账
node scripts/evm-batch-transfer.js --eth --to 0x目标 --amount 0.1

# 批量转账（从文件读取）
node scripts/evm-batch-transfer.js --eth --file recipients.json

# ERC20 转账
node scripts/evm-batch-transfer.js --token 0x代币合约 --to 0x目标 --amount 100
```

### 高级功能

```bash
# 模拟运行（不发交易）
--dry-run

# 手动指定 Gas
--gas-price 50

# 断点续传（失败后从断点继续）
--resume

# 指定 RPC
--rpc https://mainnet.base.org
```

### 断点续传

批量转账中途失败时，进度自动保存。重新运行加 `--resume` 跳过已完成的交易：

```bash
node scripts/evm-batch-transfer.js --eth --file recipients.json --resume
```

## 资金归集

将多个子钱包的资金归集到主钱包：

```bash
# 归集 ETH（先模拟）
node scripts/evm-collect.js --eth --file wallets.json --dry-run
node scripts/evm-collect.js --eth --file wallets.json

# 归集 ERC20
node scripts/evm-collect.js --token 0x代币合约 --file wallets.json

# 指定 Gas
node scripts/evm-collect.js --eth --file wallets.json --gas-price 30
```

归集时自动预留 Gas 费用，不会把 ETH 全部转走。

## 批量查询

```bash
# 逗号分隔
node scripts/evm-batch-query.js --addresses 0xA,0xB,0xC

# 从文件
node scripts/evm-batch-query.js --file addresses.txt

# 查 ERC20
node scripts/evm-batch-query.js --file addresses.txt --token 0x代币合约
```

3 个以上地址自动使用 Multicall3 批量查询，1 次 RPC 调用完成。

## 切换网络

所有脚本支持 `--rpc` 参数：

| 网络 | RPC |
|------|-----|
| Ethereum | `https://eth.llamarpc.com` |
| Base | `https://mainnet.base.org` |
| BNB Chain | `https://bsc-dataseed.binance.org` |
| Arbitrum | `https://arb1.arbitrum.io/rpc` |
| Polygon | `https://polygon-rpc.com` |
| Sepolia 测试网 | `https://ethereum-sepolia-rpc.publicnode.com` |

## 文件格式

### recipients.json（转账目标）
```json
[
  {"address": "0xabc...", "amount": "0.1"},
  {"address": "0xdef...", "amount": "0.2"}
]
```

### wallets.json（含私钥，用于归集）
```json
[
  {"address": "0xabc...", "privateKey": "0x..."},
  {"address": "0xdef...", "privateKey": "0x..."}
]
```

### addresses.txt（纯地址列表）
```
0xabc...
0xdef...
```

## 安全须知

- 私钥存放在 `vault/` 目录，权限 600，不进入 Git
- 导出含私钥的文件自动设置 600 权限
- 转账前务必用 `--dry-run` 模拟
- 小额测试优先
- 定期运行 `scripts/evm-backup.sh` 备份 vault/
