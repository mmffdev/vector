#!/usr/bin/env bash
# gen-file-index.sh — generate .claude/c_file_index.md, a curated directory map
# of the codebase used by Claude to skip blind <search> fan-outs.
#
# Curated roots: app/ backend/ dev/ db/ docs/
# Excludes: node_modules, .next, dist, build, __pycache__, archive, generated.
#
# Strategy: list every directory that *directly contains* at least one matching
# file. Each row shows count, top-3 most-recently-modified filenames, and a
# Purpose line (preserved across regenerations).

set -u
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"
OUT="$ROOT/.claude/c_file_index.md"
TMP="$(mktemp)"
EXISTING_PURPOSES="$(mktemp)"

# Preserve hand-edited "Purpose:" lines across runs
if [[ -f "$OUT" ]]; then
  awk '
    /^### / { dir = $0; sub(/^### /, "", dir); next }
    /^Purpose: / && dir != "" { print dir "\t" $0 }
  ' "$OUT" > "$EXISTING_PURPOSES"
fi

EXCLUDE_RE='node_modules|/\.next/|/dist/|/build/|__pycache__|/archive/|cgl-volatile-do-not-commit|/backups/|/logs/|/\.git/'

# macOS BSD find vs GNU find: use -E flag for extended regex (works on both via the wrapper).
# Detect at runtime which find we have.
FIND_CMD="find"
if find --version 2>/dev/null | grep -q GNU; then
  FIND_E=(-regextype posix-extended)
else
  FIND_E=()
  FIND_CMD="find -E"  # BSD: -E goes before path
fi

# Wrapper invocation that handles both:
finde() {
  if [[ "$FIND_CMD" == "find -E" ]]; then
    find -E "$@"
  else
    find "${FIND_E[@]}" "$@"
  fi
}

# Sort filenames by mtime (newest first) — portable across BSD/GNU.
sort_by_mtime() {
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    if stat -f '%m %N' "$f" 2>/dev/null; then :; else stat -c '%Y %n' "$f" 2>/dev/null; fi
  done | sort -rn | awk '{$1=""; sub(/^ /, ""); print}'
}

list_dirs() {
  local root="$1" regex="$2"
  finde "$root" -type f -regex "$regex" 2>/dev/null \
    | grep -Ev "$EXCLUDE_RE" \
    | xargs -n1 dirname 2>/dev/null \
    | sort -u
}

emit_section() {
  local heading="$1"
  local root="$2"
  local regex="$3"
  local min_breakout="${4:-1}"   # dirs with fewer files than this get rolled up

  echo "## $heading"
  echo

  local dirs
  dirs=$(list_dirs "$root" "$regex")
  if [[ -z "$dirs" ]]; then
    echo "_(no matches)_"
    echo
    return
  fi

  local rolled_up=""
  local dir count keyfiles purpose
  while IFS= read -r dir; do
    [[ -z "$dir" ]] && continue
    count=$(finde "$dir" -maxdepth 1 -type f -regex "$regex" 2>/dev/null | wc -l | tr -d ' ')
    [[ "$count" -eq 0 ]] && continue

    if [[ "$count" -lt "$min_breakout" ]]; then
      rolled_up+="${dir} "
      continue
    fi

    keyfiles=$(finde "$dir" -maxdepth 1 -type f -regex "$regex" 2>/dev/null \
      | sort_by_mtime | head -3 | xargs -n1 basename 2>/dev/null \
      | tr '\n' ',' | sed 's/,$//' | sed 's/,/, /g')
    keyfiles="${keyfiles:0:90}"
    purpose=$(grep -F "$dir	" "$EXISTING_PURPOSES" 2>/dev/null | head -1 | cut -f2-)
    [[ -z "$purpose" ]] && purpose="Purpose: _(unset)_"

    echo "### $dir"
    echo "$count file(s) · key: $keyfiles"
    echo "$purpose"
    echo
  done <<< "$dirs"

  if [[ -n "$rolled_up" ]]; then
    echo "### _Single-file dirs (rolled up)_"
    echo "$rolled_up" | tr ' ' '\n' | sed '/^$/d' | awk '{print "- " $0}'
    echo
  fi
}

{
  echo "# Codebase File Index (auto-generated)"
  echo
  echo "**Generated:** $(date '+%Y-%m-%d %H:%M:%S')"
  echo "**Generator:** \`dev/scripts/gen-file-index.sh\`"
  echo
  echo "Map of curated source directories. Use this to **locate the right area before reaching for \`<search>\`**."
  echo "\`Grep\`/\`Glob\` direct from here is sub-second; \`<search>\` should be reserved for unknown territory."
  echo
  echo "Hand-edited \`Purpose:\` lines are preserved across regenerations."
  echo

  emit_section "App router & components (TS/TSX)" "app"     '.*\.(ts|tsx)$' 2
  emit_section "Backend Go services"               "backend" '.*\.go$'        1
  emit_section "Dev tooling"                       "dev"     '.*\.(ts|tsx|sh|py)$' 2
  emit_section "Dev fixtures & data"               "dev"     '.*\.(json|sql)$'     3
  emit_section "Database schema"                   "db"      '.*\.sql$'        1
  emit_section "Documentation indexes"             "docs"    '.*\.md$'         1
} > "$TMP"

mv "$TMP" "$OUT"
rm -f "$EXISTING_PURPOSES"

LINES=$(wc -l < "$OUT" | tr -d ' ')
DIRS=$(grep -c '^### ' "$OUT")
echo "Wrote $OUT ($LINES lines, $DIRS dirs)"
