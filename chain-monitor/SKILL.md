---
name: chain-monitor
description: Base 链上项目监控与归档。三数据源（GMGN rank、GMGN new_pairs、DexScreener）自动扫描新项目，AI 挖矿项目重点标注。支持：启动/停止监控、48小时回测、生成报告、过期项目按日期归档、索引查询。触发词：链上监控、项目监控、chain monitor、新项目扫描、回测、归档。
---

# Chain Monitor

Base 链多数据源项目监控，自动发现、过滤、归档链上新项目。

## 架构

```
chain-monitor/
├── SKILL.md
├── scripts/
│   ├── gmgn_monitor.py      # 主监控服务（systemd: gmgn-monitor）
│   ├── backtest_48h.py       # 48小时回测
│   └── report_archive.py     # 独立归档工具
├── references/
│   └── data-sources.md       # 数据源 API 文档
└── archive/                  # 归档数据（自动生成）
    ├── INDEX.md              # 归档索引（日期+项目名+合约地址）
    ├── REPORT_48H.md         # 48小时活跃项目报告
    ├── archive_db.json       # 归档数据库
    └── YYYY-MM-DD.md         # 按日期归档文件
```

## 数据源

1. **GMGN rank API** (graduated) — 主力，已开盘项目排行
2. **GMGN new_pairs API** — 补充，新交易对
3. **DexScreener search API** — 兜底，关键词搜索覆盖 GMGN 漏掉的项目

优先级：gmgn_rank > gmgn_pairs > dexscreener（同地址去重时保留高优先级源）

## 过滤规则

- 流动性 ≥ $5,000
- 持有人 ≥ 20（DexScreener 无 holder 数据时放宽）
- 项目年龄 ≤ 72 小时
- 排除主流币：cbBTC, WETH, USDC, USDT, DAI, WBTC, ETH

## AI 挖矿检测

关键词匹配 symbol/website/twitter：
mine, miner, mining, bot, agent, ai, earn, farm, stake, proof, compute, gpu, hash, reward, epoch, node, botcoin, agentcoin, aibot, automine

## 操作指南

### 启动监控服务

```bash
systemctl start gmgn-monitor
systemctl status gmgn-monitor
tail -f /tmp/gmgn_monitor.log
```

### 停止监控

```bash
systemctl stop gmgn-monitor
```

### 运行48小时回测

```bash
python3 scripts/backtest_48h.py
# 结果保存到 /tmp/backtest_48h_results.json
```

### 手动生成报告和归档

```bash
python3 scripts/report_archive.py
# 生成 archive/REPORT_48H.md 和按日期归档文件
```

## 通知机制

监控发现新项目时：
1. 写入 `/tmp/gmgn_notify.json`
2. 通过 curl 唤醒 OpenClaw（wake API）
3. Heartbeat 读取通知文件，格式化后发送给用户

每个项目通知包含：名称、合约地址、MC、流动性、持有人、年龄、来源、网站、推特、GMGN 快速跳转链接。

## 归档系统

- 48小时内项目 → `archive/REPORT_48H.md`（每轮扫描自动更新）
- 超过48小时 → 按开盘日期归档到 `archive/YYYY-MM-DD.md`
- 索引 → `archive/INDEX.md`（日期、项目数、AI挖矿数、项目列表、合约地址）

## 配置修改

编辑 `scripts/gmgn_monitor.py` 顶部常量：
- `SCAN_INTERVAL`: 扫描间隔（默认 600 秒）
- `MIN_LIQUIDITY`: 最低流动性（默认 $5,000）
- `MIN_HOLDERS`: 最低持有人（默认 20）
- `MAX_AGE_HOURS`: 最大年龄（默认 72 小时）
- `AI_MINING_KEYWORDS`: AI 挖矿关键词列表
- `DEXSCREENER_KEYWORDS`: DexScreener 搜索关键词
- `EXCLUDED_SYMBOLS`: 排除的主流币

修改后重启服务：`systemctl restart gmgn-monitor`

## systemd 服务配置

服务文件：`/etc/systemd/system/gmgn-monitor.service`

如需重新创建：
```ini
[Unit]
Description=Chain Monitor - Base Chain Project Scanner
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /root/.openclaw/workspace/skills/chain-monitor/scripts/gmgn_monitor.py
Restart=always
RestartSec=10
StandardOutput=append:/tmp/gmgn_monitor.log
StandardError=append:/tmp/gmgn_monitor.log

[Install]
WantedBy=multi-user.target
```
