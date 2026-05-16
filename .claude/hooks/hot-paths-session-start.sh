#!/usr/bin/env bash
# SessionStart hook — emits a "hot paths" digest as additionalContext.
# Tells Claude WHERE work has been happening so it can skip blind <search>.
#
# Two blocks:
#   1. Files touched in last 10 commits (top 25, deduped, sorted by recency)
#   2. Currently dirty files (git status --short)
#
# Filenames only — no contents — keeps the digest under ~500 tokens.
# Silent exit if not in a git repo.

set -u

PROJECT_ROOT="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
cd "$PROJECT_ROOT" 2>/dev/null || exit 0

# Bail if not a git repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Files touched in last 10 commits, ordered by recency, deduped, capped at 25.
RECENT_FILES=$(git log --name-only --pretty=format: -10 2>/dev/null \
  | awk 'NF && !seen[$0]++' \
  | head -25)

# Currently dirty (modified/untracked), short form
DIRTY=$(git status --short 2>/dev/null | head -25)

MSG=""
if [[ -n "$RECENT_FILES" ]]; then
  MSG="**Hot paths — files touched in last 10 commits:**"$'\n'
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    MSG+="- $f"$'\n'
  done <<< "$RECENT_FILES"
fi

if [[ -n "$DIRTY" ]]; then
  [[ -n "$MSG" ]] && MSG+=$'\n'
  MSG+="**Currently dirty (uncommitted):**"$'\n'
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    MSG+="- $line"$'\n'
  done <<< "$DIRTY"
fi

if [[ -n "$MSG" ]]; then
  MSG+=$'\n'"_Use this to locate the right area before reaching for \`<search>\`. \`Grep\`/\`Glob\` direct from these paths is sub-second._"
fi

[[ -z "$MSG" ]] && exit 0

CONTEXT=$(printf '%s' "$MSG" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))' 2>/dev/null || printf '"Hot paths digest unavailable"')

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":%s}}\n' "$CONTEXT"
exit 0
