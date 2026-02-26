# API Endpoints Reference

## Blockscout API (Base)

Base URL: `https://base.blockscout.com/api/v2`

| Endpoint | Purpose | Example |
|----------|---------|---------|
| `GET /addresses/<addr>` | Contract/address info (name, creator, verified) | `/addresses/0xA601...0BA3` |
| `GET /tokens/<addr>` | Token info (name, symbol, decimals, holders_count, total_supply) | `/tokens/0xA601...0BA3` |
| `GET /tokens/<addr>/holders` | Holder list (address, value, token_id) | `/tokens/0xA601...0BA3/holders` |
| `GET /tokens/<addr>/counters` | Transfer count + holder count | `/tokens/0xA601...0BA3/counters` |
| `GET /tokens/<addr>/transfers` | Recent transfer list | `/tokens/0xA601...0BA3/transfers` |
| `GET /addresses/<addr>/tokens` | Tokens held by address | `/addresses/0x660e...9b12/tokens` |

Other chains:
- Ethereum: `https://eth.blockscout.com/api/v2`
- Optimism: `https://optimism.blockscout.com/api/v2`
- Arbitrum: `https://arbitrum.blockscout.com/api/v2`

### Notes
- `holders_count` from `/tokens/` is unreliable for Uniswap v4 tokens (PoolManager aggregates balances)
- Use DexScreener browser scrape for accurate holder count
- Rate limits apply; add 1s delay between requests

## DexScreener API

| Endpoint | Purpose |
|----------|---------|
| `GET https://api.dexscreener.com/latest/dex/tokens/<addr>` | All pairs for a token (price, volume, liquidity, txns) |
| `GET https://api.dexscreener.com/tokens/v1/<chain>/<addr>` | Single best pair for token on chain |

Response fields:
- `priceUsd` — current price
- `fdv` — fully diluted valuation
- `liquidity.usd` — pool liquidity
- `volume.h24` — 24h volume
- `txns.h24.buys/sells` — 24h buy/sell count
- `priceChange.h24` — 24h price change %
- `pairCreatedAt` — pair creation timestamp (ms)

## DexScreener Browser Scrape (for holders)

```
1. agent-browser open "https://dexscreener.com/<chain>/<address>"
2. agent-browser snapshot → find "Holders (N)" button ref
3. agent-browser click @ref
4. agent-browser snapshot → parse holder table
```

Key data from holder table:
- Rank, Address, %, Amount, Value, Txns
- Last row: "Others (N)" with aggregate %

## gmgn.ai

URL: `https://gmgn.ai/<chain>/token/<address>`

Has Cloudflare protection — requires browser with cookie solving. Usually blocked from headless browsers. Use as fallback only.

## Twitter/X

URL: `https://x.com/<handle>`

Requires browser (web_fetch returns error). Extract from snapshot:
- Followers count
- Following count
- Posts count
- Bio text
- Join date
- Verified status
