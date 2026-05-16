#!/usr/bin/env bash
# PostToolUse hook — fires after Write/Edit/MultiEdit and runs the
# project-specific lint scripts whose scan domain intersects the edited
# file. Blocks the turn (exit 2) ONLY if a violation names the file
# Claude just edited; pre-existing violations elsewhere stay quiet and
# are left for the relevant `npm run lint:*` to surface.
#
# Path → lint mapping mirrors the routes in package.json:
#   app/(user)/**/page.tsx                          → lint:page-description
#   app/(user)/**/*.tsx                             → lint:h2-panel-only
#   app/**/*.tsx                                    → lint:no-raw-table
#   app/globals.css | dev/**/*.{tsx,css,ts}         → lint:dev-css
#   backend/internal/**/handler*.go | *_handler.go  → lint:no-db-in-handlers
#   backend/internal/**/*.go                        → lint:sql-in-sqlfile-only
#                                                     + lint:writer-boundary
#   backend/internal/artefactitems/**/*.go          → lint:scope-literals
#
# Test files (_test.go, *.test.tsx, *.spec.*) are skipped — they
# legitimately bypass several of these rules.
#
# Disable by removing this hook entry from .claude/settings.json — no
# env-var kill-switch by design, keep the failure surface visible.

set -u

ROOT="${CLAUDE_PROJECT_DIR:-/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector}"

# Extract file_path from PostToolUse JSON on stdin. Edit/Write/MultiEdit
# all carry it under tool_input.file_path.
FILE_PATH=$(python3 -c '
import json, sys
try:
  d = json.loads(sys.stdin.read())
  print(d.get("tool_input", {}).get("file_path", ""))
except Exception:
  print("")
' 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0

# Normalise to repo-relative path.
REL="${FILE_PATH#$ROOT/}"

# Skip test/spec files and non-source extensions.
case "$REL" in
  *_test.go|*.test.tsx|*.test.ts|*.spec.tsx|*.spec.ts|*.spec.mjs) exit 0 ;;
  *.tsx|*.ts|*.go|*.css|*.sql) ;;
  *) exit 0 ;;
esac

# Build list of linters whose scan domain covers this path.
LINTS=()
case "$REL" in
  "app/(user)/"*"/page.tsx") LINTS+=("page_description") ;;
esac
case "$REL" in
  "app/(user)/"*.tsx) LINTS+=("h2_panel_only") ;;
esac
case "$REL" in
  "app/"*.tsx) LINTS+=("no_raw_table") ;;
esac
case "$REL" in
  "app/globals.css"|"dev/"*.tsx|"dev/"*.css|"dev/"*.ts) LINTS+=("dev_css") ;;
esac
case "$REL" in
  "backend/internal/"*handler*.go|"backend/internal/"*_handler.go) LINTS+=("no_db_in_handlers") ;;
esac
case "$REL" in
  "backend/internal/"*.go) LINTS+=("sql_in_sqlfile_only" "writer_boundary") ;;
esac
case "$REL" in
  "backend/internal/artefactitems/"*.go) LINTS+=("scope_literals") ;;
esac

[[ ${#LINTS[@]} -eq 0 ]] && exit 0

# Verify all expected scripts exist (skip silently if not — e.g. someone
# renamed a lint script; better to no-op than crash the hook).
SCRIPTS=()
for L in "${LINTS[@]}"; do
  SCRIPT="$ROOT/dev/scripts/lint_${L}.py"
  [[ -f "$SCRIPT" ]] && SCRIPTS+=("$L")
done
[[ ${#SCRIPTS[@]} -eq 0 ]] && exit 0

# Run all relevant lints in parallel.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

for L in "${SCRIPTS[@]}"; do
  python3 "$ROOT/dev/scripts/lint_${L}.py" >"$TMPDIR/$L" 2>&1 &
done
wait

# Filter each lint's output to lines that NAME the edited file.
# Lint scripts emit violations in `FAIL  <path>: <reason>` form, so a
# fixed-string match on the repo-relative path is enough.
VIOLATIONS=""
for L in "${SCRIPTS[@]}"; do
  HITS=$(grep -F -- "$REL" "$TMPDIR/$L" 2>/dev/null || true)
  if [[ -n "$HITS" ]]; then
    VIOLATIONS+=$'\n--- lint:'"${L//_/-}"$'\n'
    VIOLATIONS+="$HITS"$'\n'
  fi
done

if [[ -n "$VIOLATIONS" ]]; then
  cat >&2 <<EOF
POST_EDIT_LINT — violation(s) in $REL:
$VIOLATIONS
Fix the violation, or add the path to the matching registry under
dev/registries/ paired with a TD-* entry (per the deferrals rule).
Lints triggered: ${SCRIPTS[*]}
EOF
  exit 2
fi

exit 0
