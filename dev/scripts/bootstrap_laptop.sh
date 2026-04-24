#!/usr/bin/env bash
# One-shot bootstrap for a fresh laptop after `git clone` + `git pull`.
#
# Idempotent — safe to re-run. Each step prints OK / INFO / WARN / ERR and
# moves on; nothing is destroyed without a backup.
#
# What it does, in order:
#   1. Link auto-memory (~/.claude/projects/…/memory -> repo/.claude/memory)
#   2. Run ssh_manager.sh (brew, libpq, autossh, node, SSH key, ssh-copy-id,
#      ssh config, tunnel, .env.local, backend deps, DB verify)
#   3. Install the tunnel LaunchAgent (optional, asks)
#   4. Print the cheat-sheet (URLs, login, handy commands)

set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$REPO_ROOT/.." && pwd)"
SCRIPTS="$REPO_ROOT/dev/scripts"

banner() {
  printf '\n\033[1;36m=== %s ===\033[0m\n' "$*"
}

banner "1/3  Link auto-memory"
"$SCRIPTS/link_memory.sh" || echo "WARN: link_memory.sh failed — continuing."

banner "2/3  ssh_manager (dependencies, SSH, tunnel, env, DB)"
"$SCRIPTS/ssh_manager.sh" || echo "WARN: ssh_manager.sh exited non-zero — review output."

banner "3/3  LaunchAgent (auto-start tunnel at login)"
if [ -x "$SCRIPTS/install_launchagent.sh" ]; then
  read -r -p "Install LaunchAgent so the tunnel starts at login? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) "$SCRIPTS/install_launchagent.sh" ;;
    *) echo "Skipped LaunchAgent." ;;
  esac
else
  echo "INFO: install_launchagent.sh missing — skipping."
fi

cat <<'EOF'

============================================================
  Laptop ready. Cheat-sheet:
============================================================

  Tunnel (manual start):   ssh -N -f mmffdev-pg
  Tunnel status:           nc -z localhost 5434 && echo OK
  Adminer (DB UI):         http://localhost:8081
    System:    PostgreSQL
    Server:    mmff-ops-postgres
    User:      mmff_dev
    DB:        mmff_vector
    Password:  see backend/.env.local  (DB_PASSWORD)

  Dev server:              cd "$(pwd)" && npm run dev
                           -> http://localhost:3000

  Server admin shell:      ssh mmffdev-admin

============================================================
EOF
