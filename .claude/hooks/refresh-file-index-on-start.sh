#!/usr/bin/env bash
# SessionStart hook — regenerate .claude/c_file_index.md if it's older than 24h.
# Runs in the background so it never blocks session startup.
# Silent — emits no additionalContext.

set -u

PROJECT_ROOT="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
INDEX="$PROJECT_ROOT/.claude/c_file_index.md"
GEN="$PROJECT_ROOT/dev/scripts/gen-file-index.sh"

[[ ! -x "$GEN" ]] && exit 0

# Always emit a valid empty hookSpecificOutput response, then background the work.
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":""}}\n'

# Decide whether to regenerate.
NEED_REGEN=0
if [[ ! -f "$INDEX" ]]; then
  NEED_REGEN=1
else
  # mtime in epoch seconds — portable: try BSD stat first, fall back to GNU.
  if INDEX_MTIME=$(stat -f '%m' "$INDEX" 2>/dev/null); then :;
  else INDEX_MTIME=$(stat -c '%Y' "$INDEX" 2>/dev/null || echo 0); fi
  NOW=$(date +%s)
  AGE=$(( NOW - INDEX_MTIME ))
  # 86400 seconds = 24 hours
  [[ "$AGE" -gt 86400 ]] && NEED_REGEN=1
fi

if [[ "$NEED_REGEN" -eq 1 ]]; then
  ( "$GEN" >/dev/null 2>&1 & disown ) 2>/dev/null
fi

exit 0
