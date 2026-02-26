# 数据源 API 文档

## 1. GMGN Rank API (graduated)

获取已开盘项目排行。

```
GET https://gmgn.ai/defi/quotation/v1/rank/{chain}/swaps/{timeframe}
```

参数：
- `chain`: base
- `timeframe`: 1h / 6h / 24h
- `limit`: 100
- `orderby`: open_timestamp
- `direction`: desc
- `tag`: graduated

必须 Headers：
```
User-Agent: Mozilla/5.0 (Macintosh; ...)
Referer: https://gmgn.ai/?chain=base
Accept: application/json
Origin: https://gmgn.ai
```

返回字段：address, symbol, price, market_cap, liquidity, volume, swaps, buys, sells, holder_count, price_change_percent1h, open_timestamp, twitter_username, website, telegram, is_honeypot, buy_tax, sell_tax, renounced, smart_buy_24h, smart_sell_24h

## 2. GMGN New Pairs API

获取新交易对。

```
GET https://gmgn.ai/defi/quotation/v1/pairs/{chain}/new_pairs
```

参数：
- `chain`: base
- `limit`: 100
- `orderby`: open_timestamp
- `direction`: desc

返回结构：`data.pairs[]`，每个 pair 包含 `base_token_info`（同 rank 字段）和 `open_timestamp`。

## 3. DexScreener Search API

关键词搜索，覆盖 GMGN 漏掉的项目。

```
GET https://api.dexscreener.com/latest/dex/search?q={keyword}
```

无需特殊 Headers。需过滤 `chainId == "base"`。

返回字段：baseToken.address, baseToken.symbol, priceUsd, marketCap, liquidity.usd, volume.h1, txns.h1, priceChange.h1, pairCreatedAt, info.websites, info.socials, info.imageUrl

注意：DexScreener 不提供 holder_count。

## 4. DexScreener Token API

获取单个代币详情（用于补充信息）。

```
GET https://api.dexscreener.com/tokens/v1/{chain}/{address}
```

返回该代币的所有交易对，包含 info.imageUrl（图标）、info.websites、info.socials。

## 5. GMGN Token URL

快速跳转：`https://gmgn.ai/base/token/{address}`

## 限流注意

- GMGN：无明确限流，建议请求间隔 ≥ 0.5s
- DexScreener：建议关键词搜索间隔 ≥ 0.3s，避免批量请求被封
