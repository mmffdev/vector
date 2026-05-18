# Bash Cookbook

Curated shell commands that worked. Append a new entry any time a non-trivial command succeeds and the next-session-me would otherwise guess wrong.

**Append rule:** if the command has a non-obvious flag, path, env var, or pipeline → entry goes here before moving on.

**Skip rule:** `ls`, `cat`, `grep`, plain `git status`, anything where guessing right is trivial.

**Gotcha line is the most valuable part** — it captures the thing that bit last-time-me. Always fill it in, even if it's "none — but the flag order matters".

---

## Template

```markdown
### <what this command does>
**Use when:** <one-line trigger>
**Gotcha:** <the non-obvious bit — flag, env, path, ordering, side-effect>
```bash
<the command that worked>
```
```

---

## Backend / dev server

### Run a side instance of the backend on `:5199` without touching the live `:5100`

**Use when:** verifying a fresh build of `backend/cmd/server` end-to-end (e.g. after an auth change) without restarting the launcher-managed `:5100` process. `:5199` is the convention — clearly out of band from frontend (`:5101`) and backend (`:5100`).
**Gotcha:** binary is built into `/tmp` so a `git status` doesn't show it; `SERVER_PORT=5199` overrides the `backend/.env.dev` default; `BACKEND_ENV=dev` is required so it picks the dev DB tunnel (`localhost:5435`); background it with `&` and grep `lsof -i :5199` for the LISTEN PID to kill it cleanly. Don't forget to `rm -f /tmp/vector-server-*` after.
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend"
go build -o /tmp/vector-server-side ./cmd/server
BACKEND_ENV=dev SERVER_PORT=5199 /tmp/vector-server-side > /tmp/vector-side.log 2>&1 &
sleep 3 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5199/healthz
# … run tests …
kill "$(lsof -i :5199 -P 2>/dev/null | awk '/LISTEN/ {print $2}')"
rm -f /tmp/vector-server-side /tmp/vector-side.log
```

### Decode the payload of a JWT (no signature check) for inspecting claims

**Use when:** verifying a freshly-issued access token carries the expected claims (e.g. confirming `sid` lands in tokens after B16.8.11 step 2). The middle segment of a JWT is base64url-encoded JSON; macOS `base64` is forgiving about a missing `=` but Linux is strict, so pad to length-multiple-of-4.
**Gotcha:** JWT uses **URL-safe** base64 (`-` and `_` instead of `+` and `/`); `base64 -d` accepts both on macOS but tools like `openssl base64` don't — use `tr -- '-_' '+/'` if you hit decode errors.
```bash
TOKEN='<jwt here>'
PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
PADDED=$(echo "$PAYLOAD" | awk '{ for(i=length($0)%4; i<4 && i>0; i++) printf "="; print "" }')
echo "$PAYLOAD$PADDED" | base64 -d 2>/dev/null | python3 -m json.tool
```

### End-to-end auth smoke test against a running backend (login → decode sid → query users_sessions)

**Use when:** verifying a complete login flow including session-row write (e.g. after B16.8.11 steps 1+2). Uses `claude_3_test@` (gadmin Claude-owned test account) so `claude@` doesn't get touched. Adjust port for live (`:5100`) vs side instance (`:5199`).
**Gotcha:** login path is `/auth/login` (root mount), **not** `/v1/api/auth/login` — the test-accounts memory line about `/v1/api/` was outdated as of 2026-05-18. The CSRF middleware exempts `/auth/login` so no double-submit token is needed for this call.
```bash
PORT=5199  # or 5100 for live
RESP=$(curl -s -c /tmp/cookies.txt -X POST "http://localhost:$PORT/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"claude_3_test@mmffdev.com","password":"password123!"}')
TOKEN=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
PAYLOAD=$(echo "$TOKEN" | cut -d. -f2); PADDED=$(echo "$PAYLOAD" | awk '{ for(i=length($0)%4; i<4 && i>0; i++) printf "="; print "" }')
SID=$(echo "$PAYLOAD$PADDED" | base64 -d 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('sid',''))")
echo "JWT sid: $SID"
PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h localhost -p 5435 -U mmff_dev -d mmff_vector \
  -c "SELECT users_sessions_id, users_sessions_revoked FROM users_sessions WHERE users_sessions_id = '$SID';"
# Then test refresh rotation:
curl -s -b /tmp/cookies.txt -X POST "http://localhost:$PORT/auth/refresh" | python3 -m json.tool
rm -f /tmp/cookies.txt
```

### Smoke-test the login-redirect cookie handoff (TD-SEC-LOGIN-REDIRECT-COOKIE)

**Use when:** verifying the post-2026-05-18 cookie continuation flow that replaces `/login?redirect=`. Confirms (a) middleware bounces to backend with URL-encoded path, (b) backend validates path + mints HttpOnly cookie + 302s to plain `/login`, (c) continuation probe returns `{path}` and clears the cookie atomically (single-use), (d) hostile paths land on `/login` with no cookie.
**Gotcha:** the `Set-Cookie: …; Max-Age=0` only writes the new value back to a curl jar if you pass BOTH `-c $JAR -b $JAR` on the same call; with `-b` alone curl reads but never updates. The probe's "no cookie / invalid / expired" branch returns 204 (empty body, no Content-Length), not 200 with a sentinel — easy to mis-read as a hang. Validation rejects empty, non-leading-slash, `//`, `\\` prefix, and `/v2/*`.
```bash
JAR=$(mktemp)
# Step 1 — middleware-side bounce (frontend on :5101 → backend on :5100).
curl -sS -o /dev/null -w "%{http_code} → %{redirect_url}\n" "http://localhost:5101/portfolio-items"
# Step 2 — backend mints the signed cookie + 302s to plain /login.
curl -sS -c "$JAR" -b "$JAR" -i "http://localhost:5100/_site/auth/login-required?p=/portfolio-items" \
  | grep -E "^(HTTP|Set-Cookie:|Location:)"
# Step 3 — probe returns {path} AND atomically clears the cookie.
curl -sS -c "$JAR" -b "$JAR" "http://localhost:5100/_site/auth/login-continuation"
# Step 4 — second probe returns 204 (cookie was single-use).
curl -sS -c "$JAR" -b "$JAR" -o /dev/null -w "%{http_code}\n" "http://localhost:5100/_site/auth/login-continuation"
# Step 5 — hostile paths: no Set-Cookie line should appear.
for p in "//evil.com" "/v2/test" "https://evil.com" "x" ""; do
  enc=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$p', safe=''))")
  curl -sS -i "http://localhost:5100/_site/auth/login-required?p=$enc" \
    | grep -E "^(HTTP|Set-Cookie:|Location:)" | tr '\n' '|'; echo
done
rm -f "$JAR"
```

---

## Database (psql invocation shapes)

See [`c_c_db_routing.md`](c_c_db_routing.md) for which DB hosts which tables; this section captures the **command shape**, not the routing.

### Run a one-shot psql query against `mmff_vector` (dev, via tunnel `:5435`)
**Use when:** any ad-hoc query against the main DB while backend is on dev env
**Gotcha:**
- `psql` is NOT on PATH in the Claude bash shell — use the full libpq path `/opt/homebrew/opt/libpq/bin/psql`. Plain `psql` errors with `command not found`.
- Credentials live in `backend/.env.dev` as `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` — `set -a; source backend/.env.dev; set +a` exports them all in one shot.
- Project already defines `vector_psql()` and `va_psql()` helpers in `dev/scripts/cross_db_canary.sh` — same pattern, reuse if running multiple queries.
- HARD RULE — confirm via [`docs/c_c_db_routing.md`](c_c_db_routing.md) which DB hosts the table BEFORE running.
```bash
set -a; source backend/.env.dev; set +a
PGPASSWORD="$DB_PASSWORD" /opt/homebrew/opt/libpq/bin/psql \
  -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -c "SELECT 1;"
```

### Run a one-shot psql query against `vector_artefacts` (vaPool, dev)
**Use when:** querying the cutover substrate — `artefact_types`, `artefacts`, `flows`, `field_library`, `timebox_*`
**Gotcha:** vaPool uses a **separate** set of env vars — `VA_DB_HOST/VA_DB_PORT/VA_DB_USER/VA_DB_PASSWORD/VA_DB_NAME`. Easy to use `DB_*` by reflex and silently hit `mmff_vector` instead. The `va_psql` helper in `cross_db_canary.sh` does this correctly.
```bash
set -a; source backend/.env.dev; set +a
PGPASSWORD="$VA_DB_PASSWORD" /opt/homebrew/opt/libpq/bin/psql \
  -h "$VA_DB_HOST" -p "$VA_DB_PORT" -U "$VA_DB_USER" -d "$VA_DB_NAME" \
  -c "SELECT 1;"
```

### Find where `psql` lives when it's not on PATH
**Use when:** the bash shell says `command not found: psql` (default state in Claude's shell)
**Gotcha:** `which psql` returns nothing because brew's libpq is keg-only and not symlinked. Don't `brew link` — the project deliberately uses libpq, not full postgres. Just use the absolute path.
```bash
ls /opt/homebrew/opt/libpq/bin/psql /Applications/Postgres.app/Contents/Versions/*/bin/psql 2>/dev/null
```

---

## Frontend / Next.js

_no entries yet — e.g. start dev server, kill stale node, clear `.next` cache_

---

## Tunnels / network

_no entries yet — e.g. SSH tunnel for `:5435`, check what's bound to a port_

---

## Git (non-trivial)

_no entries yet — surgical `checkout <ref> -- <path>`, log filters, blame ranges. Standard `git status`/`add`/`commit` does NOT belong here._

---

## Hooks / scripts in `.claude/`

### Inspect MCP server configuration (global + project)
**Use when:** "are we using MCP server X?", auditing what MCPs are wired up before adding/removing one
**Gotcha:** global config is `~/.claude/mcp.json` (servers only), project MCP usage is recorded in `.claude/settings.json` as `mcp__<server>__<tool>` permission entries — there is NO separate project `mcp.json`. Check both or you'll miss half the picture.
```bash
cat ~/.claude/mcp.json && grep -E "mcp__[a-z_]+__" .claude/settings.json | sort -u
```

---

## One-off ops / launcher / services

_no entries yet — e.g. starting the launcher from CLI, checking which services are up_

---

## Filesystem checks (non-trivial)

### Confirm the global memory dir is the project mirror (it's a symlink — no cp needed)
**Use when:** about to "sync" `.claude/memory/` → `~/.claude/projects/.../memory/`. Check first — usually a no-op.
**Gotcha:** The active mirror is `~/.claude/projects/-Users-rick-Documents-MMFFDev---Projects-MMFFDev---Vector/memory` (TRIPLE-dash variant). A stale double-dash dir exists (`...MMFFDev-Projects-MMFFDev---Vector/memory`) — DO NOT write to it; it's orphaned. Same-inode test confirms the live mirror is a symlink to the project dir, so any project write is instantly visible globally; `cp` reports "files are identical (not copied)".
```bash
ls -i .claude/memory/MEMORY.md \
  "/Users/rick/.claude/projects/-Users-rick-Documents-MMFFDev---Projects-MMFFDev---Vector/memory/MEMORY.md"
```

### Check if a set of files exists without erroring on missing ones
**Use when:** scaffolding new files and want to confirm none clash, or auditing if optional files are present
**Gotcha:** `ls file1 file2` errors on the first missing file with exit 2; redirect stderr with `2>&1` so you see which exist and which don't in one shot. With zsh + globs, prefix the glob with `noglob` or quote it — bare `ls foo*` errors hard if no match (`no matches found`).
```bash
ls docs/c_sql_cookbook.md docs/c_bash_cookbook.md 2>&1 | head -5
```
