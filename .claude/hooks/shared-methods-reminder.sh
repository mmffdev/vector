#!/usr/bin/env bash
# PostToolUse hook — fires after Write or Edit on a new Next.js route.ts
# or a Go handler.go file. Nudges Claude to consider whether the logic
# being added belongs in app/lib/shared/<domain>/ + backend/internal/shared/<domain>/
# so cross-runtime parity is maintained.
#
# Conservative matcher: only fires when the changed file is under
#   app/api/**/route.ts   OR
#   backend/internal/**/handler.go
# AND the file already exists on disk being edited adds enough volume
# that the logic is non-trivial (size guard avoids noise on tiny stubs).
#
# See: PLA-0045, docs/c_shared_methods.md

FILE_PATH=$(echo "${CLAUDE_TOOL_INPUT:-}" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('file_path', d.get('path', '')))
except Exception:
    print('')
" 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Only match new route handlers
case "$FILE_PATH" in
    *"/app/api/"*"/route.ts"|*"/app/api/"*"/route.tsx") MATCH=ts ;;
    *"/backend/internal/"*"/handler.go") MATCH=go ;;
    *) exit 0 ;;
esac

# Skip noise on tiny files (< 30 lines = likely a stub or one-liner re-export)
if [ -f "$FILE_PATH" ]; then
    LINES=$(wc -l < "$FILE_PATH" 2>/dev/null || echo 0)
    if [ "$LINES" -lt 30 ]; then
        exit 0
    fi
fi

cat <<EOF
SHARED_METHODS_REMINDER: You just touched a handler file ($FILE_PATH).

Does the core logic in this handler need to produce IDENTICAL output in:
  • the BFF (\`/_site\` Next.js Route Handler), AND
  • the public Go API (\`/samantha/v2\`), AND/OR
  • a frontend React consumer?

If two or more of those are yes, the logic belongs in:
  • TS:    \`app/lib/shared/<domain>/<method>.ts\`
  • Go:    \`backend/internal/shared/<domain>/<method>.go\`
  • Tests: \`dev/fixtures/shared/<domain>/<method>.golden.json\` (parity fixture)

Then catalogue it in \`docs/c_shared_methods.md\`. The handler becomes a thin
orchestrator that does I/O + calls the shared core.

If only one surface needs the logic, ignore this reminder — single-surface
code does NOT belong in \`shared/\`.
EOF
