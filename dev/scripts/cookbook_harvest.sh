#!/usr/bin/env bash
# cookbook_harvest.sh — pull novel psql queries from ~/.psql_history into staging.
# Invoked by the <cookbook> command. See .claude/commands/c_cookbook.md.
#
# Flags:
#   (no flags)   harvest new queries into staging, update marker
#   -s           dry-run: print what would be harvested, no writes, no marker update
#   -r           reset marker (re-scan entire history)
#
# Marker: ~/.claude/cookbook_last_harvest stores the byte-offset of psql history
#         at last harvest. We grow only — never re-emit older lines.

set -euo pipefail

PSQL_HISTORY="${PSQL_HISTORY:-$HOME/.psql_history}"
MARKER="$HOME/.claude/cookbook_last_harvest"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGING="$REPO_ROOT/docs/c_sql_cookbook_staging.md"
COOKBOOK="$REPO_ROOT/docs/c_sql_cookbook.md"

DRY_RUN=0
RESET=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        -s) DRY_RUN=1 ;;
        -r) RESET=1 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
    shift
done

if [[ ! -f "$PSQL_HISTORY" ]]; then
    echo "no ~/.psql_history yet — run some psql queries first, then rerun"
    exit 0
fi

# -r: clear the marker so we re-scan everything
if [[ "$RESET" == "1" ]]; then
    rm -f "$MARKER"
    echo "marker cleared — next harvest will scan entire history"
    [[ "$DRY_RUN" == "1" ]] && exit 0
fi

# Determine the byte-offset to start reading from
LAST_OFFSET=0
if [[ -f "$MARKER" ]]; then
    LAST_OFFSET=$(cat "$MARKER")
fi

CURRENT_SIZE=$(wc -c < "$PSQL_HISTORY" | tr -d ' ')

if [[ "$LAST_OFFSET" -ge "$CURRENT_SIZE" ]]; then
    echo "nothing new since last harvest (marker: $LAST_OFFSET, size: $CURRENT_SIZE)"
    exit 0
fi

# Slice the new bytes
NEW_BYTES=$((CURRENT_SIZE - LAST_OFFSET))
RAW_NEW=$(tail -c "$NEW_BYTES" "$PSQL_HISTORY")

# Filter: skip trivial queries
# - psql meta-commands alone: \d, \dt, \q, \?, \l, \du, etc.
# - SELECT 1, SELECT NOW(), SELECT version()
# - lines shorter than 20 chars (after trim)
# - empty lines, comment lines
FILTERED=$(printf '%s\n' "$RAW_NEW" | awk '
    {
        line = $0
        gsub(/^[ \t]+|[ \t]+$/, "", line)
        if (length(line) == 0) next
        if (length(line) < 20) next
        if (line ~ /^--/) next
        if (line ~ /^\\[a-z?+]+[a-zA-Z0-9_+ ]*$/) next
        if (tolower(line) ~ /^select 1;?$/) next
        if (tolower(line) ~ /^select now\(\);?$/) next
        if (tolower(line) ~ /^select version\(\);?$/) next
        print line
    }
')

if [[ -z "$FILTERED" ]]; then
    echo "harvest complete — 0 novel queries (filtered all trivial)"
    if [[ "$DRY_RUN" == "0" ]]; then
        echo "$CURRENT_SIZE" > "$MARKER"
    fi
    exit 0
fi

# De-dupe against staging + main cookbook
EXISTING=""
[[ -f "$STAGING" ]] && EXISTING+=$(cat "$STAGING")$'\n'
[[ -f "$COOKBOOK" ]] && EXISTING+=$(cat "$COOKBOOK")$'\n'

NOVEL=""
while IFS= read -r query; do
    [[ -z "$query" ]] && continue
    if ! grep -qF "$query" <<< "$EXISTING"; then
        NOVEL+="$query"$'\n'
    fi
done <<< "$FILTERED"

if [[ -z "${NOVEL// }" ]]; then
    echo "harvest complete — 0 novel queries (all dupes of existing entries)"
    if [[ "$DRY_RUN" == "0" ]]; then
        echo "$CURRENT_SIZE" > "$MARKER"
    fi
    exit 0
fi

COUNT=$(printf '%s' "$NOVEL" | grep -c . || true)

if [[ "$DRY_RUN" == "1" ]]; then
    echo "=== DRY-RUN — would harvest $COUNT novel queries ==="
    printf '%s' "$NOVEL"
    echo "=== END ==="
    echo "(marker not updated; run without -s to commit)"
    exit 0
fi

# Append to staging with a timestamp header
mkdir -p "$(dirname "$STAGING")"

# Write preamble BEFORE the append block, otherwise the redirect creates the
# file first and the existence check inside the block sees it.
if [[ ! -f "$STAGING" ]]; then
    cat > "$STAGING" <<'EOF'
# SQL Cookbook — Staging

Raw psql queries harvested from ~/.psql_history by `<cookbook>`. Each batch is timestamped.

**These are NOT cookbook entries yet** — they're drafts. Run `<cookbook> -c` to curate:
read each query, identify DB+pool+use-case+gotcha, write a proper entry into
[`c_sql_cookbook.md`](c_sql_cookbook.md), then remove from this file.

---
EOF
fi

{
    echo ""
    echo "## Batch — $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""
    echo '```sql'
    printf '%s' "$NOVEL"
    echo '```'
} >> "$STAGING"

echo "$CURRENT_SIZE" > "$MARKER"
echo "harvested $COUNT novel queries → $STAGING"
echo "next: run \`<cookbook> -c\` to curate them into the main cookbook"
