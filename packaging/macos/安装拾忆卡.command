#!/bin/bash
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DEST="$HOME/Applications/拾忆卡.app"
PRODUCT_DIR="$HOME/Applications/Pick Memory"
EXTENSION_DEST="$PRODUCT_DIR/extension"
SUPPORT_DIR="$HOME/Library/Application Support/ShiyiCard"
HOST_DEST="$SUPPORT_DIR/shiyi-native-host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_DEST="$MANIFEST_DIR/com.shiyi.card.json"

mkdir -p "$HOME/Applications" "$PRODUCT_DIR" "$SUPPORT_DIR" "$MANIFEST_DIR"
ditto "$PACKAGE_DIR/extension" "$EXTENSION_DEST"
ditto "$PACKAGE_DIR/native/拾忆卡.app" "$APP_DEST"
cp "$PACKAGE_DIR/native/shiyi-native-host" "$HOST_DEST"
chmod +x "$HOST_DEST"

sed -e "s|__HOST_PATH__|$HOST_DEST|g" \
  "$PACKAGE_DIR/native/com.shiyi.card.json.template" > "$MANIFEST_DEST"

open "$APP_DEST"
open "$EXTENSION_DEST"
open -a "Google Chrome" "chrome://extensions/" || true

echo
echo "Pick Memory v__VERSION__ 已复制完成。"
echo "1. 在 Chrome 扩展页面开启开发者模式。"
echo "2. 点击‘加载已解压的扩展程序’，选择：$EXTENSION_DEST"
echo "3. 在系统设置 → 隐私与安全性 → 辅助功能中开启‘拾忆卡’。"
echo "公开扩展 ID：__EXTENSION_ID__"
echo
read -r -p "按回车键关闭…"
