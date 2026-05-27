#!/usr/bin/env bash
# lint:no-stub-evaluator
#
# Fails if evaluator.go in the v2 rules package still contains a stub
# return (e.g. `return true // stub`). This marker is the tell for an
# un-implemented evaluator that always matches everything.
#
# The contract: a real evaluator loads rules from the DB and tests each
# rule's conditions via the operator/jsonpath engine. A stub evaluator
# bypasses that and matches every event — a silent correctness failure
# that would ship incorrect behaviour to production.
#
# Origin: S07 (Rules engine — real matchConditions) — 2026-05-26.
# See: docs/c_c_lint_rules.md lint:no-stub-evaluator

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/backend/internal/notifications/v2/rules/evaluator.go"

if [[ ! -f "$TARGET" ]]; then
    echo "[lint:no-stub-evaluator] evaluator.go not found at expected path — treating as FAIL"
    echo "Expected: $TARGET"
    exit 1
fi

# Match lines that return a literal true/false with a 'stub' comment.
# Pattern: `return true.*//.*stub` or `return false.*//.*stub` (case-insensitive).
VIOLATIONS=$(grep -n -iE 'return (true|false).*//.*stub' "$TARGET" || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo "[lint:no-stub-evaluator] FAIL"
    echo ""
    echo "evaluator.go contains a stub return. The rules engine must"
    echo "implement real condition evaluation — not always-true/false."
    echo ""
    echo "Violating lines:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "[lint:no-stub-evaluator] PASS"
