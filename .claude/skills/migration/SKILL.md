---
name: migration
description: Scaffold + apply a file-based SQL migration against one of the three dev DBs. Picks next NNN, writes header + BEGIN/COMMIT skeleton, dry-runs, applies, and verifies schema_migrations. Use when the user wants to create, scaffold, or apply a database migration. Never assumes a DB — always asks if not explicit.
---

# `<migration>` Skill

Wraps the recurring DB-migration workflow:

1. Pick the right DB (HARD RULE — never assume).
2. Compute the next `NNN` for that DB's `schema/` dir.
3. Scaffold `db/<dbname>/schema/NNN_<slug>.sql` with the project's header convention + `BEGIN;`/`COMMIT;` wrapper.
4. (Optional) Scaffold a paired `db/<dbname>/schema/down/NNN_<slug>_DOWN.sql`.
5. Dry-run the migrator.
6. Apply.
7. Verify the row landed in `schema_migrations`.
8. Surface the commit-and-push reminder.

---

## HARD RULES — non-negotiable

1. **Always target `dev`.** Pass `-env backend/.env.dev` to the migrator on every invocation. Never `-env backend/.env.staging` / `backend/.env.production` — those are blocked by the env-file lockdown hook anyway, but this skill must not even *attempt* them.
2. **Never assume which DB.** Three databases are in play (`mmff_vector` / `mmff_library` / `vector_artefacts`). If the user didn't say which, ASK before scaffolding. See [`docs/c_c_db_routing.md`](../../../docs/c_c_db_routing.md) for the service → pool → DB map.
3. **Substrate-prefix every new table/column.** Tables under `vector_artefacts` start with `artefact_*`; new columns adopt their table's substrate prefix. See [`feedback_table_naming_prefixes`](../../memory/feedback_table_naming_prefixes.md).
4. **Idempotent or no-op.** Every migration must be safe to re-run. Use `ON CONFLICT DO NOTHING`, `IF NOT EXISTS`, `CREATE OR REPLACE`. If genuinely non-idempotent (e.g. a one-shot data fix), document why in the header.
5. **No big-bang cutovers.** Drop legacy tables/columns one at a time as their last reader migrates. See [`feedback_gradual_db_sanitisation`](../../memory/feedback_gradual_db_sanitisation.md).
6. **Push promptly.** Per [`feedback_push_often`](../../memory/feedback_push_often.md), commit + push the migration shortly after applying — don't let a local-only `schema_migrations` row drift from the file in git.

---

## DB → directory map

| DB name | Schema dir | Pool variable (Go) | Service layer |
|---|---|---|---|
| `mmff_vector` | `db/mmff_vector/schema/` | `pool` | most app services |
| `vector_artefacts` | `db/vector_artefacts/schema/` | `vaPool` | artefact_*, flows, field_library, timebox_* |
| `mmff_library` | `db/mmff_library/schema/` | `libPools` | read-only library spine |

Runner flag values: `-db vector` / `-db library` / `-db vector_artefacts` / `-db both`.

---

## Flow

### Step 1 — Resolve target DB

If the user's invocation message contains a hint (`vector`, `artefacts`, `library`, or a table name with a known prefix like `artefact_*`), pick that DB. Otherwise ASK:

> "Which DB? `vector` (mmff_vector), `artefacts` (vector_artefacts), or `library` (mmff_library)?"

Wait for the answer. Never default.

### Step 2 — Compute next NNN

Scan descending (per [`feedback_scan_plans_descending`](../../memory/feedback_scan_plans_descending.md)) — the ascending `ls` buries the highest number at the tail:

```bash
HIGH=$(ls -r db/<dbname>/schema/ | grep -E '^[0-9]+_' | head -1 | grep -oE '^[0-9]+')
NEXT=$(printf '%03d' $((10#$HIGH + 1)))
```

Three-digit zero-padded. Report the chosen NNN to the user.

### Step 3 — Get the slug

If the user gave one inline (e.g. `<migration> vector add column foo to bar`), turn the description into a snake_case slug:
- lowercase
- spaces → `_`
- strip articles (a, the, an)
- under 50 chars
- preserve substrate prefix if a table name appears (`add_artefact_types_slot` not `add_slot`)

Otherwise ASK for a short slug.

### Step 4 — Scaffold the migration file

Write `db/<dbname>/schema/<NNN>_<slug>.sql` with this template:

```sql
-- ============================================================
-- <NNN>_<slug>.sql
--
-- <One-line WHAT>
--
-- WHY:
--   <The motivation — usually a story/plan ID or a constraint that
--    forced this change. If the migration came from a deferred TD
--    item or a follow-up story, cite the ID.>
--
-- IDEMPOTENCY:
--   <Brief note on what makes this re-runnable. e.g.
--    "ON CONFLICT DO NOTHING on the unique (a, b) index",
--    "ADD COLUMN IF NOT EXISTS",
--    "DROP TRIGGER IF EXISTS before CREATE TRIGGER".>
--
-- ROLLBACK:
--   <Pointer to the paired DOWN script under schema/down/, OR
--    "Forward-only — rollback would require restoring archived rows
--     from <reference>".>
-- ============================================================

BEGIN;

-- TODO: replace with the actual migration SQL.

COMMIT;
```

Stop here and show the user the scaffolded path + open the file in their editor (don't just dump the body in chat — the file IS the artefact).

### Step 5 — Wait for the user to fill in the SQL

The skill does NOT write the migration body itself. The user (or a subsequent prompt) authors the SQL. Reason: migrations are domain-specific and require thought about constraints, indexes, FKs, soft-archive invariants, tenant isolation, etc. — none of which the skill can infer from a slug.

Once the user signals "ready" (or pastes the SQL into the file), proceed.

### Step 6 — Dry-run

From repo root:

```bash
go run ./backend/cmd/migrate -dry-run -db <which> -env backend/.env.dev
```

Show the output. The new file should appear as pending; nothing else should be listed (if other pending migrations show, that's worth surfacing — they may have been applied via raw psql without backfilling `schema_migrations`).

### Step 7 — Apply

```bash
go run ./backend/cmd/migrate -db <which> -env backend/.env.dev
```

Show the output. Confirm the migration applied without error.

### Step 8 — Verify

Query `schema_migrations` to confirm the row landed:

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) \
  /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d <dbname> \
  -tAc "SELECT filename, applied_at FROM schema_migrations WHERE filename = '<NNN>_<slug>.sql'"
```

(Note: for `vector_artefacts`, use `VA_DB_PASSWORD`; for `mmff_library`, use `LIBRARY_DB_PASSWORD`. The wrapper at [`.claude/bin/pg-mcp.sh`](../../bin/pg-mcp.sh) carries the same mapping — reference it if confused.)

If the row is missing, **stop**. Don't loop — read the migrator output, the migration file, and the DB error. See [`feedback_read_source_when_stuck`](../../memory/feedback_read_source_when_stuck.md).

### Step 9 — Commit + push reminder

Surface — don't auto-commit:

> "Migration applied + verified. Per `feedback_push_often`, commit and push now so the file and the `schema_migrations` row don't drift. The file to stage is `db/<dbname>/schema/<NNN>_<slug>.sql`."

If the user wants the skill to commit, that's a separate decision and triggers the standard commit protocol (HEREDOC message, `Co-Authored-By: Claude…`, no `git add -A`).

---

## DOWN scripts (optional)

If the migration is non-trivial and reversible, scaffold a paired DOWN script at the same time:

`db/<dbname>/schema/down/<NNN>_<slug>_DOWN.sql`

Template:
```sql
-- ============================================================
-- <NNN>_<slug>_DOWN.sql
-- Rollback for <NNN>_<slug>.sql
-- NOT auto-applied (the runner ignores schema/down/).
-- Apply manually via psql if needed.
-- ============================================================

BEGIN;

-- TODO: reverse the forward migration.

COMMIT;
```

DOWN scripts are author-discretion — skip for trivial idempotent seeds, write for schema changes that have real rollback complexity.

---

## Backfill mode — `<migration> --backfill <NNN>_<slug>.sql`

If the user applied SQL manually via psql (outside the runner) and now needs `schema_migrations` to know about it:

1. Confirm the file exists at `db/<dbname>/schema/<NNN>_<slug>.sql`.
2. Confirm the changes actually landed in the DB (`\d` the affected table, check row counts, etc.).
3. Insert the row:
   ```bash
   PGPASSWORD=... psql ... -d <dbname> -c \
     "INSERT INTO schema_migrations (filename, applied_at) VALUES ('<NNN>_<slug>.sql', now()) ON CONFLICT DO NOTHING"
   ```
4. Re-run `-dry-run` to verify the file is no longer listed as pending.

This satisfies [`feedback_push_often`](../../memory/feedback_push_often.md): "backfill `schema_migrations` immediately if applied via raw psql."

---

## What this skill does NOT do

- **Does not author the migration body.** Domain decisions (FKs, indexes, soft-archive triggers, tenant isolation, RBAC seeds) are the user's call. The skill writes the wrapper; the user writes the SQL.
- **Does not run migrations against staging/production.** Hard-blocked by the env-file lockdown hook + the HARD RULE in this skill.
- **Does not commit automatically.** Surfacing the reminder is enough — commits are a deliberate act.
- **Does not bump plan/story IDs.** If the migration belongs to a `PLA-NNNN` or `00NNN` story, the user should reference it in the header WHY block; the skill won't synthesise the linkage.

---

## Quick reference

| Step | Command |
|---|---|
| Find next NNN (vector) | `ls -r db/mmff_vector/schema/ \| grep -E '^[0-9]+_' \| head -1` |
| Scaffold | (this skill — write file with template) |
| Dry-run | `go run ./backend/cmd/migrate -dry-run -db vector -env backend/.env.dev` |
| Apply | `go run ./backend/cmd/migrate -db vector -env backend/.env.dev` |
| Verify | `psql -d mmff_vector -c "SELECT * FROM schema_migrations ORDER BY applied_at DESC LIMIT 5"` |
