---
name: evm-toolkit
description: >
  EVM 链上工具集：钱包生成、批量转账、资金归集、余额查询、地址验证、标签管理、交易历史。
  适用场景：(1) 生成 EVM 钱包地址 (2) 批量转账 ETH/ERC20 (3) 多地址资金归集
  (4) 查询余额和地址信息 (5) 批量查询和验证地址 (6) 地址标签管理
  触发词：EVM、钱包、转账、归集、余额、地址生成、batch transfer、collect、airdrop
---

# EVM Toolkit

EVM 兼容链的完整工具集，基于 ethers.js，支持 Ethereum/Base/Arbitrum/Polygon 等所有 EVM 链。

## 依赖

- Node.js + ethers.js（v6）
- 脚本位于 `scripts/` 目录，全部可直接执行

## 安全规则

- 私钥存放在 `vault/` 目录（权限 600），永不进入 LLM 上下文
- 转账操作先用 `--dry-run` 模拟，确认后再执行
- 小额测试优先（0.001 ETH）
- 定期备份 `vault/` 目录

## 工具速查

### 地址生成

```bash
# 生成单个钱包
scripts/evm-wallet-gen.js
scripts/evm-wallet-gen.js --count 5 --save    # 生成5个并保存到 vault/
scripts/evm-wallet-gen.js --mnemonic          # 带助记词

# 批量生成
scripts/evm-batch-gen.js --count 10
scripts/evm-batch-gen.js --count 10 --format csv --output wallets.csv --save
```

### 余额查询

```bash
# 单地址
scripts/evm-balance.js --address 0x...
scripts/evm-balance.js --address 0x... --token 0x...   # ERC20

# 批量查询
scripts/evm-batch-query.js --file addresses.txt
scripts/evm-batch-query.js --file addresses.txt --token 0x...

# 从钱包文件批量查
scripts/evm-balance.js --file wallets.json
```

### 转账

```bash
# 单笔 ETH
scripts/evm-batch-transfer.js --eth --to 0x... --amount 0.1

# 批量 ETH（先 dry-run）
scripts/evm-batch-transfer.js --eth --file recipients.json --dry-run
scripts/evm-batch-transfer.js --eth --file recipients.json

# 批量 ERC20
scripts/evm-batch-transfer.js --token 0x... --file recipients.json
```

### 资金归集

```bash
# 归集 ETH 到主地址
scripts/evm-collect.js --eth --file wallets.json --dry-run
scripts/evm-collect.js --eth --file wallets.json

# 归集 ERC20
scripts/evm-collect.js --token 0x... --file wallets.json
```

### 地址信息

```bash
scripts/evm-info.js --address 0x...              # 基本信息
scripts/evm-info.js --address 0x... --tokens     # 含常见代币余额
scripts/evm-tx-history.js --address 0x... --api-key YOUR_KEY --limit 10  # 交易历史
```

### 地址验证

```bash
scripts/evm-validate.js --address 0x...
scripts/evm-validate.js --file addresses.txt
scripts/evm-validate.js --file addresses.txt --fix --output fixed.txt
```

### 标签管理

```bash
scripts/evm-labels.js list                                    # 查看所有标签
scripts/evm-labels.js add --address 0x... --label "测试地址"   # 添加标签
scripts/evm-labels.js get --address 0x...                     # 查询标签
scripts/evm-labels.js export --output labels.csv              # 导出
```

### 统一管理器

```bash
scripts/evm.js balance --address 0x...    # 通过子命令调用
scripts/evm.js gen --count 5
scripts/evm.js transfer --help
```

### 交互式管理

```bash
scripts/evm-manager.sh    # 菜单式操作（需 TTY）
```

## 文件格式

recipients.json（转账目标）:
```json
[{"address": "0x...", "amount": "0.1"}, {"address": "0x...", "amount": "0.2"}]
```

wallets.json（含私钥，用于归集）:
```json
[{"address": "0x...", "privateKey": "0x..."}]
```

addresses.txt（纯地址列表，每行一个）:
```
0xabc...
0xdef...
```

## 切换网络

所有工具支持 `--rpc` 参数：
- Ethereum: `--rpc https://eth.llamarpc.com`
- Base: `--rpc https://mainnet.base.org`
- BNB Chain: `--rpc https://bsc-dataseed.binance.org`
- Arbitrum: `--rpc https://arb1.arbitrum.io/rpc`
- Polygon: `--rpc https://polygon-rpc.com`

## 辅助脚本

- `scripts/evm-extract-addresses.js` — 从钱包 JSON 提取纯地址列表
- `scripts/evm-backup.sh` — 备份 vault/ 目录
- `scripts/evm-init.sh` — 初始化环境和依赖
