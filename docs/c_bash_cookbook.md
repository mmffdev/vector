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

_no entries yet — e.g. start backend with BACKEND_ENV=dev, tail logs, restart on :5100_

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
