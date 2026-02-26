#!/usr/bin/env python3
"""
链上项目监控 - 报告生成与归档系统

功能：
1. 生成48小时内活跃项目报告
2. 过期项目按日期归档到 archive/YYYY-MM-DD.md
3. 维护索引文件 archive/INDEX.md（日期、项目名、合约地址）
"""

import json
import os
import time
from datetime import datetime, timedelta

ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "archive")
INDEX_FILE = os.path.join(ARCHIVE_DIR, "INDEX.md")
REPORT_FILE = os.path.join(ARCHIVE_DIR, "REPORT_48H.md")
ENRICHED_FILE = "/tmp/backtest_48h_enriched.json"
STATE_FILE = "/tmp/gmgn_monitor_state.json"

os.makedirs(ARCHIVE_DIR, exist_ok=True)

NOW = int(time.time())
CUTOFF_48H = NOW - 48 * 3600


def load_projects():
    """加载所有已知项目（enriched + state 中的历史记录）"""
    projects = []
    # 从 enriched 文件加载
    if os.path.exists(ENRICHED_FILE):
        with open(ENRICHED_FILE) as f:
            projects = json.load(f)
    return projects


def load_archive_db():
    """加载已归档项目数据库"""
    db_file = os.path.join(ARCHIVE_DIR, "archive_db.json")
    if os.path.exists(db_file):
        with open(db_file) as f:
            return json.load(f)
    return {}


def save_archive_db(db):
    db_file = os.path.join(ARCHIVE_DIR, "archive_db.json")
    with open(db_file, 'w') as f:
        json.dump(db, f, ensure_ascii=False, indent=2)


def format_mc(val):
    if val >= 1_000_000_000:
        return f"${val/1_000_000_000:.2f}B"
    elif val >= 1_000_000:
        return f"${val/1_000_000:.2f}M"
    elif val >= 1_000:
        return f"${val/1_000:.0f}K"
    return f"${val:.0f}"


def format_project_block(p, idx, symbol_counts=None):
    """格式化单个项目为 markdown 块"""
    lines = []
    ai_tag = "🤖" if p.get('is_ai_mining') else "📊"
    sym = p['symbol']
    cnt = symbol_counts.get(sym, 1) if symbol_counts else 1
    if cnt > 1:
        sym = f"{sym} ({p['address'][:6]}) [同名×{cnt}]"
    lines.append(f"### {ai_tag} #{idx} {sym}")
    lines.append(f"")
    lines.append(f"- 合约: `{p['address']}`")
    lines.append(f"- MC: {format_mc(p.get('market_cap', 0))} | 流动性: {format_mc(p.get('liquidity', 0))}")
    if p.get('holders'):
        lines.append(f"- 持有人: {p['holders']:,}")
    lines.append(f"- 年龄: {p.get('age_hours', 0)}h | 来源: {p.get('source', '?')}")
    if p.get('website'):
        lines.append(f"- 🌐 {p['website']}")
    if p.get('twitter'):
        lines.append(f"- 🐦 @{p['twitter']}")
    if p.get('telegram'):
        lines.append(f"- 💬 {p['telegram']}")
    lines.append(f"- 🔗 [GMGN](https://gmgn.ai/base/token/{p['address']})")
    if p.get('ai_keywords'):
        lines.append(f"- 关键词: {', '.join(p['ai_keywords'])}")
    lines.append("")
    return "\n".join(lines)


def generate_48h_report(projects):
    """生成48小时内活跃项目报告"""
    active = [p for p in projects if p.get('age_hours', 999) <= 48]
    active.sort(key=lambda x: (not x.get('is_ai_mining', False), -x.get('open_timestamp', 0)))

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M')

    # 同名检测
    from collections import Counter
    _sc = Counter(p['symbol'] for p in active)

    # 疑似假市值判断
    def _is_fake_mc(p):
        liq = p.get('liquidity', 0)
        mc = p.get('market_cap', 0)
        return liq > 0 and mc / liq > 1000

    ai_projects = [p for p in active if p.get('is_ai_mining') and not _is_fake_mc(p)]
    normal = [p for p in active if not p.get('is_ai_mining') and not _is_fake_mc(p)]
    fake_mc = [p for p in active if _is_fake_mc(p)]

    lines = []
    lines.append(f"# 链上项目监控 - 48小时报告")
    lines.append(f"")
    lines.append(f"生成时间: {now_str}")
    lines.append(f"项目总数: {len(active)} | AI挖矿: {len(ai_projects)} | 其他: {len(normal)} | 疑似假市值: {len(fake_mc)}")
    lines.append(f"")

    # AI 挖矿项目
    if ai_projects:
        lines.append(f"## 🤖 AI 挖矿项目 ({len(ai_projects)})")
        lines.append("")
        for i, p in enumerate(ai_projects, 1):
            lines.append(format_project_block(p, i, _sc))
            lines.append("---")
            lines.append("")

    # 其他项目
    if normal:
        lines.append(f"## 📊 其他项目 ({len(normal)})")
        lines.append("")
        for i, p in enumerate(normal, len(ai_projects) + 1):
            lines.append(format_project_block(p, i, _sc))
            lines.append("---")
            lines.append("")

    # 疑似假市值
    if fake_mc:
        lines.append(f"## ⚠️ 疑似假市值 ({len(fake_mc)})")
        lines.append("")
        for i, p in enumerate(fake_mc, len(ai_projects) + len(normal) + 1):
            lines.append(format_project_block(p, i, _sc))
            lines.append("---")
            lines.append("")

    report = "\n".join(lines)
    with open(REPORT_FILE, 'w') as f:
        f.write(report)
    print(f"✅ 48小时报告已生成: {REPORT_FILE} ({len(active)} 个项目)")
    return active


def archive_expired(projects):
    """将过期项目（>48h）按日期归档"""
    expired = [p for p in projects if p.get('age_hours', 0) > 48]
    if not expired:
        print("📭 没有过期项目需要归档")
        return

    # 加载已有归档数据库
    db = load_archive_db()

    # 按开盘日期分组
    by_date = {}
    for p in expired:
        ts = p.get('open_timestamp', 0)
        if ts:
            date_str = datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
        else:
            date_str = "unknown"
        by_date.setdefault(date_str, []).append(p)

    new_archived = 0
    for date_str, date_projects in sorted(by_date.items()):
        # 检查哪些是新的
        existing_addrs = set()
        if date_str in db:
            existing_addrs = {p['address'] for p in db[date_str]}

        new_projects = [p for p in date_projects if p['address'] not in existing_addrs]
        if not new_projects:
            continue

        # 合并到数据库
        if date_str not in db:
            db[date_str] = []
        db[date_str].extend(new_projects)
        new_archived += len(new_projects)

        # 生成/更新日期归档文件
        archive_file = os.path.join(ARCHIVE_DIR, f"{date_str}.md")
        all_day_projects = db[date_str]
        all_day_projects.sort(key=lambda x: (not x.get('is_ai_mining', False), -x.get('open_timestamp', 0)))

        ai_count = sum(1 for p in all_day_projects if p.get('is_ai_mining'))
        day_sc = Counter(p['symbol'] for p in all_day_projects)
        lines = []
        lines.append(f"# 链上项目归档 - {date_str}")
        lines.append(f"")
        lines.append(f"项目总数: {len(all_day_projects)} | AI挖矿: {ai_count}")
        lines.append(f"")

        for i, p in enumerate(all_day_projects, 1):
            lines.append(format_project_block(p, i, day_sc))
            lines.append("---")
            lines.append("")

        with open(archive_file, 'w') as f:
            f.write("\n".join(lines))
        print(f"📁 归档 {date_str}: {len(all_day_projects)} 个项目 (新增 {len(new_projects)})")

    save_archive_db(db)
    update_index(db)
    print(f"✅ 归档完成，新增 {new_archived} 个项目")


def update_index(db):
    """更新索引文件"""
    from collections import Counter
    # 全局同名检测
    _all_symbols = Counter()
    for projects in db.values():
        for p in projects:
            _all_symbols[p['symbol']] += 1

    lines = []
    lines.append("# 链上项目归档索引")
    lines.append("")
    lines.append(f"更新时间: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    lines.append("")

    total = 0
    total_ai = 0

    lines.append("| 日期 | 项目数 | AI挖矿 | 项目列表 |")
    lines.append("|------|--------|---------|----------|")

    for date_str in sorted(db.keys(), reverse=True):
        projects = db[date_str]
        ai_count = sum(1 for p in projects if p.get('is_ai_mining'))
        total += len(projects)
        total_ai += ai_count

        # 项目简要列表（同名加合约前缀）
        names = []
        for p in projects:
            tag = "🤖" if p.get('is_ai_mining') else ""
            sym = p['symbol']
            if _all_symbols.get(sym, 1) > 1:
                sym = f"{sym}({p['address'][:6]})"
            names.append(f"{tag}{sym}")
        names_str = ", ".join(names[:8])
        if len(names) > 8:
            names_str += f" +{len(names)-8}"

        lines.append(f"| [{date_str}]({date_str}.md) | {len(projects)} | {ai_count} | {names_str} |")

    lines.append("")
    lines.append(f"**总计: {total} 个项目 | AI挖矿: {total_ai}**")
    lines.append("")

    # 完整合约地址索引
    lines.append("## 合约地址索引")
    lines.append("")
    lines.append("| 日期 | 项目 | 合约地址 | AI |")
    lines.append("|------|------|----------|-----|")

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
    print(f"📋 索引已更新: {INDEX_FILE}")


def main():
    print("=" * 50)
    print("链上项目监控 - 报告生成与归档")
    print("=" * 50)

    projects = load_projects()
    if not projects:
        print("❌ 没有项目数据，请先运行回测或等待监控收集数据")
        return

    print(f"加载 {len(projects)} 个项目")

    # 1. 生成48小时报告
    active = generate_48h_report(projects)

    # 2. 归档过期项目
    archive_expired(projects)

    print("\n✅ 全部完成")


if __name__ == '__main__':
    main()
