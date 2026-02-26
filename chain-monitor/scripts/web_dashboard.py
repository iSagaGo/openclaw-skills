#!/usr/bin/env python3
"""链上项目监控 - Web Dashboard"""

import json
import os
import time
from datetime import datetime
from flask import Flask, Response, request, jsonify

app = Flask(__name__)

STATE_FILE = "/tmp/gmgn_monitor_state.json"
FAV_FILE = "/tmp/gmgn_favorites.json"
HIDE_FILE = "/tmp/gmgn_hidden.json"

def load_json(path):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return None

def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, ensure_ascii=False)

def load_favs():
    return load_json(FAV_FILE) or []

def save_favs(favs):
    save_json(FAV_FILE, favs)

def load_hidden():
    return load_json(HIDE_FILE) or []

def save_hidden(hidden):
    save_json(HIDE_FILE, hidden)

def fmt_mc(val):
    if not val: return "$0"
    if val >= 1_000_000_000: return f"${val/1e9:.2f}B"
    if val >= 1_000_000: return f"${val/1e6:.2f}M"
    if val >= 1_000: return f"${val/1e3:.0f}K"
    return f"${val:.0f}"

def is_fake_mc(p):
    liq = p.get('liquidity', 0)
    mc = p.get('market_cap', 0)
    return liq > 0 and mc / liq > 1000

def classify_projects(projects, hist_addrs):
    import time as _time
    now_ts = _time.time()
    new_10m, new_1h, ai, normal, fake = [], [], [], [], []
    for p in projects:
        ots = p.get('open_timestamp', 0)
        if ots and ots > 1000000000:
            age_sec = now_ts - ots
        else:
            age_sec = 999999  # 未知时间归入其他
        if is_fake_mc(p):
            fake.append(p)
        elif age_sec <= 600:
            new_10m.append(p)
        elif age_sec <= 3600:
            new_1h.append(p)
        elif p.get('is_ai_mining'):
            ai.append(p)
        else:
            normal.append(p)
    return new_10m, new_1h, ai, normal, fake

def get_symbol_counts(projects, hist):
    from collections import Counter
    sc = Counter(p['symbol'] for p in projects)
    for addr, hp in hist.items():
        sym = hp.get('symbol', '')
        if sym: sc[sym] += 1
    proj_addrs = {p['address'] for p in projects}
    for addr, hp in hist.items():
        if addr in proj_addrs:
            sc[hp.get('symbol', '')] -= 1
    return sc

def display_name(p, sc):
    sym = p['symbol']
    cnt = sc.get(sym, 1)
    if cnt > 1:
        return f"{sym} ({p['address'][:6]}) <span class='dup'>同名×{cnt}</span>"
    return sym

def security_tags(p):
    tags = []
    if p.get('renounced') == 1: tags.append('<span class="tag-ok">✅弃权</span>')
    elif p.get('renounced') == 0: tags.append('<span class="tag-warn">❌未弃权</span>')
    if p.get('is_open_source') == 1 or p.get('is_open_source') is None: tags.append('<span class="tag-ok">✅开源</span>')
    if p.get('is_honeypot') == 0: tags.append('<span class="tag-ok">✅非貔貅</span>')
    elif p.get('is_honeypot') == 1: tags.append('<span class="tag-bad">🚫貔貅</span>')
    if p.get('suspect_honeypot'): tags.append('<span class="tag-bad">⚠️疑似貔貅(买卖比异常)</span>')
    bt = p.get('buy_tax'); st = p.get('sell_tax')
    if bt is not None and st is not None:
        tags.append(f"税:{float(bt):.1f}%/{float(st):.1f}%")
    return " | ".join(tags)

def render_project_row(p, idx, sc, favs_set, show_kw=False, show_ai_tag=False):
    name = display_name(p, sc)
    icon = ""
    if p.get('liquidity', 0) < 10000:
        icon = '<span class="icon-warn">🚨</span>'
    elif p.get('liquidity', 0) < 20000:
        icon = '<span class="icon-warn">⚠️</span>'
    elif p.get('website'):
        icon = '<span class="icon-star">⭐</span>'
    mc = fmt_mc(p.get('market_cap', 0))
    liq_val = p.get('liquidity', 0)
    mc_val = p.get('market_cap', 0)
    if mc_val >= 1000000:
        mc = f'<span style="color:#3fb950">{mc}</span>'
    elif mc_val >= 300000:
        mc = f'<span style="color:#58a6ff">{mc}</span>'
    liq = fmt_mc(liq_val)
    if liq_val < 10000:
        liq = f'<span class="liq-red">{liq}</span>'
    elif liq_val < 20000:
        liq = f'<span class="liq-yellow">{liq}</span>'
    mc_liq_ratio = f"{mc_val / liq_val:.1f}x" if liq_val > 0 else "N/A"
    holders = f"{p.get('holders', 0):,}"
    age_h = p.get('age_hours', 0)
    ots = p.get('open_timestamp', 0)
    if ots and ots > 1000000000:
        import time as _t
        age_h = (_t.time() - ots) / 3600
    if age_h <= 0 and (not ots or ots < 1000000000):
        age = "未知"
    elif age_h >= 24:
        age = f"{age_h/24:.0f}d"
    else:
        age = f"{age_h:.1f}h"
    try:
        chg = float(p.get('price_change_1h', 0) or 0)
    except: chg = 0
    chg_cls = "up" if chg > 0 else "down" if chg < 0 else ""
    chg_str = f"+{chg:.1f}%" if chg > 0 else f"{chg:.1f}%"

    # 可信度评分
    trust_score = p.get('trust_score', 0) or 0
    trust_rank = p.get('trust_rank', '')
    if trust_rank:
        if '真品' in trust_rank:
            trust_cls = 'trust-good'
        elif '待验证' in trust_rank:
            trust_cls = 'trust-warn'
        elif '仿盘' in trust_rank:
            trust_cls = 'trust-bad'
        else:
            trust_cls = 'trust-none'
        trust_html = f'<span style="color:#8b949e;font-size:0.85em">{trust_score}/15</span> <span class="{trust_cls}">{trust_rank}</span>'
    elif trust_score != 0:
        # 无同名但有基础分
        score_color = '#3fb950' if trust_score >= 5 else '#d29922' if trust_score >= 2 else '#f85149'
        trust_html = f'<span style="color:{score_color};font-size:0.85em">{trust_score}/15</span>'
    else:
        trust_html = '<span class="trust-none">-</span>'

    src = p.get('source', '?')
    sec = security_tags(p)
    addr = p['address']
    gmgn = f"https://gmgn.ai/base/token/{addr}"
    is_fav = addr in favs_set
    fav_cls = "fav-btn faved" if is_fav else "fav-btn"
    fav_star = "★" if is_fav else "☆"

    extra = ""
    if show_kw and p.get('ai_keywords'):
        extra += f"<div class='kw'>关键词: {', '.join(p['ai_keywords'])}</div>"
    if p.get('website'):
        extra += f"<div>🌐 <a href='{p['website']}' target='_blank'>{p['website']}</a></div>"
    if p.get('twitter'):
        tw = p['twitter']
        if not tw.startswith('http'): tw = f"https://x.com/{tw}"
        extra += f"<div>🐦 <a href='{tw}' target='_blank'>@{p['twitter']}</a></div>"

    warns = []
    mc_val = p.get('market_cap', 0); liq_val = p.get('liquidity', 0)
    if liq_val > 0 and mc_val / liq_val > 1000:
        warns.append(f"MC/Liq比={mc_val/liq_val:.0f}x，疑似假市值")
    warn_html = "".join(f"<div class='warn'>⚠️ {w}</div>" for w in warns)

    tag_list = []
    tags = ""
    if show_ai_tag and p.get('is_ai_mining'):
        tags += '<span class="ai-tag">🤖AI挖矿</span> '
        tag_list.append('ai-mining')
    if p.get('liquidity', 0) < 10000:
        tags += '<span class="very-low-liq-tag">💧流动性极低</span>'
        tag_list.append('very-low-liq')
    elif p.get('liquidity', 0) < 20000:
        tags += '<span class="low-liq-tag">💧流动性过低</span>'
        tag_list.append('low-liq')
    if p.get('website'):
        tag_list.append('has-website')
    if p.get('twitter'):
        tag_list.append('has-twitter')
    if p.get('renounced') == 1:
        tag_list.append('renounced')
    if p.get('is_honeypot') == 1:
        tag_list.append('honeypot')

    is_ai = 'true' if p.get('is_ai_mining') else 'false'
    tags_data = ','.join(tag_list)
    ots_val = p.get('open_timestamp', 0) or 0
    return f"""<tr data-ai="{is_ai}" data-tags="{tags_data}" data-ots="{ots_val}">
<td>{idx}</td>
<td class="icon">{icon}</td>
<td class="name">{name}{warn_html}</td>
<td class="addr"><a href="{gmgn}" target="_blank">{addr}</a><button class="copy-btn" onclick="copyAddr(this,'{addr}')">📋</button><button class="{fav_cls}" onclick="toggleFav(this,'{addr}')">{fav_star}</button><button class="hide-btn" onclick="toggleHide('{addr}')">🙈</button></td>
<td>{mc}</td>
<td>{liq}</td>
<td>{mc_liq_ratio}</td>
<td>{holders}</td>
<td>{age}</td>
<td class="{chg_cls}">{chg_str}</td>
<td>{trust_html}</td>
<td>{src}</td>
<td class="sec">{sec}</td>
<td>{extra}</td>
<td>{tags}</td>
</tr>"""

def render_section(title, emoji, projects, sc, favs_set, show_kw=False, show_ai_tag=False, section_type=""):
    if not projects: return ""
    rows = "".join(render_project_row(p, i+1, sc, favs_set, show_kw, show_ai_tag) for i, p in enumerate(projects))
    return f"""
<div class="section" data-section="{section_type}">
<h2>{emoji} {title} (<span class="section-count">{len(projects)}</span>)</h2>
<table>
<colgroup><col class="c-idx"><col class="c-icon"><col class="c-name"><col class="c-addr"><col class="c-mc"><col class="c-liq"><col class="c-ratio"><col class="c-hold"><col class="c-age"><col class="c-chg"><col class="c-trust"><col class="c-src"><col class="c-sec"><col class="c-extra"><col class="c-tags"></colgroup>
<thead><tr>
<th>#</th><th></th><th>名称</th><th>合约（点击跳转到GMGN）</th><th>MC</th><th>流动性</th><th>MC/Liq</th>
<th>持有人</th><th>年龄</th><th>1h</th><th>可信度</th><th>来源</th><th>安全</th><th>其他</th><th>标签</th>
</tr></thead>
<tbody>{rows}</tbody>
</table>
</div>"""


@app.route('/api/fav', methods=['POST'])
def api_fav():
    data = request.get_json()
    addr = data.get('address', '')
    if not addr:
        return jsonify({'ok': False})
    favs = load_favs()
    if addr in favs:
        favs.remove(addr)
        save_favs(favs)
        return jsonify({'ok': True, 'faved': False})
    else:
        favs.append(addr)
        save_favs(favs)
        return jsonify({'ok': True, 'faved': True})


@app.route('/api/hide', methods=['POST'])
def api_hide():
    data = request.get_json()
    addr = data.get('address', '')
    if not addr:
        return jsonify({'ok': False})
    hidden = load_hidden()
    if addr in hidden:
        hidden.remove(addr)
        save_hidden(hidden)
        return jsonify({'ok': True, 'hidden': False})
    else:
        hidden.append(addr)
        save_hidden(hidden)
        return jsonify({'ok': True, 'hidden': True})


@app.route('/')
def index():
    state = load_json(STATE_FILE) or {}
    hist = state.get('notified_full', {})
    projects = list(hist.values())
    projects.sort(key=lambda p: p.get('open_timestamp', 0), reverse=True)

    # 先从全量数据中取收藏和隐藏项目（不受时间过滤）
    favs = load_favs()
    favs_set = set(favs)
    hidden = load_hidden()
    hidden_set = set(hidden)
    fav_projects = [p for p in projects if p['address'] in favs_set]
    hidden_projects = [p for p in projects if p['address'] in hidden_set]

    # 时间范围过滤（URL参数 hours，默认12）
    try:
        filter_hours = int(request.args.get('hours', 12))
    except:
        filter_hours = 12
    if filter_hours > 0:
        import time as _ft
        cutoff = _ft.time() - filter_hours * 3600
        projects = [p for p in projects if (p.get('open_timestamp', 0) or 0) >= cutoff]

    sc = get_symbol_counts(projects, {})

    # 主列表排除隐藏项目
    visible_projects = [p for p in projects if p['address'] not in hidden_set]
    new_10m, new_1h, ai, normal, fake = classify_projects(visible_projects, set())

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    total = len(projects)
    summary = f"{total} 个项目"
    new_total = len(new_10m) + len(new_1h)
    if new_total: summary += f" | 🆕新: {new_total}"
    summary += f" | 🤖AI挖矿: {len(ai)} | 📊其他: {len(normal)}"
    if fake: summary += f" | ⚠️可疑: {len(fake)}"
    if fav_projects: summary += f" | ⭐收藏: {len(fav_projects)}"

    # 重点项目：有网页或X的项目，按优先级排序
    def key_priority(p):
        # 主排序：可信度评分从高到低
        score = -(p.get('trust_score', 0) or 0)
        # 次排序：有网站+X > 有网站 > 有X > 无
        has_web = bool(p.get('website'))
        has_x = bool(p.get('twitter'))
        if has_web and has_x: social = 0
        elif has_web: social = 1
        elif has_x: social = 2
        else: social = 3
        return (score, social)
    # 重点项目也排除隐藏
    key_projects = [p for p in visible_projects if p.get('website') or p.get('twitter')]
    key_projects.sort(key=key_priority)

    # 收集所有标签用于动态筛选栏
    TAG_DEFS = [
        ('ai-mining', '🤖 AI挖矿'),
        ('very-low-liq', '🚨 流动性极低'),
        ('low-liq', '⚠️ 流动性过低'),
        ('has-website', '🌐 有网站'),
        ('has-twitter', '🐦 有X'),
        ('renounced', '✅ 已弃权'),
        ('honeypot', '🚫 貔貅'),
    ]
    all_tags = set()
    for p in visible_projects:
        if p.get('is_ai_mining'): all_tags.add('ai-mining')
        if p.get('liquidity', 0) < 10000: all_tags.add('very-low-liq')
        elif p.get('liquidity', 0) < 20000: all_tags.add('low-liq')
        if p.get('website'): all_tags.add('has-website')
        if p.get('twitter'): all_tags.add('has-twitter')
        if p.get('renounced') == 1: all_tags.add('renounced')
        if p.get('is_honeypot') == 1: all_tags.add('honeypot')
    filter_checkboxes = ""
    for tag_id, tag_label in TAG_DEFS:
        if tag_id in all_tags:
            checked = 'checked' if tag_id == 'ai-mining' else ''
            filter_checkboxes += f'<label><input type="checkbox" class="tag-filter" data-tag="{tag_id}" {checked} onchange="applyTagFilter()"> {tag_label}</label>\n'

    # 时间按钮，根据当前 filter_hours 设置 active
    time_buttons = ""
    for h, label in [(0,'全部'),(1,'1h'),(3,'3h'),(12,'12h'),(24,'24h'),(48,'48h'),(72,'3d'),(168,'7d')]:
        active = ' active' if h == filter_hours else ''
        time_buttons += f'<button class="time-btn{active}" data-hours="{h}" onclick="setTimeFilter(this,{h})">{label}</button>\n'

    # 重点观察：有网站或X的项目，但同名组里低分的踢到项目列表
    from collections import defaultdict
    candidate_key = [p for p in visible_projects if p.get('website') or p.get('twitter')]

    # 构建全局 symbol -> 最高分 映射
    global_sym_scores = defaultdict(int)
    for p in visible_projects:
        sym = p.get('symbol', '').upper()
        score = p.get('trust_score', 0) or 0
        if score > global_sym_scores[sym]:
            global_sym_scores[sym] = score

    # 按 symbol 分组候选
    sym_groups = defaultdict(list)
    for p in candidate_key:
        sym_groups[p.get('symbol', '').upper()].append(p)

    key_set = set()
    demoted_set = set()
    for sym, group in sym_groups.items():
        global_top = global_sym_scores.get(sym, 0)
        for p in group:
            score = p.get('trust_score', 0) or 0
            # 如果全局有更高分的同名项目，降级
            if global_top > 0 and score < global_top:
                demoted_set.add(p['address'])
            else:
                key_set.add(p['address'])

    # 全局✅可能真品也加入重点观察（即使没有社交链接）
    for p in visible_projects:
        rank = p.get('trust_rank', '')
        if '真品' in rank:
            key_set.add(p['address'])
            demoted_set.discard(p['address'])

    # 48小时后流动性极低(<$10K)的项目移出重点观察
    # 可信度为负数的项目移出重点观察
    for p in visible_projects:
        if p['address'] in key_set:
            age = p.get('age_hours', 0) or 0
            liq = p.get('liquidity', 0) or 0
            score = p.get('trust_score', 0) or 0
            if (age > 48 and liq < 10000) or score < 0:
                key_set.discard(p['address'])
                demoted_set.add(p['address'])

    key_projects = [p for p in visible_projects if p['address'] in key_set]
    key_projects.sort(key=key_priority)

    # 主列表：排除重点观察里的，但包含被降级的
    show_all_tags = request.args.get('show_all', '0') == '1'
    if not show_all_tags:
        list_projects = [p for p in visible_projects if (p.get('is_ai_mining') or p['address'] in demoted_set) and p['address'] not in key_set]
    else:
        list_projects = [p for p in visible_projects if p['address'] not in key_set]
    list_projects.sort(key=lambda p: p.get('open_timestamp', 0), reverse=True)

    title_suffix = f"{filter_hours}h" if filter_hours > 0 else "全部"
    if not show_all_tags:
        title_suffix += " · AI挖矿"

    sections = ""
    sections += render_section("重点观察", "🌟", key_projects, sc, favs_set, show_kw=True, show_ai_tag=True, section_type="key")
    sections += render_section(f"项目列表 · {title_suffix}", "⛓️", list_projects, sc, favs_set, show_kw=True, show_ai_tag=True, section_type="all")

    fav_section = render_section("收藏项目", "⭐", fav_projects, sc, favs_set, show_kw=True, show_ai_tag=True)
    hidden_section = render_section("隐藏项目", "🙈", hidden_projects, sc, favs_set, show_kw=True, show_ai_tag=True, section_type="hidden")

    fav_count = len(fav_projects)
    hidden_count = len(hidden_projects)
    show_all_checked = 'checked' if show_all_tags else ''

    html = """<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>链上项目监控</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; cursor:default; }
body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background:#0d1117; color:#c9d1d9; padding:20px; cursor:default; }
h1 { color:#58a6ff; margin-bottom:5px; font-size:1.5em; }
.summary { color:#8b949e; margin-bottom:10px; font-size:0.95em; }
.updated { color:#484f58; font-size:0.8em; margin-bottom:15px; }
.section { margin-bottom:30px; }
h2 { color:#f0f6fc; font-size:1.15em; margin-bottom:10px; padding:8px 12px; background:#161b22; border-radius:6px; border-left:3px solid #58a6ff; }
table { width:100%%%%; border-collapse:collapse; font-size:0.82em; table-layout:fixed; }
col.c-idx { width:35px; } col.c-icon { width:30px; } col.c-name { width:200px; } col.c-addr { width:400px; }
col.c-mc { width:60px; } col.c-liq { width:60px; } col.c-ratio { width:60px; } col.c-hold { width:50px; }
col.c-age { width:40px; } col.c-chg { width:60px; } col.c-trust { width:180px; } col.c-src { width:80px; }
col.c-sec { width:220px; } col.c-extra { width:240px; } col.c-tags { width:200px; }
thead { background:#161b22; }
th { padding:8px 6px; text-align:left; color:#8b949e; font-weight:600; border-bottom:1px solid #21262d; white-space:nowrap; }
td { padding:7px 6px; border-bottom:1px solid #21262d; vertical-align:top; }
tr:hover { background:#161b22; }
.name { font-weight:600; color:#f0f6fc; white-space:nowrap; overflow:hidden; }
.addr { white-space:nowrap; overflow:hidden; }
.addr a { color:#58a6ff; text-decoration:none; font-family:monospace; font-size:0.78em; word-break:break-all; white-space:normal; }
.addr a:hover { text-decoration:underline; }
.copy-btn { margin-left:4px; background:none; border:1px solid #30363d; color:#8b949e; cursor:pointer; border-radius:4px; padding:1px 5px; font-size:0.85em; vertical-align:middle; }
.copy-btn:hover { background:#21262d; color:#c9d1d9; }
.fav-btn { margin-left:3px; background:none; border:none; cursor:pointer; font-size:1.1em; vertical-align:middle; color:#484f58; }
.fav-btn:hover { color:#d29922; }
.fav-btn.faved { color:#d29922; }
.hide-btn { margin-left:3px; background:none; border:none; cursor:pointer; font-size:0.9em; vertical-align:middle; color:#484f58; }
.hide-btn:hover { color:#f85149; }
.up { color:#3fb950; font-weight:600; }
.down { color:#f85149; font-weight:600; }
.dup { color:#d29922; font-size:0.8em; font-weight:normal; }
.icon { text-align:center; font-size:0.9em; }
.ai-tag { background:#1f6feb; color:#fff; font-size:0.75em; padding:1px 6px; border-radius:3px; font-weight:normal; }
.low-liq-tag { background:none; color:#f85149; font-size:0.75em; padding:0; font-weight:600; }
.very-low-liq-tag { background:none; color:#f85149; font-size:0.75em; padding:0; font-weight:600; text-decoration:underline; }
.liq-red { color:#f85149; font-weight:700; }
.liq-yellow { color:#d29922; font-weight:700; }
.trust-good { color:#3fb950; font-weight:600; }
.trust-warn { color:#d29922; font-weight:600; }
.trust-bad { color:#f85149; font-weight:600; }
.trust-none { color:#484f58; }
.score-bar { display:inline-block; width:50px; height:6px; background:#21262d; border-radius:3px; overflow:hidden; vertical-align:middle; margin-right:4px; }
.score-fill { height:100%%; border-radius:3px; }
.tag-ok { color:#3fb950; }
.tag-warn { color:#d29922; }
.tag-bad { color:#f85149; font-weight:600; }
.sec { font-size:0.78em; min-width:180px; }
.kw { color:#8b949e; font-size:0.85em; }
.warn { color:#d29922; font-size:0.85em; }
a { color:#58a6ff; }
.refresh { display:inline-block; padding:6px 16px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; cursor:pointer; text-decoration:none; font-size:0.85em; }
.refresh:hover { background:#30363d; }
.tab-bar { margin-bottom:15px; display:flex; gap:8px; }
.tab-btn { padding:6px 16px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; cursor:pointer; font-size:0.9em; }
.tab-btn:hover { background:#30363d; }
.tab-btn.active { background:#1f6feb; color:#fff; border-color:#1f6feb; }
.tab-content { display:none; }
.tab-content.active { display:block; }
.filter-bar { margin-bottom:15px; display:flex; gap:12px; align-items:center; font-size:0.9em; }
.filter-bar label { cursor:pointer; color:#c9d1d9; display:flex; align-items:center; gap:4px; }
.filter-bar input[type=checkbox] { cursor:pointer; }
.time-btn { padding:4px 12px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; cursor:pointer; font-size:0.85em; }
.time-btn:hover { background:#30363d; }
.time-btn.active { background:#1f6feb; color:#fff; border-color:#1f6feb; }
</style>
</head>
<body>
<h1>⛓️ Base 链项目监控</h1>
<div class="summary">%s</div>
<div class="updated">更新时间: %s · <span id="countdown">10:00</span> 后自动刷新 · <a href="#" class="refresh" id="manualRefresh">🔄 刷新</a> <span id="cooldown" style="color:#d29922;display:none;">冷却中...</span></div>
<div class="tab-bar">
<button class="tab-btn active" onclick="switchTab('main')">📊 全部项目</button>
<button class="tab-btn" onclick="switchTab('fav')">⭐ 收藏 (%d)</button>
<button class="tab-btn" onclick="switchTab('hidden')">🙈 隐藏 (%d)</button>
</div>
<div id="tab-main" class="tab-content active">
<div class="filter-bar">
%s
<label style="margin-left:12px;border-left:1px solid #30363d;padding-left:12px;"><input type="checkbox" id="filterAll" onchange="toggleShowAll()" %s> 📊 显示全部</label>
</div>
<div class="filter-bar">
<span style="color:#8b949e;margin-right:4px;">⏰ 时间:</span>
%s
</div>
<div class="filter-bar">
<span style="color:#8b949e;margin-right:4px;">🔍 搜索:</span>
<input type="text" id="searchInput" placeholder="项目名称或合约地址..." oninput="applyTagFilter()" style="background:#161b22;color:#c9d1d9;border:1px solid #30363d;border-radius:4px;padding:4px 10px;font-size:0.9em;width:300px;outline:none;">
<button onclick="document.getElementById('searchInput').value='';applyTagFilter();" style="background:#21262d;color:#8b949e;border:1px solid #30363d;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:0.85em;">✕ 清除</button>
</div>
%s</div>
<div id="tab-fav" class="tab-content">%s</div>
<div id="tab-hidden" class="tab-content">%s</div>
<div class="updated" style="margin-top:40px;">数据来源: GMGN rank + GMGN pairs + DexScreener · 自动刷新间隔 10min</div>
<script>
function switchTab(t){
  document.querySelectorAll('.tab-content').forEach(function(e){e.classList.remove('active');});
  document.querySelectorAll('.tab-btn').forEach(function(e){e.classList.remove('active');});
  document.getElementById('tab-'+t).classList.add('active');
  event.target.classList.add('active');
}
var currentTimeHours=24;
function setTimeFilter(btn,hours){
  currentTimeHours=hours;
  // 服务端过滤，直接跳转
  var params=new URLSearchParams(window.location.search);
  params.set('hours',hours);
  window.location.href=window.location.pathname+'?'+params.toString();
}
function toggleShowAll(){
  var params=new URLSearchParams(window.location.search);
  var cb=document.getElementById('filterAll');
  if(cb.checked){params.set('show_all','1');}else{params.delete('show_all');}
  window.location.href=window.location.pathname+'?'+params.toString();
}
function applyTagFilter(){
  var showAll=document.getElementById('filterAll').checked;
  var checkedTags=[];
  document.querySelectorAll('.tag-filter:checked').forEach(function(cb){checkedTags.push(cb.getAttribute('data-tag'));});
  var searchVal=(document.getElementById('searchInput').value||'').toLowerCase().trim();
  document.querySelectorAll('#tab-main .section').forEach(function(s){
    var isKey=s.getAttribute('data-section')==='key';
    var rows=s.querySelectorAll('tr[data-tags]');
    var hasVisible=false;
    rows.forEach(function(r){
      // 搜索筛选
      if(searchVal){
        var nameEl=r.querySelector('.name');
        var addrEl=r.querySelector('.addr a');
        var name=nameEl?nameEl.textContent.toLowerCase():'';
        var addr=addrEl?addrEl.textContent.toLowerCase():'';
        if(name.indexOf(searchVal)<0 && addr.indexOf(searchVal)<0){r.style.display='none';return;}
      }
      // 重点观察不受标签筛选影响
      if(isKey){r.style.display='';hasVisible=true;return;}
      // 标签筛选
      if(showAll){r.style.display='';hasVisible=true;return;}
      if(checkedTags.length===0){r.style.display='none';return;}
      var rowTags=(r.getAttribute('data-tags')||'').split(',');
      var match=checkedTags.some(function(t){return rowTags.indexOf(t)>=0;});
      if(match){r.style.display='';hasVisible=true;}
      else{r.style.display='none';}
    });
    s.style.display=hasVisible?'':'none';
  });
  // 重新编号可见行并更新section计数
  document.querySelectorAll('#tab-main .section').forEach(function(s){
    if(s.style.display==='none')return;
    var idx=1;
    s.querySelectorAll('tr[data-tags]').forEach(function(r){
      if(r.style.display!=='none'){
        r.cells[0].textContent=idx++;
      }
    });
    var cnt=s.querySelector('.section-count');
    if(cnt) cnt.textContent=idx-1;
  });
}
function copyAddr(btn,addr){
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(addr).then(function(){btn.textContent='✓';setTimeout(function(){btn.textContent='📋';},1000);});
  }else{
    var ta=document.createElement('textarea');ta.value=addr;ta.style.position='fixed';ta.style.left='-9999px';
    document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    btn.textContent='✓';setTimeout(function(){btn.textContent='📋';},1000);
  }
}
function toggleFav(btn,addr){
  fetch('/api/fav',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:addr})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.ok){location.reload();}
  });
}
function toggleHide(addr){
  fetch('/api/hide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:addr})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.ok){location.reload();}
  });
}
var total=600,c=600,cooldown=0;
var el=document.getElementById('countdown');
var btn=document.getElementById('manualRefresh');
var cdEl=document.getElementById('cooldown');
function fmt(s){var m=Math.floor(s/60);var ss=s-m*60;return m+':'+(ss<10?'0':'')+ss;}
setInterval(function(){
  c--;if(c<=0){location.reload();}else{el.textContent=fmt(c);}
  if(cooldown>0){cooldown--;if(cooldown<=0){cdEl.style.display='none';btn.style.opacity='1';btn.style.pointerEvents='auto';}}
},1000);
btn.addEventListener('click',function(e){
  e.preventDefault();
  if(cooldown>0)return;
  cooldown=30;cdEl.style.display='inline';btn.style.opacity='0.5';btn.style.pointerEvents='none';
  location.reload();
});
// 页面加载时应用默认筛选
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){applyTagFilter();});}else{applyTagFilter();}
</script>
</body>
</html>""" % (summary, now_str, fav_count, hidden_count, filter_checkboxes, show_all_checked, time_buttons, sections, fav_section if fav_section else '<div class="section"><h2>⭐ 暂无收藏项目</h2><p style="color:#8b949e;padding:12px;">点击合约地址旁的 ☆ 按钮收藏项目</p></div>', hidden_section if hidden_section else '<div class="section"><h2>🙈 暂无隐藏项目</h2><p style="color:#8b949e;padding:12px;">点击合约地址旁的 🙈 按钮隐藏项目</p></div>')
    return Response(html, content_type='text/html; charset=utf-8', headers={'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', 'Pragma': 'no-cache'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=18790, debug=False)