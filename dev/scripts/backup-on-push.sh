#!/usr/bin/env bash
# backup-on-push.sh — downstream script for both Channel A (git pre-push)
# and Channel B (Claude PreToolUse). Never blocks the push.
#
# Usage:
#   git pre-push:   stdin "<local-ref> <local-sha> <remote-ref> <remote-sha>" lines
#                   invoked as: backup-on-push.sh --channel git
#   Claude hook:    invoked as: backup-on-push.sh --channel claude --sha <short-sha>
#   Manual:         invoked as: backup-on-push.sh --channel manual --sha <short-sha>
#
# Exit: always 0.

set -u

PROJECT_ROOT="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
cd "$PROJECT_ROOT" 2>/dev/null || exit 0

BACKUP_DIR="$PROJECT_ROOT/local-assets/backups"
LOG_FILE="$BACKUP_DIR/backup-log.jsonl"
SKIP_LOG="$BACKUP_DIR/skip-warnings.log"
DIAG_LOG_DIR="$PROJECT_ROOT/dev/logs"
DIAG_LOG="$DIAG_LOG_DIR/backup-on-push.log"
NO_BACKUP_SENTINEL="$PROJECT_ROOT/.claude/no-push-backup"
PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
DEDUPE_WINDOW_SECONDS=600
RETENTION_COUNT=20
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR" "$DIAG_LOG_DIR"

# Single source of truth for the dev tunnel port (env-file → probe → default).
# Sets DEV_DB_PORT and DEV_DB_PORT_SOURCE.
# shellcheck source=./resolve-dev-db-port.sh
. "$PROJECT_ROOT/dev/scripts/resolve-dev-db-port.sh"
resolve_dev_db_port

CHANNEL=""
SHA_ARG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="$2"; shift 2 ;;
    --sha)     SHA_ARG="$2"; shift 2 ;;
    *)         shift ;;
  esac
done
CHANNEL="${CHANNEL:-unknown}"

now_iso()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_epoch(){ date +%s; }
ts_fname() { date +%Y%m%d_%H%M%S; }

json_escape() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().rstrip()))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
}

log_entry() {
  local status="$1" sha="$2" label="$3" filename="$4" bytes="$5" dur_ms="$6" reason="$7"
  local reason_json
  reason_json=$(printf '%s' "$reason" | json_escape)
  printf '{"ts":"%s","channel":"%s","status":"%s","sha":"%s","label":"%s","filename":"%s","bytes":%s,"duration_ms":%s,"skip_reason":%s}\n' \
    "$(now_iso)" "$CHANNEL" "$status" "$sha" "$label" "$filename" "${bytes:-0}" "${dur_ms:-0}" "$reason_json" \
    >> "$LOG_FILE"
}

emit_skip_banner() {
  local reason="$1"
  printf '\033[31m⚠ backup-on-push SKIPPED: %s. Run `<backupsql>` manually to recover.\033[0m\n' "$reason" >&2
  printf '\033[31m   resolved port: %s (source: %s) — see dev/logs/backup-on-push.log for full diagnostics\033[0m\n' \
    "${DEV_DB_PORT:-?}" "${DEV_DB_PORT_SOURCE:-?}" >&2
  printf '%s\t%s\t%s\n' "$(now_iso)" "$CHANNEL" "$reason" >> "$SKIP_LOG"
}

# write_diag_log — append a multi-line diagnostic block to dev/logs/backup-on-push.log.
# Captures everything Claude or the user needs to root-cause a skip without rerunning.
# Args: $1 reason  $2 sha
write_diag_log() {
  local reason="$1" sha="$2"
  {
    printf '======== %s ========\n' "$(now_iso)"
    printf 'channel:        %s\n' "$CHANNEL"
    printf 'reason:         %s\n' "$reason"
    printf 'sha:            %s\n' "$sha"
    printf 'resolved port:  %s\n' "${DEV_DB_PORT:-?}"
    printf 'port source:    %s\n' "${DEV_DB_PORT_SOURCE:-?}"
    printf '\n-- LISTEN sockets on 5430-5439 --\n'
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:5430-5439 -sTCP:LISTEN 2>/dev/null || printf '(none)\n'
    else
      printf '(lsof unavailable)\n'
    fi
    printf '\n-- ssh tunnel processes (-L flag or known dev aliases) --\n'
    {
      ps -A -o pid,command 2>/dev/null \
        | grep -E '(^|[[:space:]])ssh([[:space:]]|$).*(-L|vector-dev-pg|mmffdev-pg)' \
        | grep -v grep
    } || printf '(none)\n'
    printf '\n-- ACTIVE BACKEND ENV marker (.claude/CLAUDE.md) --\n'
    grep -E '^> \*\*ACTIVE BACKEND ENV' "$PROJECT_ROOT/.claude/CLAUDE.md" 2>/dev/null \
      | head -n 1 \
      || printf '(marker line not found)\n'
    printf '\n'
  } >> "$DIAG_LOG" 2>/dev/null || true
}

# -- Resolve SHA ------------------------------------------------------------
SHA=""
if [[ "$CHANNEL" == "git" ]]; then
  # git feeds "<local-ref> <local-sha> <remote-ref> <remote-sha>" per ref; grab first non-zero local-sha
  while read -r _lref lsha _rref _rsha; do
    [[ -z "${lsha:-}" || "$lsha" == "0000000000000000000000000000000000000000" ]] && continue
    SHA=$(git rev-parse --short "$lsha" 2>/dev/null || true)
    break
  done
  [[ -z "$SHA" ]] && SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
else
  SHA="${SHA_ARG:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}"
fi

# -- Resolve label (tag if present, else short SHA) -------------------------
LABEL=""
if TAG=$(git describe --tags --exact-match "$SHA" 2>/dev/null); then
  LABEL="$TAG"
else
  LABEL="$SHA"
fi

# -- Opt-out checks ---------------------------------------------------------
if [[ "${SKIP_PUSH_BACKUP:-0}" == "1" ]]; then
  log_entry "opt-out-env" "$SHA" "$LABEL" "" 0 0 "SKIP_PUSH_BACKUP=1"
  exit 0
fi

if [[ -f "$NO_BACKUP_SENTINEL" ]]; then
  log_entry "opt-out-sentinel" "$SHA" "$LABEL" "" 0 0 ".claude/no-push-backup present"
  exit 0
fi

if git log -1 --pretty=%B HEAD 2>/dev/null | grep -qF '[skip-backup]'; then
  log_entry "opt-out-commit-msg" "$SHA" "$LABEL" "" 0 0 "[skip-backup] in commit message"
  exit 0
fi

# -- Dedupe -----------------------------------------------------------------
if [[ -f "$LOG_FILE" ]]; then
  LAST_OK=$(tail -n 50 "$LOG_FILE" | grep '"status":"ok"' | tail -n 1 || true)
  if [[ -n "$LAST_OK" ]]; then
    LAST_SHA=$(printf '%s' "$LAST_OK" | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p')
    LAST_TS=$(printf '%s' "$LAST_OK"  | sed -n 's/.*"ts":"\([^"]*\)".*/\1/p')
    if [[ "$LAST_SHA" == "$SHA" && -n "$LAST_TS" ]]; then
      LAST_EPOCH=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_TS" +%s 2>/dev/null || echo 0)
      AGE=$(( $(now_epoch) - LAST_EPOCH ))
      if (( LAST_EPOCH > 0 && AGE < DEDUPE_WINDOW_SECONDS )); then
        log_entry "deduped" "$SHA" "$LABEL" "" 0 0 "prior ok entry ${AGE}s ago"
        exit 0
      fi
    fi
  fi
fi

# -- Tunnel check -----------------------------------------------------------
# DEV_DB_PORT and DEV_DB_PORT_SOURCE were set by resolve_dev_db_port at the top.
DB_PORT="$DEV_DB_PORT"

# -- Dry-run path -----------------------------------------------------------
# BACKUP_DRY_RUN=1 → resolve everything, print the plan, exit 0 without dumping.
if [[ "${BACKUP_DRY_RUN:-0}" == "1" ]]; then
  printf 'backup-on-push: DRY RUN\n'
  printf '  channel:        %s\n' "$CHANNEL"
  printf '  sha:            %s (label=%s)\n' "$SHA" "$LABEL"
  printf '  resolved port:  %s\n' "$DB_PORT"
  printf '  port source:    %s\n' "$DEV_DB_PORT_SOURCE"
  if nc -z localhost "$DB_PORT" 2>/dev/null; then
    printf '  tunnel check:   OK (something LISTENing on %s)\n' "$DB_PORT"
  else
    printf '  tunnel check:   FAIL (nothing LISTENing on %s)\n' "$DB_PORT"
  fi
  printf '  diag log:       %s\n' "$DIAG_LOG"
  exit 0
fi

if ! nc -z localhost "$DB_PORT" 2>/dev/null; then
  reason="tunnel_down: localhost:$DB_PORT (source=$DEV_DB_PORT_SOURCE)"
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "$reason"
  write_diag_log "$reason" "$SHA"
  emit_skip_banner "SSH tunnel down (localhost:$DB_PORT unreachable)"
  exit 0
fi

# -- Credentials ------------------------------------------------------------
# Prefer .env.dev (the canonical pinned-to-dev file); fall back to .env.local.
ENV_FILE=""
for cand in "$PROJECT_ROOT/backend/.env.dev" "$PROJECT_ROOT/backend/.env.local"; do
  if [[ -f "$cand" ]]; then ENV_FILE="$cand"; break; fi
done
if [[ -z "$ENV_FILE" ]]; then
  reason="env_missing: backend/.env.dev and backend/.env.local both missing"
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "$reason"
  write_diag_log "$reason" "$SHA"
  emit_skip_banner "backend/.env.dev and backend/.env.local both missing"
  exit 0
fi
PW=$(grep '^DB_PASSWORD' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')
LIB_PW=$(grep '^LIBRARY_DB_PASSWORD' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')
LIB_PORT=$(grep '^LIBRARY_DB_PORT' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]')
LIB_PORT="${LIB_PORT:-$DB_PORT}"
VA_PW=$(grep '^VA_DB_PASSWORD' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')
VA_PORT=$(grep '^VA_DB_PORT' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'' | tr -d '[:space:]')
VA_PORT="${VA_PORT:-$DB_PORT}"
ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/SQL Backups Vector"
mkdir -p "$ICLOUD_DIR" 2>/dev/null || true
if [[ -z "$PW" ]]; then
  reason="env_missing: DB_PASSWORD not set in $(basename "$ENV_FILE")"
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "$reason"
  write_diag_log "$reason" "$SHA"
  emit_skip_banner "DB_PASSWORD not found in $(basename "$ENV_FILE")"
  exit 0
fi

if [[ ! -x "$PG_DUMP" ]]; then
  reason="pg_dump_missing: $PG_DUMP"
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "$reason"
  write_diag_log "$reason" "$SHA"
  emit_skip_banner "pg_dump not found at $PG_DUMP (install libpq)"
  exit 0
fi

# -- Dump mmff_vector -------------------------------------------------------
# Filename shape: <ts>_<sha>_dev_<dbname>.sql — matches the <backupsql> shortcut.
# `dev_` is the env tag (this script only runs against the pinned-dev tunnel).
TS=$(ts_fname)
OUT="$BACKUP_DIR/${TS}_${LABEL}_dev_mmff_vector.sql"
START_MS=$(($(date +%s) * 1000))

if ! PGPASSWORD="$PW" "$PG_DUMP" \
    -h localhost -p "$DB_PORT" -U mmff_dev -d mmff_vector \
    --no-owner --no-privileges \
    > "$OUT" 2> "$OUT.err"; then
  ERR_TAIL=$(tail -c 300 "$OUT.err" 2>/dev/null | tr '\n' ' ')
  rm -f "$OUT" "$OUT.err"
  reason="pg_dump_failed: $ERR_TAIL"
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "$reason"
  write_diag_log "$reason" "$SHA"
  emit_skip_banner "pg_dump failed: $ERR_TAIL"
  exit 0
fi
rm -f "$OUT.err"

END_MS=$(($(date +%s) * 1000))
DUR=$(( END_MS - START_MS ))
BYTES=$(wc -c < "$OUT" | tr -d ' ')
log_entry "ok" "$SHA" "$LABEL" "$(basename "$OUT")" "$BYTES" "$DUR" ""
printf 'backup-on-push: ok [%s] %s (%s bytes, %sms, channel=%s)\n' \
  "$LABEL" "$(basename "$OUT")" "$BYTES" "$DUR" "$CHANNEL"

# Track per-DB success so we only mirror to iCloud if everything dumped cleanly.
LIB_OK=0
VA_OK=0
OUT_LIB=""
OUT_VA=""

# -- Dump mmff_library ------------------------------------------------------
if [[ -n "$LIB_PW" ]]; then
  OUT_LIB="$BACKUP_DIR/${TS}_${LABEL}_dev_mmff_library.sql"
  START_MS=$(($(date +%s) * 1000))

  if ! PGPASSWORD="$LIB_PW" "$PG_DUMP" \
      -h localhost -p "$LIB_PORT" -U mmff_dev -d mmff_library \
      --no-owner --no-privileges \
      > "$OUT_LIB" 2> "$OUT_LIB.err"; then
    ERR_TAIL=$(tail -c 300 "$OUT_LIB.err" 2>/dev/null | tr '\n' ' ')
    rm -f "$OUT_LIB" "$OUT_LIB.err"
    OUT_LIB=""
    reason="pg_dump_failed (library): $ERR_TAIL"
    log_entry "skipped" "$SHA" "${LABEL}_library" "" 0 0 "$reason"
    write_diag_log "$reason" "$SHA"
    emit_skip_banner "pg_dump mmff_library failed: $ERR_TAIL"
  else
    rm -f "$OUT_LIB.err"
    END_MS=$(($(date +%s) * 1000))
    DUR=$(( END_MS - START_MS ))
    BYTES_LIB=$(wc -c < "$OUT_LIB" | tr -d ' ')
    LIB_OK=1
    log_entry "ok" "$SHA" "${LABEL}_library" "$(basename "$OUT_LIB")" "$BYTES_LIB" "$DUR" ""
    printf 'backup-on-push: ok [%s] %s (%s bytes, %sms, channel=%s)\n' \
      "${LABEL}_library" "$(basename "$OUT_LIB")" "$BYTES_LIB" "$DUR" "$CHANNEL"
  fi
fi

# -- Dump vector_artefacts --------------------------------------------------
if [[ -n "$VA_PW" ]]; then
  OUT_VA="$BACKUP_DIR/${TS}_${LABEL}_dev_vector_artefacts.sql"
  START_MS=$(($(date +%s) * 1000))

  if ! PGPASSWORD="$VA_PW" "$PG_DUMP" \
      -h localhost -p "$VA_PORT" -U mmff_dev -d vector_artefacts \
      --no-owner --no-privileges \
      > "$OUT_VA" 2> "$OUT_VA.err"; then
    ERR_TAIL=$(tail -c 300 "$OUT_VA.err" 2>/dev/null | tr '\n' ' ')
    rm -f "$OUT_VA" "$OUT_VA.err"
    OUT_VA=""
    reason="pg_dump_failed (vector_artefacts): $ERR_TAIL"
    log_entry "skipped" "$SHA" "${LABEL}_vector_artefacts" "" 0 0 "$reason"
    write_diag_log "$reason" "$SHA"
    emit_skip_banner "pg_dump vector_artefacts failed: $ERR_TAIL"
  else
    rm -f "$OUT_VA.err"
    END_MS=$(($(date +%s) * 1000))
    DUR=$(( END_MS - START_MS ))
    BYTES_VA=$(wc -c < "$OUT_VA" | tr -d ' ')
    VA_OK=1
    log_entry "ok" "$SHA" "${LABEL}_vector_artefacts" "$(basename "$OUT_VA")" "$BYTES_VA" "$DUR" ""
    printf 'backup-on-push: ok [%s] %s (%s bytes, %sms, channel=%s)\n' \
      "${LABEL}_vector_artefacts" "$(basename "$OUT_VA")" "$BYTES_VA" "$DUR" "$CHANNEL"
  fi
fi

# -- iCloud mirror ----------------------------------------------------------
# Mirror only if all three DBs dumped successfully — otherwise the iCloud copy
# would be partial and confusing. Failures here are non-fatal (push never blocks).
if [[ $LIB_OK -eq 1 && $VA_OK -eq 1 && -d "$ICLOUD_DIR" ]]; then
  cp "$OUT"     "$ICLOUD_DIR/" 2>/dev/null || true
  cp "$OUT_LIB" "$ICLOUD_DIR/" 2>/dev/null || true
  cp "$OUT_VA"  "$ICLOUD_DIR/" 2>/dev/null || true
fi

# -- Retention --------------------------------------------------------------
if [[ "${SKIP_BACKUP_PRUNE:-0}" != "1" ]]; then
  python3 - "$BACKUP_DIR" "$RETENTION_COUNT" "$RETENTION_DAYS" <<'PY' || true
import os, re, sys, time
backup_dir, keep_n, keep_days = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
now = time.time()
cutoff = now - keep_days * 86400
SHA_RE = re.compile(
    r'^('
    r'[0-9a-f]{4,40}_\d{8}_\d{6}(_library)?\.sql'                     # legacy: <sha>_<ts>(_library).sql
    r'|\d{8}_\d{6}_[0-9a-f]{4,40}_dev_(mmff_vector|mmff_library|vector_artefacts)\.sql'  # new: <ts>_<sha>_dev_<dbname>.sql
    r')$'
)
candidates = []
for name in os.listdir(backup_dir):
    path = os.path.join(backup_dir, name)
    if not name.endswith('.sql') or not os.path.isfile(path):
        continue
    if not SHA_RE.match(name):
        continue  # tagged or unrecognised — keep forever
    candidates.append((os.path.getmtime(path), path))
candidates.sort(reverse=True)  # newest first
keep_idx = set(range(min(keep_n, len(candidates))))
for i, (mtime, path) in enumerate(candidates):
    if i in keep_idx or mtime >= cutoff:
        continue
    try:
        os.remove(path)
    except OSError:
        pass
PY
fi

exit 0
