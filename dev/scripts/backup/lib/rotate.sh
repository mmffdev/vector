# Grandfather-Father-Son rotation.
# Daily bucket is always populated (that's the produced run). Weekly/monthly/yearly
# are copies taken on cadence. Pruning uses `find -mtime`.
# shellcheck shell=bash

rotate() {
  local daily_dir="$BACKUP_ROOT/daily/$TODAY"
  [ -d "$daily_dir" ] || die "rotate: $daily_dir missing"

  local dow="$(date +%u)"   # 1..7, 7=Sun
  local dom="$(date +%d)"
  local mon="$(date +%m)"

  # Sunday → weekly
  if [ "$dow" = "7" ]; then
    local week
    week="$(date +%G-W%V)"
    log "rotate: promoting to weekly/$week"
    mkdir -p "$BACKUP_ROOT/weekly"
    cp -R "$daily_dir" "$BACKUP_ROOT/weekly/$week"
  fi

  # 1st of month → monthly
  if [ "$dom" = "01" ]; then
    local m
    m="$(date +%Y-%m)"
    log "rotate: promoting to monthly/$m"
    mkdir -p "$BACKUP_ROOT/monthly"
    cp -R "$daily_dir" "$BACKUP_ROOT/monthly/$m"
  fi

  # 1 Jan → yearly
  if [ "$dom" = "01" ] && [ "$mon" = "01" ]; then
    local y
    y="$(date +%Y)"
    log "rotate: promoting to yearly/$y"
    mkdir -p "$BACKUP_ROOT/yearly"
    cp -R "$daily_dir" "$BACKUP_ROOT/yearly/$y"
  fi

  # Prune (directories older than N days by mtime of their own dir).
  # macOS find lacks -mindepth on oldest BSD variants; guard with -type d + -path depth.
  log "rotate: pruning daily>${KEEP_DAILY}d, weekly>$((KEEP_WEEKLY*7))d, monthly>$((KEEP_MONTHLY*31))d"
  find "$BACKUP_ROOT/daily"   -mindepth 1 -maxdepth 1 -type d -mtime "+${KEEP_DAILY}"            -exec rm -rf {} + 2>/dev/null || true
  find "$BACKUP_ROOT/weekly"  -mindepth 1 -maxdepth 1 -type d -mtime "+$((KEEP_WEEKLY*7))"       -exec rm -rf {} + 2>/dev/null || true
  find "$BACKUP_ROOT/monthly" -mindepth 1 -maxdepth 1 -type d -mtime "+$((KEEP_MONTHLY*31))"     -exec rm -rf {} + 2>/dev/null || true
  # yearly is kept forever

  log "rotate: ok"
}
