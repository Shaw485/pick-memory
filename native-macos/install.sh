#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_SOURCE="$BUILD_DIR/拾忆卡.app"
APP_DEST="$HOME/Applications/拾忆卡.app"
SUPPORT_DIR="$HOME/Library/Application Support/ShiyiCard"
HOST_DEST="$SUPPORT_DIR/shiyi-native-host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_DEST="$MANIFEST_DIR/com.shiyi.card.json"
EXTENSION_ID="${EXTENSION_ID:-lkpicpmpkngebhgahhanngoglckfhija}"

if [[ ! -d "$APP_SOURCE" || ! -x "$BUILD_DIR/shiyi-native-host" ]]; then
  echo "Run build.sh first."
  exit 1
fi

mkdir -p "$HOME/Applications" "$SUPPORT_DIR" "$MANIFEST_DIR"
ditto "$APP_SOURCE" "$APP_DEST"
cp "$BUILD_DIR/shiyi-native-host" "$HOST_DEST"
chmod +x "$HOST_DEST"

sed \
  -e "s|__HOST_PATH__|$HOST_DEST|g" \
  -e "s|__EXTENSION_ID__|$EXTENSION_ID|g" \
  "$SCRIPT_DIR/com.shiyi.card.json.template" > "$MANIFEST_DEST"

open "$APP_DEST"
echo "Installed: $APP_DEST"
