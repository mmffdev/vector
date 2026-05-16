#!/usr/bin/env bash
# rg-rerun.sh
#
# Wrapper around `rg-runner` (the Tracker regression test runner that lives
# in the sibling `MMFFDev - Tracker` repo) for use from the Vector repo.
#
# Spawns the runner against this project's root, streaming per-test results
# to Tracker for every group visible to the API key (or a single group via
# RG_GROUP). The `<rg>` substrate is anchored in PLA-0051; the Red-Green
# Feature-Driven SOP that drives groups lives in
# `.claude/skills/stories/SKILL.md` §5.d.
#
# Usage:
#   dev/scripts/rg-rerun.sh                     # run all groups, fail on runner error
#   dev/scripts/rg-rerun.sh --soft              # best-effort, always exit 0 (for pre-push)
#   dev/scripts/rg-rerun.sh --group <slug>      # run a single group (overrides RG_GROUP)
#   dev/scripts/rg-rerun.sh --dry-run           # resolve groups, print intended runs, exit
#
# Env (see .claude/memory/project_tracker_rg_api_key.md):
#   RG_API_KEY           — Tracker PAT (project-clamped to Vector). REQUIRED.
#   RG_TARGET            — project codebase path. Defaults to git repo root.
#   RG_TRACKER_URL       — Tracker base URL. Defaults to http://localhost:5102.
#   RG_GROUP             — group slug, or 'all'. Defaults to 'all'.
#   RG_TRACKER_REPO      — path to the Tracker repo holding cmd/rg-runner.
#                          Defaults to "$(git rev-parse --show-toplevel)/../MMFFDev - Tracker".
#   SKIP_RG_RERUN=1      — short-circuit; print "skipped" and exit 0.

set -euo pipefail

MODE_SOFT=0
RG_GROUP_OVERRIDE=""
DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --soft)          MODE_SOFT=1 ; shift ;;
    --group)         RG_GROUP_OVERRIDE="$2" ; shift 2 ;;
    --dry-run)       DRY_RUN=1 ; shift ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *)
      echo "unknown flag: $1 (try --help)" >&2
      [ "$MODE_SOFT" = "1" ] && exit 0 || exit 2
      ;;
  esac
done

soft_exit() {
  local code=$1
  if [ "$MODE_SOFT" = "1" ]; then
    [ "$code" != "0" ] && echo "rg-rerun: soft mode — not blocking (exit ${code})" >&2
    exit 0
  fi
  exit "$code"
}

if [ "${SKIP_RG_RERUN:-0}" = "1" ]; then
  echo "rg-rerun: SKIP_RG_RERUN=1, skipping"
  exit 0
fi

# Locate this repo + the sibling Tracker repo.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "${REPO_ROOT:-}" ]; then
  echo "rg-rerun: not inside a git repo" >&2
  soft_exit 1
fi
TRACKER_REPO="${RG_TRACKER_REPO:-${REPO_ROOT}/../MMFFDev - Tracker}"
if [ ! -d "$TRACKER_REPO/backend/cmd/rg-runner" ]; then
  echo "rg-rerun: cmd/rg-runner not found at: $TRACKER_REPO/backend/cmd/rg-runner" >&2
  echo "          set RG_TRACKER_REPO to the path of the MMFFDev - Tracker repo" >&2
  soft_exit 1
fi

if [ -z "${RG_API_KEY:-}" ]; then
  echo "rg-rerun: RG_API_KEY not set" >&2
  echo "          see .claude/memory/project_tracker_rg_api_key.md for the Vector-clamped token" >&2
  soft_exit 1
fi

GROUP="${RG_GROUP_OVERRIDE:-${RG_GROUP:-all}}"
TARGET="${RG_TARGET:-$REPO_ROOT}"
TRACKER_URL="${RG_TRACKER_URL:-http://localhost:5102}"

# Quick reachability probe so a down Tracker fails fast with a clear message.
if ! curl -fsS -m 2 -o /dev/null "$TRACKER_URL/" 2>/dev/null; then
  echo "rg-rerun: Tracker not reachable at $TRACKER_URL (skipping)" >&2
  soft_exit 0
fi

echo "rg-rerun: group=$GROUP target=$TARGET tracker=$TRACKER_URL"

DRY_FLAG=()
[ "$DRY_RUN" = "1" ] && DRY_FLAG=(-dry-run)

set +e
( cd "$TRACKER_REPO/backend" && \
  RG_API_KEY="$RG_API_KEY" go run ./cmd/rg-runner \
    -group "$GROUP" \
    -target "$TARGET" \
    -tracker-url "$TRACKER_URL" \
    "${DRY_FLAG[@]}" )
EXIT=$?
set -e

soft_exit "$EXIT"
