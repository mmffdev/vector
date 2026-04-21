# Bash — Postgres operations

> Parent: [c_bash.md](c_bash.md)
> Last verified: 2026-04-21

Verified Postgres command lines. All paths respect the repo's space-in-path; `pg_dump` lives in the keg-only libpq install.

## Preconditions (every command below)

- SSH tunnel is up: `nc -z localhost 5434` → "succeeded".
- `backend/.env.local` has `DB_PASSWORD=…` on its own line.
- macOS: `/opt/homebrew/opt/libpq/bin/` exists.

## `pg_dump` — snapshot to a timestamped SQL file

Canonical `<backupsql>` block lives in [c_db-backup.md](c_db-backup.md). Single source of truth — edit there, not here.

## `psql` — round-trip verification

```bash
PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
       -h localhost -p 5434 -U mmff_dev -d mmff_vector \
       -c 'SELECT 1;'
```

Returns one row (`?column? | 1`) on success. Use for "is the tunnel actually serving SQL?" — `nc` only proves TCP reachability.

## Apply a migration file

```bash
PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
       -h localhost -p 5434 -U mmff_dev -d mmff_vector \
       -v ON_ERROR_STOP=1 \
       -f "db/schema/00N_name.sql"
```

`ON_ERROR_STOP=1` is mandatory — without it `psql` keeps running after a failing statement and leaves the DB half-migrated.

## `docker exec` fallback (when run ON the server)

If SSH'd into the server itself and the tunnel isn't applicable:

```bash
docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector -v ON_ERROR_STOP=1 < db/schema/00N_name.sql
```

Container name `mmff-ops-postgres` is fixed by Compose; confirm with `docker ps` before assuming.

## What NOT to do

- **`psql` without `-v ON_ERROR_STOP=1`** for migrations — silent partial-apply.
- **`pg_dump` without `PGPASSWORD`** via env — `-W` prompts block non-interactive invocations (hooks, scripts).
- **Leaking `$PW` into `ps`** — always use `PGPASSWORD=…` inline (not exported) or a `~/.pgpass` file.
