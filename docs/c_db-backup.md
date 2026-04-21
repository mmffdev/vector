# Database backup

Lazy-loaded guide for `<backupsql>` — load only when the user invokes the shortcut or asks about DB dumps.

## `<backupsql>` — snapshot the remote Postgres

Dumps the remote `mmff_vector` DB (via the SSH tunnel on `localhost:5434`) to a timestamped SQL file tagged with the current `HEAD` short SHA on `main`. No data mutation — pure read-side snapshot.

### Preconditions
- SSH tunnel up: `nc -z localhost 5434` → "succeeded". If down, direct the user to run `bash dev/scripts/ssh_manager.sh`; don't try to bring the tunnel up from here.
- `pg_dump` at `/opt/homebrew/opt/libpq/bin/pg_dump` (libpq is keg-only on macOS; not on PATH).
- Creds loaded from `backend/.env.local` (`DB_USER`, `DB_PASSWORD`, `DB_NAME`).

### Command
```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" \
  && mkdir -p local-assets/backups \
  && SHA=$(git rev-parse --short main) \
  && TS=$(date +%Y%m%d_%H%M%S) \
  && PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/pg_dump \
       -h localhost -p 5434 -U mmff_dev -d mmff_vector \
       --no-owner --no-privileges \
       > "local-assets/backups/${TS}_${SHA}.sql"
```

### Output
`local-assets/backups/YYYYMMDD_HHMMSS_<sha>.sql`.

### Notes
- `local-assets/backups/` is currently tracked by git. If dumps should stay out of the repo, add that path to `.gitignore` before running.
- `--no-owner --no-privileges` produces a portable dump that restores under any user without needing the exact role set from prod.
- Ownership/ACL info is stripped by design — if you ever need a full fidelity dump, drop those flags.
