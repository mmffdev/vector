# backupdb Protocol — Postgres Backup Manager

Dumps the live `mmff_ops` Postgres database (SSH tunnel on port 5434) to `backend/data/.pg-backup/` as a plain-SQL file restorable with `psql -f`. Manual-only — no cron.

## Triggers

- `<backupdb>` — manual, from you
- Automatic at the start of `/sprint-close` (before any finalize writes) — passes label `sprintNNN-close`
- Automatic before a pre-merge via `<premerge>` — passes label `premerge`

## Phase 1 — Run the Backup Script

The backup is a one-liner. The script resolves everything else:

```bash
./scripts/backup-db.sh [label]
```

- With no label → `mmff_ops-YYYYMMDD-HHMMSS.sql`
- With label → `mmff_ops-<label>-YYYYMMDD-HHMMSS.sql`

The script:
- Reads `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD` from `backend/.env.local`
- Calls `pg_dump` in plain-SQL format (`-F p`) via `/opt/homebrew/Cellar/libpq/18.3/bin/pg_dump`
- Writes to `backend/data/.pg-backup/`
- Exits non-zero on failure (missing env, empty dump, pg_dump error)

## Phase 2 — Report

After the script prints its summary line, report:

| File | Size | Total `.sql` backups | Location |
|------|------|----------------------|----------|
| mmff_ops-YYYYMMDD-HHMMSS.sql | 452K | 4 | backend/data/.pg-backup/ |

## Flags

### `--list`
```bash
ls -lht backend/data/.pg-backup/*.sql 2>/dev/null
```
Show newest first. Plain-SQL `.sql` files are the current format; `.dump` files are legacy custom-format dumps from the pre-retire era (restorable only via `pg_restore`).

### `--sprint-close <sprintId>`
Label the backup with the sprint identifier for archival clarity:
```bash
./scripts/backup-db.sh "${sprintId}-close"
```
No separate manifest file — the filename itself is the manifest.

### `--premerge`
```bash
./scripts/backup-db.sh "premerge"
```

## Retention

No automatic pruning. The user controls disk. To prune manually:
```bash
ls -1t backend/data/.pg-backup/*.sql | tail -n +11 | xargs -r rm
```
(Keeps newest 10.)

## Failure Handling

- `pg_dump` fails → script exits non-zero. Report the error verbatim to the user and stop the workflow that triggered the backup (do NOT continue with sprint-close / premerge).
- `backend/.env.local` missing → script exits with "backend/.env.local not found". Fix before retrying.
- Empty dump file → script exits with "Dump file empty or missing". Investigate connection before retrying.

## Recovery

Use `<restoredb>` (interactive — shows list, user picks one), or direct:
```bash
./scripts/restore-db.sh <filename> [--yes]
```

## What Changed from the Old Protocol

- **No cron.** Manual + sprint-close + premerge only.
- **No Docker container.** Dumps come from live remote Postgres on port 5434 via SSH tunnel.
- **Plain SQL (`-F p`), not custom format (`-Fc`).** Restorable with `psql -f`, no `pg_restore` needed.
- **No 30-copy retention cap.** User manages disk.
- **Legacy `.dump` files** stay on disk for now — only restorable via `pg_restore` against a running container, which no longer exists.
