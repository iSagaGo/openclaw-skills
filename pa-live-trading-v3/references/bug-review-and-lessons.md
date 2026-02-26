# PA Live Trading V3 — Bug 复盘与经验手册

> 最后更新：2026-02-25
> 目的：记录开发过程中踩过的坑和修复思路，避免重蹈覆辙。

---

## 一、资金安全类（P0）

### 1.1 调用不存在的 API 方法

**问题**：平仓重试循环中调用了 `binanceAPI.getPosition(symbol)` 和 `binanceAPI.closePosition()`，但 `binance-api.js` 只暴露了 `getPositions()`（复数）和 `marketOrder()`。

**后果**：首次平仓失败后进入重试，立即抛 `TypeError`，重试永远失败，进入无限循环，整个系统卡死，持仓无法平仓。

**修复**：统一使用 `getPositions()` + `marketOrder()`，与首次平仓逻辑一致。

**教训**：
- 写重试逻辑时，必须和首次调用使用完全相同的 API 方法
- 新写的代码要对照 API 模块的 `module.exports` 确认方法名存在
- 重试逻辑是最容易被忽略测试的路径，但它恰恰是最关键的

---

### 1.2 无限重试循环无退出条件

**问题**：`while (!retrySuccess)` 没有最大重试次数，网络故障时永远循环。

**后果**：阻塞整个交易系统，所有币种的检查都停止。

**修复**：
- 即时重试：最多 10 次，超限标记 `pendingClose`
- pendingClose 重试：每轮检查最多 5 次，超限通知人工干预

**教训**：
- 所有 `while` 循环必须有退出条件，尤其涉及网络 IO 的
- 模式：`while (condition && retryCount < MAX)` 而不是 `while (condition)`
- 失败兜底：超过重试上限后必须有降级方案（通知人工、标记待处理）

---

### 1.3 pendingClose 标记后被无条件删除

**问题**：平仓失败后标记了 `state.positions[symbol].pendingClose = true`，但紧接着 `delete state.positions[symbol]` 无条件执行，标记丢失。

**后果**：下一轮检查时系统认为没有持仓，可能再次开仓（双重持仓），而 Binance 上旧持仓仍在。

**修复**：`if (!state.positions[symbol]?.pendingClose) { delete state.positions[symbol]; }`

**教训**：
- 状态标记和状态清理之间要有条件判断
- 写完标记逻辑后，往下看是否有代码会覆盖/删除这个标记
- 这类 bug 在正常流程中不会触发，只在异常路径出现，code review 时要特别关注异常分支后的代码

---

### 1.4 旧版文件调用新版函数缺少参数

**问题**：`live-trading-core.js`（旧版）调用 `enhanceConsolidationZones(klines, zones)` 和 `detectBOS(klines, trend)` 时没传第三个参数 `config`，而函数签名已更新为需要 config。

**后果**：启动旧版入口直接崩溃 `TypeError: Cannot read properties of undefined`。

**教训**：
- 修改函数签名后，全局搜索所有调用点
- 旧版文件要么同步更新，要么明确标记废弃并阻止启动
- `grep -rn "函数名" *.js` 是你的朋友

---

## 二、逻辑正确性类（P1）

### 2.1 动态风险计算可能超过杠杆限制

**问题**：盈利 ≥50% 时 `riskWithBOS = 0.20`，配合 5x 杠杆，如果 `priceRisk` 很小（1%），仓位价值 = `balance × 0.20 / 0.01 = 20倍余额`，远超 5x 杠杆。

**修复**：
- 引擎层：`calculatePnL` 已有 `cappedPositionValue` 上限检查
- 实盘层：开仓时加 `maxQuantity = balance × allocation × leverage / entry`，取 `Math.min(quantity, maxQuantity)`

**教训**：
- 风险计算公式要考虑极端参数组合
- 引擎层和实盘层都要有保护，不能只依赖一层
- 写完公式后代入极端值验算：最大风险 + 最小 priceRisk + 最大杠杆

---

### 2.2 同步持仓 priceRisk=0 导致 NaN

**问题**：重启时从 Binance 同步持仓，`priceRisk: 0`。后续 `calculatePnL` 中 `riskPerTrade / priceRisk = 0/0 = NaN`，利润计算崩溃。`checkExit` 中 `priceRisk × rrRatio = 0`，任何正向波动都触发止盈。

**修复**：同步持仓标记 `manualOnly: true`，引擎跳过自动出场。

**教训**：
- 从外部同步的数据永远不完整，必须标记为"不可信"
- 涉及除法的字段（priceRisk、allocation），0 值要特殊处理
- 同步 ≠ 恢复，同步只是"知道有这个东西"，不代表能自动管理

---

### 2.3 monitor.js 读错状态结构

**问题**：`monitor.js` 读 `state.position`（单数），实际是 `state.positions`（复数对象）。

**后果**：监控报告永远显示"持仓: 无"，失去监控意义。

**教训**：
- 重构状态结构后，搜索所有读取状态的文件
- 监控/报告模块容易被遗忘，但它们是发现问题的第一道防线

---

## 三、架构设计类（P2）

### 3.1 新旧版本并存

**问题**：`live-trading-core.js`（旧版单币种）和 `live-trading-core-dual.js`（新版）并存，旧版有大量未修复的 bug。

**教训**：
- 新版稳定后立即废弃旧版，至少在文件头加 `// DEPRECATED` 并在启动脚本中移除
- 两套入口 = 两倍维护成本 + 两倍 bug 概率

### 3.2 相对路径依赖工作目录

**问题**：`data-${mode}/live-state.json` 使用相对路径，systemd 启动时工作目录可能不对。

**教训**：
- Node.js 中用 `path.join(__dirname, ...)` 构建路径
- systemd service 中设置 `WorkingDirectory` 是兜底，不是解决方案

### 3.3 硬编码值散落各处

**问题**：Telegram 用户 ID、币种精度在多个文件中重复定义。

**教训**：
- 配置集中管理，其他文件引用
- `SYMBOL_PRECISION` 只在 `binance-api.js` 定义一次，其他地方 `require` 引用

---

## 四、回测与参数优化类

### 4.1 RR 扫描的性能问题

**问题**：`backtest-runner.js --rr-sweep` 每个 RR 值重新加载 K 线，4312 根 × 11 个 RR = 极慢。

**修复**：写了 `rr-sweep-btc-inline.js`，K 线只加载一次，单进程顺序跑。

**教训**：
- 批量回测时数据加载要提到循环外面
- `klines.slice(0, i+1)` 每次创建新数组，O(n²) 内存分配，大数据集很慢
- 性能敏感的回测考虑传索引而不是切片

### 4.2 过拟合风险

**RR 扫描结果**：

| RR | 胜率 | 收益 | 回撤 | 收益/回撤 |
|----|------|------|------|-----------|
| 1.0 | 68.8% | +124.8% | 25.4% | 4.91 |
| 1.1 | 77.4% | +362.3% | 26.8% | 13.51 |
| 1.4 | 76.0% | +404.2% | 25.4% | 15.91 |
| 1.5 | 76.0% | +478.4% | 26.8% | 17.84 |
| 1.6 | 68.0% | +317.6% | 25.4% | 12.50 |
| 2.0 | 52.4% | +112.0% | 26.9% | 4.17 |

**选择 RR 1.4 而非最优 1.5 的原因**：
- 回撤更低（25.4% vs 26.8%）
- 胜率相同（76%）
- 留出安全边际，避免过拟合到历史最优点
- 未来行情变化时 1.4 的容错空间更大

**教训**：
- 回测最优 ≠ 实盘最优，要留安全边际
- 关注参数敏感度：1.5→1.6 胜率断崖（76%→68%），说明 1.5 附近是临界点，不宜贴着临界点选参数

---

## 五、通用开发原则

1. **异常路径比正常路径更重要** — 正常流程谁都能写对，bug 藏在异常分支里
2. **重试必须有上限** — 任何 `while` + 网络 IO = 潜在无限循环
3. **状态修改要原子化** — 标记和清理之间不能有无条件覆盖
4. **改签名后全局搜索** — `grep -rn` 找到所有调用点
5. **同步数据不可信** — 外部来源的数据要标记、校验、兜底
6. **除法前检查分母** — `priceRisk`、`allocation` 等字段为 0 时要特殊处理
7. **旧版及时清理** — 废弃代码是 bug 的温床
8. **监控模块同步更新** — 重构后别忘了更新读取状态的辅助模块
9. **回测参数留安全边际** — 不选历史最优，选稳健区间
10. **性能敏感操作避免 O(n²)** — 数据加载提到循环外，传索引不传切片
