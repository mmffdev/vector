#!/usr/bin/env bash
# Brief (~15s) n8n stop + consistent tar of the n8n_data volume (SQLite + encryption key).
# Container is always restarted, even on tar failure, via 'trap'.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

OUT="$STAGING/n8n_data.tar.gz"
log "n8n: stopping container for consistent snapshot"

ssh_server 'bash -s' <<'REMOTE' > "$OUT"
set -euo pipefail
cleanup() { docker start n8n >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker stop n8n >/dev/null
docker run --rm -v n8n_data:/src alpine tar czf - -C /src .
REMOTE

SIZE="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
[ "$SIZE" -gt 1000 ] || die "n8n tar suspiciously small ($SIZE bytes)"
# Confirm container is back
STATE="$(ssh_server 'docker inspect n8n --format {{.State.Status}}')"
[ "$STATE" = "running" ] || die "n8n did not restart (state=$STATE)"
log "n8n: ok ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "$SIZE bytes"), container=$STATE)"
