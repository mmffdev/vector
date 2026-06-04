#!/usr/bin/env bash
# Launch the Vector Log Viewer.
#
# Prereqs:
#   * Node >= 20
#   * The dev Postgres tunnel must be up so the viewer can reach vector_artefacts:
#       ssh -fN vector-dev-pg     # forwards localhost:5435 -> remote :5432
#   * ../backend/.env.dev must contain VECTOR_ARTEFACTS_DB_URL
#     (or set LOG_VIEWER_DB_URL to a read-only DSN of your own).
#
# Usage:
#   ./start.sh            # install (first run) + start on the configured port
#   PORT=4002 ./start.sh  # override the port

set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "▚ installing dependencies…"
  npm install
fi

# Friendly pre-flight: warn if the tunnel port isn't listening.
PORT_PG=5435
if ! nc -z localhost "$PORT_PG" 2>/dev/null; then
  echo "⚠  localhost:${PORT_PG} is not reachable — the DB tunnel may be down."
  echo "   Start it with:  ssh -fN vector-dev-pg"
  echo "   (Starting anyway; the viewer will show 'DB UNREACHABLE' until it's up.)"
fi

echo "▚ starting Vector Log Viewer…"
exec npm start
