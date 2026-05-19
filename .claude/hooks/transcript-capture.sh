#!/usr/bin/env bash
# Stop hook — captures a one-line summary of the final assistant turn to
# context/transcripts/{YYYY-MM-DD}.md. Fire-and-forget; never fails the session.
#
# Claude Code Stop-hook payload (stdin JSON):
#   { "session_id": "...", "transcript_path": "/Users/.../sessions/<id>.jsonl",
#     "cwd": "...", "stop_hook_active": true|false }
#
# We read the last `type:"assistant"` line from the transcript JSONL and
# slice its first text block to ~500 chars.

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

# Extract last assistant message's first text block, slice to 500 chars,
# collapse whitespace. Silent on failure.
SUMMARY="$(/usr/bin/python3 - "$TRANSCRIPT_PATH" <<'PY' 2>/dev/null
import json, sys, re
path = sys.argv[1]
last = None
with open(path) as f:
    for line in f:
        line = line.strip()
        if not line: continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("type") == "assistant":
            msg = obj.get("message", {})
            content = msg.get("content", [])
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    txt = block.get("text", "").strip()
                    if txt:
                        last = txt
                        break
text = last or ""
text = re.sub(r"\s+", " ", text)[:500]
print(text)
PY
)"

[ -z "$SUMMARY" ] && exit 0

{
    printf '\n## %s — %s\n' "$TIME" "${SESSION_ID:0:8}"
    printf '%s\n' "$SUMMARY"
} >> "$OUT_FILE"

exit 0
