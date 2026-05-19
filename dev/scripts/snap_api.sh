#!/usr/bin/env bash
# snap_api.sh — Layer 4: bump snapshot + generate blast radius report
# Usage: npm run api:snap
#
# Snapshots both siteAPI.yaml (v1) and samanthaAPI.yaml (v2) into api-snapshots/.
# v1 snapshots: api-snapshots/v1/vN.yaml
# v2 snapshots: api-snapshots/v2/vN.yaml
# blast-radius-latest.md covers the v1 diff (v2 diff written to blast-radius-v2-latest.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
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

snap_spec() {
  local label="$1"       # "v1" or "v2"
  local spec_file="$2"   # path to the spec
  local blast_out="$3"   # output file for blast-radius report

  local dir="$SNAP_DIR/$label"
  mkdir -p "$dir"

  local latest_n=0
  for f in "$dir"/v*.yaml; do
    [[ -f "$f" ]] || continue
    local n="${f##*/v}"; n="${n%.yaml}"
    [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && latest_n=$n
  done
  local next_n=$(( latest_n + 1 ))
  local prev_n=$latest_n

  echo "=== api:snap [$label] — creating v${next_n} snapshot ==="
  cp "$spec_file" "$dir/v${next_n}.yaml"
  echo "  Wrote api-snapshots/$label/v${next_n}.yaml"

  if [[ $prev_n -gt 0 && -f "$dir/v${prev_n}.yaml" ]]; then
    if OASDIFF=$(resolve_oasdiff); then
      "$OASDIFF" changelog \
        "$dir/v${prev_n}.yaml" \
        "$dir/v${next_n}.yaml" \
        --format=markdown \
        > "$SNAP_DIR/$blast_out" 2>/dev/null || true
      echo "  Wrote api-snapshots/$blast_out"
    else
      echo "WARN: oasdiff not found — $blast_out not generated."
      echo "      Install: go install github.com/oasdiff/oasdiff@latest"
      echo "# Blast radius report not generated — oasdiff not installed" > "$SNAP_DIR/$blast_out"
    fi
  else
    echo "# First $label snapshot — no previous version to diff against" > "$SNAP_DIR/$blast_out"
    echo "  v${next_n} is first $label snapshot — no diff generated"
  fi

  # Append to CHANGELOG.md
  local sha
  sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  local date
  date=$(date +%Y-%m-%d)
  local breaking="no"
  if [[ -f "$SNAP_DIR/$blast_out" ]] && grep -qi "breaking" "$SNAP_DIR/$blast_out" 2>/dev/null; then
    breaking="yes"
  fi

  local changelog="$dir/CHANGELOG.md"
  cat >> "$changelog" <<EOF

## v${next_n} — ${date}

Snapshot of ${spec_file##*/} at ${sha}. Breaking changes: ${breaking}.
EOF
  echo "  Appended to api-snapshots/$label/CHANGELOG.md"
}

mkdir -p "$SNAP_DIR"

# Snapshot v1 spec
snap_spec "v1" "$REPO_ROOT/siteAPI.yaml" "blast-radius-latest.md"

# Snapshot v2 spec (if it exists)
if [[ -f "$REPO_ROOT/samanthaAPI.yaml" ]]; then
  snap_spec "v2" "$REPO_ROOT/samanthaAPI.yaml" "blast-radius-v2-latest.md"
else
  echo "INFO: samanthaAPI.yaml not found — skipping v2 snapshot"
fi

# Regenerate caller maps for both specs
python3 "$SCRIPTS_DIR/check_callers.py" > /dev/null
python3 "$SCRIPTS_DIR/check_callers.py" --spec samanthaAPI.yaml > /dev/null 2>/dev/null || true
echo "  Regenerated api-snapshots/caller-map.json + dead-apis.txt"

echo ""
echo "=== Done: snapshots ready. Commit api-snapshots/ to record them. ==="
