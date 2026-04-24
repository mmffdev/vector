#!/usr/bin/env bash
# mmff-Ops — Intelligent laptop setup script
#
# Streamed through the backend to the frontend as a shell trace.
# When a step is missing, emits a [PROMPT] sentinel line that the frontend
# intercepts and renders as Yes/No buttons. The user's reply comes back on
# stdin as a single line ("y" or "n").
#
# Protocol:
#   [STEP] <name>               — new step heading
#   [OK]   <name>               — step verified, nothing to do
#   [INFO] <message>            — progress / context line
#   [WARN] <message>            — non-fatal warning
#   [ERR]  <message>            — fatal error (script exits non-zero)
#   [PROMPT] <question> [y/N]   — wait for stdin reply (y or n)
#   [DONE]                      — final line, always emitted on clean exit
#
# Stream lines are unbuffered (stdbuf / printf) so the frontend sees them live.

set -u  # no unset vars; we handle errors explicitly per-step

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_HOST="mmffdev.com"
SERVER_USER="root"
TUNNEL_PORT=5434
REMOTE_PG_PORT=5432
ADMINER_LOCAL_PORT=8081
ADMINER_REMOTE_PORT=8081
RABBITMQ_MGMT_LOCAL_PORT=15672
RABBITMQ_MGMT_REMOTE_PORT=15672
PORTAINER_LOCAL_PORT=9000
PORTAINER_REMOTE_PORT=9000
HOMEPAGE_LOCAL_PORT=8082
HOMEPAGE_REMOTE_PORT=3000
SSH_CONFIG="$HOME/.ssh/config"
SSH_KEY="$HOME/.ssh/id_ed25519"
ENV_LOCAL="$REPO_ROOT/backend/.env.local"
DB_PASSWORD_DEFAULT='9&cr39&19&11Ctcr'

# ---------- helpers ----------

emit() { printf '%s\n' "$*"; }

step()   { emit "[STEP] $*"; }
ok()     { emit "[OK] $*"; }
info()   { emit "[INFO] $*"; }
warn()   { emit "[WARN] $*"; }
err()    { emit "[ERR] $*"; }

# ask "question" — emits PROMPT, reads one line, returns 0 for yes, 1 for no.
ask() {
  emit "[PROMPT] $1 [y/N]"
  local reply
  IFS= read -r reply || reply=""
  case "$reply" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------- steps ----------

check_brew() {
  step "Homebrew"
  if has_cmd brew; then
    ok "brew $(brew --version | head -1)"
    return 0
  fi
  info "Homebrew not found."
  if ask "Install Homebrew now?"; then
    info "Running Homebrew installer (may prompt for sudo password in terminal)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
      err "Homebrew install failed."
      return 1
    }
    # Post-install: add brew to PATH for apple silicon
    if [ -x /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    has_cmd brew && ok "Homebrew installed." || { err "Homebrew still missing after install."; return 1; }
  else
    err "Homebrew is required. Aborting."
    return 1
  fi
}

check_libpq() {
  step "libpq (psql / pg_dump)"
  if has_cmd psql; then
    ok "psql $(psql --version)"
    return 0
  fi
  info "psql not found."
  if ask "Install libpq via brew and add to PATH?"; then
    brew install libpq || { err "brew install libpq failed."; return 1; }
    # keg-only — need to link via PATH
    local shellrc="$HOME/.zshrc"
    local libpq_path_line='export PATH="/opt/homebrew/opt/libpq/bin:$PATH"'
    if ! grep -qF "$libpq_path_line" "$shellrc" 2>/dev/null; then
      printf '\n# Added by mmff-Ops setup\n%s\n' "$libpq_path_line" >> "$shellrc"
      info "Added libpq to PATH in $shellrc"
    fi
    export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
    has_cmd psql && ok "psql on PATH." || { err "psql still missing after install."; return 1; }
  else
    warn "Skipped libpq — DB verification steps will be skipped."
  fi
}

check_autossh() {
  step "autossh (resilient tunnel)"
  if has_cmd autossh; then
    ok "autossh present"
    return 0
  fi
  info "autossh not found."
  if ask "Install autossh via brew?"; then
    brew install autossh || { err "brew install autossh failed."; return 1; }
    ok "autossh installed."
  else
    warn "Skipped autossh — plain ssh tunnel will be used (no auto-reconnect)."
  fi
}

check_node() {
  step "Node 20.x"
  if has_cmd node; then
    local v
    v="$(node --version)"
    if [[ "$v" =~ ^v20\. ]]; then
      ok "node $v"
      return 0
    fi
    warn "node $v present but project expects v20.x"
  else
    info "node not found."
  fi
  if ask "Install node@20 via brew?"; then
    brew install node@20 || { err "brew install node@20 failed."; return 1; }
    local shellrc="$HOME/.zshrc"
    local node_path_line='export PATH="/opt/homebrew/opt/node@20/bin:$PATH"'
    if ! grep -qF "$node_path_line" "$shellrc" 2>/dev/null; then
      printf '\n# Added by mmff-Ops setup\n%s\n' "$node_path_line" >> "$shellrc"
      info "Added node@20 to PATH in $shellrc"
    fi
    export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
    ok "node $(node --version)"
  else
    warn "Skipped node — backend/frontend installs will fail without it."
  fi
}

check_ssh_key() {
  step "SSH key (ed25519)"
  if [ -f "$SSH_KEY.pub" ]; then
    ok "Found $SSH_KEY.pub"
    return 0
  fi
  info "No ed25519 key at $SSH_KEY.pub"
  if ask "Generate a new ed25519 key (passphrase optional)?"; then
    ssh-keygen -t ed25519 -C "laptop@mmffdev" -f "$SSH_KEY" -N "" || {
      err "ssh-keygen failed."
      return 1
    }
    ok "Key generated."
  else
    warn "Skipped key generation. SSH-dependent steps will fail."
    return 1
  fi
}

check_ssh_copy_id() {
  step "Server access (ssh key installed on $SERVER_HOST)"
  if ssh -o BatchMode=yes -o ConnectTimeout=5 "$SERVER_USER@$SERVER_HOST" "echo ok" 2>/dev/null | grep -q '^ok$'; then
    ok "Key auth already works."
    return 0
  fi
  info "Key auth not working yet."
  if ask "Run ssh-copy-id to push your public key (will prompt for server password)?"; then
    ssh-copy-id "$SERVER_USER@$SERVER_HOST" || {
      err "ssh-copy-id failed. Check server reachability or fail2ban."
      return 1
    }
    ssh -o BatchMode=yes -o ConnectTimeout=5 "$SERVER_USER@$SERVER_HOST" "echo ok" 2>/dev/null | grep -q '^ok$' \
      && ok "Key auth works now." || { err "Key auth still failing."; return 1; }
  else
    warn "Skipped — tunnel steps will fail without server key access."
    return 1
  fi
}

check_ssh_config() {
  step "SSH config entries (mmffdev-pg, mmffdev-homepage, mmffdev-admin)"
  mkdir -p "$HOME/.ssh"
  touch "$SSH_CONFIG"
  chmod 600 "$SSH_CONFIG"
  local missing_pg=0 missing_hp=0 missing_admin=0
  grep -q '^Host mmffdev-pg$' "$SSH_CONFIG" || missing_pg=1
  grep -q '^Host mmffdev-homepage$' "$SSH_CONFIG" || missing_hp=1
  grep -q '^Host mmffdev-admin$' "$SSH_CONFIG" || missing_admin=1
  if [ "$missing_pg" -eq 0 ] && [ "$missing_hp" -eq 0 ] && [ "$missing_admin" -eq 0 ]; then
    ok "All aliases present."
    return 0
  fi
  info "One or more ssh aliases missing."
  if ask "Append missing mmffdev-* blocks to ~/.ssh/config?"; then
    if [ "$missing_pg" -eq 1 ]; then
      cat >> "$SSH_CONFIG" <<EOF

# Added by mmff-Ops setup
Host mmffdev-pg
  HostName $SERVER_HOST
  User $SERVER_USER
  LocalForward $TUNNEL_PORT localhost:$REMOTE_PG_PORT
  LocalForward $ADMINER_LOCAL_PORT localhost:$ADMINER_REMOTE_PORT
  LocalForward $RABBITMQ_MGMT_LOCAL_PORT localhost:$RABBITMQ_MGMT_REMOTE_PORT
  LocalForward $PORTAINER_LOCAL_PORT localhost:$PORTAINER_REMOTE_PORT
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes
EOF
    fi
    if [ "$missing_hp" -eq 1 ]; then
      cat >> "$SSH_CONFIG" <<EOF

Host mmffdev-homepage
  HostName $SERVER_HOST
  User $SERVER_USER
  LocalForward $HOMEPAGE_LOCAL_PORT localhost:$HOMEPAGE_REMOTE_PORT
  ServerAliveInterval 30
  ServerAliveCountMax 3
  ExitOnForwardFailure yes
EOF
    fi
    if [ "$missing_admin" -eq 1 ]; then
      cat >> "$SSH_CONFIG" <<EOF

Host mmffdev-admin
  HostName $SERVER_HOST
  User $SERVER_USER
  ServerAliveInterval 30
  ServerAliveCountMax 3
EOF
    fi
    ok "ssh config updated."
  else
    warn "Skipped ssh config — tunnel(s) will not start via alias."
  fi
}

check_tunnel() {
  step "SSH tunnel on localhost:$TUNNEL_PORT"
  if nc -z localhost "$TUNNEL_PORT" 2>/dev/null; then
    ok "Tunnel already listening."
    return 0
  fi
  info "Tunnel not up."
  if ask "Start tunnel now (autossh if available, else ssh -N -f)?"; then
    if has_cmd autossh; then
      autossh -M 0 -N -f mmffdev-pg || { err "autossh failed to start."; return 1; }
    else
      ssh -N -f mmffdev-pg || { err "ssh -N -f failed."; return 1; }
    fi
    sleep 2
    nc -z localhost "$TUNNEL_PORT" 2>/dev/null \
      && ok "Tunnel is up." \
      || { err "Tunnel not listening after start."; return 1; }
  else
    warn "Skipped — DB verification will fail."
  fi
}

check_homepage_tunnel() {
  step "Homepage tunnel on localhost:$HOMEPAGE_LOCAL_PORT"
  if nc -z localhost "$HOMEPAGE_LOCAL_PORT" 2>/dev/null; then
    ok "Homepage tunnel already listening."
    return 0
  fi
  info "Homepage tunnel not up."
  if ask "Start homepage tunnel now (autossh if available, else ssh -N -f)?"; then
    if has_cmd autossh; then
      autossh -M 0 -N -f mmffdev-homepage || { err "autossh failed to start."; return 1; }
    else
      ssh -N -f mmffdev-homepage || { err "ssh -N -f failed."; return 1; }
    fi
    sleep 2
    nc -z localhost "$HOMEPAGE_LOCAL_PORT" 2>/dev/null \
      && ok "Homepage tunnel is up — http://localhost:$HOMEPAGE_LOCAL_PORT" \
      || { err "Homepage tunnel not listening after start."; return 1; }
  else
    warn "Skipped — Homepage will not be reachable at localhost:$HOMEPAGE_LOCAL_PORT."
  fi
}

check_env_local() {
  step "backend/.env.local"
  if [ -f "$ENV_LOCAL" ]; then
    if grep -q '^DB_PORT=' "$ENV_LOCAL" && grep -q '^DB_PASSWORD=' "$ENV_LOCAL"; then
      ok "$ENV_LOCAL exists with required vars."
      return 0
    fi
    warn "$ENV_LOCAL exists but appears incomplete."
  fi
  info "$ENV_LOCAL missing or incomplete."
  if ask "Write a default .env.local for REMOTE Postgres (port $TUNNEL_PORT)?"; then
    cat > "$ENV_LOCAL" <<EOF
# Per-machine secrets — git-ignored. Not committed.
# Points backend at remote Postgres on $SERVER_HOST through the SSH tunnel.
# Tunnel must be running: ssh -N -f mmffdev-pg (LocalForward $TUNNEL_PORT -> localhost:$REMOTE_PG_PORT)

DB_HOST=localhost
DB_PORT=$TUNNEL_PORT
DB_NAME=mmff_vector
DB_USER=mmff_dev
DB_PASSWORD="$DB_PASSWORD_DEFAULT"

# To use local dev PG instead, switch to:
# DB_PORT=5433
# DB_PASSWORD=dev_password_local
EOF
    chmod 600 "$ENV_LOCAL"
    ok "Wrote $ENV_LOCAL"
  else
    warn "Skipped — backend will fall back to local-dev defaults."
  fi
}

check_dotenv_installed() {
  step "backend dotenv dependency"
  if [ -d "$REPO_ROOT/backend/node_modules/dotenv" ]; then
    ok "dotenv present in backend/node_modules."
    return 0
  fi
  info "backend dotenv not installed."
  if ask "Run 'npm install' in backend/ now?"; then
    ( cd "$REPO_ROOT/backend" && npm install ) || { err "npm install failed."; return 1; }
    ok "Backend dependencies installed."
  else
    warn "Skipped — backend may fail to load .env.local."
  fi
}

verify_db() {
  step "Verify remote Postgres (round-trip through tunnel)"
  if ! has_cmd psql; then
    warn "psql missing — skipping DB verification."
    return 0
  fi
  if ! nc -z localhost "$TUNNEL_PORT" 2>/dev/null; then
    warn "Tunnel not up — skipping DB verification."
    return 0
  fi
  local pw
  if [ -f "$ENV_LOCAL" ]; then
    pw="$(grep '^DB_PASSWORD=' "$ENV_LOCAL" | sed -E 's/^DB_PASSWORD=//; s/^"(.*)"$/\1/')"
  fi
  pw="${pw:-$DB_PASSWORD_DEFAULT}"
  local count
  count=$(PGPASSWORD="$pw" psql -h localhost -p "$TUNNEL_PORT" -U mmff_dev -d mmff_vector -tAc "SELECT 1;" 2>&1) || {
    err "DB query failed: $count"
    return 1
  }
  if [ "$count" = "1" ]; then
    ok "Connected to mmff_vector via tunnel."
  else
    err "Unexpected response: $count"
    return 1
  fi
}

# ---------- main ----------

emit "[INFO] mmff-Ops laptop setup — starting"
emit "[INFO] Repo root: $REPO_ROOT"
emit ""

check_brew           || exit 1
check_libpq
check_autossh
check_node
check_ssh_key        || true
check_ssh_copy_id    || true
check_ssh_config
check_tunnel
check_homepage_tunnel
check_env_local
check_dotenv_installed
verify_db            || true

emit ""
emit "[INFO] Setup finished."
emit "[DONE]"
