#!/usr/bin/env bash
# audit_codegraph.sh — full-repo code-graph for the Dev → Visualiser page.
#
# Emits dev/audits/codegraph.json with one node per source file (frontend TS
# + backend Go) and three edge kinds:
#   - "import"  — TS file → TS file  (resolved from `import ... from "..."`)
#   - "import"  — Go file → Go file  (resolved from `import (...)` blocks)
#   - "bridge"  — TS file → Go file  (resolved from `apiSite/apiV2/apiRoot`
#                                     call sites → matching backend handler
#                                     OR a fallback edge to main.go when the
#                                     handler can't be cleanly resolved)
#
# Output schema:
#   {
#     "generated_at": "<iso8601>",
#     "stats": { "ts_files": N, "go_files": N, "import_edges": N, "bridge_edges": N },
#     "nodes": [
#       { "id": "<relpath>", "side": "frontend"|"backend",
#         "folder": "<dir>", "layer": "<page|component|lib|handler|service|sql|...>" }
#     ],
#     "edges": [
#       { "source": "<id>", "target": "<id>", "kind": "import"|"bridge" }
#     ]
#   }
#
# Read-only. Idempotent. ~5s on Vector's tree.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$REPO_ROOT/dev/audits/codegraph.json"
TMP_DIR=$(mktemp -d -t codegraph-XXXXXX)
trap 'rm -rf "$TMP_DIR"' EXIT

NODES="$TMP_DIR/nodes.jsonl"
EDGES="$TMP_DIR/edges.jsonl"
: > "$NODES"
: > "$EDGES"

cd "$REPO_ROOT"

# ─── Layer classifier ────────────────────────────────────────────────────────
ts_layer() {
  local f="$1"
  case "$f" in
    app/api/*)          echo "shadow-api" ;;
    app/components/*)   echo "component" ;;
    app/lib/*)          echo "lib" ;;
    app/hooks/*)        echo "hook" ;;
    app/*/page.tsx)     echo "page" ;;
    app/*/layout.tsx)   echo "layout" ;;
    app/*)              echo "app-other" ;;
    dev/pages/*)        echo "dev-panel" ;;
    dev/components/*)   echo "dev-component" ;;
    dev/*)              echo "dev-other" ;;
    *)                  echo "ts-other" ;;
  esac
}

go_layer() {
  local f="$1"
  case "$f" in
    */handler.go|*/handler_*.go)  echo "handler" ;;
    */service.go|*/service_*.go)  echo "service" ;;
    */sql.go|*/sql_*.go|*/repo.go) echo "sql" ;;
    */types.go|*/dto.go)          echo "types" ;;
    */main.go)                    echo "main" ;;
    *_test.go)                    echo "test" ;;
    backend/cmd/*)                echo "cmd" ;;
    backend/internal/*)           echo "service" ;;
    *)                            echo "go-other" ;;
  esac
}

emit_node() {
  jq -nc \
    --arg id "$1" --arg side "$2" --arg folder "$3" --arg layer "$4" \
    '{id:$id, side:$side, folder:$folder, layer:$layer}' >> "$NODES"
}

emit_edge() {
  jq -nc \
    --arg source "$1" --arg target "$2" --arg kind "$3" \
    '{source:$source, target:$target, kind:$kind}' >> "$EDGES"
}

# ─── 1. TS/TSX nodes + import edges ──────────────────────────────────────────
echo "▶ walking TS files…" >&2

# Build a set of valid TS paths (used for resolving `@/`-prefixed imports).
TS_FILES="$TMP_DIR/ts_files.txt"
find app dev -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" \
  -not -path "*/.next/*" \
  -not -name "*.d.ts" \
  -not -name "*.test.ts" -not -name "*.test.tsx" \
  -not -name "*.stories.tsx" \
  | sort > "$TS_FILES"

TS_COUNT=$(wc -l < "$TS_FILES" | tr -d ' ')
echo "  $TS_COUNT TS files" >&2

# Emit nodes.
while IFS= read -r f; do
  folder=$(dirname "$f")
  emit_node "$f" "frontend" "$folder" "$(ts_layer "$f")"
done < "$TS_FILES"

# Resolve a `@/foo/bar` import → relpath. Tries .ts, .tsx, /index.ts(x).
resolve_ts_import() {
  local src="$1" raw="$2"
  local base=""
  if [[ "$raw" == @/* ]]; then
    base="${raw#@/}"
  elif [[ "$raw" == ./* || "$raw" == ../* ]]; then
    base=$(cd "$(dirname "$src")" 2>/dev/null && cd "$(dirname "$raw")" 2>/dev/null && pwd 2>/dev/null)
    if [[ -n "$base" ]]; then
      base="${base#$REPO_ROOT/}/$(basename "$raw")"
    else
      return 1
    fi
  else
    return 1   # third-party (react, next, etc.)
  fi
  for ext in .tsx .ts /index.tsx /index.ts; do
    if [[ -f "$REPO_ROOT/${base}${ext}" ]]; then
      echo "${base}${ext}"
      return 0
    fi
  done
  return 1
}

# Walk TS imports.
echo "▶ parsing TS imports…" >&2
while IFS= read -r f; do
  # Grep `from "..."` and `from '...'` — fast, line-oriented.
  while IFS= read -r raw; do
    [[ -z "$raw" ]] && continue
    resolved=$(resolve_ts_import "$f" "$raw") || continue
    [[ "$resolved" == "$f" ]] && continue
    emit_edge "$f" "$resolved" "import"
  done < <(grep -oE 'from[[:space:]]+["'\''][^"'\'']+["'\'']' "$f" 2>/dev/null \
            | sed -E 's/from[[:space:]]+["'\'']([^"'\'']+)["'\'']/\1/')
done < "$TS_FILES"

# ─── 2. Go nodes + import edges ──────────────────────────────────────────────
echo "▶ walking Go files…" >&2

GO_FILES="$TMP_DIR/go_files.txt"
find backend -type f -name "*.go" \
  -not -path "*/vendor/*" \
  -not -name "*_test.go" \
  | sort > "$GO_FILES"

GO_COUNT=$(wc -l < "$GO_FILES" | tr -d ' ')
echo "  $GO_COUNT Go files" >&2

# Emit nodes.
while IFS= read -r f; do
  folder=$(dirname "$f")
  emit_node "$f" "backend" "$folder" "$(go_layer "$f")"
done < "$GO_FILES"

# Build module-prefix → relpath map. The module name lives in backend/go.mod.
MOD_NAME=$(grep -m1 '^module ' backend/go.mod 2>/dev/null | awk '{print $2}')
echo "  module = $MOD_NAME" >&2

# For Go imports, we emit ONE edge per (src file → target package's first file
# we can find). Granular file-level Go imports require AST parsing; this is
# a fair approximation for the visual.
echo "▶ parsing Go imports…" >&2
while IFS= read -r f; do
  # Extract import paths between `import (` and `)`, OR single-line `import "..."`.
  awk '
    /^import \(/ { in_block=1; next }
    in_block && /^\)/ { in_block=0; next }
    in_block { print }
    /^import "/ { print }
  ' "$f" 2>/dev/null \
    | grep -oE '"[^"]+"' \
    | tr -d '"' \
    | while IFS= read -r imp; do
        [[ -z "$imp" ]] && continue
        [[ "$imp" != "$MOD_NAME/"* ]] && continue
        rel="backend/${imp#$MOD_NAME/}"
        # Pick the first .go file in that dir (alphabetical).
        target=$(find "$rel" -maxdepth 1 -name "*.go" -not -name "*_test.go" 2>/dev/null | sort | head -1)
        [[ -z "$target" ]] && continue
        [[ "$target" == "$f" ]] && continue
        emit_edge "$f" "$target" "import"
      done
done < "$GO_FILES"

# ─── 3. Bridge edges: TS apiSite/apiV2/apiRoot → Go ──────────────────────────
echo "▶ tracing bridge edges (TS → Go)…" >&2

# For v1, every bridge edge points at backend/cmd/server/main.go. Resolving
# the exact handler from a path literal needs stateful route-table parsing;
# that's a v2 enhancement. Honest now > fake-precise later.
MAIN_GO="backend/cmd/server/main.go"
BRIDGE_COUNT=0
while IFS= read -r f; do
  # Match: apiSite("…"), apiV2('…'), apiRoot(`…`)
  if grep -qE 'api(Site|V2|Root)[[:space:]]*\(' "$f" 2>/dev/null; then
    emit_edge "$f" "$MAIN_GO" "bridge"
    BRIDGE_COUNT=$((BRIDGE_COUNT + 1))
  fi
done < "$TS_FILES"

# Also catch raw `fetch("/api/...")` to shadow handlers under app/api/dev/.
echo "▶ tracing shadow-handler bridges (fetch → app/api/dev)…" >&2
while IFS= read -r f; do
  while IFS= read -r path; do
    [[ -z "$path" ]] && continue
    # /api/dev/foo → app/api/dev/foo/route.ts
    candidate="app${path#/api}/route.ts"
    if [[ -f "$REPO_ROOT/$candidate" && "$candidate" != "$f" ]]; then
      emit_edge "$f" "$candidate" "bridge"
      BRIDGE_COUNT=$((BRIDGE_COUNT + 1))
    fi
  done < <(grep -oE 'fetch\([[:space:]]*[`"'\''](/api/[a-zA-Z0-9_/-]+)' "$f" 2>/dev/null \
            | sed -E 's/.*[`"'\''](\/api\/[a-zA-Z0-9_\/-]+).*/\1/' \
            | sort -u)
done < "$TS_FILES"

# ─── 4. Stitch into final JSON ───────────────────────────────────────────────
echo "▶ stitching JSON…" >&2

IMPORT_EDGES=$(grep -c '"kind":"import"' "$EDGES" || true)
TOTAL_NODES=$(wc -l < "$NODES" | tr -d ' ')
TOTAL_EDGES=$(wc -l < "$EDGES" | tr -d ' ')

mkdir -p "$(dirname "$OUT")"

jq -n \
  --arg gen "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --argjson ts "$TS_COUNT" \
  --argjson go "$GO_COUNT" \
  --argjson ie "$IMPORT_EDGES" \
  --argjson be "$BRIDGE_COUNT" \
  --slurpfile nodes "$NODES" \
  --slurpfile edges "$EDGES" \
  '{
    generated_at: $gen,
    stats: { ts_files: $ts, go_files: $go, import_edges: $ie, bridge_edges: $be },
    nodes: $nodes,
    edges: $edges
  }' > "$OUT"

echo "" >&2
echo "✓ Code-graph written to $OUT" >&2
echo "  Nodes: $TOTAL_NODES  (TS: $TS_COUNT  Go: $GO_COUNT)" >&2
echo "  Edges: $TOTAL_EDGES  (import: $IMPORT_EDGES  bridge: $BRIDGE_COUNT)" >&2
