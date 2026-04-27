# failover Protocol — Emergency DB Failover to Local Docker

Brings up a local Docker Postgres on 5433, restores the latest `.sql` dump into it, and rewrites `backend/.env.local` so the backend points at local (5433) instead of the remote SSH tunnel (5434). Use only when the remote DB or tunnel is unavailable.

## Triggers

- `<failover>` — failover using the **latest** `.sql` dump in `backend/data/.pg-backup/`
- `<failover --version <filename>>` — failover using a specific dump file
- `<failover --back>` — failback to remote (delegate to `scripts/failback-to-remote.sh`)

## Phase 1 — Confirm Intent

Show the user:

```
╔══════════════════════════════════════════════════════════════╗
║  DB FAILOVER TO LOCAL                                        ║
╠══════════════════════════════════════════════════════════════╣
║  Action : start Docker Postgres on 5433                      ║
║  Source : latest .sql dump in backend/data/.pg-backup/       ║
║  Effect : rewrites backend/.env.local (DB_PORT 5434→5433)    ║
║  Recovery: <failover --back> restores remote pointing        ║
╚══════════════════════════════════════════════════════════════╝
```

**Do NOT auto-execute.** Ask the user to confirm by replying `YES`. Only then proceed.

If `--version <filename>` was passed, also print the resolved dump filename in the box so the user can sanity-check.

## Phase 2 — Run

Execute:

```bash
./scripts/failover-to-local.sh [--version <filename>]
```

The script:
1. Starts container `mmff-ops-failover` (creates it if missing, starts it if stopped, skips if already running)
2. Waits up to 30 seconds for readiness
3. Drops + recreates schema `public` (clean slate)
4. Restores the chosen dump via `psql -v ON_ERROR_STOP=1 -f`
5. Backs up `.env.local` to `.env.local.bak`, flips `DB_PORT` from 5434 to 5433
6. Prints post-restore row counts for `backlog_items`, `sprints`, `project_config`

## Phase 3 — Restart Backend

The backend process still holds a pool pointed at 5434. The env edit alone won't retarget it — a restart is required.

Remind the user:

> Failover complete. Run `<server>` to restart the launcher (which restarts the backend on the new DB_PORT). Until you do, the running backend is still trying to reach the remote.

**Do not auto-trigger `<server>`** — server restarts are user-flagged per CLAUDE.md.

## Phase 4 — Failback (`<failover --back>`)

When the remote is healthy again:

```bash
./scripts/failback-to-remote.sh
```

The script:
1. Probes 127.0.0.1:5434 and aborts if unreachable (tunnel must be up first)
2. Backs up `.env.local` → `.env.local.bak`, flips `DB_PORT` back to 5434
3. Stops container `mmff-ops-failover` (use `--keep-container` to leave it running)

After failback, remind the user to run `<server>` to pick up the new port.

## Failure Handling

- Docker not installed or daemon not running → abort with clear error, do not touch `.env.local`.
- Dump file missing (when `--version` is passed) → list candidates, abort.
- `psql` restore exits non-zero → the local DB is in a partial state. Report the error. Do NOT flip `.env.local`. Tell the user to investigate or pick a different dump.
- Container fails to become ready within 30s → abort, do not flip `.env.local`.
- Failback probe fails (5434 unreachable) → abort, do not touch anything. Tell the user to bring up the SSH tunnel `mmffdev-pg` first.

## Safety Notes

- `.env.local.bak` is written on every flip — user can hand-revert if anything goes sideways.
- Container `mmff-ops-failover` is purposely distinct from the retired `mmff-ops-postgres` — it's a throwaway, not a permanent service.
- Never chain `<failover>` after `<backupdb>` automatically. Each is a deliberate user action.
- The local DB is a **read-capable standby**. Any writes made while failed-over will NOT sync back to remote automatically. If the user makes writes during failover, they must be pg_dump'd and manually applied to remote post-failback (out of scope for this skill — flag it).
