#!/usr/bin/env bash
# UserPromptSubmit hook — runs each time the user sends a prompt.
# Two responsibilities:
#   1. Mark the loop-detector window as having a user message (resets signal #3).
#   2. If /tmp/.claude-retro-loop-trigger exists AND the user did NOT just type
#      <report> -retro, inject a <system-reminder> instructing the agent to
#      invoke `<report> -retro --auto-loop` before any tool use except Read.
#
# The retro flow used to live in its own /retro skill (typed as <r>); it was
# folded into <report> 2026-05-21. The legacy <r>/<retro> aliases are gone.
#
# The harness reads stdout of this hook to inject additionalContext.

set -u

STATE_FILE="/tmp/.claude-retro-loop-state.json"
TRIGGER_FILE="/tmp/.claude-retro-loop-trigger"

# 1. Mark user-message-seen flag in state file (best-effort; silent failure ok)
if [[ -f "$STATE_FILE" ]]; then
    python3 - <<'PY' 2>/dev/null || true
import json
from pathlib import Path
p = Path("/tmp/.claude-retro-loop-state.json")
try:
    s = json.loads(p.read_text())
    s["user_msg_seen"] = True
    p.write_text(json.dumps(s, indent=2))
except Exception:
    pass
PY
fi

# 2. If trigger present, inject the LOOP DETECTED system-reminder
if [[ -f "$TRIGGER_FILE" ]]; then
    PROMPT="${CLAUDE_USER_PROMPT:-}"
    # Skip if user already invoked the retro flow (modern: <report> -retro;
    # legacy aliases kept for muscle memory until the next session clears).
    if [[ "$PROMPT" == *"<report> -retro"* || "$PROMPT" == *"/report -retro"* || "$PROMPT" == *"<r>"* || "$PROMPT" == *"/retro"* ]]; then
        exit 0
    fi
    REMINDER='LOOP DETECTED — the loop-detector hook fired. Five consecutive signals indicate the agent is stuck. Per the LOOP DETECTED HARD RULE in CLAUDE.md, you MUST invoke `<report> -retro --auto-loop` before any further tool use except Read. Do not attempt to "just try one more thing" — that is the trap. Run the retro now.'
    CONTEXT=$(printf '%s' "$REMINDER" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))')
    printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":%s}}\n' "$CONTEXT"
fi
exit 0
