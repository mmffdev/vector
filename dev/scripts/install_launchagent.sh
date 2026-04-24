#!/usr/bin/env bash
# Install the mmffdev-pg tunnel as a LaunchAgent so it auto-starts at login
# and restarts on failure. Idempotent: unload + reload if already installed.
#
# Tunnel forwards defined in ~/.ssh/config under Host mmffdev-pg:
#   5434 -> server:5432 (Postgres)
#   8081 -> server:8081 (Adminer)
#
# Logs land in ~/Library/Logs/mmff/tunnel.*.log.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

LABEL="com.mmff.tunnel"
TEMPLATE="$REPO_ROOT/dev/scripts/launchagent/com.mmff.tunnel.plist.template"
AGENT_DIR="$HOME/Library/LaunchAgents"
AGENT_PATH="$AGENT_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/mmff"

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: template missing at $TEMPLATE" >&2
  exit 1
fi

SSH_BIN="$(command -v ssh || echo /usr/bin/ssh)"
if [ ! -x "$SSH_BIN" ]; then
  echo "ERROR: ssh not found on PATH and /usr/bin/ssh missing." >&2
  exit 1
fi

mkdir -p "$AGENT_DIR" "$LOG_DIR"

# Render template: __SSH_BIN__ and __LOG_DIR__ substituted.
sed -e "s|__SSH_BIN__|$SSH_BIN|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    "$TEMPLATE" > "$AGENT_PATH"

echo "INFO: wrote $AGENT_PATH"

# Unload existing (if any), then load. `bootstrap` is the modern equivalent.
if launchctl list | grep -q "$LABEL"; then
  echo "INFO: unloading existing agent"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$AGENT_PATH" 2>/dev/null || true
fi

launchctl bootstrap "gui/$(id -u)" "$AGENT_PATH" 2>/dev/null || launchctl load "$AGENT_PATH"

sleep 2
if nc -z localhost 5434 2>/dev/null; then
  echo "OK: tunnel is up on 5434"
else
  echo "WARN: tunnel not listening yet. Check logs: $LOG_DIR/tunnel.err.log"
fi
if nc -z localhost 8081 2>/dev/null; then
  echo "OK: tunnel is up on 8081 (Adminer reachable at http://localhost:8081)"
else
  echo "WARN: 8081 not listening yet. Check logs: $LOG_DIR/tunnel.err.log"
fi

cat <<EOF

Installed. To manage:
  Stop:       launchctl bootout gui/$(id -u)/$LABEL
  Start:      launchctl bootstrap gui/$(id -u) $AGENT_PATH
  Logs:       tail -f $LOG_DIR/tunnel.err.log
  Uninstall:  launchctl bootout gui/$(id -u)/$LABEL ; rm $AGENT_PATH
EOF
