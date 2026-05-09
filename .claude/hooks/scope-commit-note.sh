#!/usr/bin/env bash
# PostToolUse hook — fires after a Bash git commit.
# Maps the commit to scope item(s) in Vector_Scope.md and appends a note.
#
# Matching priority:
#   1. Explicit ref tag in commit message: [1.4] or [1.4, 8.2]
#   2. scope-refs.map — keyword lookup registered when -a added the item
#   3. File-path heuristics — fallback keyword map from changed file paths
#
# Unmatched commits go to ## Unmatched Commits section at the bottom.

set -u

SCOPE_FILE="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/Vector_Scope.md"
REFS_MAP="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/.claude/scope-refs.map"

[[ ! -f "$SCOPE_FILE" ]] && exit 0

# Only fire on git commit commands
INPUT=$(cat)
TOOL_INPUT=$(printf '%s' "$INPUT" | python3 -c '
import json,sys
try:
  d = json.loads(sys.stdin.read())
  print(d.get("tool_input", {}).get("command", ""))
except Exception:
  print("")
' 2>/dev/null || true)

case "$TOOL_INPUT" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# Get commit details
COMMIT_HASH=$(git -C "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" log --oneline -1 --no-merges 2>/dev/null | awk '{print $1}' || true)
COMMIT_MSG=$(git -C "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" log --format="%s" -1 2>/dev/null || true)
COMMIT_DATE=$(date +%Y-%m-%d)
CHANGED_FILES=$(git -C "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" diff-tree --no-commit-id -r --name-only HEAD 2>/dev/null || true)

# Strip self-references: Vector_Scope.md is the hook's destination, never a
# source signal. Likewise scope-refs.map (the keyword catalogue) — without
# this, every commit that touches either file matches its own keywords and
# the hook annotates itself in an infinite loop.
CHANGED_FILES=$(printf '%s\n' "$CHANGED_FILES" | grep -vE '^(Vector_Scope\.md|\.claude/scope-refs\.map)$' || true)

[[ -z "$COMMIT_HASH" || -z "$COMMIT_MSG" ]] && exit 0

NOTE="> Commit \`${COMMIT_HASH}\` (${COMMIT_DATE}): ${COMMIT_MSG}"

# ── Priority 1: explicit ref tag in commit message ────────────────────────────
# Accepts numeric (1.4) and letter-prefixed (B19.1.4, M3.1.1) refs.
EXPLICIT_REFS=$(printf '%s' "$COMMIT_MSG" | grep -oE '\[([A-Z]?[0-9]+\.[0-9.]+)(,\s*[A-Z]?[0-9]+\.[0-9.]+)*\]' | tr -d '[]' | tr ',' '\n' | tr -d ' ' || true)

# ── Priority 2: scope-refs.map lookup ─────────────────────────────────────────
MAP_KEYWORDS=""
if [[ -f "$REFS_MAP" ]]; then
  # Each line: REF<tab>keyword keyword keyword
  while IFS=$'\t' read -r ref kws; do
    [[ -z "$ref" ]] && continue
    # Check if any map keyword appears in commit msg or changed files
    for kw in $kws; do
      if echo "$COMMIT_MSG $CHANGED_FILES" | grep -qi "$kw"; then
        MAP_KEYWORDS="$MAP_KEYWORDS __MAPREF__${ref}"
        break
      fi
    done
  done < "$REFS_MAP"
fi

# ── Priority 3: file-path heuristic keywords ──────────────────────────────────
FILE_KEYWORDS=""
echo "$CHANGED_FILES" | grep -q "timeboxsprints\|sprint"        && FILE_KEYWORDS="$FILE_KEYWORDS sprint timebox"
echo "$CHANGED_FILES" | grep -q "workitems\|work.item\|artefact" && FILE_KEYWORDS="$FILE_KEYWORDS work item artefact"
echo "$CHANGED_FILES" | grep -q "searchworker\|search"           && FILE_KEYWORDS="$FILE_KEYWORDS search"
echo "$CHANGED_FILES" | grep -q "webhook"                        && FILE_KEYWORDS="$FILE_KEYWORDS webhook"
echo "$CHANGED_FILES" | grep -q "apikeys\|api.key\|api_key"      && FILE_KEYWORDS="$FILE_KEYWORDS api key"
echo "$CHANGED_FILES" | grep -q "ranking\|rank"                  && FILE_KEYWORDS="$FILE_KEYWORDS rank"
echo "$CHANGED_FILES" | grep -q "roles\|permissions\|rbac"       && FILE_KEYWORDS="$FILE_KEYWORDS role permission"
echo "$CHANGED_FILES" | grep -q "topology\|orgdesign\|org.node"  && FILE_KEYWORDS="$FILE_KEYWORDS topology"
echo "$CHANGED_FILES" | grep -q "fields\|custom.field"           && FILE_KEYWORDS="$FILE_KEYWORDS custom field"
echo "$CHANGED_FILES" | grep -q "portfolio\|master.record"       && FILE_KEYWORDS="$FILE_KEYWORDS portfolio"
echo "$CHANGED_FILES" | grep -q "library\|librarydb"             && FILE_KEYWORDS="$FILE_KEYWORDS library"
echo "$CHANGED_FILES" | grep -q "addressables\|page.help"        && FILE_KEYWORDS="$FILE_KEYWORDS addressable"
echo "$CHANGED_FILES" | grep -q "ratelimit\|rate.limit"          && FILE_KEYWORDS="$FILE_KEYWORDS rate limit"
echo "$CHANGED_FILES" | grep -q "auth\|jwt\|token"               && FILE_KEYWORDS="$FILE_KEYWORDS auth jwt"
echo "$CHANGED_FILES" | grep -q "ResourceTree\|WorkItemsTree"    && FILE_KEYWORDS="$FILE_KEYWORDS ResourceTree tree"
echo "$CHANGED_FILES" | grep -q "Table\.tsx\|table"              && FILE_KEYWORDS="$FILE_KEYWORDS Table"
echo "$CHANGED_FILES" | grep -q "TimeboxManager\|timebox"        && FILE_KEYWORDS="$FILE_KEYWORDS timebox"

# Combine all signals for the Python resolver
ALL_KEYWORDS="$FILE_KEYWORDS $COMMIT_MSG"

python3 - "$SCOPE_FILE" "$NOTE" "$ALL_KEYWORDS" "$EXPLICIT_REFS" "$MAP_KEYWORDS" <<'PYEOF'
import sys, re

scope_file    = sys.argv[1]
note          = sys.argv[2]
kw_string     = sys.argv[3].lower()
explicit_refs = [r.strip() for r in sys.argv[4].split('\n') if r.strip()]
map_refs_raw  = sys.argv[5]  # space-separated __MAPREF__X.Y tokens

# Parse map refs
map_refs = [t.replace("__MAPREF__", "") for t in map_refs_raw.split() if t.startswith("__MAPREF__")]

keywords = kw_string.split()

with open(scope_file, "r") as f:
    lines = f.readlines()

ref_pattern = re.compile(r"^-\s+(?:[✅\U0001F535⚠❌️]\s*)*\*\*([A-Z]?\d[\d.]*)\*\*\s+(.*)")

# Build full ref->line index
ref_index = {}
for i, line in enumerate(lines):
    m = ref_pattern.match(line)
    if m:
        ref_index[m.group(1)] = i

matches = []  # list of (ref, line_index)

# Priority 1: explicit refs from commit message tags
for ref in explicit_refs:
    if ref in ref_index:
        matches.append((ref, ref_index[ref]))

# Priority 2: map refs
if not matches:
    for ref in map_refs:
        if ref in ref_index:
            matches.append((ref, ref_index[ref]))

# Priority 3 removed — fuzzy keyword scan against item text was too greedy
# (matched 10+ items per commit on common words like "v1", "API", "spec").
# Falls through to "## Unmatched Commits" when explicit refs and map both miss.
# User reconciles via `<scope> -r`.

if not matches:
    # Unmatched — append to section
    target_line = None
    for i, line in enumerate(lines):
        if line.strip() == "## Unmatched Commits":
            target_line = i
            break
    if target_line is None:
        lines.append("\n## Unmatched Commits\n\n")
        target_line = len(lines) - 1
    # Drop "_(none)_" placeholder if present anywhere in the section
    lines = [l for l in lines if l.strip() != "_(none)_"]
    # Re-locate target after potential placeholder strip
    for i, line in enumerate(lines):
        if line.strip() == "## Unmatched Commits":
            target_line = i
            break
    lines.insert(target_line + 2, note + "\n")
    with open(scope_file, "w") as f:
        f.writelines(lines)
    sys.exit(1)

# Insert note after each matched item, skipping existing > lines
offset = 0
seen = set()
for ref, idx in matches:
    if ref in seen:
        continue
    seen.add(ref)
    insert_at = idx + 1 + offset
    while insert_at < len(lines) and lines[insert_at].startswith(">"):
        insert_at += 1
    lines.insert(insert_at, note + "\n")
    offset += 1

with open(scope_file, "w") as f:
    f.writelines(lines)

sys.exit(0)
PYEOF

EXIT=$?

if [[ $EXIT -ne 0 ]]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Scope: commit %s (%s) had no matching scope item — added to Unmatched Commits section. Review with <scope> -r."}}\n' \
    "$COMMIT_HASH" "$COMMIT_MSG"
fi

exit 0
