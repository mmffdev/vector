#!/usr/bin/env bash
# claude-global.sh — sync global Claude Code config between machines.
#
# Usage:
#   ./claude-global.sh export   Save ~/.claude/ portables → Claude Global/
#   ./claude-global.sh import   Apply Claude Global/ → ~/.claude/
#   ./claude-global.sh status   Diff saved vs current config
#
# Path handling:
#   $HOME is normalised to {{HOME}} on export and restored on import.
#   This covers all ~/.claude paths automatically — they are always HOME-rooted.
#
# Workflow:
#   Office  → export → git add 'Claude Global/' → commit → push
#   Laptop  → git pull → status (review) → import → restart Claude Code

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GLOBAL_SRC="$HOME/.claude"
STORE="$SCRIPT_DIR/Claude Global"

# Portable items only — projects/ sessions/ cache/ telemetry/ are machine-specific.
ITEMS=(CLAUDE.md settings.json mcp.json keybindings.json skills commands protocols)

# ── colour helpers ──────────────────────────────────────────────────────────
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
dim()    { printf '\033[2m%s\033[0m\n'    "$*"; }
bold()   { printf '\033[1m%s\033[0m\n'    "$*"; }

# ── path substitution ───────────────────────────────────────────────────────

sed_escape() { printf '%s' "$1" | sed 's/[\\|&]/\\&/g'; }

apply_sub() {
  local path="$1" expr="$2"
  if [ -d "$path" ]; then
    find "$path" -type f \( \
      -name "*.json" -o -name "*.md" -o -name "*.sh" -o -name "*.txt" \
    \) -exec sed -i '' "$expr" {} +
  elif [ -f "$path" ]; then
    sed -i '' "$expr" "$path"
  fi
}

# ── export ──────────────────────────────────────────────────────────────────

cmd_export() {
  echo ""
  bold "Export: ~/.claude/ → Claude Global/"
  echo ""

  mkdir -p "$STORE"

  for item in "${ITEMS[@]}"; do
    local src="$GLOBAL_SRC/$item" dest="$STORE/$item"
    if [ -d "$src" ]; then
      mkdir -p "$dest"
      rsync -a --delete "$src/" "$dest/"
      green "  ✓  $item/"
    elif [ -f "$src" ]; then
      cp "$src" "$dest"
      green "  ✓  $item"
    else
      dim   "  –  $item  (absent)"
    fi
  done

  echo ""
  echo "Normalising paths…"
  local home_expr="s|$(sed_escape "$HOME")|{{HOME}}|g"
  for item in "${ITEMS[@]}"; do
    apply_sub "$STORE/$item" "$home_expr"
  done
  dim "  $HOME  →  {{HOME}}"

  echo ""
  dim "Excluded: projects/ sessions/ history.jsonl cache/ telemetry/ tasks/ agents/"
  echo ""
  echo "Next:"
  yellow "  git add 'Claude Global/'"
  yellow "  git commit -m 'chore: update global Claude config'"
  yellow "  git push"
  echo ""
}

# ── import ──────────────────────────────────────────────────────────────────

cmd_import() {
  if [ ! -d "$STORE" ]; then
    red "Claude Global/ not found. Run export on another machine first."
    exit 1
  fi

  echo ""
  bold "Import: Claude Global/ → ~/.claude/"
  echo ""

  local backup="$HOME/.claude.bak.$(date +%Y%m%d-%H%M%S)"
  if [ -d "$GLOBAL_SRC" ]; then
    cp -r "$GLOBAL_SRC" "$backup"
    dim "  Backed up existing ~/.claude → $(basename "$backup")"
    echo ""
  fi

  mkdir -p "$GLOBAL_SRC"

  for item in "${ITEMS[@]}"; do
    local src="$STORE/$item" dest="$GLOBAL_SRC/$item"
    if [ -d "$src" ]; then
      mkdir -p "$dest"
      rsync -a --delete "$src/" "$dest/"
      green "  ✓  $item/"
    elif [ -f "$src" ]; then
      cp "$src" "$dest"
      green "  ✓  $item"
    else
      dim   "  –  $item  (absent in Claude Global/, skipped)"
    fi
  done

  echo ""
  echo "Resolving paths…"
  local home_expr="s|{{HOME}}|$(sed_escape "$HOME")|g"
  for item in "${ITEMS[@]}"; do
    apply_sub "$GLOBAL_SRC/$item" "$home_expr"
  done
  dim "  {{HOME}}  →  $HOME"

  echo ""
  green "Done. Restart Claude Code to apply the imported settings."
  echo ""
}

# ── status ──────────────────────────────────────────────────────────────────

cmd_status() {
  if [ ! -d "$STORE" ]; then
    yellow "Claude Global/ not found — nothing saved yet."
    dim "Run './claude-global.sh export' first."
    echo ""
    exit 0
  fi

  echo ""
  bold "Status: Claude Global/ (saved)  vs  ~/.claude/ (live)"
  echo ""

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  local home_expr="s|$(sed_escape "$HOME")|{{HOME}}|g"

  for item in "${ITEMS[@]}"; do
    local src="$GLOBAL_SRC/$item" saved="$STORE/$item"
    if [ ! -e "$saved" ] && [ ! -e "$src" ]; then
      dim   "  –  $item  (absent in both)"
      continue
    elif [ ! -e "$saved" ]; then
      yellow "  +  $item  (live only — not saved yet)"
      continue
    elif [ ! -e "$src" ]; then
      yellow "  -  $item  (saved only — not on this machine)"
      continue
    fi

    local tmp_item="$tmp/$item"
    if [ -d "$src" ]; then
      mkdir -p "$tmp_item"
      rsync -a "$src/" "$tmp_item/"
      apply_sub "$tmp_item" "$home_expr"
    else
      cp "$src" "$tmp_item"
      apply_sub "$tmp_item" "$home_expr"
    fi

    if diff -rq --exclude=".DS_Store" "$saved" "$tmp_item" &>/dev/null; then
      dim  "  ✓  $item  (in sync)"
    else
      red  "  ≠  $item  (differs)"
    fi
  done

  echo ""
}

# ── dispatch ────────────────────────────────────────────────────────────────

case "${1:-}" in
  export) cmd_export ;;
  import) cmd_import ;;
  status) cmd_status ;;
  *)
    echo ""
    bold "claude-global.sh"
    echo ""
    echo "  export   Save portable ~/.claude/ items → Claude Global/"
    echo "  import   Apply Claude Global/ → ~/.claude/ (backs up first)"
    echo "  status   Show what differs between saved and live config"
    echo ""
    echo "All \$HOME paths are normalised automatically on export/import."
    echo ""
    exit 1
    ;;
esac
