# Postgres — introspection playbook

> Parent: [c_postgresql.md](c_postgresql.md)
> Last verified: 2026-04-24

Copy-paste-ready SQL for the questions that come up repeatedly when designing migrations or verifying backfills against `mmff_vector`. The parent doc covers *how* to reach the DB; this doc covers *what to ask it once you're there.*

Every block below assumes you have a `psql` session open, or the preamble from [c_c_bash_postgres.md](c_c_bash_postgres.md). If you prefer one-shot invocation, wrap the SQL in `-c "…"` or `-f a.sql`.

---

## Quick orientation

```sql
-- Who am I, where am I, what version?
SELECT current_user, current_database(), version();

-- List every user table (excludes partitions' child tables)
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- Row counts, cheap approximation (no SEQSCAN on large tables)
SELECT relname AS table_name, n_live_tup AS est_rows
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;
```

---

## Columns and types

```sql
-- Full column definition for a table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'workspace'
ORDER BY ordinal_position;

-- Every table that has a column named X (useful for rename audits)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'tenant_id'
ORDER BY table_name;

-- Find every column whose name MATCHES a pattern
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND column_name LIKE '%_id'
ORDER BY table_name, column_name;
```

---

## Constraints

```sql
-- Every constraint on a table (PK, FK, UNIQUE, CHECK)
SELECT conname, contype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'workspace'::regclass
ORDER BY contype, conname;
-- contype: p=PK, f=FK, u=UNIQUE, c=CHECK, x=EXCLUDE

-- Every CHECK constraint's current expression (useful for enum-style CHECKs)
SELECT conrelid::regclass AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'c' AND connamespace = 'public'::regnamespace
ORDER BY table_name, conname;
```

---

## Foreign keys — incoming and outgoing

```sql
-- FKs OUT of a table (what does this table reference?)
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f' AND conrelid = 'workspace'::regclass;

-- FKs INTO a table (what references this table? critical before DROP/RENAME)
SELECT conrelid::regclass AS from_table, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f' AND confrelid = 'tenants'::regclass
ORDER BY from_table;

-- Every FK in the schema, grouped by target table
SELECT confrelid::regclass AS target_table,
       conrelid::regclass AS from_table,
       conname
FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace
ORDER BY target_table, from_table;
```

---

## Indexes

```sql
-- Every index on a table with its definition (partial indexes show the WHERE)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'workspace';

-- Every unique / partial unique index (important before adding new UNIQUE)
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND indexdef ILIKE '%UNIQUE%'
ORDER BY tablename;

-- Index size (helps decide whether dropping is cheap)
SELECT relname AS index_name, pg_size_pretty(pg_relation_size(oid)) AS size
FROM pg_class
WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
ORDER BY pg_relation_size(oid) DESC
LIMIT 20;
```

---

## Triggers and functions

```sql
-- Triggers on a table + what function they call
SELECT tgname, pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'workspace'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- Body of a function (e.g. provision_tenant_defaults)
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'provision_tenant_defaults'
  AND pronamespace = 'public'::regnamespace;

-- Every trigger-calling function defined in public
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace AND prokind = 'f'
ORDER BY proname;
```

---

## Sequences and counters

```sql
-- Inspect tenant_sequence state for a given scope
SELECT * FROM tenant_sequence WHERE scope = 'workspace' ORDER BY tenant_id;

-- Every sequence in the DB (rare — we use tenant_sequence, not SEQUENCEs)
SELECT sequence_name, data_type, start_value, increment, max_value
FROM information_schema.sequences
WHERE sequence_schema = 'public';
```

---

## Partitioned tables (once we have the `events` table)

```sql
-- Is this table partitioned, and by what?
SELECT c.relname, p.partstrat, pg_get_partkeydef(c.oid) AS partition_key
FROM pg_partitioned_table p
JOIN pg_class c ON c.oid = p.partrelid
WHERE c.relnamespace = 'public'::regnamespace;

-- List all child partitions of a parent
SELECT inhrelid::regclass AS partition,
       pg_get_expr(c.relpartbound, c.oid) AS bound
FROM pg_inherits i
JOIN pg_class c ON c.oid = i.inhrelid
WHERE inhparent = 'events'::regclass
ORDER BY partition::text;
```

---

## Dry-run a migration

Wrap the migration body in an explicit ROLLBACK to see exactly what it would change without committing:

```bash
PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-) \
  && PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql \
       -h localhost -p 5434 -U mmff_dev -d mmff_vector \
       -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
\i db/schema/017_subscription_rename.sql
-- Verification queries here — they see the post-migration state
SELECT to_regclass('public.subscriptions'), to_regclass('public.tenants');
ROLLBACK;
SQL
```

Warning: the migration file itself already contains `BEGIN; … COMMIT;`. `\i` inside an outer transaction will fail on the inner `COMMIT` unless you first strip those. Two options:

1. **Preferred for dry-run**: copy the migration body into a temp file with the `BEGIN`/`COMMIT` removed, then `\i` that.
2. **Alternative**: run the file normally, then verify in a follow-up session. Cheaper for trivial migrations, riskier for structural ones.

---

## Backfill verification recipes

Every migration that rewrites data needs three queries answered *before* the PR merges.

### Pattern — "did every row get a value?"

```sql
-- After adding subscription_id via rename, no row should still be without one
SELECT COUNT(*) FROM workspace WHERE subscription_id IS NULL;  -- expect 0
```

### Pattern — "are FKs valid?"

```sql
-- Find orphans: rows whose FK target doesn't exist
SELECT w.id, w.subscription_id
FROM workspace w
LEFT JOIN subscriptions s ON s.id = w.subscription_id
WHERE s.id IS NULL;                                            -- expect 0 rows
```

### Pattern — "does the invariant still hold post-rewrite?"

```sql
-- After roadmap relocation, every workspace should have exactly 0 or 1 roadmap
SELECT workspace_id, COUNT(*)
FROM workspace_roadmap
GROUP BY workspace_id
HAVING COUNT(*) > 1;                                           -- expect 0 rows
```

### Pattern — "backfill deposited the right count"

```sql
-- 019 backfill copies portfolio_item_types rows to SPACE-00000001 workspaces.
-- Count before vs after should match per subscription.
SELECT subscription_id, COUNT(*) AS types_count
FROM portfolio_item_types
GROUP BY subscription_id
ORDER BY subscription_id;
```

---

## Rename-audit checklist (Migration 017)

Before declaring a `tenants → subscriptions` rename complete, run:

```sql
-- 1. No table still named tenants or tenant_sequence
SELECT to_regclass('public.tenants'),
       to_regclass('public.tenant_sequence');                  -- both NULL

-- 2. No column still named tenant_id anywhere
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND column_name = 'tenant_id';   -- 0 rows

-- 3. No constraint name still contains 'tenant'
SELECT conrelid::regclass, conname FROM pg_constraint
WHERE conname ILIKE '%tenant%';                                -- 0 rows

-- 4. No index name still contains 'tenant'
SELECT tablename, indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname ILIKE '%tenant%';    -- 0 rows

-- 5. No function body still mentions 'tenant_sequence' or 'tenant_id'
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND pg_get_functiondef(oid) ILIKE '%tenant%';                -- 0 rows
```

Any row returned by queries 2–5 is a rename-miss. Fix before merging 017.

---

## Size and health

```sql
-- Table sizes, largest first
SELECT relname AS table_name,
       pg_size_pretty(pg_total_relation_size(oid)) AS total_size,
       pg_size_pretty(pg_relation_size(oid)) AS heap_size
FROM pg_class
WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
ORDER BY pg_total_relation_size(oid) DESC
LIMIT 20;

-- Current connections + what they're doing
SELECT pid, usename, application_name, state,
       now() - query_start AS running_for, left(query, 80) AS query
FROM pg_stat_activity
WHERE datname = 'mmff_vector' AND pid != pg_backend_pid()
ORDER BY query_start;

-- Tables that have never been VACUUMed (or not since last big churn)
SELECT relname, last_vacuum, last_autovacuum, n_dead_tup
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC
LIMIT 10;
```

---

## Never run against prod blindly

Any query starting with `DELETE`, `UPDATE`, `TRUNCATE`, `ALTER`, `DROP` — wrap in `BEGIN; … SELECT the affected rows; ROLLBACK;` first, read the result, *then* re-run with `COMMIT`. The tunnel makes prod feel like staging. It is not.

If you're reading this file because a migration went wrong: [c_db-backup.md](c_db-backup.md) — restore from the pre-apply snapshot. Do not attempt to "fix forward" a half-applied DDL migration; the backup is faster.
