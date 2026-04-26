#!/usr/bin/env bash
# Entry point. Run manually or via launchd.
# Staging → daily → rotate → notify. Whole run fails atomically: partial staging is
# never moved into daily/ if any producer exits non-zero.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/lib/common.sh"
source "$HERE/lib/notify.sh"
source "$HERE/lib/preflight.sh"
source "$HERE/lib/rotate.sh"

START_TS="$(date +%s)"
log "=== server-backup starting ($RUN_STAMP) ==="

trap 'rc=$?; if [ $rc -ne 0 ]; then log "FAILED rc=$rc"; notify "Server backup FAILED" "See $LOG_FILE"; fi; rm -rf "$STAGING"' EXIT

preflight

for p in "$HERE/producers/"*.sh; do
  log "--- running $(basename "$p") ---"
  bash "$p"
done

# Promote staging to daily
DAILY_DIR="$BACKUP_ROOT/daily/$TODAY"
mkdir -p "$BACKUP_ROOT/daily"
rm -rf "$DAILY_DIR"
mv "$STAGING" "$DAILY_DIR"
log "promoted staging → $DAILY_DIR"

# Don't let rotate() try to rm the directory we just moved.
trap 'rc=$?; if [ $rc -ne 0 ]; then log "FAILED rc=$rc"; notify "Server backup FAILED" "See $LOG_FILE"; fi' EXIT

rotate

DURATION=$(( $(date +%s) - START_TS ))
TOTAL_SIZE="$(du -sh "$DAILY_DIR" | awk '{print $1}')"
log "=== server-backup done ${DURATION}s, $TOTAL_SIZE ==="
notify "Server backup OK" "$TOTAL_SIZE in ${DURATION}s → $DAILY_DIR"
