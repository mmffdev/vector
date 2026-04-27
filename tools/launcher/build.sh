#!/usr/bin/env bash
# MMFF Vector Launcher — build script
# Builds the SwiftPM executable, assembles a hand-crafted .app bundle, and
# applies an ad-hoc bottom-up codesign suitable for internal dev distribution.
#
# Hard rules:
#   - No `git` commands anywhere.
#   - Coexists with MMFF Vector Dev.app (different bundle id + name).
#   - Never modifies AppleScript launcher or shortcuts.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_NAME="MMFF Vector Launcher.app"
APP_PATH="$REPO_ROOT/$APP_NAME"
BIN_NAME="MMFFVectorLauncher"
PLIST_SRC="$REPO_ROOT/tools/launcher/Info.plist"

cd "$REPO_ROOT"

echo "==> swift build"
swift build -c release --arch arm64

BUILT_BIN="$(swift build -c release --arch arm64 --show-bin-path)/$BIN_NAME"
if [[ ! -x "$BUILT_BIN" ]]; then
    echo "build.sh: expected binary at $BUILT_BIN, not found" >&2
    exit 1
fi

echo "==> assembling bundle at $APP_PATH"
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

cp "$BUILT_BIN" "$APP_PATH/Contents/MacOS/$BIN_NAME"
cp "$PLIST_SRC" "$APP_PATH/Contents/Info.plist"
printf 'APPL????' > "$APP_PATH/Contents/PkgInfo"

# Placeholder icon — generate a 1024x1024 transparent PNG and convert to ICNS
# only if iconutil is available. Otherwise drop a stub file; macOS falls back
# to the generic app icon. This is fine for a dev-only launcher.
ICON_DST="$APP_PATH/Contents/Resources/AppIcon.icns"
if command -v iconutil >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
    TMP_ICONSET="$(mktemp -d)/AppIcon.iconset"
    mkdir -p "$TMP_ICONSET"
    SRC_PNG="$TMP_ICONSET/icon_1024x1024.png"
    # 1x1 transparent PNG, then upscale
    printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > "$SRC_PNG.tiny"
    sips -s format png -Z 1024 "$SRC_PNG.tiny" --out "$SRC_PNG" >/dev/null 2>&1 || cp "$SRC_PNG.tiny" "$SRC_PNG"
    for size in 16 32 64 128 256 512; do
        sips -z "$size" "$size" "$SRC_PNG" --out "$TMP_ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1 || true
        sips -z "$((size * 2))" "$((size * 2))" "$SRC_PNG" --out "$TMP_ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1 || true
    done
    iconutil -c icns "$TMP_ICONSET" -o "$ICON_DST" 2>/dev/null || touch "$ICON_DST"
else
    touch "$ICON_DST"
fi

echo "==> ad-hoc codesign (bottom-up)"
codesign -f -s - --options=runtime --timestamp=none \
    "$APP_PATH/Contents/MacOS/$BIN_NAME"
codesign -f -s - --options=runtime --timestamp=none \
    "$APP_PATH"

echo "==> verify"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo
echo "Build complete."
echo "  Bundle: $APP_PATH"
echo
echo "First launch on macOS Tahoe 26:"
echo "  open \"$APP_PATH\""
echo "  → If Gatekeeper blocks: System Settings → Privacy & Security → Open Anyway"
