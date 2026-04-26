#!/usr/bin/env bash
# Installs the launchd job that runs server-backup.sh at 05:00 daily.
# Idempotent — safe to re-run after edits to the plist template.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$(cd "$HERE/.." && pwd)/server-backup.sh"
TEMPLATE="$HERE/com.mmffdev.server-backup.plist"
TARGET="$HOME/Library/LaunchAgents/com.mmffdev.server-backup.plist"
LABEL="com.mmffdev.server-backup"

[ -x "$SCRIPT_PATH" ] || { echo "ERROR: $SCRIPT_PATH not executable" >&2; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Backups/mmffdev/.logs"

sed -e "s|__SCRIPT_PATH__|$SCRIPT_PATH|g" \
    -e "s|__HOME__|$HOME|g" \
    "$TEMPLATE" > "$TARGET"

# Reload (bootout is silent if not loaded)
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$TARGET"

echo "Installed: $TARGET"
echo "Next run:  05:00 daily"
echo "Inspect:   launchctl print gui/$UID/$LABEL | head -30"
echo "Manual:    bash $SCRIPT_PATH"
