#!/usr/bin/env bash
# Self-test for lint:no-old-context-imports (PLA062 S19).
#
# Creates a temp fixture under app/components/__fixture_old_ctx__/
# that imports from @/app/contexts/AuthContext, runs the lint, and
# asserts a violation is reported. Cleans up afterward.
#
# Exit 0 = lint correctly rejected the fixture.
# Exit 1 = lint missed the fixture (regression).

set -eu

cd "$(dirname "$0")/../.."

FIXTURE_DIR="app/components/__fixture_old_ctx__"
FIXTURE_FILE="$FIXTURE_DIR/violation.tsx"
mkdir -p "$FIXTURE_DIR"

cat > "$FIXTURE_FILE" <<'EOF'
// Fixture for lint:no-old-context-imports — DO NOT REFERENCE.
// Imports from the legacy AuthContext, which is exactly the pattern
// the lint must reject after PLA062 S19.
import { useAuth } from "@/app/contexts/AuthContext";
export function ViolationComponent() {
  const { user: _u } = useAuth();
  return null;
}
EOF

cleanup() {
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

if python3 dev/scripts/lint_no_old_context_imports.py 2>/dev/null | grep -q "FAIL.*violation.tsx"; then
  echo "OK    self-test passed — fixture violation was caught"
  exit 0
fi

echo "FAIL  self-test regression — fixture violation was NOT caught by lint:no-old-context-imports"
exit 1
