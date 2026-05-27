#!/usr/bin/env bash
# lint:no-v1-broker-imports
# Fails if any file under backend/internal/notifications/v2/ imports
# the v1 broker package "backend/internal/notifications/broker".
# Strangler-fig hard rule — v2 must be standalone until v1 deletion.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/backend/internal/notifications/v2"

if [[ ! -d "$TARGET" ]]; then
    echo "[lint:no-v1-broker-imports] target dir $TARGET does not exist — skipping"
    exit 0
fi

# Look for imports of the v1 broker path. Match the actual module
# path used in this project (read backend/go.mod for the module name).
MODULE=$(grep -E '^module ' "$ROOT/backend/go.mod" | awk '{print $2}')
V1_IMPORT_PATH="$MODULE/internal/notifications/broker"

VIOLATIONS=$(grep -rln "\"$V1_IMPORT_PATH\"" "$TARGET" 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo "[lint:no-v1-broker-imports] FAIL"
    echo "v2 code imports the v1 broker package. The strangler-fig"
    echo "design requires v2 to be standalone. Files:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "[lint:no-v1-broker-imports] PASS"
