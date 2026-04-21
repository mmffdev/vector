# Postgres — applying migrations

> Parent: [c_postgresql.md](c_postgresql.md)
> Last verified: 2026-04-21

Every migration lives at `db/schema/NNN_name.sql`. Each file already wraps its DDL in `BEGIN; … COMMIT;` — no extra transaction wrapping needed.

## Apply pattern (from the laptop, via the tunnel)

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" \
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

No down-migrations in this repo. Rollback is "restore from the pre-apply `<backupsql>` dump". This is a deliberate simplification — the data volume is small enough that a full restore is faster than maintaining reversible migration pairs.

## Migration order

Run in number order. The backend does not currently track "migrations applied" in a table — that's a known gap. When adding a new migration:

1. Number it after the highest existing file.
2. Wrap in `BEGIN; … COMMIT;`.
3. Document it in the matching [c_c_schema_*.md](c_schema.md) leaf.
4. Run `<backupsql>` before applying.
