#!/usr/bin/env bash
# Self-test for lint:no-direct-workspace-id (PLA062 S19).
#
# Creates a temp fixture under app/components/__fixture_workspace_id__/
# that reads `user.workspace_id` WITHOUT importing @/app/sentinel, runs
# the lint, and asserts a violation is reported. Cleans up afterward.
#
# Exit 0 = lint correctly rejected the fixture.
# Exit 1 = lint missed the fixture (regression).

set -eu

cd "$(dirname "$0")/../.."

FIXTURE_DIR="app/components/__fixture_workspace_id__"
FIXTURE_FILE="$FIXTURE_DIR/violation.tsx"
mkdir -p "$FIXTURE_DIR"

cat > "$FIXTURE_FILE" <<'EOF'
// Fixture for lint:no-direct-workspace-id — DO NOT REFERENCE.
// Reads user.workspace_id without importing from @/app/sentinel,
// which is exactly the pattern the lint must reject.
export function ViolationComponent(props: { user: { workspace_id: string } }) {
  const wsId = props.user.workspace_id;
  return wsId;
}
EOF

cleanup() {
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT

if python3 dev/scripts/lint_no_direct_workspace_id.py 2>/dev/null | grep -q "FAIL.*violation.tsx"; then
  echo "OK    self-test passed — fixture violation was caught"
  exit 0
fi

echo "FAIL  self-test regression — fixture violation was NOT caught by lint:no-direct-workspace-id"
exit 1
