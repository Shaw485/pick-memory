#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
APP_DIR="$BUILD_DIR/拾忆卡.app"

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
mkdir -p "$BUILD_DIR/module-cache"

xcrun clang -O2 -fobjc-arc -fblocks \
  -fmodules-cache-path="$BUILD_DIR/module-cache" \
  -framework Cocoa \
  -framework ApplicationServices \
  "$SCRIPT_DIR/Sources/ShiyiCapture/main.m" \
  -o "$APP_DIR/Contents/MacOS/ShiyiCapture"

cp "$SCRIPT_DIR/Info.plist" "$APP_DIR/Contents/Info.plist"
cp "$SCRIPT_DIR/Sources/NativeHost/shiyi_native_host.py" "$BUILD_DIR/shiyi-native-host"
chmod +x "$APP_DIR/Contents/MacOS/ShiyiCapture" "$BUILD_DIR/shiyi-native-host"

# Sign the complete bundle after Info.plist is in place. Without a bundle
# signature, macOS can show an enabled Accessibility toggle while TCC still
# treats a rebuilt executable as a different, untrusted app.
codesign --force --sign - \
  --identifier com.shiyi.capture \
  --requirements '=designated => identifier "com.shiyi.capture"' \
  "$APP_DIR"

echo "Built: $APP_DIR"
