---
name: crypto-project-analyzer
description: "Crypto/Web3 project deep analysis with 6-step framework. Use when user asks to analyze a crypto project, token, or smart contract. Supports: project overview, tokenomics (on-chain contract analysis), project mechanics (mining/DeFi/GameFi), community & ecosystem, risk assessment, and investment strategy. Triggers: 'analyze project', 'project analysis', '项目分析', '分析代币', 'tokenomics', '代币经济学', 'analyze token', 'analyze contract'."
---

# Crypto Project Analyzer

Six-step deep analysis framework for crypto/Web3 projects. Generates structured reports with on-chain data, tokenomics, risk assessment, and investment strategy.

## Script Directory

`${SKILL_DIR}` = this SKILL.md's parent directory.

| Script | Purpose |
|--------|---------|
| `scripts/collect_chain_data.sh` | Fetch on-chain data (token info, holders, transfers) |
| `scripts/gen_report_pdf.js` | Convert HTML report to PDF via Playwright |

## Workflow

### Step 0: Gather Input

Required from user:
- Token contract address OR project name/URL
- Chain (default: Base)

Optional:
- Specific focus areas (e.g. "only tokenomics")
- Project docs/whitepaper URL

### Step 1: Setup Project Directory

```
projects/<project-name>/
├── raw/           # Raw data snapshots
├── report-images/ # Generated images (if needed)
└── report-hd/     # HD images (if needed)
```

### Step 2: Execute 6-Step Analysis

Run steps sequentially. Each step produces one markdown file. See `references/framework.md` for detailed instructions per step.

| Step | Output File | Focus |
|------|------------|-------|
| 1 | `01-项目概览.md` | Basic info, positioning, architecture, market data |
| 2 | `02-代币经济学.md` | On-chain contract analysis, distribution, inflation |
| 3 | `03-项目特性.md` | Core mechanism deep-dive (type-dependent) |
| 4 | `04-社区与生态.md` | Social media, ecosystem, team, competitors |
| 5 | `05-风险综合评估.md` | Risk matrix, scenario analysis |
| 6 | `06-投资建议与参与策略.md` | Strategy, scoring, monitoring |

For each step:
1. Collect data (APIs, browser, docs) → save to `raw/`
2. Analyze and write report → save numbered `.md`

### Step 3: Generate Final Report

1. Merge all 6 reports into two versions:
   - **精简版**: Extract key findings → `report-summary.md` (~200-300 lines)
   - **完整版**: Concatenate all 6 reports in full → `report-complete.md` (no omissions)
2. Convert both to HTML: `npx -y bun <markdown-to-html-skill>/scripts/main.ts <md-file> --theme default --keep-title`
3. Generate both PDFs: `node ${SKILL_DIR}/scripts/gen_report_pdf.js <html-path> <pdf-path>`
4. Send to user (default: both versions; or per user request)

### Data Collection Methods

#### On-Chain Data (use `scripts/collect_chain_data.sh`)

```bash
bash ${SKILL_DIR}/scripts/collect_chain_data.sh <contract_address> <chain> <output_dir>
```

Chains supported: `base`, `eth`, `optimism`, `arbitrum`

#### DexScreener API (direct fetch)

```
GET https://api.dexscreener.com/latest/dex/tokens/<address>
```

Returns: price, FDV, liquidity, volume, txns, pair info.

#### Holder Data (browser required)

Blockscout API `holders_count` is unreliable for Uniswap v4 tokens. Use DexScreener page instead:

1. `agent-browser open "https://dexscreener.com/<chain>/<address>"`
2. `agent-browser snapshot` → find "Holders (N)" button
3. Click it → snapshot again for top holders table

#### Social Data (browser required)

Twitter/X blocks web_fetch. Use agent-browser:

1. `agent-browser open "https://x.com/<handle>"`
2. `agent-browser snapshot` → extract followers, posts, bio

#### Contract Source

Blockscout verified source: `GET https://<chain>.blockscout.com/api/v2/addresses/<address>`

### Key API Endpoints

See `references/api-endpoints.md` for full list.

### Report Quality Checklist

Before delivering:
- [ ] All 6 steps completed
- [ ] Holder count cross-verified (DexScreener vs Blockscout)
- [ ] Market data timestamped
- [ ] Risk levels assigned (🔴🟡🟢)
- [ ] Scoring card included
- [ ] Disclaimer included
- [ ] PDF generated and readable

### Output Formats

| Format | When |
|--------|------|
| Telegram text | Default, split into sections |
| PDF (both versions) | User requests "输出报告" or "generate report" |
| PDF (summary only) | User requests "精简版" or "summary" |
| PDF (complete only) | User requests "完整版" or "full report" |

### Report Versions

Two PDF versions are generated:

1. **精简版** (`report-summary.md` → PDF, ~200-300 lines)
   - Core findings, key tables, conclusions per step
   - No detailed analysis process, results only
   - For quick review and sharing

2. **完整版** (`report-complete.md` → PDF, full content)
   - All 6 reports concatenated in full, separated by `---`
   - No content omitted
   - For deep reading and verification

Default: generate both and send both to user.

### Language

Match user's language. Default: Chinese (简体中文) for Chinese users.
