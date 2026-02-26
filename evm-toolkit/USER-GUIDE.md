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

### 地址信息（evm-info.js）

查看地址类型（EOA/合约）、nonce、余额、常见代币持仓。

```bash
# 基本信息
node scripts/evm-info.js --address 0x你的地址

# 含常见代币余额
node scripts/evm-info.js --address 0x你的地址 --tokens
```

### 交易历史（evm-tx-history.js）

需要 Etherscan API Key（免费申请：https://etherscan.io/apis）。

```bash
# 查询最近 10 笔交易
node scripts/evm-tx-history.js --address 0x你的地址 --api-key YOUR_KEY --limit 10

# 查询最近 50 笔
node scripts/evm-tx-history.js --address 0x你的地址 --api-key YOUR_KEY --limit 50
```

⚠️ 不同网络需要对应的区块浏览器 API Key（如 Basescan、Arbiscan）。

---

## 4. 转账操作

### 批量转账 ETH

```bash
# 单笔转账
node scripts/evm-batch-transfer.js --eth --to 0x目标地址 --amount 0.1

# 从文件批量转账
node scripts/evm-batch-transfer.js --eth --file recipients.json

# 指定网络
node scripts/evm-batch-transfer.js --eth --file recipients.json --rpc https://mainnet.base.org
```

### 批量转账 ERC20 代币

```bash
# 单笔 ERC20 转账
node scripts/evm-batch-transfer.js --token 0x代币合约 --to 0x目标地址 --amount 100

# 批量 ERC20 转账
node scripts/evm-batch-transfer.js --token 0x代币合约 --file recipients.json
```

### 收款文件格式（recipients.json）

```json
[
  {"address": "0xabc...", "amount": "0.1"},
  {"address": "0xdef...", "amount": "0.2"},
  {"address": "0x123...", "amount": "0.5"}
]
```

### dry-run 模拟模式

⚠️ 强烈建议：任何转账操作前先用 `--dry-run` 模拟，确认无误后再执行。

```bash
# 模拟运行（不发送真实交易）
node scripts/evm-batch-transfer.js --eth --file recipients.json --dry-run

# 确认无误后去掉 --dry-run 执行
node scripts/evm-batch-transfer.js --eth --file recipients.json
```

### 断点续传（--resume）

批量转账中途失败时（网络错误、Gas 超限等），进度自动保存。加 `--resume` 从断点继续：

```bash
# 原命令加 --resume 即可
node scripts/evm-batch-transfer.js --eth --file recipients.json --resume
```

工作原理：
- 进度文件自动记录已完成的交易索引
- 恢复时校验链上 nonce，确保不重复发送
- 支持多次中断和恢复

---

## 5. 资金归集

将多个子钱包的资金归集到主钱包。归集时自动预留 Gas 费用（含 10% 余量），不会把 ETH 全部转走。

### ETH 归集

```bash
# 先模拟
node scripts/evm-collect.js --eth --file vault/sub-wallets.json --dry-run

# 确认后执行
node scripts/evm-collect.js --eth --file vault/sub-wallets.json

# 指定归集目标地址
node scripts/evm-collect.js --eth --file vault/sub-wallets.json --to 0x主地址

# 手动指定 Gas
node scripts/evm-collect.js --eth --file vault/sub-wallets.json --gas-price 30
```

### ERC20 代币归集

```bash
# 归集 ERC20 代币
node scripts/evm-collect.js --token 0x代币合约 --file vault/sub-wallets.json

# 模拟
node scripts/evm-collect.js --token 0x代币合约 --file vault/sub-wallets.json --dry-run
```

### 钱包文件格式

归集需要含私钥的钱包文件（因为要从子钱包发起交易）：

```json
[
  {"address": "0xabc...", "privateKey": "0x..."},
  {"address": "0xdef...", "privateKey": "0x..."}
]
```

⚠️ 归集前确保子钱包有足够 ETH 支付 Gas 费用。

---

## 6. Gas 管理

### 三层保护机制

| 层级 | 机制 | 说明 |
|------|------|------|
| 第一层 | 警告 | 单笔 Gas 超阈值（ETH 0.0005 / ERC20 0.001）时打印警告 |
| 第二层 | 硬上限 | 单笔 Gas 超过 max-fee（默认 0.005 ETH）自动终止交易 |
| 第三层 | Gas War | 手动取消所有限制，适合抢跑场景 |

### Telegram Gas 面板

发送以下触发词唤醒设置面板：

```
gas设置
gas面板
```

面板功能：
- 🛡 正常模式 / 🔥 Gas War 模式 一键切换
- 快速设置 max-fee：0.005 / 0.01 / 0.02 / 0.05 / 0.1 ETH
- 自定义 max-fee 金额

### 文本快捷命令

```
gas war        → 开启 Gas War 模式（取消硬上限）
gas normal     → 恢复正常模式
gas 0.05       → 设置 max-fee 为 0.05 ETH/笔
```

配置存储在 `/tmp/evm-gas-config.json`，脚本启动时自动读取。

### CLI 参数

```bash
# 手动指定 Gas 价格（Gwei）
--gas-price 50

# 设置单笔最大 Gas 费用（ETH）
--max-fee 0.02

# 开启 Gas War 模式
--gas-war
```

⚠️ CLI 参数优先级高于 Telegram 面板配置。

### Gas 超限处理

当提示"当前gas超过max fee"时：

1. 发送 `gas设置` 查看当前 Gas 价格
2. 网络拥堵 → 等待 Gas 下降后重试
3. 确认要执行 → 调高 max-fee：`gas 0.05` 或 `--max-fee 0.05`
4. 紧急抢跑 → `gas war`（⚠️ 谨慎使用，无上限保护）

---

## 7. 地址工具

### 地址验证（evm-validate.js）

检查地址格式和校验和（checksum）是否正确。

```bash
# 验证单个地址
node scripts/evm-validate.js --address 0x你的地址

# 批量验证（从文件）
node scripts/evm-validate.js --file addresses.txt

# 批量验证并自动修复校验和，输出到新文件
node scripts/evm-validate.js --file addresses.txt --fix --output fixed.txt
```

### 地址提取（evm-extract-addresses.js）

从钱包 JSON 文件中提取纯地址列表（去掉私钥信息）。

```bash
node scripts/evm-extract-addresses.js --file vault/sub-wallets.json --output addresses.txt
```

### 标签管理（evm-labels.js）

为地址添加备注标签，方便识别和管理。

```bash
# 添加标签
node scripts/evm-labels.js add --address 0x地址 --label "交易所热钱包"

# 查询标签
node scripts/evm-labels.js get --address 0x地址

# 查看所有标签
node scripts/evm-labels.js list

# 删除标签
node scripts/evm-labels.js remove --address 0x地址

# 导出标签到文件
node scripts/evm-labels.js export --output labels-backup.csv

# 导入标签（合并模式，不覆盖已有标签）
node scripts/evm-labels.js import --file labels-backup.csv
```

⚠️ 地址存储时统一转为小写，查询时不区分大小写。

---

## 8. 网络切换

### 支持的网络

| 网络 | RPC 地址 | 原生代币 |
|------|----------|----------|
| Ethereum | `https://eth.llamarpc.com` | ETH |
| Base | `https://mainnet.base.org` | ETH |
| BNB Chain | `https://bsc-dataseed.binance.org` | BNB |
| Arbitrum | `https://arb1.arbitrum.io/rpc` | ETH |
| Polygon | `https://polygon-rpc.com` | MATIC |
| Sepolia 测试网 | `https://ethereum-sepolia-rpc.publicnode.com` | SepoliaETH |

### 如何指定网络

所有脚本都支持 `--rpc` 参数：

```bash
# 在 Base 上查余额
node scripts/evm-balance.js --address 0x... --rpc https://mainnet.base.org

# 在 Arbitrum 上批量转账
node scripts/evm-batch-transfer.js --eth --file recipients.json --rpc https://arb1.arbitrum.io/rpc

# 在 BNB Chain 上归集
node scripts/evm-collect.js --eth --file vault/sub-wallets.json --rpc https://bsc-dataseed.binance.org
```

也可以使用 `--network` 简写：

```bash
node scripts/evm-balance.js --network base --address 0x...
node scripts/evm-batch-transfer.js --network arbitrum --eth --file recipients.json
```

Telegram 命令：`切换到 base`、`用 arbitrum`

### 各网络注意事项

- **BNB Chain**：原生代币是 BNB 而非 ETH，Gas 用 BNB 支付
- **Polygon**：原生代币是 MATIC，Gas 用 MATIC 支付
- **Sepolia**：测试网，代币无真实价值，适合测试新操作
- **公共 RPC**：有速率限制，大批量操作建议使用付费 RPC 节点

---

## 9. 备份与恢复

### 备份

```bash
bash scripts/evm-backup.sh backup
```

备份脚本会自动：
- 打包 `vault/` 目录为 `.tar.gz` 文件
- 设置备份文件权限为 600
- 文件名包含日期，如 `backup-2026-02-26.tar.gz`

### 恢复

```bash
bash scripts/evm-backup.sh restore backup-2026-02-26.tar.gz
```

恢复后自动重设 `vault/` 目录及文件权限。

### 备份文件说明

- 备份包含 `vault/` 下所有文件（私钥、助记词、钱包文件）
- 备份文件等同于资产本身，务必安全存放

⚠️ 不要将备份文件上传到 GitHub、云盘或聊天记录中。建议加密后存储到离线介质。

---

## 10. 常见问题 FAQ

### Gas 超限怎么办？

提示"当前gas超过max fee"时：
1. 发送 `gas设置` 查看当前网络 Gas
2. 等待 Gas 下降，或调高 max-fee：`gas 0.05`
3. 紧急情况用 `gas war` 取消限制

### 交易卡住怎么办？

交易长时间 pending 未被打包：
1. 可能是 Gas 价格过低，网络 Gas 已上涨
2. 用更高 Gas 重发：`--gas-price 20`
3. 批量转账中断用 `--resume` 续传

### 余额不足怎么办？

提示 `insufficient funds`：
- ETH 转账：余额需覆盖 转账金额 + Gas 费用
- ERC20 转账：需要足够的代币余额 + ETH 支付 Gas
- 归集操作：子钱包需有 ETH 支付 Gas

### 断点续传怎么用？

```bash
# 在原命令后加 --resume
node scripts/evm-batch-transfer.js --eth --file recipients.json --resume
```

进度自动保存，恢复时校验链上 nonce 防止重复发送。

### 如何查看交易状态？

```bash
# 查看地址的交易历史
node scripts/evm-tx-history.js --address 0x... --api-key YOUR_KEY --limit 10
```

也可以直接在区块浏览器查看：
- Ethereum: `https://etherscan.io/address/0x...`
- Base: `https://basescan.org/address/0x...`
- Arbitrum: `https://arbiscan.io/address/0x...`

### 常见错误速查

| 错误 | 原因 | 解决 |
|------|------|------|
| `insufficient funds` | 余额不足（含 Gas） | 充值或减少金额 |
| `nonce too low` | 有 pending 交易 | 等待确认或 `--resume` |
| `replacement fee too low` | 替换交易 Gas 不够 | 提高 `--gas-price` |
| `execution reverted` | 合约执行失败 | 检查代币余额和授权 |
| `network timeout` | RPC 超时 | 换节点 `--rpc https://...` |
| `ENOENT vault/...` | 文件不存在 | 运行 `evm-init.sh` 初始化 |

---

## 11. 安全须知

### vault 目录说明

`vault/` 是敏感数据存储目录：
- 目录权限 700（仅所有者可访问）
- 文件权限 600（仅所有者可读写）
- 内容永不进入 LLM 上下文
- 不纳入 Git 版本控制

### 私钥安全

- 所有私钥文件自动设置权限 600
- 不要在聊天中发送私钥或助记词
- 不要将 `vault/` 目录加入 Git
- 不要使用 `chmod 777` 修改权限

### 备份安全

- 备份文件包含私钥，等同于资产本身
- 不要上传到 GitHub、云盘、聊天记录
- 建议加密后存储到离线介质（U盘等）
- 定期验证备份可恢复性

### 操作安全清单

| ✅ 应该做 | ❌ 不要做 |
|-----------|-----------|
| 转账前用 `--dry-run` 模拟 | 跳过模拟直接执行 |
| 小额测试优先（0.001 ETH） | 首次就大额操作 |
| 设置 `--max-fee` 保护 | 不设上限批量转账 |
| 新功能先在 Sepolia 测试 | 直接在主网测试 |
| 定期备份 `vault/` | 从不备份 |
| 使用付费 RPC 做大批量操作 | 公共 RPC 上大量请求 |

---

*本手册基于 EVM Toolkit v1.0，最后更新：2026-02-26*
