#!/usr/bin/env bash
# PreToolUse hook — blocks any Write or Edit to boot*.md files in the
# memory directory unless the explicit user command <b> -N -C has set
# the authorisation flag /tmp/boot-write-authorized first.
#
# No flag = hard block. Always. No agent may autonomously write these files.
# The c_boot skill sets /tmp/boot-write-authorized before each write call,
# then this hook consumes and deletes the flag (one-shot per write).

set -u

MEMORY_DIR="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/.claude/memory"
FLAG="/tmp/boot-write-authorized"

INPUT=$(cat)

# Extract file_path from tool input (Write and Edit both use file_path).
FILE_PATH=""
if command -v jq >/dev/null 2>&1; then
  FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null || true)
else
  FILE_PATH=$(printf '%s' "$INPUT" | python3 -c '
import json, sys
try: print(json.loads(sys.stdin.read()).get("tool_input", {}).get("file_path", "") or "")
except Exception: print("")
' 2>/dev/null || true)
fi

# Not a file write we care about.
[ -z "$FILE_PATH" ] && exit 0

# Normalise to absolute path.
case "$FILE_PATH" in
  /*) ABS="$FILE_PATH" ;;
  *)  ABS="$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd)/$(basename "$FILE_PATH")" ;;
esac

# Only intercept files inside the memory directory named boot*.md.
case "$ABS" in
  "$MEMORY_DIR"/boot*.md) ;;
  *) exit 0 ;;
esac

# Boot file targeted. Check for the authorisation flag.
if [ -f "$FLAG" ]; then
  rm -f "$FLAG"
  exit 0   # Authorised by explicit <b> -N -C command — allow.
fi

# No flag — block unconditionally.
BASENAME=$(basename "$ABS")
printf '{"decision":"block","reason":"BOOT FILE GUARD: %s is agent-owned and cannot be written without an explicit <b> -N -C user command. No authorisation flag found at %s. If you intended to write a boot file, the user must type the command directly."}\n' \
  "$BASENAME" "$FLAG"
exit 2
