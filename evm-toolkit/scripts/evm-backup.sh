#!/bin/bash
# EVM 工具集备份脚本

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_DIR="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")/vault"
BACKUP_DIR="$SCRIPT_DIR/backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_NAME="evm-backup-$TIMESTAMP"

echo "💾 EVM 工具集备份"
echo "===================="
echo ""

# 创建备份目录
if [ ! -d "$BACKUP_DIR" ]; then
    mkdir -p "$BACKUP_DIR"
    echo "✅ 创建备份目录: $BACKUP_DIR"
fi

echo "📦 开始备份..."
echo ""

# 备份 vault 目录
echo "1️⃣ 备份 vault/ 目录..."
if [ -d "$VAULT_DIR" ]; then
    tar -czf "$BACKUP_DIR/$BACKUP_NAME-vault.tar.gz" -C "$(dirname "$VAULT_DIR")" vault/
    chmod 600 "$BACKUP_DIR/$BACKUP_NAME-vault.tar.gz"
    echo "   ✅ vault/ → $BACKUP_NAME-vault.tar.gz"
else
    echo "   ⚠️  vault/ 目录不存在"
fi

# 备份地址标签
echo "2️⃣ 备份地址标签..."
if [ -f "$SCRIPT_DIR/address-labels.json" ]; then
    cp "$SCRIPT_DIR/address-labels.json" "$BACKUP_DIR/$BACKUP_NAME-labels.json"
    echo "   ✅ address-labels.json → $BACKUP_NAME-labels.json"
else
    echo "   ⚠️  address-labels.json 不存在"
fi

# 备份配置文件
echo "3️⃣ 备份配置文件..."
for f in sub-wallets-1-20.json addresses-only.txt gas-distribution-0.01.json gas-distribution-0.001.json; do
    if [ -f "$SCRIPT_DIR/$f" ]; then
        cp "$SCRIPT_DIR/$f" "$BACKUP_DIR/$BACKUP_NAME-$f"
        # 含私钥的文件设 600 权限
        case "$f" in
            sub-wallets*|wallets*) chmod 600 "$BACKUP_DIR/$BACKUP_NAME-$f" ;;
        esac
        echo "   ✅ $f → $BACKUP_NAME-$f"
    fi
done

echo ""
echo "📊 备份统计:"
echo ""

# 统计备份文件
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR/$BACKUP_NAME"* 2>/dev/null | wc -l)
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

echo "  - 备份文件数: $BACKUP_COUNT"
echo "  - 备份目录大小: $BACKUP_SIZE"
echo "  - 备份位置: $BACKUP_DIR/"
echo ""

# 列出备份文件
echo "📁 备份文件列表:"
echo ""
ls -lh "$BACKUP_DIR/$BACKUP_NAME"* 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# 清理旧备份（保留最近10次，按时间戳分组）
echo "🧹 清理旧备份..."
BACKUP_TIMESTAMPS=$(ls -1 "$BACKUP_DIR"/evm-backup-* 2>/dev/null | sed 's/.*evm-backup-\([0-9-]*\)-.*/\1/' | sort -u -r)
BACKUP_SESSIONS=$(echo "$BACKUP_TIMESTAMPS" | wc -l)
if [ "$BACKUP_SESSIONS" -gt 10 ]; then
    OLD_TIMESTAMPS=$(echo "$BACKUP_TIMESTAMPS" | tail -n +11)
    OLD_COUNT=0
    for ts in $OLD_TIMESTAMPS; do
        rm -f "$BACKUP_DIR"/evm-backup-"$ts"-*
        OLD_COUNT=$((OLD_COUNT + 1))
    done
    echo "   ✅ 已删除 $OLD_COUNT 次旧备份（保留最近10次）"
else
    echo "   ✅ 备份次数: $BACKUP_SESSIONS（无需清理）"
fi
echo ""

echo "✅ 备份完成！"
echo ""
echo "💡 恢复备份:"
echo "   tar -xzf $BACKUP_DIR/$BACKUP_NAME-vault.tar.gz -C $(dirname "$VAULT_DIR")"
echo "   cp $BACKUP_DIR/$BACKUP_NAME-labels.json $SCRIPT_DIR/address-labels.json"
echo ""
