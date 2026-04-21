#!/usr/bin/env bash
# Channel B — Claude Code PreToolUse hook (Bash matcher).
# Reads tool-use JSON on stdin; fires backup-on-push.sh only for `git push`.
# Emits hookSpecificOutput.additionalContext so the main agent can narrate.
# Never blocks the tool call — always exits 0.

set -u

PROJECT_ROOT="/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"
SCRIPT="$PROJECT_ROOT/dev/scripts/backup-on-push.sh"

INPUT=$(cat)

# Extract tool_input.command. Prefer jq; fallback to python3.
CMD=""
if command -v jq >/dev/null 2>&1; then
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || true)
else
  CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("tool_input",{}).get("command","") or "")
except Exception: print("")' 2>/dev/null || true)
fi

# Match `git push` at word boundary (ignore leading whitespace, common prefixes like `env FOO=1 git push`).
if ! printf '%s' "$CMD" | grep -Eq '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  exit 0
fi

if [[ ! -x "$SCRIPT" ]]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"backup-on-push: script missing at %s"}}\n' "$SCRIPT"
  exit 0
fi

SHA=$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)

OUTPUT=$("$SCRIPT" --channel claude --sha "$SHA" 2>&1 || true)
# Escape for JSON via python3 (jq would also work; python3 is on every macOS).
CONTEXT=$(printf '%s' "$OUTPUT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))' 2>/dev/null || printf '"backup-on-push: ran"')

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":%s}}\n' "$CONTEXT"
exit 0
