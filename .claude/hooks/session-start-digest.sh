#!/usr/bin/env bash
# SessionStart hook — emits the librarian digest as additionalContext.
# Silent exit when digest is empty.

set -u

PROJECT_ROOT="/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"
DIGEST="$PROJECT_ROOT/dev/scripts/librarian-digest.sh"

[[ ! -x "$DIGEST" ]] && exit 0

OUT=$("$DIGEST" 2>/dev/null || true)
[[ -z "$OUT" ]] && exit 0

CONTEXT=$(printf '%s' "$OUT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))' 2>/dev/null || printf '"Librarian digest unavailable"')

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$CONTEXT"
exit 0
