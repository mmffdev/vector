#!/usr/bin/env bash
# =============================================================================
# cross_db_canary.sh
#
# Purpose:  Cross-DB integrity canary for PLA-0026. Stands in for the
#           foreign key Postgres can't enforce: every
#           vector_artefacts.<table>.workspace_id MUST point at a live row
#           in mmff_vector.workspaces. This script is the ops counterpart
#           of backend/internal/portfoliomodels/cross_db_canary_test.go —
#           the Go test is the authority; this wrapper produces equivalent
#           answers for nightly cron / monitoring.
#
# Strategy: TWO-POOL (matches the Go test).
#           1. SELECT id FROM mmff_vector.workspaces  → known-set file
#           2. For each VA table with a workspace_id column, run
#                SELECT DISTINCT workspace_id FROM <table>
#                  [WHERE archived_at IS NULL]
#              and assert subset against the known-set.
#           dblink is not installed; postgres_fdw is — but the script
#           deliberately avoids relying on fdw_workspaces so a future drop
#           or drift can't turn the canary into a false-positive cascade.
#
# Tables checked (mirrors Go test vaCanaryTables — keep in sync):
#           artefact_types               (filter archived_at IS NULL)
#           artefact_workspace_fields    (no archived_at; lifetime = workspace)
#           artefacts                    (filter archived_at IS NULL)
#           master_record_portfolio      (no archived_at; PK = workspace_id)
#           sprints                      (filter archived_at IS NULL)
#
# Usage:    bash dev/scripts/cross_db_canary.sh
#           (run from repo root; reads backend/.env.local)
#
# Output:   One line per table:
#             OK   <table>  0 orphans
#             FAIL <table>  N orphans   (followed by the orphan ids)
#
# Exit:     0 — every table passed
#           1 — at least one orphan found OR psql/connect failure
#
# Cron line (every night at 02:30; alert on non-zero):
#   30 2 * * * cd /path/to/MMFFDev-Vector && bash dev/scripts/cross_db_canary.sh \
#               >> /var/log/mmff/cross_db_canary.log 2>&1 || \
#               /usr/local/bin/notify-ops "cross_db_canary FAILED"
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Locate repo root + env file
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "FATAL: env file not found at $ENV_FILE" >&2
    exit 1
fi

# Load DB creds. set -a exports every assignment.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ---------------------------------------------------------------------------
# Locate psql (libpq client; no full postgres install required)
# ---------------------------------------------------------------------------
PSQL="${PSQL:-psql}"
if ! command -v "$PSQL" >/dev/null 2>&1; then
    for cand in \
        /opt/homebrew/opt/libpq/bin/psql \
        /opt/homebrew/Cellar/libpq/*/bin/psql \
        /usr/local/opt/libpq/bin/psql \
        /Applications/Postgres.app/Contents/Versions/*/bin/psql
    do
        if [[ -x "$cand" ]]; then
            PSQL="$cand"
            break
        fi
    done
fi
if ! command -v "$PSQL" >/dev/null 2>&1 && ! [[ -x "$PSQL" ]]; then
    echo "FATAL: psql not found in PATH or known brew/Postgres.app locations." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Sanity-check required env vars
# ---------------------------------------------------------------------------
required=(DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
          VA_DB_HOST VA_DB_PORT VA_DB_USER VA_DB_PASSWORD VA_DB_NAME)
missing=()
for v in "${required[@]}"; do
    if [[ -z "${!v:-}" ]]; then
        missing+=("$v")
    fi
done
if (( ${#missing[@]} > 0 )); then
    echo "FATAL: missing required env vars in $ENV_FILE: ${missing[*]}" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Helpers — psql wrappers that emit one column per row (-tA = tuples-only,
# unaligned). PGPASSWORD is the documented non-interactive auth path.
# ---------------------------------------------------------------------------
vector_psql() {
    PGPASSWORD="$DB_PASSWORD" "$PSQL" \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -v ON_ERROR_STOP=1 -tAq "$@"
}

va_psql() {
    PGPASSWORD="$VA_DB_PASSWORD" "$PSQL" \
        -h "$VA_DB_HOST" -p "$VA_DB_PORT" -U "$VA_DB_USER" -d "$VA_DB_NAME" \
        -v ON_ERROR_STOP=1 -tAq "$@"
}

# ---------------------------------------------------------------------------
# Step 1 — load known workspace ids from mmff_vector
# ---------------------------------------------------------------------------
KNOWN_FILE="$(mktemp -t cross_db_canary_known.XXXXXX)"
trap 'rm -f "$KNOWN_FILE" "$KNOWN_FILE.sorted"' EXIT

if ! vector_psql -c "SELECT id FROM workspaces;" > "$KNOWN_FILE"; then
    echo "FATAL: failed to load workspaces from mmff_vector ($DB_HOST:$DB_PORT/$DB_NAME)" >&2
    exit 1
fi

known_count=$(wc -l < "$KNOWN_FILE" | tr -d ' ')
if [[ "$known_count" == "0" ]]; then
    echo "FATAL: mmff_vector.workspaces returned 0 rows — refusing to run canary against an empty source-of-truth" >&2
    exit 1
fi

sort -u "$KNOWN_FILE" > "$KNOWN_FILE.sorted"

echo "loaded $known_count workspace id(s) from mmff_vector.workspaces"

# ---------------------------------------------------------------------------
# Step 2 — per VA table, compute orphans = (distinct workspace_id) − known
# ---------------------------------------------------------------------------
# Table list mirrors backend/internal/portfoliomodels/cross_db_canary_test.go
# vaCanaryTables. Format: "table_name|has_archived_at" where has_archived_at
# is "1" (filter archived rows) or "0" (no archived_at column).
TABLES=(
    "artefact_types|1"
    "artefact_workspace_fields|0"
    "artefacts|1"
    "master_record_portfolio|0"
    "sprints|1"
)

overall_fail=0

for entry in "${TABLES[@]}"; do
    table="${entry%%|*}"
    has_archived="${entry##*|}"

    if [[ "$has_archived" == "1" ]]; then
        sql="SELECT DISTINCT workspace_id FROM ${table} WHERE archived_at IS NULL;"
    else
        sql="SELECT DISTINCT workspace_id FROM ${table};"
    fi

    seen_file="$(mktemp -t cross_db_canary_seen.XXXXXX)"
    if ! va_psql -c "$sql" > "$seen_file"; then
        echo "FAIL $table  query error (see psql output above)"
        overall_fail=1
        rm -f "$seen_file"
        continue
    fi

    # comm -23 prints lines unique to file1 (seen) — i.e. orphans.
    sort -u "$seen_file" > "$seen_file.sorted"
    orphans=$(comm -23 "$seen_file.sorted" "$KNOWN_FILE.sorted" || true)
    rm -f "$seen_file" "$seen_file.sorted"

    if [[ -z "$orphans" ]]; then
        printf "OK   %-30s 0 orphans\n" "$table"
    else
        n=$(printf "%s\n" "$orphans" | wc -l | tr -d ' ')
        printf "FAIL %-30s %s orphans\n" "$table" "$n"
        printf "%s\n" "$orphans" | sed 's/^/       workspace_id=/'
        overall_fail=1
    fi
done

# ---------------------------------------------------------------------------
# Exit
# ---------------------------------------------------------------------------
if (( overall_fail == 0 )); then
    echo "cross_db_canary: PASS"
    exit 0
fi
echo "cross_db_canary: FAIL — at least one orphan reference detected" >&2
exit 1
