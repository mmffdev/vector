#!/bin/bash
# shortcuts-staleness-check.sh
#
# PostToolUse hook on Write|Edit|MultiEdit. Fires a one-line reminder when a NEW
# skill or command file exists on disk but is not referenced in BOTH targets that
# render the shortcuts list:
#
#   1. dev/pages/DevShortcutsPanel.tsx  — the live Dev → Shortcuts UI (source of truth)
#   2. dev/shortcuts.html               — the static browser-openable mirror
#
# Detect-only — never writes to either. The user runs `<?> -u` to regenerate both.
#
# Match rule for "new":
#   - .claude/skills/<NAME>/SKILL.md exists
#   - .claude/commands/c_<NAME>.md exists
#   - AND its load-path segment (e.g. skills/<NAME>/SKILL.md or commands/c_<NAME>.md)
#     does NOT appear as a literal substring inside the target file.
#
# A file is "missing" if absent from EITHER target. The reminder reports which.
#
# Cooldown: 5 minutes per (file, target) pair to prevent spam during iteration.

set -e

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SHORTCUTS_TSX="$PROJECT_DIR/dev/pages/DevShortcutsPanel.tsx"
SHORTCUTS_HTML="$PROJECT_DIR/dev/shortcuts.html"
SKILLS_DIR="$PROJECT_DIR/.claude/skills"
COMMANDS_DIR="$PROJECT_DIR/.claude/commands"
COOLDOWN_DIR="/tmp/mmff-shortcuts-staleness"
COOLDOWN_SECS=300

# Bail out silently if either render target is missing — never break the user's flow.
[ -f "$SHORTCUTS_TSX" ]  || exit 0
[ -f "$SHORTCUTS_HTML" ] || exit 0
[ -d "$SKILLS_DIR" ]     || exit 0
[ -d "$COMMANDS_DIR" ]   || exit 0

mkdir -p "$COOLDOWN_DIR"

# Ignore-list: internal protocol files and config skills that are NOT user-facing
# shortcuts. They're called by other shortcuts but never invoked directly, so they
# don't belong on the shortcuts.html page. Extend this list when adding new helpers.
IGNORE=(
  "skills/setup-matt-pocock-skills/SKILL.md"  # plugin config scaffolder, not a shortcut
  "commands/c_addpaper-stories.md"            # protocol partner of <addpaper>
  "commands/c_research-paper-format.md"       # JSON shape spec for research writer
  "commands/c_write-research-paper.md"        # shared writer called by <addpaper>/<research>
  "commands/c_research.md"                    # protocol detail for /research skill
  "commands/c_retro.md"                       # protocol detail for <r> skill
)

is_ignored() {
  local p="$1"
  for ig in "${IGNORE[@]}"; do
    [ "$p" = "$ig" ] && return 0
  done
  return 1
}

missing_tsx=()
missing_html=()
now=$(date +%s)

check_path() {
  local fs_path="$1"   # absolute path on disk
  local seg="$2"       # substring to grep for inside each render target

  # Ignored → not a shortcut, skip.
  is_ignored "$seg" && return

  local key_base
  key_base=$(printf '%s' "$seg" | tr -c 'a-zA-Z0-9' '_')

  # TSX target.
  if ! grep -qF "$seg" "$SHORTCUTS_TSX" 2>/dev/null; then
    local stamp="$COOLDOWN_DIR/tsx_${key_base}"
    local last=0
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    if [ $((now - last)) -ge "$COOLDOWN_SECS" ]; then
      missing_tsx+=("$seg")
      echo "$now" > "$stamp"
    fi
  fi

  # HTML target.
  if ! grep -qF "$seg" "$SHORTCUTS_HTML" 2>/dev/null; then
    local stamp="$COOLDOWN_DIR/html_${key_base}"
    local last=0
    [ -f "$stamp" ] && last=$(cat "$stamp" 2>/dev/null || echo 0)
    if [ $((now - last)) -ge "$COOLDOWN_SECS" ]; then
      missing_html+=("$seg")
      echo "$now" > "$stamp"
    fi
  fi
}

# Skills: .claude/skills/<NAME>/SKILL.md
for skill_md in "$SKILLS_DIR"/*/SKILL.md; do
  [ -f "$skill_md" ] || continue
  name=$(basename "$(dirname "$skill_md")")
  check_path "$skill_md" "skills/$name/SKILL.md"
done

# Commands: .claude/commands/c_*.md
for cmd_md in "$COMMANDS_DIR"/c_*.md; do
  [ -f "$cmd_md" ] || continue
  name=$(basename "$cmd_md")
  check_path "$cmd_md" "commands/$name"
done

[ ${#missing_tsx[@]} -eq 0 ] && [ ${#missing_html[@]} -eq 0 ] && exit 0

# Emit the reminder on stderr (PostToolUse non-blocking convention).
{
  echo ""
  echo "Shortcuts list is stale — run \`<?> -u\` to regenerate both render targets."
  if [ ${#missing_tsx[@]} -gt 0 ]; then
    echo "  dev/pages/DevShortcutsPanel.tsx (live Dev → Shortcuts UI) missing:"
    for m in "${missing_tsx[@]}"; do
      echo "    - $m"
    done
  fi
  if [ ${#missing_html[@]} -gt 0 ]; then
    echo "  dev/shortcuts.html (static browser mirror) missing:"
    for m in "${missing_html[@]}"; do
      echo "    - $m"
    done
  fi
  echo ""
} >&2

exit 0
