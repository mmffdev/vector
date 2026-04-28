# Database backup

Lazy-loaded guide for `<backupsql>` — load only when the user invokes the shortcut or asks about DB dumps.

## `<backupsql>` — snapshot both remote Postgres databases

Dumps both `mmff_vector` and `mmff_library` via the SSH tunnel to timestamped SQL files tagged with the current `HEAD` short SHA. No data mutation — pure read-side snapshot.

### Preconditions
- SSH tunnel up: `nc -z localhost 5434` → "succeeded". If down, direct the user to run `bash dev/scripts/ssh_manager.sh`; don't try to bring the tunnel up from here.
- `pg_dump` at `/opt/homebrew/opt/libpq/bin/pg_dump` (libpq is keg-only on macOS; not on PATH).
- Creds loaded from `backend/.env.local` (`DB_PASSWORD`, `LIBRARY_DB_PASSWORD`).

### Command
```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" \
  && mkdir -p local-assets/backups \
  && SHA=$(git rev-parse --short main) \
  && TS=$(date +%Y%m%d_%H%M%S) \
  && PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && LIB_PW=$(grep '^LIBRARY_DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && PORT=$(grep '^DB_PORT' backend/.env.local | cut -d= -f2- | tr -d ' ') \
  && PORT="${PORT:-5434}" \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/pg_dump \
       -h localhost -p "$PORT" -U mmff_dev -d mmff_vector \
       --no-owner --no-privileges \
       > "local-assets/backups/${TS}_${SHA}.sql" \
  && PGPASSWORD="$LIB_PW" /opt/homebrew/opt/libpq/bin/pg_dump \
       -h localhost -p "$PORT" -U mmff_dev -d mmff_library \
       --no-owner --no-privileges \
       > "local-assets/backups/${TS}_${SHA}_library.sql"
```

### Output
- `local-assets/backups/YYYYMMDD_HHMMSS_<sha>.sql` — mmff_vector
- `local-assets/backups/YYYYMMDD_HHMMSS_<sha>_library.sql` — mmff_library

### Notes
- `local-assets/backups/` is gitignored — dumps never enter the repo.
- `--no-owner --no-privileges` produces a portable dump that restores under any user without needing the exact role set from prod.
- Port is read from `DB_PORT` in `.env.local` (falls back to 5434). Dev env uses 5435; prod/staging use 5434.
