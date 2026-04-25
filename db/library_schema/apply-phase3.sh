#!/usr/bin/env bash
# apply-phase3.sh — Apply Phase 3 mmff_library release-channel schema
# against the dev cluster via the SSH tunnel at localhost:5434.
#
# Phase 3 ships:
#   006_release_channel.sql           → mmff_library (release tables)
#   007_grants_release_channel.sql    → mmff_library (grant matrix extension)
#   021_library_acknowledgements.sql  → mmff_vector  (per-subscription acks)
#   seed/002_test_release.sql         → mmff_library (one info-severity row)
#
# Phase 1 must already be applied (apply-phase1.sh) — bundle tables,
# four roles, and the existing grants are prerequisites.
#
# Usage:
#   ./apply-phase3.sh           # apply
#   ./apply-phase3.sh --dry-run # list steps, no connection
#
# Idempotent: SQL files use IF NOT EXISTS / ON CONFLICT / NOT EXISTS
# guards so a second invocation is safe.

set -euo pipefail

# --- locate repo paths ------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/backend/.env.local"
LIB_SQL_DIR="${SCRIPT_DIR}"
LIB_SEED_DIR="${SCRIPT_DIR}/seed"
VECTOR_SQL_DIR="${REPO_ROOT}/db/schema"

DB_HOST="localhost"
DB_PORT="5434"
ADMIN_USER="mmff_dev"
LIB_DB="mmff_library"
VECTOR_DB="mmff_vector"
LIB_ADMIN_USER="mmff_library_admin"
LIB_ADMIN_PASSWORD="change_me_admin"   # placeholder set by 002_roles.sql; dev only

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

# --- step plan --------------------------------------------------------------
declare -a STEP_LABELS=(
  "create release-channel tables (${LIB_DB},    as ${ADMIN_USER})"
  "extend grants matrix          (${LIB_DB},    as ${ADMIN_USER})"
  "create acknowledgements table (${VECTOR_DB}, as ${ADMIN_USER})"
  "seed test release             (${LIB_DB},    as ${LIB_ADMIN_USER})"
)
declare -a STEP_FILES=(
  "${LIB_SQL_DIR}/006_release_channel.sql"
  "${LIB_SQL_DIR}/007_grants_release_channel.sql"
  "${VECTOR_SQL_DIR}/021_library_acknowledgements.sql"
  "${LIB_SEED_DIR}/002_test_release.sql"
)
declare -a STEP_DBS=(
  "${LIB_DB}"
  "${LIB_DB}"
  "${VECTOR_DB}"
  "${LIB_DB}"
)

# --- dry-run path -----------------------------------------------------------
if [[ ${DRY_RUN} -eq 1 ]]; then
  echo "[dry-run] would source DB_PASSWORD from: ${ENV_FILE}"
  echo "[dry-run] would verify TCP reachability of ${DB_HOST}:${DB_PORT}"
  echo "[dry-run] would run psql with ON_ERROR_STOP=1 against ${DB_HOST}:${DB_PORT}"
  for i in "${!STEP_LABELS[@]}"; do
    n=$((i + 1))
    echo "[dry-run] step ${n}: ${STEP_LABELS[$i]}"
    echo "[dry-run]           file: ${STEP_FILES[$i]}"
  done
  echo "[dry-run] no connection attempted; exiting."
  exit 0
fi

# --- preflight: env file ----------------------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: env file not found at ${ENV_FILE}" >&2
  exit 1
fi

DB_PASSWORD="$(
  grep -E '^[[:space:]]*DB_PASSWORD[[:space:]]*=' "${ENV_FILE}" \
    | tail -n 1 \
    | sed -E 's/^[[:space:]]*DB_PASSWORD[[:space:]]*=[[:space:]]*//' \
    | sed -E 's/^"(.*)"$/\1/' \
    | sed -E "s/^'(.*)'\$/\\1/"
)"

if [[ -z "${DB_PASSWORD}" ]]; then
  echo "ERROR: DB_PASSWORD not set (or empty) in ${ENV_FILE}" >&2
  exit 1
fi

# --- preflight: SQL files ---------------------------------------------------
for f in "${STEP_FILES[@]}"; do
  if [[ ! -f "${f}" ]]; then
    echo "ERROR: missing SQL file: ${f}" >&2
    exit 1
  fi
done

# --- preflight: tunnel ------------------------------------------------------
if ! command -v nc >/dev/null 2>&1; then
  echo "ERROR: 'nc' not found on PATH; cannot verify tunnel" >&2
  exit 1
fi
if ! nc -z "${DB_HOST}" "${DB_PORT}" >/dev/null 2>&1; then
  echo "ERROR: nothing listening on ${DB_HOST}:${DB_PORT} — bring the SSH tunnel up first" >&2
  exit 1
fi

# --- preflight: psql --------------------------------------------------------
PSQL_BIN=""
for candidate in \
    /opt/homebrew/opt/libpq/bin/psql \
    /usr/local/opt/libpq/bin/psql \
    /Applications/Postgres.app/Contents/Versions/latest/bin/psql; do
  if [[ -x "${candidate}" ]]; then
    PSQL_BIN="${candidate}"
    break
  fi
done
if [[ -z "${PSQL_BIN}" ]] && command -v psql >/dev/null 2>&1; then
  PSQL_BIN="$(command -v psql)"
fi
if [[ -z "${PSQL_BIN}" ]]; then
  echo "ERROR: psql not found. Install via 'brew install libpq' or Postgres.app." >&2
  exit 1
fi

# --- helpers ----------------------------------------------------------------
psql_run() {
  local user="$1" pass="$2" db="$3" file="$4"
  PGPASSWORD="${pass}" "${PSQL_BIN}" \
    -X \
    -v ON_ERROR_STOP=1 \
    --set=ON_ERROR_STOP=1 \
    -h "${DB_HOST}" -p "${DB_PORT}" \
    -U "${user}" -d "${db}" \
    -f "${file}"
}

step() {
  local n="$1" label="$2"
  echo "▶ step ${n}: ${label}"
}

ok() {
  echo "  ✓ done"
}

# --- run --------------------------------------------------------------------
step 1 "${STEP_LABELS[0]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "${STEP_DBS[0]}" "${STEP_FILES[0]}"
ok

step 2 "${STEP_LABELS[1]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "${STEP_DBS[1]}" "${STEP_FILES[1]}"
ok

step 3 "${STEP_LABELS[2]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "${STEP_DBS[2]}" "${STEP_FILES[2]}"
ok

step 4 "${STEP_LABELS[3]}"
psql_run "${LIB_ADMIN_USER}" "${LIB_ADMIN_PASSWORD}" "${STEP_DBS[3]}" "${STEP_FILES[3]}"
ok

# --- summary ----------------------------------------------------------------
echo
echo "Summary:"
echo "  - mmff_library: 3 release-channel tables created; grants extended for all 4 roles."
echo "  - mmff_vector:  library_acknowledgements table created."
echo "  - One info-severity test release seeded for MMFF Standard family v1."
echo "  - Verify the grant matrix: cd backend && go test ./internal/librarydb/..."
