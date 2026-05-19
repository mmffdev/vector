#!/usr/bin/env bash
# SessionStart hook — injects context/USER.md + context/MEMORY.md + today's
# daily log (or yesterday's if today is empty) as additionalContext. Silent
# on any failure.

set -u

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector}"
USER_FILE="$PROJECT_ROOT/context/USER.md"
MEM_FILE="$PROJECT_ROOT/context/MEMORY.md"
DAILY_DIR="$PROJECT_ROOT/context/memory"

TODAY="$(date +%Y-%m-%d)"
YDAY="$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d 'yesterday' +%Y-%m-%d 2>/dev/null)"

OUT=""
append() { OUT="${OUT}${1}"; }

append "=== MEMORY (frozen snapshot — context/MEMORY.md + USER.md) ==="$'\n\n'

if [[ -f "$USER_FILE" ]]; then
    append "--- context/USER.md ---"$'\n'
    append "$(cat "$USER_FILE")"$'\n\n'
fi

if [[ -f "$MEM_FILE" ]]; then
    append "--- context/MEMORY.md ---"$'\n'
    append "$(cat "$MEM_FILE")"$'\n\n'
fi

TODAY_LOG="$DAILY_DIR/$TODAY.md"
YDAY_LOG="$DAILY_DIR/$YDAY.md"
if [[ -s "$TODAY_LOG" ]]; then
    append "--- context/memory/$TODAY.md (today) ---"$'\n'
    append "$(cat "$TODAY_LOG")"$'\n\n'
elif [[ -s "$YDAY_LOG" ]]; then
    append "--- context/memory/$YDAY.md (yesterday — today empty) ---"$'\n'
    append "$(cat "$YDAY_LOG")"$'\n\n'
fi

[[ -z "$OUT" ]] && exit 0

CONTEXT=$(printf '%s' "$OUT" | /usr/bin/python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))' 2>/dev/null) || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$CONTEXT"
exit 0
