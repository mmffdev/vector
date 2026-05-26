#!/usr/bin/env bash
# Stop hook — appends the most recent user prompt + full assistant turn
# (all text blocks concatenated) to context/transcripts/{YYYY-MM-DD}.md.
# Fire-and-forget; never fails the session.
#
# Claude Code Stop-hook payload (stdin JSON):
#   { "session_id": "...", "transcript_path": "/Users/.../sessions/<id>.jsonl",
#     "cwd": "...", "stop_hook_active": true|false }
#
# Purpose: feed the L3 (raw) retrieval tier in CLAUDE.md with unsummarised
# dialogue. The full turn (not a 500-char slice) is what makes <index>
# semantic-search useful — short summaries hit nothing.

set -u
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
OUT_DIR="$PROJECT_DIR/context/transcripts"
mkdir -p "$OUT_DIR" 2>/dev/null

INPUT="$(cat)"
TRANSCRIPT_PATH="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("transcript_path",""))' 2>/dev/null)"
SESSION_ID="$(printf '%s' "$INPUT" | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("session_id",""))' 2>/dev/null)"

[ -z "$TRANSCRIPT_PATH" ] && exit 0
[ ! -f "$TRANSCRIPT_PATH" ] && exit 0

TODAY="$(date +%Y-%m-%d)"
TIME="$(date +%H:%M:%S)"
OUT_FILE="$OUT_DIR/$TODAY.md"

# Extract last user prompt + full assistant turn (all text blocks joined).
# Outputs two lines separated by a sentinel; bash splits them.
PAYLOAD="$(/usr/bin/python3 - "$TRANSCRIPT_PATH" <<'PY' 2>/dev/null
import json, sys
path = sys.argv[1]
last_user = None
last_asst_blocks = []
last_asst_open = False
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        t = obj.get("type")
        msg = obj.get("message", {})
        content = msg.get("content", [])
        if t == "user":
            # capture user text; skip tool_result-only messages
            texts = []
            if isinstance(content, str):
                texts.append(content)
            elif isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "text":
                        texts.append(b.get("text", ""))
                    elif isinstance(b, str):
                        texts.append(b)
            joined = "\n".join(t for t in texts if t).strip()
            if joined:
                last_user = joined
                last_asst_blocks = []  # reset; new turn begins
                last_asst_open = True
        elif t == "assistant" and last_asst_open:
            if isinstance(content, list):
                for b in content:
                    if isinstance(b, dict) and b.get("type") == "text":
                        txt = b.get("text", "").strip()
                        if txt:
                            last_asst_blocks.append(txt)
user_out = last_user or ""
asst_out = "\n\n".join(last_asst_blocks).strip()
# Cap each at 8 KB to keep transcript files bounded.
user_out = user_out[:8000]
asst_out = asst_out[:8000]
print(user_out)
print("---ASST---")
print(asst_out)
PY
)"

[ -z "$PAYLOAD" ] && exit 0

USER_MSG="$(printf '%s' "$PAYLOAD" | awk 'BEGIN{p=1} /^---ASST---$/{p=0; next} p')"
ASST_MSG="$(printf '%s' "$PAYLOAD" | awk 'BEGIN{p=0} /^---ASST---$/{p=1; next} p')"

[ -z "$ASST_MSG" ] && exit 0

{
    printf '\n---\n## %s — %s\n\n' "$TIME" "${SESSION_ID:0:8}"
    if [ -n "$USER_MSG" ]; then
        printf '### User\n\n%s\n\n' "$USER_MSG"
    fi
    printf '### Assistant\n\n%s\n' "$ASST_MSG"
} >> "$OUT_FILE"

exit 0
