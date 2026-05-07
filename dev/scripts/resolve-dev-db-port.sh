#!/usr/bin/env bash
# resolve-dev-db-port.sh — single source of truth for the dev Postgres tunnel
# port on this laptop. Sourced (or executed) by every script that needs to
# talk to the dev DB through the SSH tunnel.
#
# Resolution order (first match wins):
#   1. $DEV_DB_PORT_OVERRIDE  (env override; for tests / one-off use)
#   2. backend/.env.dev       DB_PORT=...   (canonical — matches Go backend)
#   3. backend/.env.local     DB_PORT=...   (legacy alias, also pinned to dev)
#   4. probe localhost:5435 LISTEN          (current dev convention)
#   5. probe localhost:5434 LISTEN          (legacy fallback)
#
# When sourced, exports:
#   DEV_DB_PORT          — resolved integer
#   DEV_DB_PORT_SOURCE   — short label describing where it came from
#                          (env-override | env-file:<path> | probe:<port> | default)
#
# When executed (no `source`), prints "<port>\t<source>" to stdout, exits 0
# always. Callers that want to fail on unresolved should check the source
# string for the "default" fallback.
#
# This file has NO side effects beyond setting the two variables / printing.

# `set -u` would break consumers that source us — leave it off.

_rdp_repo_root() {
  # Anchored to this script's location, not $PWD, so callers from anywhere work.
  local self_dir
  self_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
  ( cd "$self_dir/../.." && pwd )
}

_rdp_grep_port() {
  # $1: env file path. Echoes the DB_PORT value with quotes / whitespace stripped.
  local file="$1" raw=""
  [[ -r "$file" ]] || return 1
  raw=$(grep -E '^[[:space:]]*DB_PORT[[:space:]]*=' "$file" 2>/dev/null \
        | tail -n 1 \
        | sed -E 's/^[[:space:]]*DB_PORT[[:space:]]*=[[:space:]]*//' \
        | sed -E 's/[[:space:]]+#.*$//' \
        | sed -E 's/^"(.*)"$/\1/' \
        | sed -E "s/^'(.*)'\$/\\1/" \
        | tr -d '[:space:]')
  [[ "$raw" =~ ^[0-9]+$ ]] || return 1
  printf '%s' "$raw"
}

_rdp_probe() {
  # $1: port. Returns 0 if a process is LISTENing on that port.
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  fi
  if command -v nc >/dev/null 2>&1; then
    nc -z localhost "$port" 2>/dev/null && return 0
  fi
  return 1
}

resolve_dev_db_port() {
  local repo env_dev env_local val
  repo="$(_rdp_repo_root)"
  env_dev="$repo/backend/.env.dev"
  env_local="$repo/backend/.env.local"

  if [[ -n "${DEV_DB_PORT_OVERRIDE:-}" ]]; then
    DEV_DB_PORT="$DEV_DB_PORT_OVERRIDE"
    DEV_DB_PORT_SOURCE="env-override:DEV_DB_PORT_OVERRIDE"
    return 0
  fi

  if val=$(_rdp_grep_port "$env_dev"); then
    DEV_DB_PORT="$val"
    DEV_DB_PORT_SOURCE="env-file:backend/.env.dev"
    return 0
  fi

  if val=$(_rdp_grep_port "$env_local"); then
    DEV_DB_PORT="$val"
    DEV_DB_PORT_SOURCE="env-file:backend/.env.local"
    return 0
  fi

  if _rdp_probe 5435; then
    DEV_DB_PORT=5435
    DEV_DB_PORT_SOURCE="probe:5435-listening"
    return 0
  fi

  if _rdp_probe 5434; then
    DEV_DB_PORT=5434
    DEV_DB_PORT_SOURCE="probe:5434-listening"
    return 0
  fi

  DEV_DB_PORT=5435
  DEV_DB_PORT_SOURCE="default:5435-no-evidence"
  return 0
}

# If executed (not sourced) emit the resolved pair and exit.
# Detection: ${BASH_SOURCE[0]} == $0 means this file is the entry point.
if [[ "${BASH_SOURCE[0]:-$0}" == "${0}" ]]; then
  resolve_dev_db_port
  printf '%s\t%s\n' "$DEV_DB_PORT" "$DEV_DB_PORT_SOURCE"
  exit 0
fi
