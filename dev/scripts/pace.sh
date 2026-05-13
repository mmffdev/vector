#!/usr/bin/env bash
# pace.sh — commit-mix + tech-debt-register pace report.
#
# Why this exists:
#   Without a scoreboard, every cleanup session feels like loss and every
#   feature session feels like winning — and both feelings are wrong. This
#   script gives an honest commit-mix ratio + a tech-debt register delta
#   so we can tell whether we're actually shipping features or paying debt.
#
# Usage:
#   pace.sh                    # last 30 days
#   pace.sh -d 7               # last N days
#   pace.sh -n 50              # last N commits
#   pace.sh -s <REV>..HEAD     # explicit revision range
#   pace.sh -v                 # verbose: list miscategorised commits
#
# Exit: always 0 (informational tool, never gates).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

DAYS=30
COMMITS=""
RANGE=""
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -d) DAYS="$2"; shift 2 ;;
    -n) COMMITS="$2"; shift 2 ;;
    -s) RANGE="$2"; shift 2 ;;
    -v) VERBOSE=true; shift ;;
    -h|--help)
      grep '^# ' "$0" | sed 's/^# //; s/^#//'
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

# Resolve which git-log selector to use.
# IMPORTANT: --reverse + -n picks the OLDEST n commits, not the newest.
# For -n we want the newest n, then reverse for display ordering only.
if [[ -n "$RANGE" ]]; then
  SELECTOR=(--reverse "$RANGE")
  LABEL="range $RANGE"
elif [[ -n "$COMMITS" ]]; then
  SELECTOR=("-n" "$COMMITS")
  LABEL="last $COMMITS commits"
else
  SELECTOR=(--reverse "--since=${DAYS}.days.ago")
  LABEL="last $DAYS days"
fi

# ── 1. Pull commit subjects + classify ──────────────────────────────────────
# Conventional Commits buckets: feat, fix, refactor, chore, docs, test, style,
# perf, build, ci, revert. Anything else → unknown.
declare -A BUCKETS=(
  [feat]=0 [fix]=0 [refactor]=0 [chore]=0 [docs]=0
  [test]=0 [style]=0 [perf]=0 [build]=0 [ci]=0 [revert]=0
  [unknown]=0
)
TOTAL=0
UNKNOWN_LIST=()
FIRST_SHA=""
LAST_SHA=""

while IFS=$'\t' read -r SHA SUBJECT; do
  # FIRST_SHA = oldest in window (lower bound for TD delta diff).
  # LAST_SHA  = newest in window (upper bound for TD delta diff).
  # When --reverse is in selector: first row = oldest, last row = newest.
  # When --reverse is NOT in selector: first row = newest, last row = oldest.
  # We track both bounds regardless of order via min/max chronology — but
  # since we ALWAYS use --reverse with date-based and range-based queries,
  # and -n returns newest-first, we cover both:
  if [[ -z "$FIRST_SHA" ]]; then
    FIRST_SHA="$SHA"
  fi
  LAST_SHA="$SHA"
  TOTAL=$((TOTAL + 1))
  # Strip optional (scope), grab the prefix before the first colon.
  PREFIX="${SUBJECT%%:*}"
  PREFIX="${PREFIX%%(*}"
  # Normalise + lowercase.
  PREFIX="$(echo "$PREFIX" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$PREFIX" in
    feat|fix|refactor|chore|docs|test|style|perf|build|ci|revert)
      BUCKETS[$PREFIX]=$((BUCKETS[$PREFIX] + 1))
      ;;
    *)
      BUCKETS[unknown]=$((BUCKETS[unknown] + 1))
      UNKNOWN_LIST+=("$SHA  $SUBJECT")
      ;;
  esac
done < <(git log "${SELECTOR[@]}" --pretty=tformat:"%h%x09%s")

if (( TOTAL == 0 )); then
  echo "No commits in $LABEL."
  exit 0
fi

# After the loop, FIRST_SHA / LAST_SHA depend on whether --reverse was used.
# Normalise to OLDEST_SHA / NEWEST_SHA via a fresh single-line lookup so the
# TD register diff always compares oldest-1 → newest correctly.
# SIGPIPE quirk: under `set -o pipefail`, `git log | head -1` returns 141
# when head closes its pipe early. Disable pipefail just for these probes.
set +o pipefail
if [[ -n "$RANGE" ]]; then
  OLDEST_SHA=$(git log --reverse "$RANGE" --pretty=tformat:"%h" | head -1)
  NEWEST_SHA=$(git log "$RANGE" --pretty=tformat:"%h" | head -1)
elif [[ -n "$COMMITS" ]]; then
  OLDEST_SHA=$(git log -n "$COMMITS" --pretty=tformat:"%h" | tail -1)
  NEWEST_SHA=$(git log -n "$COMMITS" --pretty=tformat:"%h" | head -1)
else
  OLDEST_SHA=$(git log --reverse "--since=${DAYS}.days.ago" --pretty=tformat:"%h" | head -1)
  NEWEST_SHA=$(git log "--since=${DAYS}.days.ago" --pretty=tformat:"%h" | head -1)
fi
set -o pipefail
FIRST_SHA="$OLDEST_SHA"
LAST_SHA="$NEWEST_SHA"

# ── 2. Build commit-mix table ───────────────────────────────────────────────
# Buckets grouped by intent:
#   PROGRESS = feat (new capability shipped)
#   QUALITY  = fix + refactor + perf + test (correctness & internal health)
#   UPKEEP   = chore + docs + style + build + ci + revert (housekeeping)
declare -A INTENT=(
  [feat]=PROGRESS
  [fix]=QUALITY [refactor]=QUALITY [perf]=QUALITY [test]=QUALITY
  [chore]=UPKEEP [docs]=UPKEEP [style]=UPKEEP [build]=UPKEEP [ci]=UPKEEP [revert]=UPKEEP
  [unknown]=UPKEEP
)
PROGRESS=0
QUALITY=0
UPKEEP=0
for B in feat fix refactor perf test chore docs style build ci revert unknown; do
  N=${BUCKETS[$B]}
  case "${INTENT[$B]}" in
    PROGRESS) PROGRESS=$((PROGRESS + N)) ;;
    QUALITY)  QUALITY=$((QUALITY + N)) ;;
    UPKEEP)   UPKEEP=$((UPKEEP + N)) ;;
  esac
done

pct() {
  local n=$1 total=$2
  if (( total == 0 )); then echo "0"; return; fi
  awk -v n="$n" -v t="$total" 'BEGIN { printf "%.0f", (n / t) * 100 }'
}

# ── 3. Tech-debt register delta over the window ─────────────────────────────
# Count net adds vs net resolves of register rows in docs/c_tech_debt.md.
# A row line starts with `| TD-`. A resolved row is wrapped in `~~…~~` or has
# the word RESOLVED at the start of the severity cell.
TD_FILE="docs/c_tech_debt.md"
TD_ADDED=0
TD_CLOSED=0
if [[ -f "$TD_FILE" ]] && [[ -n "$FIRST_SHA" ]]; then
  # `before` ref = parent of FIRST_SHA. `after` ref = LAST_SHA.
  BEFORE_REF="${FIRST_SHA}~1"
  # Robustness: if FIRST_SHA is the root commit there is no parent — fall back.
  if git rev-parse --verify "$BEFORE_REF" >/dev/null 2>&1; then
    BEFORE_OPEN=$(git show "$BEFORE_REF:$TD_FILE" 2>/dev/null | grep -cE '^\| TD-[A-Z]' || true)
    BEFORE_RESOLVED=$(git show "$BEFORE_REF:$TD_FILE" 2>/dev/null | grep -cE '^\| ~~TD-|RESOLVED [0-9]' || true)
    AFTER_OPEN=$(git show "$LAST_SHA:$TD_FILE" 2>/dev/null | grep -cE '^\| TD-[A-Z]' || true)
    AFTER_RESOLVED=$(git show "$LAST_SHA:$TD_FILE" 2>/dev/null | grep -cE '^\| ~~TD-|RESOLVED [0-9]' || true)
    # Net new rows (positive = added during window).
    TD_ADDED=$(( AFTER_OPEN - BEFORE_OPEN ))
    # Net resolutions (positive = resolved during window).
    TD_CLOSED=$(( AFTER_RESOLVED - BEFORE_RESOLVED ))
  fi
fi

# ── 4. Verdict ──────────────────────────────────────────────────────────────
# Target bands (rough — tune over time):
#   Healthy:   feat ≥ 40%, upkeep ≤ 35%, debt-delta ≤ 0
#   Debt-heavy: feat < 25%, upkeep ≥ 50%
#   Mixed:     anything else
#
# Skipped when unknown > 20% — the data isn't classifiable enough to call.
FEAT_PCT=$(pct "$PROGRESS" "$TOTAL")
QUAL_PCT=$(pct "$QUALITY" "$TOTAL")
UP_PCT=$(pct "$UPKEEP" "$TOTAL")
UNKNOWN_PCT=$(pct "${BUCKETS[unknown]}" "$TOTAL")

VERDICT=""
if (( UNKNOWN_PCT > 20 )); then
  VERDICT="UNCLASSIFIABLE — ${UNKNOWN_PCT}% of commits don't follow Conventional Commits format. Use -v to list them. Verdict skipped; numbers above are partial."
elif (( FEAT_PCT >= 40 )) && (( UP_PCT <= 35 )) && (( TD_ADDED - TD_CLOSED <= 0 )); then
  VERDICT="HEALTHY  — shipping new capability faster than debt is accruing"
elif (( FEAT_PCT < 25 )) && (( UP_PCT >= 50 )); then
  VERDICT="DEBT-HEAVY  — upkeep dominates; check whether refactor sprint is intentional"
else
  VERDICT="MIXED  — neither sprinting features nor in pure cleanup"
fi

# ── 5. Render ───────────────────────────────────────────────────────────────
echo "=============================================================="
echo " pace.sh — commit mix ($LABEL)"
echo "=============================================================="
printf " window:     %s\n" "$LABEL"
printf " total:      %d commits\n" "$TOTAL"
printf " span:       %s … %s\n" "${FIRST_SHA:-?}" "${LAST_SHA:-?}"
echo ""
echo " By intent:"
printf "   PROGRESS  %3d  (%3s%%)  feat\n" "$PROGRESS" "$FEAT_PCT"
printf "   QUALITY   %3d  (%3s%%)  fix + refactor + perf + test\n" "$QUALITY" "$QUAL_PCT"
printf "   UPKEEP    %3d  (%3s%%)  chore + docs + style + build + ci + revert + unknown\n" "$UPKEEP" "$UP_PCT"
echo ""
echo " By prefix:"
for B in feat fix refactor perf test chore docs style build ci revert unknown; do
  N=${BUCKETS[$B]}
  if (( N > 0 )); then
    P=$(pct "$N" "$TOTAL")
    printf "   %-9s %3d  (%3s%%)\n" "$B" "$N" "$P"
  fi
done
echo ""
echo " Tech-debt register (docs/c_tech_debt.md):"
printf "   rows added during window:    %3d\n" "$TD_ADDED"
printf "   rows resolved during window: %3d\n" "$TD_CLOSED"
printf "   net delta:                   %+3d  (positive = debt grew)\n" "$(( TD_ADDED - TD_CLOSED ))"
echo ""
echo " Verdict: $VERDICT"
echo "=============================================================="

if $VERBOSE && (( ${#UNKNOWN_LIST[@]} > 0 )); then
  echo ""
  echo " Miscategorised commits (no recognised Conventional Commits prefix):"
  for entry in "${UNKNOWN_LIST[@]}"; do
    echo "   $entry"
  done
fi
