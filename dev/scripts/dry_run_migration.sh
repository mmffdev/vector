#!/usr/bin/env bash
#
# dry_run_migration.sh — apply a migration file inside an outer
# transaction with ROLLBACK so the schema is restored at end. Closes
# TD-LIB-004.
#
# Why a script: the naive pattern (`BEGIN; \i 017_foo.sql; ROLLBACK;`)
# doesn't work because inner BEGIN/COMMIT in the included file
# finalises before the outer ROLLBACK runs. This script strips
# top-level BEGIN; / COMMIT; from a copy of the file and runs it
# inside one transaction that rolls back at the end.
#
# Usage:
#   dev/scripts/dry_run_migration.sh <db> <migration_file>
#
#   <db> is one of: mmff_vector | vector_artefacts | mmff_library
#
# Reads DB connection info from backend/.env.dev. Emits the psql
# transcript to stdout — the migration's DDL ran inside the
# transaction, then ROLLBACK undid every effect.
#
# Example:
#   dev/scripts/dry_run_migration.sh mmff_vector db/mmff_vector/schema/220_my_new_thing.sql

set -euo pipefail

DB="${1:-}"
FILE="${2:-}"

if [[ -z "$DB" || -z "$FILE" ]]; then
  echo "Usage: $0 <db> <migration_file>" >&2
  echo "  db: mmff_vector | vector_artefacts | mmff_library" >&2
  exit 1
fi

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: migration file not found: $FILE" >&2
  exit 1
fi

# Load env from backend/.env.dev (relative to repo root).
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env.dev"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2
  exit 1
fi

# Pull connection values. Allow VA_DB_* / LIBRARY_DB_* overrides.
set -a; source "$ENV_FILE"; set +a

case "$DB" in
  mmff_vector)
    HOST="${DB_HOST:-localhost}"; PORT="${DB_PORT:-5435}"
    USER="${DB_USER:-mmff_dev}"; PASS="${DB_PASSWORD:-}"
    DBNAME="${DB_NAME:-mmff_vector}"
    ;;
  vector_artefacts)
    HOST="${VA_DB_HOST:-localhost}"; PORT="${VA_DB_PORT:-5435}"
    USER="${VA_DB_USER:-mmff_dev}"; PASS="${VA_DB_PASSWORD:-}"
    DBNAME="${VA_DB_NAME:-vector_artefacts}"
    ;;
  mmff_library)
    HOST="${LIBRARY_DB_HOST:-localhost}"; PORT="${LIBRARY_DB_PORT:-5435}"
    USER="${LIBRARY_DB_USER:-mmff_dev}"; PASS="${LIBRARY_DB_PASSWORD:-}"
    DBNAME="${LIBRARY_DB_NAME:-mmff_library}"
    ;;
  *)
    echo "ERROR: unknown db '$DB' (expected: mmff_vector | vector_artefacts | mmff_library)" >&2
    exit 1
    ;;
esac

# Locate psql (Homebrew libpq is the canonical path on this machine).
PSQL=""
for cand in /opt/homebrew/Cellar/libpq/*/bin/psql /usr/local/opt/libpq/bin/psql /opt/homebrew/bin/psql /usr/local/bin/psql /usr/bin/psql; do
  if [[ -x "$cand" ]]; then PSQL="$cand"; break; fi
done
if [[ -z "$PSQL" ]]; then
  echo "ERROR: psql not found in standard locations" >&2
  exit 1
fi

# Copy the migration into a scratch file with top-level BEGIN; / COMMIT;
# stripped. Inner BEGIN inside DO $$ ... END $$ blocks is left alone
# (those are PL/pgSQL block delimiters, not transaction markers).
SCRATCH="$(mktemp -t dry_run_migration.XXXXXX.sql)"
trap 'rm -f "$SCRATCH"' EXIT

# A line of just "BEGIN;" (whitespace tolerated) at column 0 is a
# top-level transaction begin. Same for "COMMIT;". Inner BEGIN/END in
# DO $$ blocks are indented OR followed by other tokens, so this
# pattern is safe for the migrations in this repo.
sed -E '/^[[:space:]]*BEGIN;[[:space:]]*$/d; /^[[:space:]]*COMMIT;[[:space:]]*$/d' "$FILE" > "$SCRATCH"

echo "── dry-run migration: $FILE"
echo "── target db: $DB ($USER@$HOST:$PORT/$DBNAME)"
echo "── scratch:   $SCRATCH"
echo

PGPASSWORD="$PASS" "$PSQL" \
  -h "$HOST" -p "$PORT" -U "$USER" -d "$DBNAME" \
  -v ON_ERROR_STOP=1 \
  -c "BEGIN;" \
  -f "$SCRATCH" \
  -c "ROLLBACK;"

echo
echo "── dry-run complete. Schema unchanged (ROLLBACK)."
