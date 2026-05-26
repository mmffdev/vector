#!/usr/bin/env bash
# SessionStart hook — injects context/USER.md + context/MEMORY.md as
# additionalContext. Daily activity logs are owned by the /remember plugin
# (.remember/now.md + today-*.md) and surfaced via its own SessionStart hook.
# Silent on any failure.

set -u

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector}"
USER_FILE="$PROJECT_ROOT/context/USER.md"
MEM_FILE="$PROJECT_ROOT/context/MEMORY.md"

OUT=""
append() { OUT="${OUT}${1}"; }

append "=== PROJECT MEMORY (frozen snapshot — context/MEMORY.md + USER.md) ==="$'\n\n'

if [[ -f "$USER_FILE" ]]; then
    append "--- context/USER.md ---"$'\n'
    append "$(cat "$USER_FILE")"$'\n\n'
fi

if [[ -f "$MEM_FILE" ]]; then
    append "--- context/MEMORY.md ---"$'\n'
    append "$(cat "$MEM_FILE")"$'\n\n'
fi

[[ -z "$OUT" ]] && exit 0

CONTEXT=$(printf '%s' "$OUT" | /usr/bin/python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))' 2>/dev/null) || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$CONTEXT"
exit 0
