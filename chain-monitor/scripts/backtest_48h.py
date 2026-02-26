#!/usr/bin/env python3
"""
链上项目监控 - 48小时回测
用与 gmgn_monitor.py 相同的三个数据源和过滤逻辑，
拉取过去48小时内的项目并输出结果。
"""

import json
import os
import time
import requests
from datetime import datetime

CHAIN = "base"
MIN_LIQUIDITY = 5000
MIN_HOLDERS = 20
MAX_AGE_HOURS = 48  # 回测48小时

AI_MINING_KEYWORDS = [
    "mine", "miner", "mining", "bot", "agent", "ai",
    "earn", "farm", "stake", "proof", "compute",
    "gpu", "hash", "reward", "epoch", "node",
    "botcoin", "agentcoin", "aibot", "automine"
]

DEXSCREENER_KEYWORDS = [
    "botcoin", "mining", "miner", "ai agent", "bot coin",
    "agent coin", "compute", "gpu", "hash", "proof",
    "node", "earn", "farm", "stake", "reward",
]

EXCLUDED_SYMBOLS = [
    "cbBTC", "WETH", "USDC", "USDT", "DAI", "WBTC", "ETH",
    "USDbC", "AERO", "DEGEN", "BRETT", "TOSHI",
]
EXCLUDED_SYMBOLS_LOWER = [s.lower() for s in EXCLUDED_SYMBOLS]

GMGN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Referer": "https://gmgn.ai/?chain=base",
    "Accept": "application/json",
    "Origin": "https://gmgn.ai"
}

DEXSCREENER_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
}

NOW = int(time.time())
CUTOFF = NOW - 48 * 3600


def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def is_ai_mining(text_parts):
    text = ' '.join(t.lower() for t in text_parts if t)
    matches = [kw for kw in AI_MINING_KEYWORDS if kw in text]
    return len(matches) > 0, matches


# === GMGN token 详情 API ===
# api/v1/token_info 可获取单个 token 的 holder_count 等详情
def fetch_gmgn_token_detail(address):
    """从 GMGN api/v1/token_info 获取单个 token 详情"""
    try:
        url = f"https://gmgn.ai/api/v1/token_info/{CHAIN}/{address}"
        resp = requests.get(url, headers=GMGN_HEADERS, timeout=10)
        data = resp.json()
        if data.get('code') == 0:
            return data.get('data', {})
    except:
        pass
    return {}


# === Honeypot.is API ===
# 通过模拟链上交易检测真实买卖税率和貔貅状态
def fetch_honeypot_check(address):
    """从 honeypot.is 获取真实税率和貔貅检测结果"""
    try:
        url = f"https://api.honeypot.is/v2/IsHoneypot?address={address}&chainId=8453"
        resp = requests.get(url, timeout=10)
        data = resp.json()
        result = {}
        if data.get('honeypotResult'):
            result['is_honeypot'] = 1 if data['honeypotResult'].get('isHoneypot') else 0
            result['honeypot_reason'] = data['honeypotResult'].get('honeypotReason', '')
        if data.get('simulationResult'):
            result['buy_tax'] = float(data['simulationResult'].get('buyTax') or 0)
            result['sell_tax'] = float(data['simulationResult'].get('sellTax') or 0)
        if data.get('summary'):
            result['risk_level'] = int(data['summary'].get('riskLevel') or 0)
        return result
    except:
        pass
    return {}


# === 数据源 1: GMGN rank ===
def fetch_gmgn_rank():
    all_tokens = []
    for timeframe in ['1h', '6h', '24h']:
        try:
            url = f"https://gmgn.ai/defi/quotation/v1/rank/{CHAIN}/swaps/{timeframe}"
            params = {"limit": 100, "orderby": "open_timestamp", "direction": "desc", "tag": "graduated"}
            resp = requests.get(url, params=params, headers=GMGN_HEADERS, timeout=15)
            data = resp.json()
            if data.get('code') == 0:
                tokens = data['data']['rank']
                log(f"[GMGN-rank/{timeframe}] {len(tokens)} 个项目")
                all_tokens.extend(tokens)
            time.sleep(0.5)
        except Exception as e:
            log(f"[GMGN-rank/{timeframe}] error: {e}")
    return all_tokens


def parse_gmgn_rank(t):
    open_ts = t.get('open_timestamp') or 0
    age_hours = (NOW - open_ts) / 3600
    return {
        'address': (t.get('address') or '').lower(),
        'symbol': t.get('symbol', '?'),
        'price': t.get('price', 0),
        'market_cap': float(t.get('market_cap') or 0),
        'liquidity': float(t.get('liquidity') or 0),
        'volume_1h': float(t.get('volume') or 0),
        'swaps': int(t.get('swaps') or 0),
        'buys': int(t.get('buys') or 0),
        'sells': int(t.get('sells') or 0),
        'holders': int(t.get('holder_count') or 0),
        'price_change_1h': t.get('price_change_percent1h', 0),
        'age_hours': round(age_hours, 1),
        'open_timestamp': open_ts,
        'twitter': t.get('twitter_username') or '',
        'website': t.get('website') or '',
        'telegram': t.get('telegram') or '',
        'source': 'gmgn_rank',
        'is_honeypot': int(t.get('is_honeypot') or 0),
        'buy_tax': float(t.get('buy_tax') or 0),
        'sell_tax': float(t.get('sell_tax') or 0),
        'renounced': int(t.get('renounced') or 0),
        'is_open_source': int(t.get('is_open_source') or 0),
        'rug_ratio': float(t.get('rug_ratio') or 0),
    }


# === 数据源 2: GMGN new_pairs ===
def fetch_gmgn_pairs():
    try:
        url = f"https://gmgn.ai/defi/quotation/v1/pairs/{CHAIN}/new_pairs"
        params = {"limit": 100, "orderby": "open_timestamp", "direction": "desc"}
        resp = requests.get(url, params=params, headers=GMGN_HEADERS, timeout=15)
        data = resp.json()
        if data.get('code') == 0:
            pairs = data['data'].get('pairs', [])
            log(f"[GMGN-pairs] {len(pairs)} 个新交易对")
            return pairs
        log(f"[GMGN-pairs] API error: {data.get('msg')}")
    except Exception as e:
        log(f"[GMGN-pairs] error: {e}")
    return []


def parse_gmgn_pair(p):
    bti = p.get('base_token_info', {})
    open_ts = p.get('open_timestamp') or 0
    age_hours = (NOW - open_ts) / 3600 if open_ts else 0
    social = bti.get('social_links', {}) or {}
    return {
        'address': (bti.get('address') or '').lower(),
        'symbol': bti.get('symbol', '?'),
        'price': bti.get('price', 0),
        'market_cap': float(bti.get('market_cap') or 0),
        'liquidity': float(bti.get('liquidity') or 0),
        'volume_1h': float(bti.get('volume') or 0),
        'swaps': int(bti.get('swaps') or 0),
        'buys': int(bti.get('buys') or 0),
        'sells': int(bti.get('sells') or 0),
        'holders': int(bti.get('holder_count') or 0),
        'price_change_1h': bti.get('price_change_percent1h', 0),
        'age_hours': round(age_hours, 1),
        'open_timestamp': open_ts,
        'twitter': social.get('twitter_username') or '',
        'website': social.get('website') or '',
        'telegram': social.get('telegram') or '',
        'source': 'gmgn_pairs',
        'is_honeypot': int(bti.get('is_honeypot') or 0),
        'buy_tax': float(bti.get('buy_tax') or 0),
        'sell_tax': float(bti.get('sell_tax') or 0),
        'renounced': int(bti.get('renounced') or 0),
        'is_open_source': int(bti.get('is_open_source') or 0),
        'rug_ratio': float(bti.get('rug_ratio') or 0),
    }


# === 数据源 3: DexScreener ===
def fetch_dexscreener():
    all_tokens = {}
    for kw in DEXSCREENER_KEYWORDS:
        try:
            resp = requests.get(
                f'https://api.dexscreener.com/latest/dex/search?q={kw}',
                headers=DEXSCREENER_HEADERS, timeout=15
            )
            if resp.status_code != 200:
                continue
            d = resp.json()
            pairs = [p for p in d.get('pairs', []) if p.get('chainId') == 'base']
            for p in pairs:
                addr = (p.get('baseToken', {}).get('address') or '').lower()
                if addr and addr not in all_tokens:
                    all_tokens[addr] = p
            time.sleep(0.3)
        except Exception as e:
            log(f"[DexScreener] '{kw}' error: {e}")
    log(f"[DexScreener] 共 {len(all_tokens)} 个 Base 链项目")
    return list(all_tokens.values())


def parse_dexscreener(p):
    bt = p.get('baseToken', {})
    now_ms = time.time() * 1000
    created = p.get('pairCreatedAt') or 0
    age_hours = (now_ms - created) / 3600000 if created else 0
    txns_1h = p.get('txns', {}).get('h1', {})
    info = p.get('info', {})
    socials = info.get('socials', [])
    websites = info.get('websites', [])
    twitter, website, telegram = '', '', ''
    for s in socials:
        if s.get('type') == 'twitter':
            url = s.get('url', '')
            twitter = url.split('/')[-1] if '/' in url else url
        elif s.get('type') == 'telegram':
            telegram = s.get('url', '')
    if websites:
        website = websites[0].get('url', '')
    return {
        'address': (bt.get('address') or '').lower(),
        'symbol': bt.get('symbol', '?'),
        'price': float(p.get('priceUsd') or 0),
        'market_cap': float(p.get('marketCap') or 0),
        'liquidity': float((p.get('liquidity') or {}).get('usd') or 0),
        'volume_1h': float((p.get('volume') or {}).get('h1') or 0),
        'swaps': int(txns_1h.get('buys', 0)) + int(txns_1h.get('sells', 0)),
        'buys': int(txns_1h.get('buys', 0)),
        'sells': int(txns_1h.get('sells', 0)),
        'holders': 0,
        'price_change_1h': float((p.get('priceChange') or {}).get('h1') or 0),
        'age_hours': round(age_hours, 1),
        'open_timestamp': int(created / 1000) if created else 0,
        'twitter': twitter,
        'website': website,
        'telegram': telegram,
        'source': 'dexscreener',
        'is_honeypot': None,
        'buy_tax': None,
        'sell_tax': None,
        'renounced': None,
        'is_open_source': None,
        'rug_ratio': None,
    }


def main():
    log("=" * 60)
    log("链上项目监控 - 48小时回测")
    log(f"回测范围: {datetime.fromtimestamp(CUTOFF).strftime('%m-%d %H:%M')} ~ {datetime.fromtimestamp(NOW).strftime('%m-%d %H:%M')}")
    log(f"过滤: 流动性>=${MIN_LIQUIDITY} 持有人>={MIN_HOLDERS} 年龄<={MAX_AGE_HOURS}h")
    log("=" * 60)

    all_parsed = []

    # 源1
    for t in fetch_gmgn_rank():
        all_parsed.append(parse_gmgn_rank(t))
    # 源2
    for p in fetch_gmgn_pairs():
        all_parsed.append(parse_gmgn_pair(p))
    # 源3
    for p in fetch_dexscreener():
        all_parsed.append(parse_dexscreener(p))

    log(f"\n原始数据: {len(all_parsed)} 条")

    # 去重（优先级高的覆盖低的），同时保留所有源数据用于交叉补充
    merged = {}
    all_by_addr = {}  # 保留所有源的数据
    priority = {'gmgn_rank': 3, 'gmgn_pairs': 2, 'dexscreener': 1}
    for t in all_parsed:
        addr = t.get('address', '')
        if not addr:
            continue
        if addr not in all_by_addr:
            all_by_addr[addr] = []
        all_by_addr[addr].append(t)
        existing = merged.get(addr)
        if not existing or priority.get(t['source'], 0) > priority.get(existing['source'], 0):
            merged[addr] = t

    # 交叉补充：用 GMGN 数据补充 DexScreener 缺失的字段
    for addr, main in merged.items():
        others = all_by_addr.get(addr, [])
        for other in others:
            if other['source'] == main['source']:
                continue
            # 补充持有人数据
            if main['holders'] == 0 and other['holders'] > 0:
                main['holders'] = other['holders']
            # 补充网站/推特/电报
            if not main['website'] and other.get('website'):
                main['website'] = other['website']
            if not main['twitter'] and other.get('twitter'):
                main['twitter'] = other['twitter']
            if not main['telegram'] and other.get('telegram'):
                main['telegram'] = other['telegram']
            # 补充 age（DexScreener age=0 时用 GMGN 的）
            if main['age_hours'] == 0 and other['age_hours'] > 0:
                main['age_hours'] = other['age_hours']
                main['open_timestamp'] = other['open_timestamp']
            # 补充安全字段（DexScreener 没有这些数据）
            for field in ['is_honeypot', 'buy_tax', 'sell_tax', 'renounced', 'is_open_source', 'rug_ratio']:
                if main.get(field) is None and other.get(field) is not None:
                    main[field] = other[field]

    log(f"去重后: {len(merged)} 个唯一项目")

    # 48小时过滤
    in_range = {k: v for k, v in merged.items() if v['age_hours'] <= MAX_AGE_HOURS}
    log(f"48小时内: {len(in_range)} 个")

    # 质量过滤
    quality = {}
    for k, v in in_range.items():
        # 排除主流币
        if v['symbol'].lower() in EXCLUDED_SYMBOLS_LOWER:
            continue
        if v['liquidity'] < MIN_LIQUIDITY:
            continue
        if v['holders'] > 0 and v['holders'] < MIN_HOLDERS:
            continue
        quality[k] = v

    # 对持有人为0的项目，从 GMGN token_info API 补查
    missing_holders = [addr for addr, v in quality.items() if v['holders'] == 0]
    if missing_holders:
        log(f"补查 {len(missing_holders)} 个缺失持有人数据的项目...")
        for addr in missing_holders:
            info = fetch_gmgn_token_detail(addr)
            if info:
                holders = int(info.get('holder_count') or 0)
                if holders > 0:
                    quality[addr]['holders'] = holders
                    log(f"  {quality[addr]['symbol']}: 补充持有人 {holders}")
                # 同时补充其他缺失字段
                if not quality[addr].get('website') and info.get('website'):
                    quality[addr]['website'] = info['website']
                if not quality[addr].get('twitter') and info.get('twitter_username'):
                    quality[addr]['twitter'] = info['twitter_username']
                if not quality[addr].get('telegram') and info.get('telegram'):
                    quality[addr]['telegram'] = info['telegram']
                # 补充 age
                if quality[addr]['age_hours'] == 0 and info.get('open_timestamp'):
                    ots = int(info['open_timestamp'])
                    quality[addr]['age_hours'] = round((NOW - ots) / 3600, 1)
                    quality[addr]['open_timestamp'] = ots
            time.sleep(0.3)
        # 补查后重新过滤持有人不足的和超龄的
        to_remove = [k for k, v in quality.items()
                     if (0 < v['holders'] < MIN_HOLDERS) or v['age_hours'] > MAX_AGE_HOURS]
        for k in to_remove:
            del quality[k]

    # 流动性二次验证 + Honeypot.is 真实税率检测
    log(f"流动性二次验证 + 貔貅检测...")
    to_remove = []
    for addr, v in quality.items():
        # 1. GMGN 流动性验证
        info = fetch_gmgn_token_detail(addr)
        if info:
            real_liq = float(info.get('liquidity') or 0)
            if real_liq < MIN_LIQUIDITY and v['liquidity'] >= MIN_LIQUIDITY:
                log(f"  ❌ {v['symbol']}: 实际流动性 ${real_liq:,.0f}（列表显示 ${v['liquidity']:,.0f}），已剔除")
                to_remove.append(addr)
                continue
            elif real_liq > 0 and v['liquidity'] > 0:
                v['liquidity'] = real_liq
        # 2. Honeypot.is 真实税率检测
        hp = fetch_honeypot_check(addr)
        if hp:
            if hp.get('is_honeypot') == 1:
                v['is_honeypot'] = 1
                v['honeypot_reason'] = hp.get('honeypot_reason', '')
                log(f"  🚫 {v['symbol']}: 貔貅盘！{hp.get('honeypot_reason','')}")
            if hp.get('buy_tax') is not None:
                v['buy_tax'] = hp['buy_tax']
            if hp.get('sell_tax') is not None:
                v['sell_tax'] = hp['sell_tax']
            if hp.get('sell_tax', 0) >= 50:
                log(f"  ⚠️ {v['symbol']}: 卖出税 {hp['sell_tax']}%")
        time.sleep(0.2)
    for k in to_remove:
        del quality[k]

    log(f"质量过滤后: {len(quality)} 个")

    # AI 挖矿标记
    for t in quality.values():
        is_ai, kws = is_ai_mining([t['symbol'], t['website'], t['twitter']])
        t['is_ai_mining'] = is_ai
        t['ai_keywords'] = kws

    # 排序
    results = sorted(quality.values(), key=lambda x: (not x['is_ai_mining'], -x['open_timestamp']))

    ai_count = sum(1 for r in results if r['is_ai_mining'])
    log(f"\n{'=' * 60}")
    log(f"回测结果: {len(results)} 个项目 (AI挖矿: {ai_count})")
    log(f"{'=' * 60}")

    # 数据源统计
    src_count = {}
    for r in results:
        src = r['source']
        src_count[src] = src_count.get(src, 0) + 1
    for src, cnt in sorted(src_count.items()):
        log(f"  数据源 {src}: {cnt} 个")

    # 数据异常检测
    def get_warnings(p):
        warns = []
        mc = p['market_cap']
        liq = p['liquidity']
        if liq > 0 and mc / liq > 1000:
            warns.append(f"MC/Liq比={mc/liq:.0f}x，疑似假市值")
        elif liq > 0 and mc / liq > 100:
            warns.append(f"MC/Liq比={mc/liq:.0f}x，市值偏高")
        if p['age_hours'] == 0 and p['source'] == 'dexscreener':
            warns.append("age=0h，可能是新pair非新币")
        if p['holders'] == 0 and p['source'] == 'dexscreener':
            warns.append("持有人数据缺失")
        # 貔貅盘检测
        if p.get('is_honeypot') == 1:
            warns.append("🚫 貔貅盘（Honeypot）！只能买不能卖")
        # 买卖税检测
        buy_tax = p.get('buy_tax')
        sell_tax = p.get('sell_tax')
        if buy_tax is not None and float(buy_tax) > 5:
            warns.append(f"买入税 {float(buy_tax):.1f}%")
        if sell_tax is not None and float(sell_tax) > 5:
            warns.append(f"卖出税 {float(sell_tax):.1f}%")
        if sell_tax is not None and float(sell_tax) > 30:
            warns.append("🚫 卖出税过高，疑似貔貅")
        # Rug 风险
        rug = p.get('rug_ratio')
        if rug is not None and float(rug) > 0.5:
            warns.append(f"⛔ Rug风险 {float(rug)*100:.0f}%")
        elif rug is not None and float(rug) > 0.2:
            warns.append(f"Rug风险 {float(rug)*100:.0f}%")
        return warns

    # 安全标签生成
    def get_security_tags(p):
        tags = []
        if p.get('renounced') == 1:
            tags.append("✅弃权")
        elif p.get('renounced') == 0 and p.get('renounced') is not None:
            tags.append("❌未弃权")
        if p.get('is_open_source') == 1:
            tags.append("✅开源")
        elif p.get('is_open_source') == 0 and p.get('is_open_source') is not None:
            tags.append("❌未开源")
        if p.get('is_honeypot') == 1:
            tags.append("🚫貔貅")
        elif p.get('is_honeypot') == 0 and p.get('is_honeypot') is not None:
            tags.append("✅非貔貅")
        buy_tax = p.get('buy_tax')
        sell_tax = p.get('sell_tax')
        if buy_tax is not None and sell_tax is not None:
            tags.append(f"税:{float(buy_tax):.1f}%/{float(sell_tax):.1f}%")
        return tags

    # 重点项目检测（有网页/社交资料）
    def is_featured(p):
        return bool(p.get('website') or p.get('twitter') or p.get('telegram'))

    # 同名检测：当批结果 + 历史 notified_full 合并统计
    from collections import Counter
    _symbol_counts = Counter(r['symbol'] for r in results)
    # 合并历史数据中的 symbol
    try:
        import json as _json
        _state_file = "/tmp/gmgn_monitor_state.json"
        if os.path.exists(_state_file):
            with open(_state_file) as _sf:
                _hist = _json.load(_sf).get('notified_full', {})
            for _addr, _hp in _hist.items():
                _sym = _hp.get('symbol', '')
                if _sym:
                    _symbol_counts[_sym] += 1
            # 去掉当批已统计的重复（历史里也有当批项目）
            for r in results:
                if r['address'] in _hist:
                    _symbol_counts[r['symbol']] -= 1
    except Exception:
        pass

    def _display_name(p):
        """同名项目在 symbol 后加合约地址前6位+同名数量"""
        sym = p['symbol']
        cnt = _symbol_counts.get(sym, 1)
        if cnt > 1:
            return f"{sym} ({p['address'][:6]}) [同名×{cnt}]"
        return sym

    def format_project(i, p, show_keywords=False):
        lines = []
        warns = get_warnings(p)
        featured = is_featured(p)
        # 标题行
        prefix = ""
        if featured and warns:
            prefix = "⭐⚠️ "
        elif featured:
            prefix = "⭐ "
        elif warns:
            prefix = "⚠️ "
        suffix = ""
        if featured:
            suffix += " — 有网页资料"
        lines.append(f"  {prefix}#{i} {_display_name(p)}{suffix}")
        lines.append(f"     合约: {p['address']}")
        lines.append(f"     MC: ${p['market_cap']:,.0f} | 流动性: ${p['liquidity']:,.0f} | 持有人: {p['holders']}")
        try:
            chg_val = float(p['price_change_1h']) if p['price_change_1h'] else 0
        except (ValueError, TypeError):
            chg_val = 0
        chg_str = f"+{chg_val:.1f}%" if chg_val > 0 else f"{chg_val:.1f}%"
        lines.append(f"     年龄: {p['age_hours']}h | 1h: {chg_str} | 来源: {p['source']}")
        # 安全标签
        sec_tags = get_security_tags(p)
        if sec_tags:
            lines.append(f"     🔒 {' | '.join(sec_tags)}")
        if show_keywords and p.get('ai_keywords'):
            lines.append(f"     关键词: {', '.join(p['ai_keywords'])}")
        if p.get('website'):
            lines.append(f"     🌐 {p['website']}")
        if p.get('twitter'):
            lines.append(f"     🐦 @{p['twitter']}")
        if p.get('telegram'):
            lines.append(f"     💬 {p['telegram']}")
        lines.append(f"     🔗 gmgn.ai/base/token/{p['address']}")
        if warns:
            for w in warns:
                lines.append(f"     ⚠️ {w}")
        lines.append("")
        return lines

    # 疑似假市值判断
    def _is_fake_mc(p):
        liq = p.get('liquidity', 0)
        mc = p.get('market_cap', 0)
        return liq > 0 and mc / liq > 1000

    # 新项目检测：不在历史 notified_full 里的
    _hist_addrs = set(_hist.keys()) if '_hist' in dir() else set()
    try:
        if not _hist_addrs:
            import json as _json2
            _sf2 = "/tmp/gmgn_monitor_state.json"
            if os.path.exists(_sf2):
                with open(_sf2) as _f2:
                    _hist_addrs = set(_json2.load(_f2).get('notified_full', {}).keys())
    except Exception:
        pass

    def _is_new(p):
        return p['address'] not in _hist_addrs

    # 四分类：新项目、AI挖矿、其他、疑似假市值
    new_projects = [r for r in results if _is_new(r) and not _is_fake_mc(r)]
    new_addrs = {r['address'] for r in new_projects}
    ai_projects = [r for r in results if r['is_ai_mining'] and not _is_fake_mc(r) and r['address'] not in new_addrs]
    normal = [r for r in results if not r['is_ai_mining'] and not _is_fake_mc(r) and r['address'] not in new_addrs]
    fake_mc = [r for r in results if _is_fake_mc(r)]

    if new_projects:
        log(f"\n🆕 新项目 ({len(new_projects)}):")
        log("-" * 60)
        for i, p in enumerate(new_projects, 1):
            for line in format_project(i, p, show_keywords=p.get('is_ai_mining', False)):
                log(line)

    if ai_projects:
        log(f"\n🤖 AI 挖矿项目 ({len(ai_projects)}):")
        log("-" * 60)
        for i, p in enumerate(ai_projects, 1):
            for line in format_project(i, p, show_keywords=True):
                log(line)

    if normal:
        log(f"\n📊 其他项目 ({len(normal)}):")
        log("-" * 60)
        for i, p in enumerate(normal, 1):
            for line in format_project(i, p):
                log(line)

    if fake_mc:
        log(f"\n⚠️ 疑似假市值 ({len(fake_mc)}):")
        log("-" * 60)
        for i, p in enumerate(fake_mc, 1):
            for line in format_project(i, p, show_keywords=p.get('is_ai_mining', False)):
                log(line)

    # 保存完整结果
    out_file = "/tmp/backtest_48h_results.json"
    with open(out_file, 'w') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    log(f"\n完整结果已保存: {out_file}")

    # 生成格式化报告文件（供 AI 直接转发，省 token）
    report_file = "/tmp/backtest_report.txt"
    _generate_report(results, new_projects, ai_projects, normal, fake_mc, _display_name, get_security_tags, get_warnings, report_file)
    log(f"格式化报告已保存: {report_file}")


def _generate_report(results, new_projects, ai_projects, normal, fake_mc, display_name_fn, sec_tags_fn, warns_fn, out_path):
    """生成可直接发送的格式化报告"""
    from datetime import datetime, timedelta
    now = datetime.now()
    start = now - timedelta(hours=48)
    lines = []

    total = len(new_projects) + len(ai_projects) + len(normal) + len(fake_mc)
    lines.append(f"📋 48小时回测结果（{start.strftime('%m-%d')} ~ {now.strftime('%m-%d')}）")
    lines.append(f"")
    summary = f"{total} 个项目"
    if new_projects:
        summary += f" | 🆕新: {len(new_projects)}"
    summary += f" | AI挖矿: {len(ai_projects)} | 其他: {len(normal)}"
    if fake_mc:
        summary += f" | 疑似假市值: {len(fake_mc)}"
    lines.append(summary)
    lines.append("")

    def _fmt_mc(val):
        if val >= 1_000_000_000:
            return f"${val/1_000_000_000:.2f}B"
        elif val >= 1_000_000:
            return f"${val/1_000_000:.2f}M"
        elif val >= 1_000:
            return f"${val/1_000:.0f}K"
        return f"${val:.0f}"

    def _fmt_project(i, p, show_kw=False):
        plines = []
        warns = warns_fn(p)
        has_web = bool(p.get('website') or p.get('twitter') or p.get('telegram'))
        prefix = ""
        if has_web and warns:
            prefix = "⭐⚠️ "
        elif has_web:
            prefix = "⭐ "
        elif warns:
            prefix = "⚠️ "
        suffix = ""
        if has_web:
            suffix = " — 有网页资料"
        plines.append(f"{prefix}#{i} {display_name_fn(p)}{suffix}")
        plines.append(f"合约: {p['address']}")
        plines.append(f"MC: {_fmt_mc(p['market_cap'])} | 流动性: {_fmt_mc(p['liquidity'])} | 持有人: {p['holders']:,}")
        try:
            chg = float(p['price_change_1h']) if p['price_change_1h'] else 0
        except (ValueError, TypeError):
            chg = 0
        chg_str = f"+{chg:.1f}%" if chg > 0 else f"{chg:.1f}%"
        plines.append(f"年龄: {p['age_hours']}h | 1h: {chg_str} | 来源: {p['source']}")
        sec = sec_tags_fn(p)
        if sec:
            plines.append(f"🔒 {' | '.join(sec)}")
        if show_kw and p.get('ai_keywords'):
            plines.append(f"关键词: {', '.join(p['ai_keywords'])}")
        if p.get('website'):
            plines.append(f"🌐 {p['website']}")
        if p.get('twitter'):
            plines.append(f"🐦 @{p['twitter']}")
        if p.get('telegram'):
            plines.append(f"💬 {p['telegram']}")
        plines.append(f"🔗 gmgn.ai/base/token/{p['address']}")
        if warns:
            for w in warns:
                plines.append(f"⚠️ {w}")
        return "\n".join(plines)

    if new_projects:
        lines.append("")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append(f"🆕 新项目 ({len(new_projects)})")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append("")
        for i, p in enumerate(new_projects, 1):
            lines.append(_fmt_project(i, p, show_kw=p.get('is_ai_mining', False)))
            lines.append("─────────────────────")

    if ai_projects:
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append(f"🤖 AI 挖矿项目 ({len(ai_projects)})")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append("")
        for i, p in enumerate(ai_projects, 1):
            lines.append(_fmt_project(i, p, show_kw=True))
            lines.append("─────────────────────")

    if normal:
        lines.append("")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append(f"📊 其他项目 ({len(normal)})")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append("")
        for i, p in enumerate(normal, 1):
            lines.append(_fmt_project(i, p))
            lines.append("─────────────────────")

    if fake_mc:
        lines.append("")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append(f"⚠️ 疑似假市值 ({len(fake_mc)})")
        lines.append("━━━━━━━━━━━━━━━━━━━━")
        lines.append("")
        for i, p in enumerate(fake_mc, 1):
            lines.append(_fmt_project(i, p, show_kw=p.get('is_ai_mining', False)))
            lines.append("─────────────────────")

    with open(out_path, 'w') as f:
        f.write("\n".join(lines))

    # 按分类拆分为多个文件（Telegram 4096字符限制）
    parts = []
    # Part 0: 头部 + 新项目
    p0 = []
    p0.append(f"📋 48小时回测结果（{start.strftime('%m-%d')} ~ {now.strftime('%m-%d')}）")
    p0.append(f"")
    p0.append(summary)
    if new_projects:
        p0.append("")
        p0.append("━━━━━━━━━━━━━━━━━━━━")
        p0.append(f"🆕 新项目 ({len(new_projects)})")
        p0.append("━━━━━━━━━━━━━━━━━━━━")
        p0.append("")
        for i, p in enumerate(new_projects, 1):
            p0.append(_fmt_project(i, p, show_kw=p.get('is_ai_mining', False)))
            p0.append("─────────────────────")
    parts.append("\n".join(p0))

    # Part 1: AI挖矿
    if ai_projects:
        p1 = []
        p1.append("━━━━━━━━━━━━━━━━━━━━")
        p1.append(f"🤖 AI 挖矿项目 ({len(ai_projects)})")
        p1.append("━━━━━━━━━━━━━━━━━━━━")
        p1.append("")
        for i, p in enumerate(ai_projects, 1):
            p1.append(_fmt_project(i, p, show_kw=True))
            p1.append("─────────────────────")
        parts.append("\n".join(p1))

    # Part 2: 其他项目
    if normal:
        p2 = []
        p2.append("━━━━━━━━━━━━━━━━━━━━")
        p2.append(f"📊 其他项目 ({len(normal)})")
        p2.append("━━━━━━━━━━━━━━━━━━━━")
        p2.append("")
        for i, p in enumerate(normal, 1):
            p2.append(_fmt_project(i, p))
            p2.append("─────────────────────")
        parts.append("\n".join(p2))

    # Part 3: 疑似假市值
    if fake_mc:
        p3 = []
        p3.append("━━━━━━━━━━━━━━━━━━━━")
        p3.append(f"⚠️ 疑似假市值 ({len(fake_mc)})")
        p3.append("━━━━━━━━━━━━━━━━━━━━")
        p3.append("")
        for i, p in enumerate(fake_mc, 1):
            p3.append(_fmt_project(i, p, show_kw=p.get('is_ai_mining', False)))
            p3.append("─────────────────────")
        parts.append("\n".join(p3))

    # 如果某个 part 超过3800字符，再拆
    final_parts = []
    for part in parts:
        if len(part) <= 3800:
            final_parts.append(part)
        else:
            # 按分隔线拆
            chunks = part.split("─────────────────────")
            buf = ""
            for chunk in chunks:
                test = buf + chunk + "─────────────────────"
                if len(test) > 3800 and buf:
                    final_parts.append(buf.rstrip())
                    buf = chunk + "─────────────────────"
                else:
                    buf = test
            if buf.strip():
                final_parts.append(buf.rstrip())

    # 写分段文件
    for idx, part in enumerate(final_parts):
        with open(f"/tmp/backtest_report_p{idx+1}.txt", 'w') as f:
            f.write(part)
    # 写总数文件
    with open("/tmp/backtest_report_parts.txt", 'w') as f:
        f.write(str(len(final_parts)))


if __name__ == '__main__':
    main()
