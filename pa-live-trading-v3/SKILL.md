---
name: pa-live-trading-v3
description: PA (Price Action) BTC自动交易系统，支持BTC 1h合约交易。功能包括：实盘交易（Binance合约）、模拟交易、回测（单币种/盈亏比扫描）、监控报告。触发词：交易系统、PA交易、实盘交易、回测、backtest、trading、开仓、平仓。
---

# PA Live Trading V3

BTC Price Action 自动交易系统，BTC 1h。

## 核心策略

- 增强密集区识别（动态强度评分）
- BOS 动态风险（有BOS 4%，无BOS 2%）
- 动态风险阶梯：初始5%，盈利每+10%加1%，上限10%，BOS双倍上限20%
- 盈亏比 1.4R（RR扫描最优稳健值：76%胜率，回撤25.4%）
- 5x杠杆，开仓有杠杆上限检查

## 文件结构

| 文件 | 角色 |
|------|------|
| `trading-engine.js` | 统一交易引擎（实盘/回测共用，无IO） |
| `trading-functions.js` | 策略函数（信号生成、密集区、BOS等） |
| `live-trading-core-dual.js` | 实盘主入口（调用引擎 + API/通知） |
| `backtest-runner.js` | 回测入口（调用同一引擎 + 缓存K线） |
| `rr-sweep-btc-inline.js` | BTC单币种RR扫描（单进程，高效） |
| `binance-api.js` | Binance 合约 API 封装 |
| `config-simulation.js` | 模拟配置 |
| `config-real.js` | 实盘配置 |
| `trade-stats.js` | 交易记录持久化 |
| `alert-system.js` | 预警机制 |
| `daily-report.js` | 每日报告 |
| `monitor.js` | 监控脚本 |

## 使用

### 回测

```bash
# 先拉取K线缓存
node ../../kline-cache.js fetch-all 1h 360

# BTC回测（默认180天 RR1.4）
node backtest-runner.js --btc-only

# 指定盈亏比和天数
node backtest-runner.js --btc-only --rr 1.4 --days 360 --drawdown

# 盈亏比扫描（单进程高效版）
node rr-sweep-btc-inline.js

# 通用扫描（支持双币种）
node backtest-runner.js --btc-only --rr-sweep --drawdown
```

### 实盘

```bash
# 模拟模式（systemd服务：pa-trading-sim）
PA_MODE=simulation node live-trading-core-dual.js

# 实盘模式（需配置 vault/binance-api.json + Binance白名单）
PA_MODE=real node live-trading-core-dual.js
```

### 监控

```bash
node monitor.js
node daily-report.js
```

## 安全机制

### 风控系统（5层）
- 单日最大亏损 15% → 触发熔断
- 总回撤 30% → 触发熔断
- 价格异常 10% → 跳过当次开仓
- API连续失败 3次 → 触发熔断
- 余额偏差 5% → 报警

### 熔断保护
- 熔断后强制市价平仓所有持仓
- 手动解除：创建 `data-real/reset-circuit-breaker` 文件
- 熔断期间不开新仓，但持续检查持仓状态

### 开仓保护
- 杠杆上限检查：仓位不超过 balance × allocation × leverage
- MIN_NOTIONAL 检查：按币种动态最低名义值（BTC $105, ETH $25, SOL $8）
- TP/SL 设置后验证挂单存在，缺失则重试
- TP/SL 3次设置均失败 → 紧急市价平仓
- TP 设置失败时回滚已设 SL，防止孤立挂单

### 出场机制（实盘）
- 完全依赖币安 TP/SL 挂单出场，引擎不主动平仓
- 每次检查同步币安持仓状态，TP/SL 触发后自动同步余额
- 所有 getPositions 调用检查 success 字段，API 失败不误判

### 平仓重试
- 失败标记 pendingClose，每轮重试5次，累计上限20次
- 超限转 manualOnly，通知人工处理
- 紧急平仓使用币安实际持仓量，非计算值

### 持仓同步
- 重启时同步币安持仓，未知持仓标记 manualOnly
- 本地有但币安无 → 清除本地记录
- manualOnly 双重保护（engine + live core 均跳过）

### 余额管理
- 启动时从币安 API 获取实际余额
- 开仓和平仓后均同步币安余额
- API Key 存储在 `vault/binance-api.json`，不在代码中硬编码

## 依赖

- `binance-api-node` — Binance API
- `../../kline-cache.js` — K线数据缓存模块（workspace根目录）
