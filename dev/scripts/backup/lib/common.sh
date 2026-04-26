# Sourced by every producer + driver. Never executed directly.
# shellcheck shell=bash

set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-$HOME/Backups/mmffdev}"
TODAY="${TODAY:-$(date +%Y-%m-%d)}"
RUN_STAMP="${RUN_STAMP:-$(date +%Y-%m-%d-%H%M%S)}"
STAGING="${STAGING:-$BACKUP_ROOT/.staging/$RUN_STAMP}"
LOG_DIR="${LOG_DIR:-$BACKUP_ROOT/.logs}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/$TODAY.log}"
export BACKUP_ROOT TODAY RUN_STAMP STAGING LOG_DIR LOG_FILE

SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_HOST="root@mmffdev.com"
SSH_OPTS=(-i "$SSH_KEY" -o ConnectTimeout=10 -o ServerAliveInterval=30)

PLESK_MAX_BYTES="${PLESK_MAX_BYTES:-5368709120}"  # 5 GiB
KEEP_DAILY=7
KEEP_WEEKLY=4
KEEP_MONTHLY=12

mkdir -p "$LOG_DIR" "$STAGING"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG_FILE" >&2; }
die() { log "ERROR: $*"; exit 1; }
ssh_server() { ssh "${SSH_OPTS[@]}" "$SSH_HOST" "$@"; }
