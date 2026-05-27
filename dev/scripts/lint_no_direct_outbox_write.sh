#!/usr/bin/env bash
# lint:no-direct-outbox-write
#
# Fails if any code OUTSIDE backend/internal/notifications/v2/ writes
# directly to notifications_outbox_v2, notifications_events_v2, or
# notifications_event_recipients via raw INSERT SQL.
#
# External producers must use the producer.Producer surface
# (producer.Enqueue / producer.EnqueueTx). This is the architectural
# boundary that guarantees idempotency, validation, and audit correctness.
#
# Origin: S02 (domain types + Producer) — 2026-05-26.
# See: docs/c_c_lint_rules.md lint:no-direct-outbox-write

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEARCH="$ROOT/backend/internal"

# Look for SQL INSERTs against the v2 tables outside the v2 package.
VIOLATIONS=$(grep -rln --include="*.go" \
    -E "INSERT INTO notifications_(events_v2|outbox_v2|event_recipients)" \
    "$SEARCH" 2>/dev/null \
    | grep -v "/notifications/v2/" \
    || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo "[lint:no-direct-outbox-write] FAIL"
    echo ""
    echo "Code outside backend/internal/notifications/v2/ writes directly"
    echo "to v2 notification tables. External producers must use"
    echo "producer.Producer.Enqueue / EnqueueTx. Violating files:"
    echo ""
    echo "$VIOLATIONS"
    exit 1
fi

echo "[lint:no-direct-outbox-write] PASS"
