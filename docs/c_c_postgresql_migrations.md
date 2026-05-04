# Postgres — applying migrations

> Parent: [c_postgresql.md](c_postgresql.md)
> Last verified: 2026-05-04

Every migration lives at `db/schema/NNN_name.sql`. Each file already wraps its DDL in `BEGIN; … COMMIT;` — no extra transaction wrapping needed.

The preferred apply path is the Go runner at `backend/cmd/migrate/main.go`, which records every applied file in a `schema_migrations` table and skips ones already there. The raw `psql -f` patterns below are for one-offs (e.g. running a DOWN script, or applying on the server with no Go toolchain available).

## Apply via the runner (preferred)

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector" \
  && go run ./backend/cmd/migrate -env backend/.env.dev -db vector -dry-run
# review the pending list, then drop -dry-run to apply
```

Flags: `-db vector|library|both`, `-env <path>`, `-dry-run`.

The runner reads the **top level** of `db/schema/` and `db/schema/library_schema/` only — subdirectories like `db/schema/down/` are intentionally skipped (see Rollback below).

## Apply pattern (from the laptop, via the tunnel)

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector" \
  && PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
       -h localhost -p 5434 -U mmff_dev -d mmff_vector \
       -v ON_ERROR_STOP=1 \
       -f db/schema/00N_name.sql
```

`ON_ERROR_STOP=1` is non-negotiable — without it, a failing statement mid-file leaves the DB in a partial state.

## Apply pattern (ON the server, via docker exec)

```bash
ssh mmffdev-admin 'docker exec -i mmff-ops-postgres \
  psql -U mmff_dev -d mmff_vector -v ON_ERROR_STOP=1' \
  < db/schema/00N_name.sql
```

This avoids the tunnel entirely — useful when the server can reach its own Postgres but the laptop is offline.

## Before applying: snapshot

Run `<backupsql>` first (see [c_db-backup.md](c_db-backup.md)). A migration that destroys a column is a one-way trip without the dump.

## After applying: verify

Every migration has a 3-query verification set. Examples:

```bash
# After 006_states.sql — count the seeded canonical rows (expect 5)
PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
  -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -tAc "SELECT COUNT(*) FROM canonical_states;"

# After 007_rename_permissions.sql — confirm old name gone
PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
  -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -tAc "SELECT to_regclass('public.user_project_permissions');"
# Expect: empty result (table no longer exists under that name).

# And confirm new name + FK present
PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
  -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -tAc "SELECT conname FROM pg_constraint
        WHERE conname = 'user_workspace_permissions_workspace_fk';"
# Expect: one row.
```

## Rollback

**Primary strategy: restore from the pre-apply `<backupsql>` dump.** Data volume is small enough that a full restore is faster (and safer) than maintaining bidirectional migration pairs. Run `<backupsql>` *before* every apply so this option is always available.

**Optional convenience: DOWN scripts in `db/schema/down/`.** When a migration is cleanly reversible (e.g. drop a column added in the UP, drop a table that holds no data yet), you may also commit a sibling rollback file:

```
db/schema/NNN_name.sql            ← forward migration (auto-applied)
db/schema/down/NNN_name_DOWN.sql  ← rollback (NEVER auto-applied)
```

The runner's `sqlFiles()` reads only the top level of `db/schema/`, so anything under `down/` is skipped by design — DOWN scripts cannot be picked up as forward migrations. To run one, invoke `psql` directly:

```bash
PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
  -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -v ON_ERROR_STOP=1 \
  -f db/schema/down/NNN_name_DOWN.sql
```

After running a DOWN, delete the matching row from `schema_migrations` so the runner will re-apply the forward migration on the next run:

```sql
DELETE FROM schema_migrations WHERE filename = 'NNN_name.sql';
```

DOWN scripts are an optional convenience — destructive changes (dropping populated columns, renaming tables that have data) should still be reverted via `<backupsql>` restore, not via a DOWN script.

## Migration order

Run in number order — the runner sorts files lexicographically. When adding a new migration:

1. Number it after the highest existing file.
2. Wrap in `BEGIN; … COMMIT;`.
3. Document it in the matching [c_c_schema_*.md](c_schema.md) leaf.
4. Run `<backupsql>` before applying.
5. (Optional) drop a sibling `db/schema/down/NNN_name_DOWN.sql` if cleanly reversible.
