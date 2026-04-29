# restoredb Protocol — Interactive Postgres Restore

Restores a local timestamped `.sql` dump INTO the live `mmff_ops` Postgres database (SSH tunnel on port 5434). **Destructive** — overwrites current DB contents.

## Triggers

- `<restoredb>` — lazy-loaded interactive picker
- `<restoredb --version mmff_ops-20260420-053111.sql>` — direct by filename
- `<restoredb --version 20260420-053111>` — direct by timestamp (matches any file with that suffix)

## Phase 1 — List Available Dumps

```bash
ls -lht backend/data/.pg-backup/*.sql 2>/dev/null
```

Display to the user as a numbered table:

| # | File | Size | Modified |
|---|------|------|----------|
| 1 | mmff_ops-premerge-20260420-053111.sql | 452K | 2026-04-20 05:31 |
| 2 | mmff_ops-sprint019-close-20260419-220000.sql | 448K | 2026-04-19 22:00 |
| 3 | mmff_ops-baseline-20260420-012307.sql | 429K | 2026-04-20 01:23 |
| 4 | mmff_ops-pre-retire-20260420-053111.sql | 450K | 2026-04-20 05:31 |

Also scan for legacy `.dump` files and warn:
```bash
ls backend/data/.pg-backup/*.dump 2>/dev/null
```
If any exist, note:
> Legacy `.dump` files detected — these are custom-format dumps from the pre-retire era and are NOT restorable by this skill (they need `pg_restore` against a running container, which no longer exists). Ignore or delete them.

## Phase 2 — Pick a Dump

### Interactive path (`<restoredb>` with no args)
Prompt the user: "Pick a number or paste a filename."
- If the user types a number, map to the filename from the list
- If the user types a filename, accept it directly
- If the user types a partial timestamp (e.g. `20260420-053111`), match against the filename suffix — if exactly one match, use it; otherwise list the matches and re-prompt

### Direct path (`--version <arg>`)
If `<arg>` matches a filename in `backend/data/.pg-backup/`, use it.
Else if `<arg>` matches a timestamp suffix against exactly one file, use it.
Else report the candidates and abort.

## Phase 3 — Confirm

Show the user:
```
╔══════════════════════════════════════════════════════════════╗
║  DESTRUCTIVE RESTORE                                         ║
╠══════════════════════════════════════════════════════════════╣
║  Target   : 127.0.0.1:5434/mmff_ops                          ║
║  Dump     : mmff_ops-sprint019-close-20260419-220000.sql     ║
║  Size     : 448K                                             ║
║  Effect   : overwrites all data in the target database       ║
╚══════════════════════════════════════════════════════════════╝
```

**Do NOT auto-execute.** Ask the user to confirm by replying `YES`. Only then proceed.

## Phase 4 — Run

```bash
./scripts/restore-db.sh <filename> --yes
```

The `--yes` flag skips the script's own interactive prompt because you already collected confirmation in Phase 3.

## Phase 5 — Verify & Report

The script prints a row-count summary for `backlog_items`, `sprints`, and `project_config`. Relay those numbers to the user verbatim.

If the backend is running, remind the user that the app is stateless and DB-driven — the next page load will reflect the restored state (no server restart needed). Reference: `project_stateless_db_driven.md`.

## Failure Handling

- psql exits non-zero (with `-v ON_ERROR_STOP=1`) → restore partially applied. Report the error line. Do NOT attempt to "fix forward" — ask the user whether to re-run, pick a different dump, or investigate.
- Dump file not found → list candidates, abort.
- `backend/.env.local` missing → abort, tell the user.

## Safety Notes

- Always present the file list first, even when `--version` is passed — lets the user sanity-check they're about to overwrite with the right one.
- Never chain `<backupdb>` + `<restoredb>` automatically. Each is a deliberate user action.
- `<restoredb>` does not touch the filesystem other than reading the dump — no file moves, no deletions.
