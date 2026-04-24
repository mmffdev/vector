#!/usr/bin/env bash
# apply-phase1.sh — Apply Phase 1 mmff_library scaffold against the dev cluster
# via the SSH tunnel at localhost:5434.
#
# Usage:
#   ./apply-phase1.sh           # apply
#   ./apply-phase1.sh --dry-run # list steps, no connection
#
# Idempotent: underlying SQL files use DO blocks / IF NOT EXISTS / ON CONFLICT,
# so a second invocation is safe.

set -euo pipefail

# --- locate repo paths ------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/backend/.env.local"
SQL_DIR="${SCRIPT_DIR}"
SEED_DIR="${SCRIPT_DIR}/seed"

DB_HOST="localhost"
DB_PORT="5434"
ADMIN_USER="mmff_dev"
LIB_DB="mmff_library"
LIB_ADMIN_USER="mmff_library_admin"
LIB_ADMIN_PASSWORD="change_me_admin"   # placeholder set by 002_roles.sql; dev only

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

# --- step plan --------------------------------------------------------------
declare -a STEP_LABELS=(
  "create database mmff_library  (postgres DB, as ${ADMIN_USER})"
  "create library roles          (postgres DB, as ${ADMIN_USER})"
  "create bundle tables          (${LIB_DB},  as ${ADMIN_USER})"
  "create shares table           (${LIB_DB},  as ${ADMIN_USER})"
  "apply per-table grants        (${LIB_DB},  as ${ADMIN_USER})"
  "seed MMFF model bundle        (${LIB_DB},  as ${LIB_ADMIN_USER})"
)
declare -a STEP_FILES=(
  "${SQL_DIR}/001_init_library.sql"
  "${SQL_DIR}/002_roles.sql"
  "${SQL_DIR}/003_portfolio_model_bundles.sql"
  "${SQL_DIR}/004_portfolio_model_shares.sql"
  "${SQL_DIR}/005_grants.sql"
  "${SEED_DIR}/001_mmff_model.sql"
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

# Parse DB_PASSWORD without sourcing the whole file (avoid surprises from other
# env vars); strip optional surrounding single/double quotes.
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
# Homebrew's libpq is keg-only — psql isn't on PATH by default. Probe a few
# known locations before falling back to PATH lookup.
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
# Pass passwords through PGPASSWORD env, never on the command line, so they
# don't show up in `ps`. Use --set=ON_ERROR_STOP=1 and -v ON_ERROR_STOP=1 for
# belt-and-braces, plus -X to skip ~/.psqlrc.
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
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "postgres" "${STEP_FILES[0]}"
ok

step 2 "${STEP_LABELS[1]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "postgres" "${STEP_FILES[1]}"
ok

step 3 "${STEP_LABELS[2]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "${LIB_DB}" "${STEP_FILES[2]}"
ok

step 4 "${STEP_LABELS[3]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "${LIB_DB}" "${STEP_FILES[3]}"
ok

step 5 "${STEP_LABELS[4]}"
psql_run "${ADMIN_USER}" "${DB_PASSWORD}" "${LIB_DB}" "${STEP_FILES[4]}"
ok

step 6 "${STEP_LABELS[5]}"
psql_run "${LIB_ADMIN_USER}" "${LIB_ADMIN_PASSWORD}" "${LIB_DB}" "${STEP_FILES[5]}"
ok

# --- summary ----------------------------------------------------------------
echo
echo "Summary:"
echo "  - DB '${LIB_DB}' created; 4 roles created; bundle + shares tables created;"
echo "    per-table grants applied; MMFF model bundle seed applied."
echo "  - Verify the grant matrix: cd backend && go test ./internal/librarydb/..."
