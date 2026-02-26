#!/usr/bin/env python3
"""
GMGN Base Chain Monitor - 多数据源项目监控
数据源：
  1. GMGN rank API (graduated) - 主扫描
  2. GMGN new_pairs API - 补充扫描
  3. DexScreener search API - 第三数据源，覆盖 GMGN 漏掉的项目
每10分钟扫描，筛选有价值的项目并通知用户。
重点标注 AI 挖矿类项目。
"""

import json
import time
import re
import requests
import os
import sys
import subprocess
from datetime import datetime
from collections import Counter, defaultdict

# === 配置 ===
CHAIN = "base"
SCAN_INTERVAL = 600  # 10分钟
STATE_FILE = "/tmp/gmgn_monitor_state.json"
NOTIFY_FILE = "/tmp/gmgn_notify.json"
ALERT_FILE = "/tmp/gmgn_alert.json"
FAV_FILE = "/tmp/gmgn_favorites.json"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(os.path.dirname(SCRIPT_DIR), "archive")
ARCHIVE_DB_FILE = os.path.join(ARCHIVE_DIR, "archive_db.json")
INDEX_FILE = os.path.join(ARCHIVE_DIR, "INDEX.md")
REPORT_FILE = os.path.join(ARCHIVE_DIR, "REPORT_48H.md")
GMGN_TOKEN_URL = "https://gmgn.ai/base/token/"

# AI 挖矿关键词
AI_MINING_KEYWORDS = [
    "mine", "miner", "mining", "bot", "agent", "ai",
    "earn", "farm", "stake", "proof", "compute",
    "gpu", "hash", "reward", "epoch", "node",
    "botcoin", "agentcoin", "aibot", "automine"
]

# DexScreener 搜索关键词（用于发现 GMGN 漏掉的项目）
DEXSCREENER_KEYWORDS = [
    "botcoin", "mining", "miner", "ai agent", "bot coin",
    "agent coin", "compute", "gpu", "hash", "proof",
    "node", "earn", "farm", "stake", "reward",
]

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

# 质量过滤门槛
MIN_LIQUIDITY = 5000       # 最低流动性 $5k
MIN_HOLDERS = 20           # 最低持有人数
MAX_AGE_HOURS = 72         # 最大项目年龄

# 排除的主流币/稳定币（不需要监控）
EXCLUDED_SYMBOLS = {
    "cbbtc", "weth", "usdc", "usdt", "dai", "wbtc", "eth",
    "usdbc", "aero", "degen", "brett", "toshi",
}


def log(msg):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] {msg}', flush=True)


def load_state():
    try:
        with open(STATE_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {'notified_tokens': {}, 'last_scan': 0}


def save_state(state):
    now = int(time.time())
    # 清理72小时前的记录
    expired_addrs = {
        k for k, v in state['notified_tokens'].items()
        if now - v >= 72 * 3600
    }
    state['notified_tokens'] = {
        k: v for k, v in state['notified_tokens'].items()
        if k not in expired_addrs
    }
    # 同步清理 notified_full
    if 'notified_full' in state:
        for addr in expired_addrs:
            state['notified_full'].pop(addr, None)
    # 原子写入：先写临时文件再 rename，防止进程被kill导致损坏
    tmp_file = STATE_FILE + '.tmp'
    with open(tmp_file, 'w') as f:
        json.dump(state, f)
    os.rename(tmp_file, STATE_FILE)



def is_ai_mining(text_parts):
    """检测是否为 AI 挖矿类项目，text_parts 是待检测的字符串列表
    对 symbol（第一个元素）使用全词匹配，对 website/twitter 使用全词匹配（含URL分隔符）"""
    if not text_parts:
        return False, []
    symbol = (text_parts[0] or '').lower()
    rest = ' '.join(t.lower() for t in text_parts[1:] if t)
    # 将 URL 分隔符替换为空格，使全词匹配能识别 URL 路径中的词
    rest = re.sub(r'[/\-_\.:]', ' ', rest)
    matches = []
    for kw in AI_MINING_KEYWORDS:
        # symbol 用全词匹配
        if re.search(r'\b' + re.escape(kw) + r'\b', symbol) or kw == symbol:
            matches.append(kw)
        # website/twitter 用全词匹配（URL已分词）
        elif rest and re.search(r'\b' + re.escape(kw) + r'\b', rest):
            matches.append(kw)
    return len(matches) > 0, matches


# ============================================================
# 数据源 1: GMGN rank API (graduated)
# ============================================================
def fetch_gmgn_graduated(limit=100):
    """获取 GMGN 已开盘(graduated)项目"""
    url = f"https://gmgn.ai/defi/quotation/v1/rank/{CHAIN}/swaps/1h"
    params = {
        "limit": limit,
        "orderby": "open_timestamp",
        "direction": "desc",
        "tag": "graduated"
    }
    try:
        resp = requests.get(url, params=params, headers=GMGN_HEADERS, timeout=15)
        data = resp.json()
        if data.get('code') == 0:
            tokens = data['data']['rank']
            log(f"[GMGN-rank] 获取 {len(tokens)} 个 graduated 项目")
            return tokens
        log(f"[GMGN-rank] API error: {data.get('msg')}")
    except Exception as e:
        log(f"[GMGN-rank] Fetch error: {e}")
    return []


def parse_gmgn_rank_token(t):
    """将 GMGN rank token 转为统一格式"""
    now = int(time.time())
    age_hours = (now - (t.get('open_timestamp') or 0)) / 3600
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
        'open_timestamp': t.get('open_timestamp', 0),
        'twitter': t.get('twitter_username') or '',
        'website': t.get('website') or '',
        'telegram': t.get('telegram') or '',
        'is_honeypot': t.get('is_honeypot', 0),
        'buy_tax': t.get('buy_tax', '0'),
        'sell_tax': t.get('sell_tax', '0'),
        'renounced': t.get('renounced', 0),
        'smart_buy_24h': t.get('smart_buy_24h', 0),
        'smart_sell_24h': t.get('smart_sell_24h', 0),
        'source': 'gmgn_rank',
    }


# ============================================================
# 数据源 2: GMGN new_pairs API
# ============================================================
def fetch_gmgn_new_pairs(limit=100):
    """获取 GMGN 新交易对，补充 rank 漏掉的项目"""
    url = f"https://gmgn.ai/defi/quotation/v1/pairs/{CHAIN}/new_pairs"
    params = {
        "limit": limit,
        "orderby": "open_timestamp",
        "direction": "desc",
    }
    try:
        resp = requests.get(url, params=params, headers=GMGN_HEADERS, timeout=15)
        data = resp.json()
        if data.get('code') == 0:
            pairs = data['data'].get('pairs', [])
            log(f"[GMGN-pairs] 获取 {len(pairs)} 个新交易对")
            return pairs
        log(f"[GMGN-pairs] API error: {data.get('msg')}")
    except Exception as e:
        log(f"[GMGN-pairs] Fetch error: {e}")
    return []


def parse_gmgn_pair(p):
    """将 GMGN new_pair 转为统一格式"""
    bti = p.get('base_token_info', {})
    now = int(time.time())
    open_ts = p.get('open_timestamp') or 0
    age_hours = (now - open_ts) / 3600 if open_ts else 0

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
        'is_honeypot': bti.get('is_honeypot', 0),
        'buy_tax': bti.get('buy_tax', '0'),
        'sell_tax': bti.get('sell_tax', '0'),
        'renounced': bti.get('renounced', 0),
        'smart_buy_24h': 0,
        'smart_sell_24h': 0,
        'source': 'gmgn_pairs',
    }


# ============================================================
# 数据源 3: DexScreener search API
# ============================================================
def fetch_dexscreener():
    """用关键词搜索 DexScreener，发现 GMGN 漏掉的 Base 链项目"""
    all_tokens = {}
    for kw in DEXSCREENER_KEYWORDS:
        try:
            resp = requests.get(
                f'https://api.dexscreener.com/latest/dex/search?q={kw}',
                headers=DEXSCREENER_HEADERS, timeout=15
            )
            if resp.status_code == 429:
                log(f"[DexScreener] 限流，暂停30s")
                time.sleep(30)
                continue
            if resp.status_code != 200:
                continue
            d = resp.json()
            pairs = [p for p in d.get('pairs', []) if p.get('chainId') == 'base']
            for p in pairs:
                addr = (p.get('baseToken', {}).get('address') or '').lower()
                if addr and addr not in all_tokens:
                    all_tokens[addr] = p
            time.sleep(0.5)  # 避免限流（15个关键词，总计~7.5s）
        except Exception as e:
            log(f"[DexScreener] search '{kw}' error: {e}")
    log(f"[DexScreener] 关键词搜索获取 {len(all_tokens)} 个 Base 链项目")
    return list(all_tokens.values())


def parse_dexscreener_pair(p):
    """将 DexScreener pair 转为统一格式"""
    bt = p.get('baseToken', {})
    now_ms = time.time() * 1000
    created = p.get('pairCreatedAt') or 0
    age_hours = (now_ms - created) / 3600000 if created else 0

    txns_1h = p.get('txns', {}).get('h1', {})
    info = p.get('info', {})
    websites = info.get('websites', [])
    socials = info.get('socials', [])

    twitter = ''
    website = ''
    telegram = ''
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
        'holders': 0,  # DexScreener 不提供 holder 数据
        'price_change_1h': float((p.get('priceChange') or {}).get('h1') or 0),
        'age_hours': round(age_hours, 1),
        'open_timestamp': int(created / 1000) if created else 0,
        'twitter': twitter,
        'website': website,
        'telegram': telegram,
        'is_honeypot': 0,
        'buy_tax': '0',
        'sell_tax': '0',
        'renounced': 0,
        'smart_buy_24h': 0,
        'smart_sell_24h': 0,
        'source': 'dexscreener',
    }


# ============================================================
# 合并、过滤、通知
# ============================================================
def merge_tokens(sources):
    """合并多个数据源，去重（同地址保留数据更丰富的源）"""
    merged = {}
    # 优先级：gmgn_rank > gmgn_pairs > dexscreener
    priority = {'gmgn_rank': 3, 'gmgn_pairs': 2, 'dexscreener': 1}
    for token in sources:
        addr = token.get('address', '')
        if not addr:
            continue
        existing = merged.get(addr)
        if not existing:
            merged[addr] = token
        else:
            # 保留优先级更高的源
            if priority.get(token['source'], 0) > priority.get(existing['source'], 0):
                merged[addr] = token
            # 如果 DexScreener 有 holder 数据补充
            elif existing.get('holders', 0) == 0 and token.get('holders', 0) > 0:
                existing['holders'] = token['holders']
    return list(merged.values())


def filter_quality(tokens):
    """质量过滤"""
    results = []
    for t in tokens:
        # 排除主流币/稳定币
        if t['symbol'].lower() in EXCLUDED_SYMBOLS:
            continue
        # 年龄过滤
        if t['age_hours'] > MAX_AGE_HOURS:
            continue
        # 流动性过滤
        if t['liquidity'] < MIN_LIQUIDITY:
            continue
        # 持有人过滤（DexScreener 没有 holder 数据，放宽）
        if t['holders'] > 0 and t['holders'] < MIN_HOLDERS:
            continue
        results.append(t)
    return results


def enrich_ai_mining(tokens):
    """标记 AI 挖矿项目"""
    for t in tokens:
        text_parts = [t['symbol'], t['website'], t['twitter']]
        is_ai, keywords = is_ai_mining(text_parts)
        t['is_ai_mining'] = is_ai
        t['ai_keywords'] = keywords
        # 市值/流动性比值
        liq = t.get('liquidity', 0)
        mc = t.get('market_cap', 0)
        t['mc_liq_ratio'] = round(mc / liq, 1) if liq > 0 else 0
        # 流动性级别: red(<10k), yellow(10k-20k), normal(>20k)
        if liq < 10000:
            t['liq_level'] = 'red'
        elif liq < 20000:
            t['liq_level'] = 'yellow'
        else:
            t['liq_level'] = 'normal'
    return tokens


# ============================================================
# 同名代币评分系统
# ============================================================
def _fetch_dexscreener_creation(address):
    """用 DexScreener 获取代币最早创建时间"""
    try:
        resp = requests.get(
            f'https://api.dexscreener.com/latest/dex/tokens/{address}',
            headers=DEXSCREENER_HEADERS, timeout=10
        )
        if resp.status_code == 200:
            pairs = resp.json().get('pairs', [])
            if pairs:
                # 取所有池子中最早的创建时间
                timestamps = [p.get('pairCreatedAt', 0) for p in pairs if p.get('pairCreatedAt', 0) > 0]
                if timestamps:
                    return min(timestamps)
    except Exception as e:
        log(f"[评分] DexScreener 查询 {address[:10]}... 失败: {e}")
    return 0


def score_single_token(t):
    """对单个项目打基础分（无同名对比时使用）"""
    score = 0
    # 有 Twitter/Website +3
    if bool(t.get('twitter')) or bool(t.get('website')):
        score += 3
    # 合约已验证(renounced) +2
    if t.get('renounced'):
        score += 2
    # Smart money 买入 +3
    if t.get('smart_buy_24h', 0) > 0:
        score += 3
    # 流动性惩罚（按年龄分级）
    liq = t.get('liquidity', 0)
    age = t.get('age_hours', 0) or 0
    if age < 1:
        if liq < 10000: score -= 1
    elif age < 24:
        if liq < 10000: score -= 2
        elif liq < 20000: score -= 1
    elif age < 48:
        if liq < 10000: score -= 4
        elif liq < 20000: score -= 2
    else:
        if liq < 10000: score -= 6
        elif liq < 20000: score -= 3
    # 买卖比异常检测（疑似貔貅）
    buys = int(t.get('buys', 0) or 0)
    sells = int(t.get('sells', 0) or 0)
    if buys > 50 and sells > 0 and buys / sells >= 3:
        t['suspect_honeypot'] = True
        score -= 3
    elif buys > 50 and sells == 0:
        t['suspect_honeypot'] = True
        score -= 3
    # 确认蜜罐/高税率
    if t.get('is_honeypot') == 1:
        score -= 5
    else:
        try:
            st = float(t.get('sell_tax', 0) or 0)
            if st >= 50:
                score -= 4
            elif st >= 20:
                score -= 2
        except (ValueError, TypeError):
            pass
    t['trust_score'] = score
    t['trust_rank'] = ''
    return t


def score_duplicate_tokens(duplicates):
    """
    对同名代币组打分。
    评分表:
      部署时间最早  +3
      流动性最高    +2
      持有人最多    +2
      有Twitter/Website +3
      合约已验证(renounced) +2
      Smart money买入 +3
    返回排序后的列表（高分在前），每个token附带 'trust_score' 和 'trust_rank'
    """
    if len(duplicates) <= 1:
        for t in duplicates:
            t['trust_score'] = 0
            t['trust_rank'] = ''
        return duplicates

    # 补全创建时间：如果 open_timestamp 为 0 或缺失，用 DexScreener 查（限制最多5次API调用）
    api_calls = 0
    for t in duplicates:
        if not t.get('open_timestamp') or t['open_timestamp'] < 1000000000:
            if api_calls >= 5:
                log(f"[评分] 同名组API调用达上限，跳过剩余补全")
                break
            ts = _fetch_dexscreener_creation(t['address'])
            if ts:
                t['open_timestamp'] = int(ts / 1000) if ts > 1e12 else int(ts)
            api_calls += 1
            time.sleep(0.5)

    # 找各维度最优值
    valid_ts = [t['open_timestamp'] for t in duplicates if t.get('open_timestamp', 0) > 1000000000]
    earliest_ts = min(valid_ts) if valid_ts else 0
    max_liq = max((t.get('liquidity', 0) for t in duplicates), default=0)
    max_holders = max((t.get('holders', 0) for t in duplicates), default=0)
    max_smart = max((t.get('smart_buy_24h', 0) for t in duplicates), default=0)

    for t in duplicates:
        score = 0

        # 部署时间最早 +3
        ts = t.get('open_timestamp', 0)
        if earliest_ts > 0 and ts > 0 and ts == earliest_ts:
            score += 3

        # 流动性最高 +2
        liq = t.get('liquidity', 0)
        if max_liq > 0 and liq == max_liq:
            score += 2

        # 持有人最多 +2
        holders = t.get('holders', 0)
        if max_holders > 0 and holders == max_holders:
            score += 2

        # 有 Twitter/Website +3
        has_social = bool(t.get('twitter')) or bool(t.get('website'))
        if has_social:
            score += 3

        # 合约已验证(renounced) +2
        if t.get('renounced'):
            score += 2

        # Smart money 买入 +3
        smart = t.get('smart_buy_24h', 0)
        if max_smart > 0 and smart == max_smart:
            score += 3

        # 流动性过低惩罚（按年龄分级）
        age = t.get('age_hours', 0) or 0
        if age < 1:
            if liq < 10000: score -= 1
        elif age < 24:
            if liq < 10000: score -= 2
            elif liq < 20000: score -= 1
        elif age < 48:
            if liq < 10000: score -= 4
            elif liq < 20000: score -= 2
        else:
            if liq < 10000: score -= 6
            elif liq < 20000: score -= 3

        # 买卖比异常检测（疑似貔貅）
        buys = int(t.get('buys', 0) or 0)
        sells = int(t.get('sells', 0) or 0)
        if buys > 50 and sells > 0 and buys / sells >= 3:
            t['suspect_honeypot'] = True
            score -= 3
        elif buys > 50 and sells == 0:
            t['suspect_honeypot'] = True
            score -= 3
        # 确认蜜罐/高税率
        if t.get('is_honeypot') == 1:
            score -= 5
        else:
            try:
                st = float(t.get('sell_tax', 0) or 0)
                if st >= 50:
                    score -= 4
                elif st >= 20:
                    score -= 2
            except (ValueError, TypeError):
                pass

        t['trust_score'] = score

    # 排序：高分在前
    duplicates.sort(key=lambda x: -x['trust_score'])

    # 标注 rank
    top_score = duplicates[0]['trust_score']
    for i, t in enumerate(duplicates):
        if i == 0 and t['trust_score'] > duplicates[-1]['trust_score']:
            if t['trust_score'] >= 7:
                t['trust_rank'] = '✅可能真品'
            else:
                t['trust_rank'] = '⚠️待验证'
        elif t['trust_score'] == top_score:
            t['trust_rank'] = '⚠️待验证'
        else:
            t['trust_rank'] = '❌可能仿盘'

    return duplicates


def detect_and_score_duplicates(new_projects, state):
    """
    检测新项目中是否有同名代币（与本轮其他新项目 + 历史已通知项目对比）。
    对同名组进行评分，给每个项目附加 trust_score 和 trust_rank。
    """
    # 构建 symbol -> [tokens] 映射（新项目 + 历史，按地址去重）
    symbol_groups = defaultdict(dict)  # symbol -> {addr: token}

    # 历史已通知项目
    for addr, full in state.get('notified_full', {}).items():
        if full:
            sym = full.get('symbol', '').upper()
            if sym:
                symbol_groups[sym][addr] = full

    # 本轮新项目（覆盖历史中的同地址数据）
    for t in new_projects:
        sym = t.get('symbol', '').upper()
        if sym:
            symbol_groups[sym][t['address']] = t

    # 找出有同名的 symbol
    dup_symbols = {sym for sym, tokens in symbol_groups.items() if len(tokens) > 1}

    if not dup_symbols:
        # 无同名，所有新项目打基础分
        for t in new_projects:
            score_single_token(t)
        return new_projects

    log(f"[评分] 检测到 {len(dup_symbols)} 个同名 symbol: {', '.join(sorted(dup_symbols))}")

    # 对每个同名组评分
    scored_addrs = {}
    for sym in dup_symbols:
        group = list(symbol_groups[sym].values())
        scored = score_duplicate_tokens(group)
        for t in scored:
            scored_addrs[t['address']] = t
        scores_str = ', '.join(f"{t['address'][:8]}={t['trust_score']}({t['trust_rank']})" for t in scored)
        log(f"[评分] {sym}: {scores_str}")

    # 更新新项目的评分
    for t in new_projects:
        if t['address'] in scored_addrs:
            s = scored_addrs[t['address']]
            t['trust_score'] = s['trust_score']
            t['trust_rank'] = s['trust_rank']
        else:
            # 不在同名组里，打基础分
            score_single_token(t)

    # 同时更新 state 中历史项目的评分
    for addr, s in scored_addrs.items():
        if addr in state.get('notified_full', {}):
            state['notified_full'][addr]['trust_score'] = s['trust_score']
            state['notified_full'][addr]['trust_rank'] = s['trust_rank']

    return new_projects


def process_all(notified_set, state=None):
    """从三个数据源获取、合并、过滤项目"""
    all_parsed = []

    # 数据源 1: GMGN graduated
    for t in fetch_gmgn_graduated():
        all_parsed.append(parse_gmgn_rank_token(t))

    # 数据源 2: GMGN new_pairs
    for p in fetch_gmgn_new_pairs():
        all_parsed.append(parse_gmgn_pair(p))

    # 数据源 3: DexScreener
    for p in fetch_dexscreener():
        all_parsed.append(parse_dexscreener_pair(p))

    log(f"[合并] 三个源共 {len(all_parsed)} 条原始数据")

    # 合并去重
    merged = merge_tokens(all_parsed)
    log(f"[合并] 去重后 {len(merged)} 个唯一项目")

    # 交叉补全 notified_full 中 open_timestamp=0 的项目
    if state:
        merged_by_addr = {t['address']: t for t in merged}
        patched = 0
        for addr, full in state.get('notified_full', {}).items():
            if not full.get('open_timestamp') and addr in merged_by_addr:
                new_ots = merged_by_addr[addr].get('open_timestamp', 0)
                if new_ots and new_ots > 1000000000:
                    full['open_timestamp'] = new_ots
                    full['age_hours'] = round((time.time() - new_ots) / 3600, 1)
                    patched += 1
        if patched:
            log(f"[补全] 交叉验证修复了 {patched} 个项目的 open_timestamp")
            save_state(state)

    # 过滤已通知的
    new_tokens = [t for t in merged if t['address'] not in notified_set]
    log(f"[过滤] 排除已通知后 {len(new_tokens)} 个")

    # 校验新项目的 open_timestamp（取最早池子创建时间，限制最多20次API调用）
    api_calls = 0
    for t in new_tokens:
        if api_calls >= 20:
            log(f"[校验] 新项目API调用达上限({api_calls})，跳过剩余")
            break
        dex_ts = _fetch_dexscreener_creation(t['address'])
        if dex_ts:
            dex_ts_sec = int(dex_ts / 1000) if dex_ts > 1e12 else int(dex_ts)
            cur_ts = t.get('open_timestamp', 0)
            if not cur_ts or cur_ts > dex_ts_sec:
                t['open_timestamp'] = dex_ts_sec
                t['age_hours'] = round((time.time() - dex_ts_sec) / 3600, 1)
        api_calls += 1
        time.sleep(0.3)

    # 质量过滤
    quality = filter_quality(new_tokens)
    log(f"[过滤] 质量过滤后 {len(quality)} 个")

    # 标记 AI 挖矿
    enriched = enrich_ai_mining(quality)

    # 排序：AI 挖矿优先，然后按开盘时间倒序
    enriched.sort(key=lambda x: (not x['is_ai_mining'], -x['open_timestamp']))

    return enriched, merged


def notify(projects):
    """写入通知文件并唤醒 AI agent，通知格式带 GMGN 链接和评分"""
    # 给每个项目加上 gmgn 链接
    for p in projects:
        p['gmgn_url'] = f"{GMGN_TOKEN_URL}{p['address']}"

    # 统计有同名评分的项目
    dup_count = sum(1 for p in projects if p.get('trust_score', 0) > 0 or p.get('trust_rank'))

    notification = {
        'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'count': len(projects),
        'ai_mining_count': sum(1 for p in projects if p['is_ai_mining']),
        'duplicate_scored_count': dup_count,
        'projects': projects
    }
    with open(NOTIFY_FILE, 'w') as f:
        json.dump(notification, f, ensure_ascii=False)

    try:
        ai_count = notification['ai_mining_count']
        text = f"链上监控: {len(projects)} 个新项目"
        if ai_count > 0:
            text += f"，其中 {ai_count} 个AI挖矿项目！"
        subprocess.Popen([
            'openclaw', 'system', 'event', '--text', text, '--mode', 'now'
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass


# ============================================================
# 归档系统
# ============================================================
def _fmt_mc(val):
    if val >= 1_000_000_000:
        return f"${val/1_000_000_000:.2f}B"
    elif val >= 1_000_000:
        return f"${val/1_000_000:.2f}M"
    elif val >= 1_000:
        return f"${val/1_000:.0f}K"
    return f"${val:.0f}"


def _fmt_liq(val):
    """流动性格式化，带颜色标记"""
    formatted = _fmt_mc(val)
    if val < 10000:
        return f"🔴{formatted}"
    elif val < 20000:
        return f"🟡{formatted}"
    return formatted


def _fmt_project_md(p, idx, symbol_counts=None):
    ai_tag = "🤖" if p.get('is_ai_mining') else "📊"
    sym = p['symbol']
    cnt = symbol_counts.get(sym, 1) if symbol_counts else 1
    if cnt > 1:
        sym = f"{sym} ({p['address'][:6]}) [同名×{cnt}]"
    mc = p.get('market_cap', 0)
    liq = p.get('liquidity', 0)
    mc_liq_ratio = round(mc / liq, 1) if liq > 0 else 0
    lines = [
        f"### {ai_tag} #{idx} {sym}",
        f"",
        f"- 合约: `{p['address']}`",
        f"- MC: {_fmt_mc(mc)} | 流动性: {_fmt_liq(liq)} | MC/Liq: {mc_liq_ratio}x",
    ]
    if p.get('holders'):
        lines.append(f"- 持有人: {p['holders']:,}")
    lines.append(f"- 年龄: {p.get('age_hours', 0)}h | 来源: {p.get('source', '?')}")
    if p.get('website'):
        lines.append(f"- 🌐 {p['website']}")
    if p.get('twitter'):
        lines.append(f"- 🐦 @{p['twitter']}")
    if p.get('telegram'):
        lines.append(f"- 💬 {p['telegram']}")
    lines.append(f"- 🔗 [GMGN]({GMGN_TOKEN_URL}{p['address']})")
    if p.get('ai_keywords'):
        lines.append(f"- 关键词: {', '.join(p['ai_keywords'])}")
    if p.get('trust_rank'):
        lines.append(f"- 可信度: {p['trust_rank']} (评分: {p.get('trust_score', 0)}/15)")
    lines.append("")
    return "\n".join(lines)


def _load_archive_db():
    if os.path.exists(ARCHIVE_DB_FILE):
        with open(ARCHIVE_DB_FILE) as f:
            return json.load(f)
    return {}


def _save_archive_db(db):
    with open(ARCHIVE_DB_FILE, 'w') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def _update_index(db):
    # 统计全局同名
    _all_symbols = Counter()
    for projects in db.values():
        for p in projects:
            _all_symbols[p['symbol']] += 1

    lines = [
        "# 链上项目归档索引", "",
        f"更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}", "",
        "| 日期 | 项目数 | AI挖矿 | 项目列表 |",
        "|------|--------|---------|----------|",
    ]
    total = total_ai = 0
    for date_str in sorted(db.keys(), reverse=True):
        projects = db[date_str]
        ai_count = sum(1 for p in projects if p.get('is_ai_mining'))
        total += len(projects)
        total_ai += ai_count
        def _idx_name(p):
            tag = "🤖" if p.get('is_ai_mining') else ""
            sym = p['symbol']
            if _all_symbols.get(sym, 1) > 1:
                sym = f"{sym}({p['address'][:6]})"
            return tag + sym
        names = [_idx_name(p) for p in projects]
        names_str = ", ".join(names[:8])
        if len(names) > 8:
            names_str += f" +{len(names)-8}"
        lines.append(f"| [{date_str}]({date_str}.md) | {len(projects)} | {ai_count} | {names_str} |")
    lines += ["", f"**总计: {total} 个项目 | AI挖矿: {total_ai}**", ""]

    # 合约地址索引
    lines += ["## 合约地址索引", "",
              "| 日期 | 项目 | 合约地址 | AI |",
              "|------|------|----------|-----|"]
    for date_str in sorted(db.keys(), reverse=True):
        for p in db[date_str]:
            ai = "🤖" if p.get('is_ai_mining') else ""
            sym = p['symbol']
            if _all_symbols.get(sym, 1) > 1:
                sym = f"{sym} ({p['address'][:6]})"
            lines.append(f"| {date_str} | {sym} | `{p['address']}` | {ai} |")
    lines.append("")
    with open(INDEX_FILE, 'w') as f:
        f.write("\n".join(lines))


def archive_and_report(state):
    """归档过期项目 + 生成48h报告。从 state 中获取所有已知项目。"""
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    now = int(time.time())
    cutoff = now - 48 * 3600

    # 收集 state 中所有已通知项目的完整数据
    all_projects = []
    for addr, ts in state.get('notified_tokens', {}).items():
        # 从 notified_full 获取完整数据
        full = state.get('notified_full', {}).get(addr)
        if full:
            # 重新计算 age
            open_ts = full.get('open_timestamp', 0)
            if open_ts:
                full['age_hours'] = round((now - open_ts) / 3600, 1)
            all_projects.append(full)

    if not all_projects:
        return

    # 分为活跃和过期
    active = [p for p in all_projects if p.get('open_timestamp', 0) >= cutoff]
    expired = [p for p in all_projects if p.get('open_timestamp', 0) < cutoff]

    # 生成48h报告
    active.sort(key=lambda x: (not x.get('is_ai_mining', False), -x.get('open_timestamp', 0)))
    ai_count = sum(1 for p in active if p.get('is_ai_mining'))
    # 同名检测：当批 + 历史 notified_full 合并
    _sc = Counter(p['symbol'] for p in active)
    active_addrs = {p['address'] for p in active}
    for _addr, _hp in state.get('notified_full', {}).items():
        if _addr not in active_addrs:
            _sym = _hp.get('symbol', '')
            if _sym:
                _sc[_sym] += 1

    # 疑似假市值判断
    def _is_fake_mc(p):
        liq = p.get('liquidity', 0)
        mc = p.get('market_cap', 0)
        return liq > 0 and mc / liq > 1000

    ai_list = [p for p in active if p.get('is_ai_mining') and not _is_fake_mc(p)]
    normal_list = [p for p in active if not p.get('is_ai_mining') and not _is_fake_mc(p)]
    fake_mc_list = [p for p in active if _is_fake_mc(p)]

    lines = [
        f"# 链上项目监控 - 48小时报告", "",
        f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"项目总数: {len(active)} | AI挖矿: {len(ai_list)} | 其他: {len(normal_list)} | 疑似假市值: {len(fake_mc_list)}", "",
    ]
    if ai_list:
        lines += [f"## 🤖 AI 挖矿项目 ({len(ai_list)})", ""]
        for i, p in enumerate(ai_list, 1):
            lines += [_fmt_project_md(p, i, _sc), "---", ""]
    if normal_list:
        lines += [f"## 📊 其他项目 ({len(normal_list)})", ""]
        for i, p in enumerate(normal_list, len(ai_list) + 1):
            lines += [_fmt_project_md(p, i, _sc), "---", ""]
    if fake_mc_list:
        lines += [f"## ⚠️ 疑似假市值 ({len(fake_mc_list)})", ""]
        for i, p in enumerate(fake_mc_list, len(ai_list) + len(normal_list) + 1):
            lines += [_fmt_project_md(p, i, _sc), "---", ""]
    with open(REPORT_FILE, 'w') as f:
        f.write("\n".join(lines))
    log(f"[归档] 48h报告: {len(active)} 个活跃项目")

    # 归档过期项目
    if expired:
        db = _load_archive_db()
        new_count = 0
        by_date = {}
        for p in expired:
            ts = p.get('open_timestamp', 0)
            date_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d') if ts else "unknown"
            by_date.setdefault(date_str, []).append(p)

        for date_str, dps in sorted(by_date.items()):
            existing_addrs = {p['address'] for p in db.get(date_str, [])}
            new_ps = [p for p in dps if p['address'] not in existing_addrs]
            if not new_ps:
                continue
            db.setdefault(date_str, []).extend(new_ps)
            new_count += len(new_ps)

            # 写日期归档文件
            all_day = db[date_str]
            all_day.sort(key=lambda x: (not x.get('is_ai_mining', False), -x.get('open_timestamp', 0)))
            day_ai = sum(1 for p in all_day if p.get('is_ai_mining'))
            day_sc = Counter(p['symbol'] for p in all_day)
            dl = [f"# 链上项目归档 - {date_str}", "",
                  f"项目总数: {len(all_day)} | AI挖矿: {day_ai}", ""]
            for i, p in enumerate(all_day, 1):
                dl += [_fmt_project_md(p, i, day_sc), "---", ""]
            with open(os.path.join(ARCHIVE_DIR, f"{date_str}.md"), 'w') as f:
                f.write("\n".join(dl))
            log(f"[归档] {date_str}: {len(all_day)} 个项目 (新增 {len(new_ps)})")

        _save_archive_db(db)
        _update_index(db)
        log(f"[归档] 完成，新增 {new_count} 个过期项目")


def cleanup_low_score_duplicates(state):
    """定期清理：1.同名代币中评分过低的仿盘(48h后) 2.流动性极低超过24h的项目"""
    notified_full = state.get('notified_full', {})
    notified_tokens = state.get('notified_tokens', {})

    removed = []

    # 规则1: 同名代币中低分仿盘48h后清除
    symbol_groups = defaultdict(list)
    for addr, p in list(notified_full.items()):
        sym = p.get('symbol', '').upper()
        if sym:
            symbol_groups[sym].append((addr, p))

    for sym, group in symbol_groups.items():
        if len(group) < 2:
            continue
        max_score = max(p.get('trust_score', 0) for _, p in group)
        if max_score == 0:
            continue
        for addr, p in group:
            score = p.get('trust_score', 0)
            rank = p.get('trust_rank', '')
            if '仿盘' in rank and score <= max_score / 3 and p.get('age_hours', 0) > 48:
                removed.append((sym, addr[:10], score, '低分仿盘'))
                notified_full.pop(addr, None)
                notified_tokens.pop(addr, None)

    # 规则2: 流动性极低(<$10K)且年龄超过24h的项目清除（AI挖矿/有社交链接的豁免）
    for addr, p in list(notified_full.items()):
        liq = p.get('liquidity', 0) or 0
        age = p.get('age_hours', 0) or 0
        if liq < 10000 and age > 24:
            # 豁免：AI挖矿项目或有社交链接的项目
            if p.get('is_ai_mining'):
                continue
            if p.get('twitter') or p.get('website'):
                continue
            removed.append((p.get('symbol', '?'), addr[:10], liq, '流动性极低>24h'))
            notified_full.pop(addr, None)
            notified_tokens.pop(addr, None)

    if removed:
        log(f"[清理] 移除 {len(removed)} 个项目: {', '.join(f'{s}({a},{r})' for s,a,_,r in removed)}")
    return len(removed)


def fetch_honeypot_check(address):
    """通过 Honeypot.is API 检测蜜罐和税率"""
    try:
        resp = requests.get(
            f'https://api.honeypot.is/v2/IsHoneypot?address={address}&chainID=8453',
            timeout=10
        )
        d = resp.json()
        hp = d.get('honeypotResult', {})
        st = d.get('simulationResult', {})
        return {
            'is_honeypot': 1 if hp.get('isHoneypot') else 0,
            'buy_tax': str(st.get('buyTax', 0)),
            'sell_tax': str(st.get('sellTax', 0)),
        }
    except Exception as e:
        log(f"[honeypot] {address[:10]} error: {e}")
        return None


def fetch_token_latest(address):
    """通过 DexScreener API 获取单个代币最新数据"""
    try:
        resp = requests.get(
            f'https://api.dexscreener.com/latest/dex/tokens/{address}',
            timeout=10
        )
        data = resp.json()
        pairs = data.get('pairs', [])
        if not pairs:
            return None
        p = pairs[0]
        txns_1h = p.get('txns', {}).get('h1', {})
        info = p.get('info', {})
        return {
            'price': float(p.get('priceUsd', 0) or 0),
            'market_cap': float(p.get('marketCap', 0) or 0),
            'liquidity': float(p.get('liquidity', {}).get('usd', 0) or 0),
            'volume_1h': float(p.get('volume', {}).get('h1', 0) or 0),
            'buys': int(txns_1h.get('buys', 0)),
            'sells': int(txns_1h.get('sells', 0)),
            'price_change_1h': float(p.get('priceChange', {}).get('h1', 0) or 0),
        }
    except Exception as e:
        log(f"[fetch_token] {address[:10]} error: {e}")
        return None


def update_key_projects(state, merged):
    """每轮扫描更新重点观察项目（有社交链接或✅真品）的实时数据"""
    merged_by_addr = {t['address']: t for t in merged}
    updated = 0
    api_fetched = 0
    now = time.time()
    update_keys = ['price', 'market_cap', 'liquidity', 'holders', 'price_change_1h',
                   'volume_1h', 'swaps', 'buys', 'sells', 'smart_buy_24h', 'smart_sell_24h',
                   'is_honeypot', 'buy_tax', 'sell_tax', 'renounced']

    for addr, old in state.get('notified_full', {}).items():
        # 只更新重点项目：有社交链接或✅真品
        is_key = bool(old.get('website')) or bool(old.get('twitter')) or '真品' in old.get('trust_rank', '')
        if not is_key:
            continue

        new = merged_by_addr.get(addr)
        if not new:
            # 冷却机制：30分钟内更新过的跳过 DexScreener 查询
            last_update = old.get('_last_api_update', 0)
            if now - last_update < 1800:
                continue
            # merged（GMGN）里没有，用 DexScreener 兜底
            new = fetch_token_latest(addr)
            if new:
                api_fetched += 1
                old['_last_api_update'] = now
                time.sleep(0.3)  # 防限流

        if not new:
            continue
        for key in update_keys:
            if key in new and new[key] is not None:
                # buys/sells: 保留较大值（历史累计 vs 当前）
                if key in ('buys', 'sells'):
                    old[key] = max(old.get(key, 0) or 0, new[key])
                else:
                    old[key] = new[key]
        # 更新年龄
        ots = old.get('open_timestamp', 0)
        if ots and ots > 1000000000:
            old['age_hours'] = round((time.time() - ots) / 3600, 1)
        updated += 1

    if updated:
        log(f"[更新] 刷新了 {updated} 个重点项目的实时数据 (API查询: {api_fetched})")

    # 蜜罐检测：每3轮做一次
    scan_count = state.get('_scan_count', 0)
    if scan_count % 3 == 0:
        hp_checked = 0
        for addr, old in state.get('notified_full', {}).items():
            is_key = bool(old.get('website')) or bool(old.get('twitter')) or '真品' in old.get('trust_rank', '')
            if not is_key:
                continue
            # 已确认蜜罐，永不再检测
            if old.get('is_honeypot') == 1:
                continue
            # 已确认安全的，6小时检测一次
            last_hp = old.get('_last_hp_check', 0)
            if old.get('is_honeypot') == 0 and last_hp > 0 and now - last_hp < 21600:
                continue
            # 未检测过的，1小时冷却
            if last_hp > 0 and now - last_hp < 3600:
                continue
            if hp_checked >= 10:
                break
            hp = fetch_honeypot_check(addr)
            if hp:
                old['is_honeypot'] = hp['is_honeypot']
                old['buy_tax'] = hp['buy_tax']
                old['sell_tax'] = hp['sell_tax']
                old['_last_hp_check'] = now
                hp_checked += 1
                time.sleep(0.3)

        if hp_checked:
            log(f"[安全] 蜜罐检测了 {hp_checked} 个重点项目")


def check_alerts(state, merged):
    """检测AI挖矿项目涨幅异常 + 收藏项目重大变化"""
    alerts = []
    merged_by_addr = {t['address']: t for t in merged}

    # 加载收藏列表
    favs = []
    if os.path.exists(FAV_FILE):
        with open(FAV_FILE) as f:
            favs = json.load(f)
    favs_set = set(favs)

    for addr, old in state.get('notified_full', {}).items():
        new = merged_by_addr.get(addr)
        if not new:
            continue

        # 读取当前和新数据用于告警判断（不在此处更新 state，由 update_key_projects 统一处理）
        old_price = float(old.get('price', 0) or 0)
        new_price = float(new.get('price', 0) or 0)
        old_liq = float(old.get('liquidity', 0) or 0)
        new_liq = float(new.get('liquidity', 0) or 0)
        old_mc = float(old.get('market_cap', 0) or 0)
        new_mc = float(new.get('market_cap', 0) or 0)

        try:
            chg_1h = float(new.get('price_change_1h', 0) or 0)
        except:
            chg_1h = 0

        # 规则1: AI挖矿项目1h涨幅>500%
        if old.get('is_ai_mining') and chg_1h > 500:
            alerts.append({
                'type': 'surge',
                'symbol': old['symbol'],
                'address': addr,
                'change_1h': chg_1h,
                'market_cap': new_mc,
                'liquidity': new_liq,
                'holders': new.get('holders', 0),
            })

        # 规则2: 收藏项目价格变化>50% 或 流动性变化>50%
        if addr in favs_set and old_price > 0 and new_price > 0:
            price_change = abs(new_price - old_price) / old_price
            liq_change = abs(new_liq - old_liq) / old_liq if old_liq > 0 else 0
            if price_change > 0.5 or liq_change > 0.5:
                alerts.append({
                    'type': 'fav_change',
                    'symbol': old['symbol'],
                    'address': addr,
                    'price_old': old_price,
                    'price_new': new_price,
                    'price_change_pct': price_change * 100,
                    'liq_old': old_liq,
                    'liq_new': new_liq,
                    'liq_change_pct': liq_change * 100,
                })

    if alerts:
        with open(ALERT_FILE, 'w') as f:
            json.dump({'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'), 'alerts': alerts}, f, ensure_ascii=False)
        log(f"🚨 生成 {len(alerts)} 条告警")
        # 唤醒 AI
        try:
            text = f"链上告警: {len(alerts)} 条"
            subprocess.Popen([
                'openclaw', 'system', 'event', '--text', text, '--mode', 'now'
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except:
            pass


def run():
    state = load_state()
    # 确保 notified_full 字段存在
    if 'notified_full' not in state:
        state['notified_full'] = {}

    log(f"🔍 GMGN Monitor v2 started. Chain: {CHAIN}, Interval: {SCAN_INTERVAL}s")
    log(f"   数据源: GMGN-rank + GMGN-pairs + DexScreener")
    log(f"   过滤: 流动性>=${MIN_LIQUIDITY} 持有人>={MIN_HOLDERS} 年龄<={MAX_AGE_HOURS}h")
    log(f"   归档: {ARCHIVE_DIR}")

    while True:
        try:
            notified_set = set(state['notified_tokens'].keys())
            new_projects, merged = process_all(notified_set, state)

            if new_projects:
                log(f"✅ 发现 {len(new_projects)} 个新项目!")
                ai_count = sum(1 for p in new_projects if p['is_ai_mining'])
                if ai_count:
                    log(f"🤖 其中 {ai_count} 个 AI 挖矿项目!")

                # 同名代币评分
                try:
                    new_projects = detect_and_score_duplicates(new_projects, state)
                except Exception as e:
                    log(f"[评分] Error: {e}")

                now = int(time.time())
                for p in new_projects:
                    state['notified_tokens'][p['address']] = now
                    state['notified_full'][p['address']] = p

                notify(new_projects)

                for p in new_projects[:15]:
                    tag = "🤖" if p['is_ai_mining'] else "📊"
                    src = p.get('source', '?')[:3]
                    log(f"  {tag} {p['symbol']} | MC: ${p['market_cap']:,.0f} | "
                        f"Liq: ${p['liquidity']:,.0f} | Holders: {p['holders']} | "
                        f"Age: {p['age_hours']}h | Src: {src}")
            else:
                log("📭 本轮无新项目")

            # 检测告警（涨幅异常 + 收藏变化）— 必须在 update_key_projects 之前，否则 old_price 已被更新
            try:
                check_alerts(state, merged)
            except Exception as e:
                log(f"[告警] Error: {e}")

            # 更新重点项目实时数据
            try:
                update_key_projects(state, merged)
            except Exception as e:
                log(f"[更新] Error: {e}")

            # 每轮扫描后执行归档
            try:
                archive_and_report(state)
            except Exception as e:
                log(f"[归档] Error: {e}")

            # 清理低分仿盘
            try:
                cleanup_low_score_duplicates(state)
            except Exception as e:
                log(f"[清理] Error: {e}")

            state['last_scan'] = int(time.time())
            state['_scan_count'] = state.get('_scan_count', 0) + 1
            save_state(state)

        except Exception as e:
            log(f"❌ Error: {e}")

        time.sleep(SCAN_INTERVAL)


if __name__ == '__main__':
    while True:
        try:
            run()
        except Exception as e:
            ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            print(f'[{ts}] 💀 run() crashed: {e}', flush=True)
            time.sleep(30)
        except KeyboardInterrupt:
            break
