# Database backup

Lazy-loaded guide for `<backupsql>` — load only when the user invokes the shortcut or asks about DB dumps.

## `<backupsql>` — snapshot all three remote Postgres databases

Dumps `mmff_vector` (pool), `mmff_library` (libPools), and `vector_artefacts` (vaPool) via the SSH tunnel to timestamped SQL files tagged with the current `HEAD` short SHA and the active env. No data mutation — pure read-side snapshot.

### Preconditions
- Active env is **`dev`** (HARD RULE — backend is pinned to dev). Tunnel must be up: `nc -z localhost 5435` → "succeeded". If down, direct the user to run `bash dev/scripts/ssh_manager.sh`; don't try to bring the tunnel up from here.
- `pg_dump` at `/opt/homebrew/opt/libpq/bin/pg_dump` (libpq is keg-only on macOS; not on PATH).
- Creds loaded from `backend/.env.dev` (`DB_PASSWORD`, `LIBRARY_DB_PASSWORD`, `VA_DB_PASSWORD`).
- All three pools route through tunnel port `5435` on dev.

### Command
```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" \
  && mkdir -p local-assets/backups \
  && SHA=$(git rev-parse --short HEAD) \
  && TS=$(date +%Y%m%d_%H%M%S) \
  && PW=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  && LIB_PW=$(grep '^LIBRARY_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  && VA_PW=$(grep '^VA_DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/pg_dump \
       -h localhost -p 5435 -U mmff_dev -d mmff_vector \
       --no-owner --no-privileges \
       > "local-assets/backups/${TS}_${SHA}_dev_mmff_vector.sql" \
  && PGPASSWORD="$LIB_PW" /opt/homebrew/opt/libpq/bin/pg_dump \
       -h localhost -p 5435 -U mmff_dev -d mmff_library \
       --no-owner --no-privileges \
       > "local-assets/backups/${TS}_${SHA}_dev_mmff_library.sql" \
  && PGPASSWORD="$VA_PW" /opt/homebrew/opt/libpq/bin/pg_dump \
       -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
       --no-owner --no-privileges \
       > "local-assets/backups/${TS}_${SHA}_dev_vector_artefacts.sql"
```

### Output
- `local-assets/backups/YYYYMMDD_HHMMSS_<sha>_dev_mmff_vector.sql` — pool
- `local-assets/backups/YYYYMMDD_HHMMSS_<sha>_dev_mmff_library.sql` — libPools
- `local-assets/backups/YYYYMMDD_HHMMSS_<sha>_dev_vector_artefacts.sql` — vaPool

### Notes
- `local-assets/backups/` is gitignored — dumps never enter the repo.
- `--no-owner --no-privileges` produces a portable dump that restores under any user without needing the exact role set from prod.
- Dev tunnel port is `5435` (pinned). Staging/prod are out-of-band and not covered by this shortcut.
- The three DBs map to the three Go pools per [`docs/c_c_db_routing.md`](../../docs/c_c_db_routing.md): `pool`→`mmff_vector`, `libPools`→`mmff_library`, `vaPool`→`vector_artefacts`.
