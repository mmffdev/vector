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

PROJECT_ROOT="/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"
cd "$PROJECT_ROOT" 2>/dev/null || exit 0

BACKUP_DIR="$PROJECT_ROOT/local-assets/backups"
LOG_FILE="$BACKUP_DIR/backup-log.jsonl"
SKIP_LOG="$BACKUP_DIR/skip-warnings.log"
NO_BACKUP_SENTINEL="$PROJECT_ROOT/.claude/no-push-backup"
PG_DUMP="/opt/homebrew/opt/libpq/bin/pg_dump"
DEDUPE_WINDOW_SECONDS=600
RETENTION_COUNT=20
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

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
  printf '%s\t%s\t%s\n' "$(now_iso)" "$CHANNEL" "$reason" >> "$SKIP_LOG"
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
if ! nc -z localhost 5434 2>/dev/null; then
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "tunnel_down: localhost:5434"
  emit_skip_banner "SSH tunnel down (localhost:5434 unreachable)"
  exit 0
fi

# -- Credentials ------------------------------------------------------------
ENV_FILE="$PROJECT_ROOT/backend/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "env_missing: backend/.env.local"
  emit_skip_banner "backend/.env.local missing"
  exit 0
fi
PW=$(grep '^DB_PASSWORD' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')
DB_PORT=$(grep '^DB_PORT' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'" ' ')
DB_PORT="${DB_PORT:-5434}"
LIB_PW=$(grep '^LIBRARY_DB_PASSWORD' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')
LIB_PORT=$(grep '^LIBRARY_DB_PORT' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'" ' ')
LIB_PORT="${LIB_PORT:-$DB_PORT}"
if [[ -z "$PW" ]]; then
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "env_missing: DB_PASSWORD not set"
  emit_skip_banner "DB_PASSWORD not found in backend/.env.local"
  exit 0
fi

if [[ ! -x "$PG_DUMP" ]]; then
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "pg_dump_missing: $PG_DUMP"
  emit_skip_banner "pg_dump not found at $PG_DUMP (install libpq)"
  exit 0
fi

# -- Dump mmff_vector -------------------------------------------------------
TS=$(ts_fname)
OUT="$BACKUP_DIR/${LABEL}_${TS}.sql"
START_MS=$(($(date +%s) * 1000))

if ! PGPASSWORD="$PW" "$PG_DUMP" \
    -h localhost -p "$DB_PORT" -U mmff_dev -d mmff_vector \
    --no-owner --no-privileges \
    > "$OUT" 2> "$OUT.err"; then
  ERR_TAIL=$(tail -c 300 "$OUT.err" 2>/dev/null | tr '\n' ' ')
  rm -f "$OUT" "$OUT.err"
  log_entry "skipped" "$SHA" "$LABEL" "" 0 0 "pg_dump_failed: $ERR_TAIL"
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

# -- Dump mmff_library ------------------------------------------------------
if [[ -n "$LIB_PW" ]]; then
  OUT_LIB="$BACKUP_DIR/${LABEL}_${TS}_library.sql"
  START_MS=$(($(date +%s) * 1000))

  if ! PGPASSWORD="$LIB_PW" "$PG_DUMP" \
      -h localhost -p "$LIB_PORT" -U mmff_dev -d mmff_library \
      --no-owner --no-privileges \
      > "$OUT_LIB" 2> "$OUT_LIB.err"; then
    ERR_TAIL=$(tail -c 300 "$OUT_LIB.err" 2>/dev/null | tr '\n' ' ')
    rm -f "$OUT_LIB" "$OUT_LIB.err"
    log_entry "skipped" "$SHA" "${LABEL}_library" "" 0 0 "pg_dump_failed (library): $ERR_TAIL"
    emit_skip_banner "pg_dump mmff_library failed: $ERR_TAIL"
  else
    rm -f "$OUT_LIB.err"
    END_MS=$(($(date +%s) * 1000))
    DUR=$(( END_MS - START_MS ))
    BYTES_LIB=$(wc -c < "$OUT_LIB" | tr -d ' ')
    log_entry "ok" "$SHA" "${LABEL}_library" "$(basename "$OUT_LIB")" "$BYTES_LIB" "$DUR" ""
    printf 'backup-on-push: ok [%s] %s (%s bytes, %sms, channel=%s)\n' \
      "${LABEL}_library" "$(basename "$OUT_LIB")" "$BYTES_LIB" "$DUR" "$CHANNEL"
  fi
fi

# -- Retention --------------------------------------------------------------
if [[ "${SKIP_BACKUP_PRUNE:-0}" != "1" ]]; then
  python3 - "$BACKUP_DIR" "$RETENTION_COUNT" "$RETENTION_DAYS" <<'PY' || true
import os, re, sys, time
backup_dir, keep_n, keep_days = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
now = time.time()
cutoff = now - keep_days * 86400
SHA_RE = re.compile(r'^[0-9a-f]{4,40}_\d{8}_\d{6}(_library)?\.sql$')
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
