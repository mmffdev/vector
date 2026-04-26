#!/usr/bin/env bash
# Tars every /opt/<svc>/docker-compose.yml + /opt/<svc>/.env. Small; makes rebuild trivial.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

OUT="$STAGING/opt-configs.tar.gz"
log "opt-configs: tarring /opt/*/{docker-compose.yml,.env}"
ssh_server 'bash -c "cd / && tar czf - opt/*/docker-compose.yml opt/*/.env 2>/dev/null"' > "$OUT"

SIZE="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
[ "$SIZE" -gt 100 ] || die "opt-configs tar suspiciously small"
log "opt-configs: ok ($SIZE bytes)"
