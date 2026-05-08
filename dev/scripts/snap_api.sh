#!/usr/bin/env bash
# snap_api.sh — Layer 4: bump snapshot + generate blast radius report
# Usage: npm run api:snap
#
# Determines the next vN by scanning api-snapshots/, copies openapi.yaml as
# the new snapshot, runs `oasdiff changelog` against the previous snapshot,
# regenerates caller-map.json + dead-apis.txt, and appends a row to
# api-snapshots/CHANGELOG.md tagging breaking-yes/no.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC="$REPO_ROOT/openapi.yaml"
SNAP_DIR="$REPO_ROOT/api-snapshots"
SCRIPTS_DIR="$REPO_ROOT/dev/scripts"

# Resolve oasdiff: PATH first, then $(go env GOPATH)/bin (where `go install` lands).
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

mkdir -p "$SNAP_DIR"

# Determine next version number
latest_n=0
for f in "$SNAP_DIR"/v*.yaml; do
  [[ -f "$f" ]] || continue
  n="${f##*/v}"; n="${n%.yaml}"
  [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && latest_n=$n
done
next_n=$(( latest_n + 1 ))
prev_n=$latest_n

echo "=== api:snap — creating v${next_n} snapshot ==="

# Copy spec
cp "$SPEC" "$SNAP_DIR/v${next_n}.yaml"
echo "  Wrote api-snapshots/v${next_n}.yaml"

# Generate changelog vs previous snapshot
if [[ $prev_n -gt 0 && -f "$SNAP_DIR/v${prev_n}.yaml" ]]; then
  if OASDIFF=$(resolve_oasdiff); then
    "$OASDIFF" changelog \
      "$SNAP_DIR/v${prev_n}.yaml" \
      "$SNAP_DIR/v${next_n}.yaml" \
      --format=markdown \
      > "$SNAP_DIR/blast-radius-latest.md" 2>/dev/null || true
    echo "  Wrote api-snapshots/blast-radius-latest.md"
  else
    echo "WARN: oasdiff not found — blast-radius-latest.md not generated."
    echo "      Install: go install github.com/oasdiff/oasdiff@latest"
    echo "# Blast radius report not generated — oasdiff not installed" > "$SNAP_DIR/blast-radius-latest.md"
  fi
else
  echo "# First snapshot — no previous version to diff against" > "$SNAP_DIR/blast-radius-latest.md"
  echo "  v${next_n} is first snapshot — no diff generated"
fi

# Regenerate caller map
python3 "$SCRIPTS_DIR/check_callers.py" > /dev/null
echo "  Regenerated api-snapshots/caller-map.json + dead-apis.txt"

# Append to CHANGELOG.md
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date +%Y-%m-%d)
BREAKING="no"
if [[ -f "$SNAP_DIR/blast-radius-latest.md" ]] && grep -qi "breaking" "$SNAP_DIR/blast-radius-latest.md" 2>/dev/null; then
  BREAKING="yes"
fi

cat >> "$SNAP_DIR/CHANGELOG.md" <<EOF

## v${next_n} — ${DATE}

Snapshot of openapi.yaml at ${SHA}. Breaking changes: ${BREAKING}.
EOF
echo "  Appended to api-snapshots/CHANGELOG.md"

echo ""
echo "=== Done: v${next_n} snapshot ready. Commit api-snapshots/ to record it. ==="
