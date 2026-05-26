# db/mmff_vector/schema — FROZEN DIRECTORY

**Status:** FROZEN — historical reference only.
**Retired:** 2026-05-26 at the end of refactorDB Pillar 3 step 3.
**Successor:** `db/vector_artefacts/schema/`

---

## What this directory is

The ~265 migration files in this directory are the complete historical
schema for the `mmff_vector` database, which existed from project
inception until 2026-05-26.

`mmff_vector` was the original tenant database for the Vector product. It
held the user, session, page, nav, role, permission, workspace,
subscription, and audit-log tables.

## What happened on 2026-05-26

`refactorDB` was a three-pillar refactor (see `handovers/refactorDB.md`):

1. **Column-prefix sweep** — every column on every table prefixed
   with its full table name (`<table_name>_<column>`).
2. **DB merge** — all 37 mmff_vector tables moved into
   `vector_artefacts`. End state: one tenant DB.
3. **FDW drop + mmff_vector drop** — the 16 `fdw_*` foreign tables in
   `vector_artefacts` were dropped, the FDW server + user mapping were
   dropped, and finally `mmff_vector` itself was DROPped.

## What this means for new work

- **Do NOT add new migrations here.** Every new migration against the
  tenant DB goes to `db/vector_artefacts/schema/`.
- **Do NOT re-apply these migrations.** The `cmd/migrate` runner no
  longer includes the `vector` phase in `-db=both`; the explicit
  `-db=vector` flag remains only so a restored historical snapshot can
  be migrated forward in isolation.
- **DOWN files in `down/`** are best-effort rollbacks against a
  restored mmff_vector snapshot. They cannot roll back live DBs once
  the corresponding UP has been folded into the post-Pillar-2 schema.
- **History only** — read these files when you need to understand the
  original shape of a table that was later moved/renamed/dropped.

## How to access historical mmff_vector data

Pre-Pillar-3 snapshots on the dev Postgres host (`vector-dev-pg`):

- `mmff_vector_snapshot_20260525` — pre-refactor parity snapshot.
- Pre-push backups under `local-assets/backups/` tagged with the
  refactor commit SHA.

Restore one of these to a throwaway DB if you need to query the old
shape.
