#!/usr/bin/env bash
# Regenerate the Xcode project from project.yml, build, and ad-hoc sign.
# Output: ./MMFF Vector Launcher.app at the repo root.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen not installed. Run: brew install xcodegen"
  exit 1
fi

xcodegen generate

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild \
  -project "MMFF Vector Launcher.xcodeproj" \
  -scheme "MMFF Vector Launcher" \
  -configuration Release \
  -derivedDataPath build \
  clean build >/tmp/mmff-launcher-build.log 2>&1

if ! grep -q "BUILD SUCCEEDED" /tmp/mmff-launcher-build.log; then
  echo "build FAILED — see /tmp/mmff-launcher-build.log"
  tail -20 /tmp/mmff-launcher-build.log
  exit 1
fi

rm -rf "MMFF Vector Launcher.app"
cp -R "build/Build/Products/Release/MMFF Vector Launcher.app" "MMFF Vector Launcher.app"
codesign -s - --force --deep "MMFF Vector Launcher.app"

echo "built: $(pwd)/MMFF Vector Launcher.app"
echo "open with: open 'MMFF Vector Launcher.app'"
