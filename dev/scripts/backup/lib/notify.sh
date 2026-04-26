# macOS Notification Centre wrapper. Silent on non-Darwin.
# shellcheck shell=bash

notify() {
  local title="$1"
  local body="$2"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"${body//\"/\\\"}\" with title \"${title//\"/\\\"}\"" >/dev/null 2>&1 || true
  fi
}
