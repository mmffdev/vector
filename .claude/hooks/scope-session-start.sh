#!/usr/bin/env bash
# SessionStart hook — emits a scope digest as additionalContext.
# Counts in-flight items, unprioritised items, and surfaces last 3
# scope-matched commits. Silent exit if scope file is missing.

set -u

SCOPE_FILE="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/Vector_Scope.md"

[[ ! -f "$SCOPE_FILE" ]] && exit 0

# Count in-flight items
IN_FLIGHT=$(grep -c "IN FLIGHT" "$SCOPE_FILE" 2>/dev/null || true)
IN_FLIGHT=$(( IN_FLIGHT + 0 ))

# Count items with no priority marker (lines starting with - ** that lack [Pn])
TOTAL_ITEMS=$(grep -cE "^\- \*\*[0-9]" "$SCOPE_FILE" 2>/dev/null || true)
PRIORITY_ITEMS=$(grep -E "^\- \*\*[0-9]" "$SCOPE_FILE" 2>/dev/null | grep -cE "\[P[1-5]\]" 2>/dev/null || true)
TOTAL_ITEMS=$(( TOTAL_ITEMS + 0 ))
PRIORITY_ITEMS=$(( PRIORITY_ITEMS + 0 ))
NO_PRIORITY=$(( TOTAL_ITEMS - PRIORITY_ITEMS ))

# Last 3 commits that touched scope-adjacent files (heuristic: any non-hook, non-doc commit)
RECENT=$(git -C "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" log --oneline -5 --no-merges 2>/dev/null | head -3 || true)

# Build message
MSG=""
if [[ "${IN_FLIGHT:-0}" -gt 0 ]]; then
  MSG="${IN_FLIGHT} item(s) currently IN FLIGHT in Vector_Scope.md."
fi
if [[ "${NO_PRIORITY:-0}" -gt 0 ]]; then
  [[ -n "$MSG" ]] && MSG="$MSG "
  MSG="${MSG}${NO_PRIORITY} item(s) have no priority set."
fi
if [[ -n "$RECENT" ]]; then
  [[ -n "$MSG" ]] && MSG="$MSG Recent commits: $(echo "$RECENT" | tr '\n' ' | ')."
fi
[[ -n "$MSG" ]] && MSG="$MSG Run \`<scope> -r\` to review."

[[ -z "$MSG" ]] && MSG="Vector_Scope.md loaded. Run \`<scope> -r\` to review scope."

CONTEXT=$(printf '%s' "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))' 2>/dev/null || printf '"Scope digest unavailable"')

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$CONTEXT"
exit 0
