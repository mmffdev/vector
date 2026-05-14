# `mmff_library` schema

Files in this directory build the second database (`mmff_library`) that holds MMFF-authored content shared across subscriptions. See `dev/planning/feature_library_db_and_portfolio_presets_v3.md` for the full design.

## Apply order

Run from inside the Postgres container, against the **`postgres`** database for `001` (which `CREATE DATABASE`s `mmff_library` and creates the four roles), then against `mmff_library` for everything else:

```bash
# 1. Bootstrap (postgres DB — creates the new DB + roles)
docker exec -i mmff-ops-postgres psql -U mmff_dev -d postgres < 001_init_library.sql
docker exec -i mmff-ops-postgres psql -U mmff_dev -d postgres < 002_roles.sql

# 2. Schema (mmff_library DB)
docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 003_portfolio_model_bundles.sql
docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 004_portfolio_model_shares.sql
docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_library < 005_grants.sql

# 3. Seed (mmff_library DB, as admin)
docker exec -i mmff-ops-postgres psql -U mmff_library_admin -d mmff_library < seed/001_mmff_model.sql
```

## Roles

| Role | Grants | Used by |
|---|---|---|
| `mmff_library_admin` | ALL on every table | release artifacts via `psql -f` only |
| `mmff_library_ro` | SELECT on every table | request-path read pool |
| `mmff_library_publish` | INSERT/UPDATE on bundle + shares (no DELETE, no releases/acks) | publish + share endpoints |
| `mmff_library_ack` | INSERT on `library_acknowledgements`; SELECT on releases/actions/acks | ack endpoint + reconciler |

The `release_*` and `acknowledgements` tables ship in Phase 3 — `005_grants.sql` only covers what exists today (bundle + shares). Phase 3's grants migration extends the matrix.

CI test: `backend/internal/librarydb/grants_test.go` queries `information_schema.role_table_grants` and asserts an exact match against the canonical map. Drift = test fail.
