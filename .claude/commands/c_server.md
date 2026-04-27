# `<server>` — switch backend DB env (dev / staging / production)

> Last verified: 2026-04-27

Switches the backend's `BACKEND_ENV` (which selects `backend/.env.<env>`), restarts the Go backend on `:5100` so it picks up the new DB connection, and rewrites the `ACTIVE_BACKEND_ENV` marker block at the top of [`.claude/CLAUDE.md`](../CLAUDE.md). Future Claude sessions read that marker on load to know which DB they're pointing at.

| Flag | `BACKEND_ENV` | Env file | DB target | Tunnel | SSH alias |
|---|---|---|---|---|---|
| `-d` | `dev` | `backend/.env.dev` | dev VPS `77.68.33.216` | `localhost:5435` | `vector-dev-pg` |
| `-s` | `staging` | `backend/.env.staging` | staging VPS `77.68.33.220` | `localhost:5436` | `vector-staging-pg` |
| `-p` | `production` | `backend/.env.production` | mmffdev.com remote | `localhost:5434` | `mmffdev-pg` |

**Hard rule — `-p` requires explicit confirmation.** Production writes hit the live shared DB. The script must prompt the user to type `production` before proceeding. `-d` and `-s` execute without prompting.

---

## Procedure (run in this order)

### 1. Validate flag

Exactly one of `-d`, `-s`, `-p` must be present. Reject anything else with usage.

### 2. Resolve env config

```bash
case "$FLAG" in
  -d) ENV=dev;        PORT=5435; ALIAS=vector-dev-pg;     LABEL="dev VPS 77.68.33.216" ;;
  -s) ENV=staging;    PORT=5436; ALIAS=vector-staging-pg; LABEL="staging VPS 77.68.33.220" ;;
  -p) ENV=production; PORT=5434; ALIAS=mmffdev-pg;        LABEL="mmffdev.com remote" ;;
esac
ENV_FILE="backend/.env.$ENV"
```

### 3. Confirm if `-p`

```bash
if [ "$ENV" = "production" ]; then
  printf 'Switching to PRODUCTION (mmffdev.com). Every write hits the live shared DB.\nType "production" to confirm: '
  read -r ANSWER
  [ "$ANSWER" = "production" ] || { echo "aborted"; exit 1; }
fi
```

When invoked through Claude, ask the user this question in chat instead of using `read` — Claude does not have an interactive TTY.

### 4. Verify the env file exists

```bash
[ -f "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/$ENV_FILE" ] \
  || { echo "missing $ENV_FILE — run setup or copy from .env.local"; exit 1; }
```

### 5. Ensure the tunnel is up; auto-start if not

```bash
if ! nc -z localhost "$PORT" 2>/dev/null; then
  echo "tunnel :$PORT is down — starting ssh -fN $ALIAS"
  ssh -fN "$ALIAS" || { echo "ssh -fN $ALIAS failed; check ~/.ssh/config and key"; exit 1; }
  for _ in $(seq 1 10); do nc -z localhost "$PORT" && break; sleep 0.5; done
  nc -z localhost "$PORT" || { echo "tunnel never came up on :$PORT"; exit 1; }
fi
echo "tunnel :$PORT  UP"
```

### 6. Stop the running backend on :5100 (if any)

```bash
PID=$(lsof -nP -iTCP:5100 -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}')
if [ -n "$PID" ]; then
  echo "stopping backend pid $PID"
  # Kill children too — `go run` spawns the compiled binary as a child
  pkill -P "$PID" 2>/dev/null
  kill "$PID" 2>/dev/null
  for _ in $(seq 1 20); do nc -z localhost 5100 2>/dev/null || break; sleep 0.5; done
  nc -z localhost 5100 2>/dev/null && { echo "backend still listening on :5100 — manual kill required"; exit 1; }
fi
```

### 7. Launch backend with new env

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/backend"
: > /tmp/mmff-server.log
BACKEND_ENV="$ENV" nohup go run ./cmd/server > /tmp/mmff-server.log 2>&1 &
disown
echo "started backend with BACKEND_ENV=$ENV (log: /tmp/mmff-server.log)"
```

### 8. Wait for `/healthz`

```bash
for _ in $(seq 1 30); do
  if curl -sS --max-time 1 http://localhost:5100/healthz | grep -q '"status":"ok"'; then
    echo "backend up — /healthz ok"
    break
  fi
  sleep 1
done
curl -sS --max-time 1 http://localhost:5100/healthz | grep -q '"status":"ok"' \
  || { echo "backend never reported healthy — tail /tmp/mmff-server.log"; exit 1; }
```

### 9. Rewrite the `ACTIVE_BACKEND_ENV` marker in CLAUDE.md

The marker block is delimited by HTML comments so it can be replaced deterministically. Use Python (always present on macOS) for safe in-place rewrite:

```bash
TS=$(date "+%Y-%m-%d %H:%M")
LINE="> **ACTIVE BACKEND ENV: \`$ENV\`** — set $TS by \`<server> $FLAG\` — DB: $LABEL via tunnel \`localhost:$PORT\` — env file: \`$ENV_FILE\`"

python3 - <<PY
import re, sys
path = "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/CLAUDE.md"
new  = """$LINE"""
src  = open(path).read()
block = "<!-- ACTIVE_BACKEND_ENV:start -->\n" + new + "\n<!-- ACTIVE_BACKEND_ENV:end -->"
out, n = re.subn(
    r"<!-- ACTIVE_BACKEND_ENV:start -->.*?<!-- ACTIVE_BACKEND_ENV:end -->",
    block,
    src,
    flags=re.DOTALL,
)
if n == 0:
    sys.exit("ACTIVE_BACKEND_ENV marker block not found in CLAUDE.md")
open(path, "w").write(out)
print("CLAUDE.md marker → " + "$ENV")
PY
```

### 10. Print summary

```
✓ Backend now on $ENV
  env file : $ENV_FILE
  DB       : $LABEL
  tunnel   : localhost:$PORT (alias $ALIAS)
  marker   : .claude/CLAUDE.md updated
  log      : /tmp/mmff-server.log

To verify from another shell:
  curl -s http://localhost:5100/healthz
  <services>
```

---

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `ssh -fN $ALIAS failed` | SSH key not loaded or alias missing | `ssh-add -l`; check `~/.ssh/config` for the alias |
| `backend never reported healthy` | Bad creds in env file, or DB not reachable | Tail `/tmp/mmff-server.log`; verify the env file's `DB_*` vars |
| `marker block not found` | Someone removed the `<!-- ACTIVE_BACKEND_ENV:start -->` / `:end` lines from CLAUDE.md | Re-insert the block right after the HARD RULE paragraph and re-run |

## What this shortcut does NOT do

- Does **not** start the Next.js frontend — use `<npm>` or the dev launcher.
- Does **not** start Planka / Adminer tunnels — use the dev launcher.
- Does **not** run migrations against the new DB — use `<backupsql>` and the migration tooling separately.
- Does **not** touch `.env.local`. That file remains the no-flag default for `go run` invocations outside this shortcut.

## Related

- [`c_dev-launcher.md`](c_dev-launcher.md) — full multi-service launcher (does not switch envs).
- [`c_services.md`](c_services.md) — read-only status check; reads the `ACTIVE_BACKEND_ENV` marker to pick the right tunnel port.
- [`c_npm.md`](c_npm.md) — frontend dev server.
