#!/usr/bin/env bash
# Server-side Plesk full backup (vhosts + DBs + DNS + SSL + mail + config).
# Aborts + notifies if > $PLESK_MAX_BYTES. Cleans up server-side temp on success or abort.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

REMOTE_FILE="/var/lib/psa/dumps/auto-backup-$RUN_STAMP.tar"
OUT="$STAGING/plesk-full.tar"

cleanup_remote() { ssh_server "rm -f $REMOTE_FILE" >/dev/null 2>&1 || true; }
trap cleanup_remote EXIT

log "plesk: triggering --server backup → $REMOTE_FILE"
ssh_server "plesk bin pleskbackup --server -output-file $REMOTE_FILE -include-server-settings" \
  >>"$LOG_FILE" 2>&1 || die "plesk pleskbackup failed (see $LOG_FILE)"

TOTAL_BYTES="$(ssh_server "stat -c%s $REMOTE_FILE 2>/dev/null || echo 0")"
log "plesk: archive size = $(numfmt --to=iec "$TOTAL_BYTES" 2>/dev/null || echo "$TOTAL_BYTES bytes")"

if [ "$TOTAL_BYTES" -gt "$PLESK_MAX_BYTES" ]; then
  die "plesk backup ${TOTAL_BYTES}B exceeds ${PLESK_MAX_BYTES}B — aborted"
fi
[ "$TOTAL_BYTES" -gt 1000 ] || die "plesk backup suspiciously small ($TOTAL_BYTES bytes)"

log "plesk: streaming archive to laptop"
ssh_server "cat $REMOTE_FILE" > "$OUT"

LOCAL_SIZE="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
[ "$LOCAL_SIZE" -eq "$TOTAL_BYTES" ] || die "plesk transfer size mismatch (remote=$TOTAL_BYTES, local=$LOCAL_SIZE)"
log "plesk: ok ($(numfmt --to=iec "$LOCAL_SIZE" 2>/dev/null || echo "$LOCAL_SIZE bytes"))"
