# OpenClaw Skills 技能集合

适用于 [OpenClaw](https://github.com/openclaw/openclaw) 的自定义技能包。

## 技能列表

| 技能 | 说明 |
|------|------|
| [evm-toolkit](./evm-toolkit/) | EVM 链上工具集：钱包生成、批量转账、资金归集、余额查询、地址验证、标签管理 |
| [chain-monitor](./chain-monitor/) | Base 链上项目监控：GMGN + DexScreener 多源扫描，AI 挖矿项目自动检测 |
| [crypto-project-analyzer](./crypto-project-analyzer/) | Crypto/Web3 项目深度分析：代币经济学、社区生态、风险评估 |
| [pa-live-trading-v3](./pa-live-trading-v3/) | PA 价格行为交易系统：SOL + BTC 双币种合约交易，回测 + 实盘 |

## 安装

将技能目录复制到 OpenClaw workspace 的 `skills/` 下即可：

```bash
git clone https://github.com/iSagaGo/openclaw-skills.git
cp -r openclaw-skills/evm-toolkit ~/.openclaw/workspace/skills/
```

各技能的详细使用说明见对应目录下的 `SKILL.md` 和 `README.md`。

## 许可

MIT
