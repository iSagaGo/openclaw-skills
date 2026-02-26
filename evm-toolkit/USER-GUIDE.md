# EVM Toolkit 用户手册

EVM 兼容链的完整工具集，支持 Ethereum / Base / Arbitrum / Polygon / BNB Chain 等所有 EVM 链。

---

## 目录

1. [快速开始](#1-快速开始)
2. [钱包管理](#2-钱包管理)
3. [查询工具](#3-查询工具)
4. [转账操作](#4-转账操作)
5. [资金归集](#5-资金归集)
6. [Gas 管理](#6-gas-管理)
7. [地址工具](#7-地址工具)
8. [网络切换](#8-网络切换)
9. [备份与恢复](#9-备份与恢复)
10. [常见问题 FAQ](#10-常见问题-faq)
11. [安全须知](#11-安全须知)

---

## 1. 快速开始

### 环境要求

- Node.js 22+
- ethers.js 6.16.0（初始化时自动安装）

### 初始化

```bash
cd skills/evm-toolkit
bash scripts/evm-init.sh
```

初始化脚本会自动：
- 安装 ethers.js 依赖
- 创建 `vault/` 目录（权限 700）
- 配置主钱包

### 目录结构

```
evm-toolkit/
├── scripts/          # 所有工具脚本
│   ├── evm-common.js           # 公共模块
│   ├── evm.js                  # 统一入口（子命令路由）
│   ├── evm-wallet-gen.js       # 单钱包生成
│   ├── evm-batch-gen.js        # 批量生成
│   ├── evm-balance.js          # 余额查询
│   ├── evm-batch-query.js      # 批量查询（Multicall3）
│   ├── evm-info.js             # 地址信息
│   ├── evm-tx-history.js       # 交易历史
│   ├── evm-batch-transfer.js   # 批量转账
│   ├── evm-collect.js          # 资金归集
│   ├── evm-labels.js           # 标签管理
│   ├── evm-validate.js         # 地址验证
│   ├── evm-extract-addresses.js# 地址提取
│   ├── evm-manager.sh          # 交互式菜单
│   ├── evm-init.sh             # 初始化
│   └── evm-backup.sh           # 备份
├── vault/            # 敏感数据（私钥/助记词），权限 700
├── SKILL.md
├── README.md
└── USER-GUIDE.md     # 本文件
```

---

## 2. 钱包管理

### 生成单个钱包

```bash
# 生成随机钱包（仅显示，不保存）
node scripts/evm-wallet-gen.js

# 生成并保存到 vault/
node scripts/evm-wallet-gen.js --save

# 生成带助记词的钱包
node scripts/evm-wallet-gen.js --mnemonic

# 从已有助记词恢复
node scripts/evm-wallet-gen.js --mnemonic "your twelve words here"
```

### 批量生成

```bash
# 生成 10 个钱包
node scripts/evm-batch-gen.js --count 10

# 生成并保存为 JSON
node scripts/evm-batch-gen.js --count 10 --format json --output vault/sub-wallets.json --save

# 导出为 CSV
node scripts/evm-batch-gen.js --count 10 --format csv --output wallets.csv

# 导出为纯地址列表
node scripts/evm-batch-gen.js --count 10 --format list --output addresses.txt
```

### 导出格式说明

| 格式 | 参数 | 内容 |
|------|------|------|
| JSON | `--format json` | 含 address + privateKey，适合后续转账/归集 |
| CSV | `--format csv` | 表格格式，方便 Excel 查看 |
| List | `--format list` | 纯地址列表，每行一个 |

⚠️ 使用 `--format` 时必须同时指定 `--output`，否则会报错。

### 钱包文件说明

生成的钱包文件保存在 `vault/` 目录，格式如下：

```json
[
  {"address": "0xabc...", "privateKey": "0x..."},
  {"address": "0xdef...", "privateKey": "0x..."}
]
```

⚠️ 含私钥的文件自动设置权限 600（仅所有者可读写）。

---

## 3. 查询工具

### 余额查询（evm-balance.js）

```bash
# 查询单地址 ETH 余额
node scripts/evm-balance.js --address 0x你的地址

# 查询 ERC20 代币余额
node scripts/evm-balance.js --address 0x你的地址 --token 0x代币合约

# 从钱包文件批量查询
node scripts/evm-balance.js --file vault/sub-wallets.json

# 批量查询 ERC20
node scripts/evm-balance.js --file vault/sub-wallets.json --token 0x代币合约
```

### 批量查询（evm-batch-query.js）

3 个以上地址自动启用 Multicall3 合约批量查询，1 次 RPC 调用完成，速度更快。

```bash
# 从文件批量查询
node scripts/evm-batch-query.js --file addresses.txt

# 逗号分隔多个地址
node scripts/evm-batch-query.js --addresses 0xA,0xB,0xC

# 批量查询 ERC20
node scripts/evm-batch-query.js --file addresses.txt --token 0x代币合约
```

⚠️ Multicall3 不可用时会自动降级为逐个查询，无需手动处理。
