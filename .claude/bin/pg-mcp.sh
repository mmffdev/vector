#!/usr/bin/env bash
# Wrapper that launches Crystal DBA's `postgres-mcp` Docker image against
# one of the three dev pools, sourcing credentials from backend/.env.dev so
# nothing sensitive is ever written to a committed file.
#
# Pool argument matches docs/c_c_db_routing.md:
#   vector    → mmff_vector         (pool       — main app DB)
#   artefacts → vector_artefacts    (vaPool     — cutover substrate)
#   library   → mmff_library        (libPools   — read-only library spine)
#
# READ-ONLY by force: `--access-mode=restricted` is hard-coded below. This
# routes every query through SafeSqlDriver (pglast-validated AST, statement
# allow-list, function allow-list, force_readonly=True hardcoded, 30s timeout,
# locking-clauses + EXPLAIN ANALYZE rejected). Pairs with the "never assume a
# database" HARD RULE: Claude can inspect/query but cannot mutate.
#
# Vetting: see github.com/crystaldba/postgres-mcp/blob/main/src/postgres_mcp/sql/safe_sql.py
# Image pinned: crystaldba/postgres-mcp:0.3.0
#   digest sha256:dbbd346860d29f1543e991f30f3284bf4ab5f096d049ecc3426528f20b1b6e6b
#
# Hard-coded to backend/.env.dev. The HARD RULE pins backend env to `dev`;
# never make this wrapper aware of staging/production.

set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/backend/.env.dev"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "pg-mcp: $ENV_FILE not found" >&2
  exit 2
fi

# Source .env.dev with auto-export so VAR=value lines become env vars
# without leaking the values into shell history.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

POOL="${1:-}"
case "$POOL" in
  vector)
    URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
    ;;
  artefacts)
    URL="postgresql://${VA_DB_USER}:${VA_DB_PASSWORD}@${VA_DB_HOST}:${VA_DB_PORT}/${VA_DB_NAME}"
    ;;
  library)
    URL="postgresql://${LIBRARY_DB_USER}:${LIBRARY_DB_PASSWORD}@${LIBRARY_DB_HOST}:${LIBRARY_DB_PORT}/${LIBRARY_DB_NAME}"
    ;;
  *)
    echo "pg-mcp: usage: pg-mcp.sh <vector|artefacts|library>" >&2
    exit 2
    ;;
esac

# Docker run flags:
#   --rm        remove container when stdio closes
#   -i          keep stdin open for JSON-RPC
#   --init      tini PID 1 for clean signal forwarding
#   -e          inject DATABASE_URI; container's image entrypoint auto-remaps
#               `localhost` → `host.docker.internal` on macOS, so the dev
#               tunnel at :5435 is reachable from inside.
#
# Image flag:
#   --access-mode=restricted  HARDCODED. Removing this enables read/write.
exec docker run --rm -i --init \
  -e DATABASE_URI="$URL" \
  crystaldba/postgres-mcp:0.3.0 \
  --access-mode=restricted
