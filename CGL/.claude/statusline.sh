#!/usr/bin/env bash
# Claude Code status line. Reads JSON on stdin, prints one styled line.

input=$(cat)

model=$(printf '%s' "$input" | jq -r '.model.display_name // .model.id // "Claude"')
cwd=$(printf '%s' "$input"   | jq -r '.workspace.current_dir // .cwd // ""')

dir_label="${cwd##*/}"
[ -z "$dir_label" ] && dir_label="~"

branch=""
dirty=""
if [ -n "$cwd" ] && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null \
             || git -C "$cwd" rev-parse --short HEAD 2>/dev/null)
    if [ -n "$(git -C "$cwd" status --porcelain 2>/dev/null)" ]; then
        dirty="*"
    fi
fi

time_now=$(date +%H:%M)

DIM=$'\033[2m'
CYAN=$'\033[36m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
MAGENTA=$'\033[35m'
RESET=$'\033[0m'

sep="${DIM} | ${RESET}"

out="${MAGENTA}${model}${RESET}${sep}${CYAN}${dir_label}${RESET}"
if [ -n "$branch" ]; then
    colour="$GREEN"
    [ -n "$dirty" ] && colour="$YELLOW"
    out="${out}${sep}${colour}${branch}${dirty}${RESET}"
fi
out="${out}${sep}${DIM}${time_now}${RESET}"

printf '%s' "$out"
