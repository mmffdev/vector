#!/usr/bin/env bash
# PreToolUse hook — refuses Edit/Write/MultiEdit on non-dev backend env
# files. Mechanical enforcement of the HARD RULE in .claude/CLAUDE.md
# that pins the active backend env to `dev`. The launcher has already
# flipped the marker once in production (2026-05-05 reversion); this
# hook makes the rule unforgettable.
#
# Blocked paths (any Edit/Write attempt → exit 2, surfaced to Claude):
#   backend/.env.staging
#   backend/.env.staging.locked
#   backend/.env.staging.*    (future-proof: any rotated variant)
#   backend/.env.production
#   backend/.env.production.locked
#   backend/.env.production.*
#
# Allowed (silent): backend/.env.dev, .env.local, .env.example, plus
# everything outside backend/.env.*. Reading these files is fine —
# this hook only matches mutating tools.
#
# To recover from a flipped marker, the user (not Claude) must touch
# the dev env file; this hook does not interfere with that path.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector}"

FILE_PATH=$(python3 -c '
import json, sys
try:
  d = json.loads(sys.stdin.read())
  print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
  print("")
' 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0

REL="${FILE_PATH#$ROOT/}"

case "$REL" in
  backend/.env.staging|backend/.env.staging.*|backend/.env.production|backend/.env.production.*)
    ;;
  *)
    exit 0
    ;;
esac

cat >&2 <<EOF
BLOCK_NON_DEV_ENV — refused to touch $REL.

Backend env is pinned to \`dev\` (HARD RULE in .claude/CLAUDE.md).
Edits to staging/production env files are out-of-band entirely.

If the active-env marker has been flipped by the launcher or another
process, the correct fix is to revert it to dev — never to "make
staging/production work". Surface the discrepancy in chat so Rick
can decide.

Files in scope of this rule:
  • backend/.env.staging          • backend/.env.production
  • backend/.env.staging.locked   • backend/.env.production.locked
  • (and any future .env.staging.* / .env.production.* rotations)
EOF
exit 2
