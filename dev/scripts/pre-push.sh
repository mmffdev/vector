#!/usr/bin/env bash
# pre-push.sh — Layer 2: API contract gate on every git push.
# Install with: npm run api:install-hooks
#
# 1. check_routes.sh — Go router ↔ siteAPI.yaml
# 2. check_callers.py — frontend api(...) callers ↔ siteAPI.yaml
# 3. oasdiff breaking — spec breaking changes vs latest snapshot for
#                       BOTH v1 (siteAPI.yaml) and v2 (samanthaAPI.yaml).
#                       Snapshots live under api-snapshots/v1/vN.yaml
#                       and api-snapshots/v2/vN.yaml per snap_api.sh.
#
# Breaking-change escape hatch: include `[breaking]` in the most recent
# commit message (subject or body) to bypass the breaking-change block.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPTS="$REPO_ROOT/dev/scripts"
SNAP_DIR="$REPO_ROOT/api-snapshots"

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

# find_latest_snap LABEL — echoes the path to the highest-numbered
# snapshot under api-snapshots/<label>/, or empty if none. The
# snap_api.sh script writes here; older top-level api-snapshots/v*.yaml
# files are ignored (they predate the v1/v2 split).
find_latest_snap() {
  local label="$1"
  local dir="$SNAP_DIR/$label"
  [[ -d "$dir" ]] || return 0
  local latest=""
  local latest_n=0
  for f in "$dir"/v*.yaml; do
    [[ -f "$f" ]] || continue
    local n="${f##*/v}"; n="${n%.yaml}"
    [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && { latest_n=$n; latest=$f; }
  done
  echo "$latest"
}

# diff_against_snap LABEL SPEC_FILE — runs oasdiff breaking, prints a
# BLOCKED message + exits 1 on real breaking changes (unless commit
# carries [breaking]). No-ops when the snapshot is missing.
diff_against_snap() {
  local label="$1"
  local spec="$2"
  local latest_snap
  latest_snap="$(find_latest_snap "$label")"

  if [[ -z "$latest_snap" ]]; then
    echo "WARN: no $label snapshot found — breaking-change check skipped for $label."
    echo "      Run 'npm run api:snap' to establish a baseline."
    return 0
  fi

  if ! "$OASDIFF" breaking "$latest_snap" "$spec" --fail-on ERR &>/dev/null; then
    LAST_MSG=$(git log -1 --format="%s%n%b" 2>/dev/null || echo "")
    if echo "$LAST_MSG" | grep -q '\[breaking\]'; then
      echo "INFO: Breaking changes detected vs $label/$(basename "$latest_snap") but [breaking] token found — allowed."
      return 0
    fi
    echo "" >&2
    echo "BLOCKED: Breaking API changes detected vs $label/$(basename "$latest_snap")." >&2
    echo "         Add [breaking] to your commit message to allow this push." >&2
    echo "         Diff:" >&2
    "$OASDIFF" breaking "$latest_snap" "$spec" --fail-on ERR 2>/dev/null >&2 || true
    exit 1
  fi
}

echo "=== pre-push: API contract checks ==="

# Layer 0: Frontend caller discipline. Two lints make sure no client
# code goes rogue with direct backend URLs or bare fetch()/SSE calls
# outside the sanctioned app/lib/api.ts chokepoint. Procurement story
# (defence/finance): every outbound backend call is audit-traceable
# through one file.
if ! python3 "$SCRIPTS/lint_api_caller_discipline.py"; then
  echo "BLOCKED: a client file references the backend directly." >&2
  echo "         Route through apiSite/apiV2/apiRoot from app/lib/api.ts," >&2
  echo "         or add an exemption with a reason in dev/registries/api_caller_exempt.json." >&2
  exit 1
fi
if ! python3 "$SCRIPTS/lint_api_helper_exclusive.py"; then
  echo "BLOCKED: a client file uses fetch()/XMLHttpRequest()/WebSocket()/EventSource() outside the helper." >&2
  echo "         Route through apiSite/apiV2/apiRoot from app/lib/api.ts," >&2
  echo "         or add an exemption with a reason in dev/registries/api_caller_exempt.json." >&2
  exit 1
fi

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

# Layer 2: Breaking change detection vs latest snapshot. Run for both
# v1 and v2 spec families against their respective snapshot dirs.
if ! OASDIFF=$(resolve_oasdiff); then
  echo "WARN: oasdiff not installed — breaking-change check skipped."
  echo "      Install: go install github.com/oasdiff/oasdiff@latest"
  echo "=== pre-push: OK (oasdiff missing) ==="
  exit 0
fi

diff_against_snap "v1" "$REPO_ROOT/siteAPI.yaml"
if [[ -f "$REPO_ROOT/samanthaAPI.yaml" ]]; then
  diff_against_snap "v2" "$REPO_ROOT/samanthaAPI.yaml"
fi

echo "=== pre-push: OK ==="
exit 0
