#!/usr/bin/env bash
# Dumps mmff_ops Postgres to $STAGING/pg-mmff_ops.dump (custom format, pre-compressed).
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

OUT="$STAGING/pg-mmff_ops.dump"
log "pg: starting dump"
ssh_server 'docker exec mmff-ops-postgres pg_dump -U mmff_dev -Fc mmff_ops' > "$OUT"

SIZE="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
[ "$SIZE" -gt 1000 ] || die "pg dump suspiciously small ($SIZE bytes)"
log "pg: ok ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "$SIZE bytes"))"
