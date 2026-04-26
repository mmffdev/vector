#!/usr/bin/env bash
# Tars Portainer BoltDB + settings. Hot copy is fine — Portainer flushes on write.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

OUT="$STAGING/portainer_data.tar.gz"
log "portainer: tarring volume"
ssh_server 'docker run --rm -v portainer_portainer_data:/src alpine tar czf - -C /src .' > "$OUT"

SIZE="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
[ "$SIZE" -gt 1000 ] || die "portainer tar suspiciously small ($SIZE bytes)"
log "portainer: ok ($(numfmt --to=iec "$SIZE" 2>/dev/null || echo "$SIZE bytes"))"
