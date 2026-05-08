#!/usr/bin/env bash
# pre-push.sh — Layer 2: API contract gate on every git push.
# Install with: npm run api:install-hooks
#
# 1. check_routes.sh — Go router ↔ openapi.yaml
# 2. check_callers.py — frontend api(...) callers ↔ openapi.yaml
# 3. oasdiff breaking — spec breaking changes vs latest snapshot
#
# Breaking-change escape hatch: include `[breaking]` in the most recent
# commit message (subject or body) to bypass the breaking-change block.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPTS="$REPO_ROOT/dev/scripts"
SNAP_DIR="$REPO_ROOT/api-snapshots"
SPEC="$REPO_ROOT/openapi.yaml"

resolve_oasdiff() {
  if command -v oasdiff &>/dev/null; then
    echo "oasdiff"
    return 0
  fi
  local gopath
  gopath="$(go env GOPATH 2>/dev/null || true)"
  if [[ -n "$gopath" && -x "$gopath/bin/oasdiff" ]]; then
    echo "$gopath/bin/oasdiff"
    return 0
  fi
  return 1
}

echo "=== pre-push: API contract checks ==="

# Layer 1a: Go router vs spec
if ! bash "$SCRIPTS/check_routes.sh"; then
  echo "BLOCKED: fix undocumented routes before pushing." >&2
  exit 1
fi

# Layer 1b: Frontend callers vs spec
if ! python3 "$SCRIPTS/check_callers.py"; then
  echo "BLOCKED: fix undocumented caller paths before pushing." >&2
  exit 1
fi

# Layer 2: Breaking change detection vs latest snapshot
latest_snap=""
latest_n=0
for f in "$SNAP_DIR"/v*.yaml; do
  [[ -f "$f" ]] || continue
  n="${f##*/v}"; n="${n%.yaml}"
  [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && { latest_n=$n; latest_snap=$f; }
done

if [[ -z "$latest_snap" ]]; then
  echo "WARN: no snapshot found in api-snapshots/ — breaking-change check skipped."
  echo "      Run 'npm run api:snap' to establish a baseline."
  echo "=== pre-push: OK (no snapshot) ==="
  exit 0
fi

if ! OASDIFF=$(resolve_oasdiff); then
  echo "WARN: oasdiff not installed — breaking-change check skipped."
  echo "      Install: go install github.com/oasdiff/oasdiff@latest"
  echo "=== pre-push: OK (oasdiff missing) ==="
  exit 0
fi

if ! "$OASDIFF" breaking "$latest_snap" "$SPEC" --fail-on ERR &>/dev/null; then
  LAST_MSG=$(git log -1 --format="%s%n%b" 2>/dev/null || echo "")
  if echo "$LAST_MSG" | grep -q '\[breaking\]'; then
    echo "INFO: Breaking changes detected but [breaking] token found in commit — allowed."
  else
    echo "" >&2
    echo "BLOCKED: Breaking API changes detected vs $(basename "$latest_snap")." >&2
    echo "         Add [breaking] to your commit message to allow this push." >&2
    echo "         Diff:" >&2
    "$OASDIFF" breaking "$latest_snap" "$SPEC" --fail-on ERR 2>/dev/null >&2 || true
    exit 1
  fi
fi

echo "=== pre-push: OK ==="
exit 0
