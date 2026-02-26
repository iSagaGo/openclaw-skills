#!/bin/bash
# collect_chain_data.sh - Fetch on-chain data for a token
# Usage: bash collect_chain_data.sh <contract_address> <chain> <output_dir>

set -e

CONTRACT="$1"
CHAIN="${2:-base}"
OUTPUT_DIR="${3:-.}"

mkdir -p "$OUTPUT_DIR"

# Map chain to Blockscout base URL
case "$CHAIN" in
  base) BLOCKSCOUT="https://base.blockscout.com/api/v2" ;;
  eth|ethereum) BLOCKSCOUT="https://eth.blockscout.com/api/v2" ;;
  optimism|op) BLOCKSCOUT="https://optimism.blockscout.com/api/v2" ;;
  arbitrum|arb) BLOCKSCOUT="https://arbitrum.blockscout.com/api/v2" ;;
  *) echo "Unsupported chain: $CHAIN"; exit 1 ;;
esac

DEXSCREENER="https://api.dexscreener.com/latest/dex/tokens/$CONTRACT"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "=== Collecting on-chain data ==="
echo "Contract: $CONTRACT"
echo "Chain: $CHAIN"
echo "Blockscout: $BLOCKSCOUT"
echo "Output: $OUTPUT_DIR"
echo ""

# 1. Token info
echo "[1/5] Fetching token info..."
curl -s "$BLOCKSCOUT/tokens/$CONTRACT" | python3 -m json.tool > "$OUTPUT_DIR/token-info.json" 2>/dev/null || echo '{"error":"fetch failed"}' > "$OUTPUT_DIR/token-info.json"
sleep 1

# 2. Address/contract info
echo "[2/5] Fetching contract info..."
curl -s "$BLOCKSCOUT/addresses/$CONTRACT" | python3 -m json.tool > "$OUTPUT_DIR/contract-info.json" 2>/dev/null || echo '{"error":"fetch failed"}' > "$OUTPUT_DIR/contract-info.json"
sleep 1

# 3. Holders
echo "[3/5] Fetching holders..."
curl -s "$BLOCKSCOUT/tokens/$CONTRACT/holders" | python3 -m json.tool > "$OUTPUT_DIR/holders.json" 2>/dev/null || echo '{"error":"fetch failed"}' > "$OUTPUT_DIR/holders.json"
sleep 1

# 4. Counters (transfer count + holder count)
echo "[4/5] Fetching counters..."
curl -s "$BLOCKSCOUT/tokens/$CONTRACT/counters" | python3 -m json.tool > "$OUTPUT_DIR/counters.json" 2>/dev/null || echo '{"error":"fetch failed"}' > "$OUTPUT_DIR/counters.json"
sleep 1

# 5. DexScreener
echo "[5/5] Fetching DexScreener data..."
curl -s "$DEXSCREENER" | python3 -m json.tool > "$OUTPUT_DIR/dexscreener.json" 2>/dev/null || echo '{"error":"fetch failed"}' > "$OUTPUT_DIR/dexscreener.json"

# Generate summary markdown
echo ""
echo "=== Generating summary ==="

python3 -c "
import json, sys

ts = '$TIMESTAMP'
chain = '$CHAIN'
contract = '$CONTRACT'

# Token info
try:
    with open('$OUTPUT_DIR/token-info.json') as f:
        token = json.load(f)
    name = token.get('name', 'Unknown')
    symbol = token.get('symbol', 'Unknown')
    decimals = token.get('decimals', '?')
    total_supply_raw = token.get('total_supply', '0')
    holders_count = token.get('holders_count', '?')
    try:
        total_supply = int(total_supply_raw) / (10 ** int(decimals))
        total_supply_str = f'{total_supply:,.0f}'
    except:
        total_supply_str = total_supply_raw
except:
    name = symbol = 'Error'
    decimals = holders_count = total_supply_str = '?'

# Contract info
try:
    with open('$OUTPUT_DIR/contract-info.json') as f:
        addr = json.load(f)
    is_contract = addr.get('is_contract', False)
    is_verified = addr.get('is_verified', False)
    contract_name = addr.get('name', 'Unknown')
    creator = addr.get('creator_address_hash', 'Unknown')
except:
    is_contract = is_verified = False
    contract_name = creator = 'Unknown'

# Counters
try:
    with open('$OUTPUT_DIR/counters.json') as f:
        counters = json.load(f)
    transfers = counters.get('transfers_count', '?')
    holders_alt = counters.get('token_holders_count', '?')
except:
    transfers = holders_alt = '?'

# DexScreener
try:
    with open('$OUTPUT_DIR/dexscreener.json') as f:
        dex = json.load(f)
    pairs = dex.get('pairs', [])
    if pairs:
        p = pairs[0]
        price = p.get('priceUsd', '?')
        fdv = p.get('fdv', '?')
        liq = p.get('liquidity', {}).get('usd', '?')
        vol24 = p.get('volume', {}).get('h24', '?')
        change24 = p.get('priceChange', {}).get('h24', '?')
        buys24 = p.get('txns', {}).get('h24', {}).get('buys', '?')
        sells24 = p.get('txns', {}).get('h24', {}).get('sells', '?')
        created = p.get('pairCreatedAt', '?')
        dex_name = p.get('dexId', '?')
    else:
        price = fdv = liq = vol24 = change24 = buys24 = sells24 = created = dex_name = 'N/A'
except:
    price = fdv = liq = vol24 = change24 = buys24 = sells24 = created = dex_name = 'Error'

# Holders list
try:
    with open('$OUTPUT_DIR/holders.json') as f:
        h = json.load(f)
    items = h.get('items', [])
except:
    items = []

summary = f'''# On-Chain Data Summary
# Collected: {ts}
# Contract: {contract}
# Chain: {chain}

## Token Info

| Field | Value |
|-------|-------|
| Name | {name} |
| Symbol | {symbol} |
| Decimals | {decimals} |
| Total Supply | {total_supply_str} |
| Holders (Blockscout) | {holders_count} |

## Contract Info

| Field | Value |
|-------|-------|
| Contract Name | {contract_name} |
| Is Contract | {is_contract} |
| Is Verified | {is_verified} |
| Creator | {creator} |

## Counters

| Field | Value |
|-------|-------|
| Transfers | {transfers} |
| Holders (alt) | {holders_alt} |

## Market Data (DexScreener)

| Field | Value |
|-------|-------|
| Price | \${price} |
| FDV | \${fdv:,} |
| Liquidity | \${liq:,} |
| 24h Volume | \${vol24:,} |
| 24h Change | {change24}% |
| 24h Buys | {buys24} |
| 24h Sells | {sells24} |
| DEX | {dex_name} |
| Pair Created | {created} |

## Top Holders (Blockscout - may be incomplete for Uniswap v4)

| # | Address | Balance |
|---|---------|---------|
'''

for i, item in enumerate(items[:10], 1):
    addr_hash = item.get('address', {}).get('hash', '?')
    addr_name = item.get('address', {}).get('name', '')
    val_raw = item.get('value', '0')
    try:
        val = int(val_raw) / (10 ** int(decimals))
        val_str = f'{val:,.2f}'
    except:
        val_str = val_raw
    label = f'{addr_hash[:6]}...{addr_hash[-4:]}' + (f' ({addr_name})' if addr_name else '')
    summary += f'| {i} | {label} | {val_str} |\\n'

summary += '''
> ⚠️ Blockscout holder count may be inaccurate for Uniswap v4 tokens.
> Use DexScreener browser scrape for accurate holder data.
'''

with open('$OUTPUT_DIR/chain-data-summary.md', 'w') as f:
    f.write(summary)

print('Summary saved to $OUTPUT_DIR/chain-data-summary.md')
" 2>&1

echo ""
echo "=== Done ==="
echo "Files saved to $OUTPUT_DIR/"
ls -la "$OUTPUT_DIR/"
