#!/usr/bin/env bash
# Link auto-memory directory to the repo's .claude/memory so it syncs across laptops.
#
# Claude Code reads auto-memory from:
#   ~/.claude/projects/<project-slug>/memory/
#
# We keep the canonical copy in the repo at .claude/memory/ and symlink the
# Claude-expected path to it. Run this once on each fresh laptop after `git pull`.
#
# Safe to re-run: detects existing correct symlink and exits. If a real
# directory is in the way, it's renamed to *.pre-symlink-backup — never deleted.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# REPO_ROOT resolves to .../dev; step up one more.
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"

CLAUDE_MEMORY_PARENT="$HOME/.claude/projects/-Users-rick-Documents-MMFFDev-Projects-MMFFDev---PM"
CLAUDE_MEMORY_LINK="$CLAUDE_MEMORY_PARENT/memory"
REPO_MEMORY="$REPO_ROOT/.claude/memory"

if [ ! -d "$REPO_MEMORY" ]; then
  echo "ERROR: repo memory dir missing at $REPO_MEMORY" >&2
  echo "Did you pull the latest from the remote?" >&2
  exit 1
fi

mkdir -p "$CLAUDE_MEMORY_PARENT"

# Already the correct symlink — nothing to do.
if [ -L "$CLAUDE_MEMORY_LINK" ]; then
  current_target="$(readlink "$CLAUDE_MEMORY_LINK")"
  if [ "$current_target" = "$REPO_MEMORY" ]; then
    echo "OK: memory already linked to $REPO_MEMORY"
    exit 0
  fi
  echo "INFO: symlink exists but points elsewhere ($current_target) — replacing."
  rm "$CLAUDE_MEMORY_LINK"
fi

# A real directory is in the way — back it up, don't delete.
if [ -d "$CLAUDE_MEMORY_LINK" ]; then
  backup="${CLAUDE_MEMORY_LINK}.pre-symlink-backup.$(date +%Y%m%d-%H%M%S)"
  echo "INFO: backing up existing memory dir to $backup"
  mv "$CLAUDE_MEMORY_LINK" "$backup"
fi

ln -s "$REPO_MEMORY" "$CLAUDE_MEMORY_LINK"
echo "OK: linked $CLAUDE_MEMORY_LINK -> $REPO_MEMORY"
echo "File count: $(ls -1 "$CLAUDE_MEMORY_LINK" | wc -l | tr -d ' ')"
