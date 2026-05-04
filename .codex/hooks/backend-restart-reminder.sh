#!/usr/bin/env bash
# PostToolUse hook — fires after Write or Edit touches a backend/ file.
# Reads CLAUDE_TOOL_INPUT from env (JSON with file_path).
# If the file is under backend/, emit an instruction block telling Claude
# to restart the backend process before testing the new code.

FILE_PATH=$(echo "${CLAUDE_TOOL_INPUT:-}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('file_path', d.get('path', '')))
except Exception:
    print('')
" 2>/dev/null)

if [[ "$FILE_PATH" == *"/backend/"* ]]; then
    echo "INSTRUCTION: You just modified a backend file ($FILE_PATH). The Go backend must be restarted before the change takes effect. Run: lsof -ti :5100 | xargs kill -9 2>/dev/null; sleep 1; cd \"\$CLAUDE_PROJECT_DIR/backend\" && go run ./cmd/server &"
fi
