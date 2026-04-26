#!/usr/bin/env bash
# Exports RabbitMQ broker topology (users, vhosts, queues, exchanges, bindings, policies).
# Does NOT capture in-flight persistent messages — intentional; they're transient.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"

OUT="$STAGING/rabbitmq_definitions.json"
log "rabbitmq: exporting definitions"
ssh_server 'docker exec rabbitmq rabbitmqctl --quiet export_definitions - --format json' > "$OUT"

SIZE="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
[ "$SIZE" -gt 10 ] || die "rabbitmq definitions export empty"
log "rabbitmq: ok ($SIZE bytes)"
