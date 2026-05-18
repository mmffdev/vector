# SQL Cookbook

Curated `psql` queries that worked. Append a new entry any time a non-trivial query succeeds and the next-session-me would otherwise re-derive it.

**Append rule:** if the query is non-obvious (joins, soft-archive filters, tenant scoping, JSONB digging, anything past `SELECT * FROM foo LIMIT 5`) → entry goes here before moving on.

**Skip rule:** trivial lookups (`\dt`, `SELECT * FROM small_table`), exploratory one-offs that didn't answer anything.

**DB discipline:** every entry MUST name the DB and pool — `mmff_vector` (pool), `vector_artefacts` (vaPool), `mmff_library` (libPools). This doubles as the "Never assume a database" record. See [`c_c_db_routing.md`](c_c_db_routing.md).

---

## Template

```markdown
### <question this query answers>
**DB:** <mmff_vector | vector_artefacts | mmff_library> (<pool name>)
**Use when:** <one-line trigger>
**Gotcha:** <the thing that would trip up next-time-me — soft-archive col, NULL handling, tenant scope, etc.>
```sql
<the query that worked>
```
```

---

## artefacts (vector_artefacts / vaPool)

### Diagnose tree-vs-summary divergence on a portfolio/work-items page
**DB:** vector_artefacts (vaPool)
**Use when:** the stats panel shows N items but the ObjectTree renders 0 — compare roots-vs-total and check whether artefact rows carry the same workspace_id as their artefact_type.
**Gotcha:** Summary filters only on `subscription_id + at.artefacts_types_scope + archived_at IS NULL`. List ALSO applies `at.artefacts_types_id_workspace = $JWT_WS` and (default) `a.parent_artefact_id IS NULL`. Many strategy seed rows carry `a.workspace_id = '…0010'` sentinel — they pass List's clamp because List uses the TYPE's workspace, not the artefact's.
```sql
SELECT a.workspace_id           AS a_ws,
       at.artefacts_types_id_workspace AS at_ws,
       at.artefacts_types_name,
       COUNT(*)                                          AS total,
       COUNT(*) FILTER (WHERE a.parent_artefact_id IS NULL) AS roots
  FROM artefacts a
  JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
 WHERE at.artefacts_types_scope = 'strategy'  -- or 'work'
   AND a.archived_at IS NULL
   AND a.subscription_id = '<sub-uuid>'
 GROUP BY a.workspace_id, at.artefacts_types_id_workspace, at.artefacts_types_name
 ORDER BY a.workspace_id, at.artefacts_types_name;
```

### Bulk-assign every artefact in a scope to one user
**DB:** vector_artefacts (vaPool)
**Use when:** seeding ownership on rows that came in with `owned_by_user_id = NULL` (typical ETL state) so the Owner column renders something visible.
**Gotcha:** join through `artefacts_types` to filter by `artefacts_types_scope` ('strategy' for portfolio-items, 'work' for work-items). Do NOT touch `created_by_user_id` — that's audit history, not assignment. Wrap in BEGIN/COMMIT; the user-id is in `mmff_vector.users` even though the write target is `vector_artefacts.artefacts`.
```sql
BEGIN;
UPDATE artefacts a
   SET owned_by_user_id = '<user-uuid>'
  FROM artefacts_types at
 WHERE at.artefacts_types_id = a.artefact_type_id
   AND at.artefacts_types_scope = 'strategy'
   AND a.archived_at IS NULL
   AND a.subscription_id = '<sub-uuid>';
COMMIT;
```

---

## work-items / objects (mmff_vector / pool)

_no entries yet_

---

## library spine (mmff_library / libPools)

_no entries yet_

---

## roles / permissions (mmff_vector / pool)

_no entries yet_

---

## auth / DPoP replay cache (mmff_vector / pool)

### Confirm ON CONFLICT DO NOTHING + RETURNING xmax behaves as jti_cache.go expects
**DB:** mmff_vector (pool — via tunnel `:5435`)
**Use when:** verifying the Postgres-backed DPoP replay-cache shape after touching migration 212 or `jti_cache.go`. The `MarkAndCheck` implementation relies on pgx returning `ErrNoRows` from `QueryRow` when `ON CONFLICT DO NOTHING` fires — confirm here that the wire shape matches.
**Gotcha:** the duplicate insert returns **zero rows** (not a row with non-zero xmax). pgx scans this as `ErrNoRows`, which `jti_cache.go` translates to `ErrJTIReplay`. If a future Postgres version changes this so the conflict path returns a row with `xmax != 0`, the defensive `if xmax != 0` guard in `jti_cache.go` catches it. Verified 2026-05-18 on PG 18.
```bash
PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi /opt/homebrew/Cellar/libpq/18.3/bin/psql \
  -h localhost -p 5435 -U mmff_dev -d mmff_vector <<'SQL'
INSERT INTO dpop_jti_cache (jti, expires_at) VALUES ('probe-1', NOW() + INTERVAL '60 seconds')
ON CONFLICT (jti) DO NOTHING RETURNING xmax;  -- expect 1 row, xmax=0
INSERT INTO dpop_jti_cache (jti, expires_at) VALUES ('probe-1', NOW() + INTERVAL '60 seconds')
ON CONFLICT (jti) DO NOTHING RETURNING xmax;  -- expect 0 rows = replay signal
DELETE FROM dpop_jti_cache WHERE jti = 'probe-1';
SQL
```

---

## performance / pg_stat_statements (any DB)

### Top N slow queries by total time
**DB:** any (each DB has its own `pg_stat_statements` view — counts are per-DB; on dev installed 2026-05-18 via swarm service args, `shared_preload_libraries=pg_stat_statements`, `track=all`, `max=10000`)
**Use when:** "what's actually slow?" — first pass on any perf investigation. Total time = `calls × mean_exec_time`, so this catches both single-slow-query and death-by-1000-cuts (N+1) patterns the per-request log can't see.
**Gotcha:** PG16 column names are `total_exec_time` / `mean_exec_time` (not `total_time` / `mean_time` — that was PG12 and earlier; copy-paste hazard). Query text is normalised — params replaced with `$1`, `$2`, etc. Backend `pgx` prepared statements show up as parameterised. Reset with `SELECT pg_stat_statements_reset();` after a fix to verify improvement; reset is per-DB.
```sql
SELECT calls,
       round(total_exec_time::numeric, 1)  AS total_ms,
       round(mean_exec_time::numeric, 2)   AS mean_ms,
       round(stddev_exec_time::numeric, 2) AS stddev_ms,
       rows,
       left(query, 120)                    AS query
  FROM pg_stat_statements
 WHERE query NOT LIKE 'SELECT pg_stat_statements%'
   AND query NOT LIKE 'CREATE EXTENSION%'
 ORDER BY total_exec_time DESC
 LIMIT 20;
```

### Top N queries by call count (find N+1 patterns)
**DB:** any
**Use when:** total_exec_time view shows fast queries dominating — those are usually N+1 candidates. A 0.5ms query called 50,000× per page is a bigger problem than one 500ms query called once.
**Gotcha:** look for queries with high `calls` AND low `mean_exec_time` — that's the N+1 shape. Real slow queries usually have mean > 10ms.
```sql
SELECT calls,
       round(mean_exec_time::numeric, 2)  AS mean_ms,
       round(total_exec_time::numeric, 1) AS total_ms,
       left(query, 120)                   AS query
  FROM pg_stat_statements
 WHERE query NOT LIKE 'SELECT pg_stat_statements%'
 ORDER BY calls DESC
 LIMIT 20;
```

### Reset stats after a fix
**DB:** any (per-DB reset)
**Use when:** you've shipped a query optimisation and want a clean baseline to measure against. Run reset, exercise the feature, re-run the top-N query.
```sql
SELECT pg_stat_statements_reset();
```

---

## performance / bloat (any DB)

### One-shot bloat audit — is pg_repack worth installing?
**DB:** any (run on each — `mmff_vector`, `vector_artefacts`, `mmff_library`)
**Use when:** deciding whether table/index bloat is a real problem before reaching for `pg_repack`, `VACUUM FULL`, or `CLUSTER`. Answers "do I have bloat worth the install?" in 30 seconds.
**Gotcha:** uses `pgstattuple` extension — install with `CREATE EXTENSION IF NOT EXISTS pgstattuple;` (needs superuser). `pgstattuple()` is slow on big tables (full scan); `pgstattuple_approx()` is fast but less accurate — prefer approx for the first sweep. Thresholds: <20% dead-tuple ratio = autovacuum coping; 20-40% = monitor; >40% = pg_repack candidate. Indexes bloat differently — separate query below.
```sql
-- Table bloat (fast approximate)
SELECT schemaname || '.' || relname                     AS table,
       pg_size_pretty(pg_relation_size(c.oid))          AS size,
       round((approx.approx_free_percent)::numeric, 1)  AS free_pct,
       round((approx.dead_tuple_percent)::numeric, 1)   AS dead_pct,
       approx.approx_tuple_count                        AS live_tuples
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_stat_user_tables s ON s.relid = c.oid,
       LATERAL pgstattuple_approx(c.oid) approx
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
   AND pg_relation_size(c.oid) > 1024 * 1024  -- skip <1MB
 ORDER BY approx.dead_tuple_percent DESC NULLS LAST
 LIMIT 20;

-- Index bloat (B-tree only — uses pgstatindex)
SELECT schemaname || '.' || indexrelname                AS index,
       pg_size_pretty(pg_relation_size(i.indexrelid))   AS size,
       round(stat.avg_leaf_density::numeric, 1)         AS leaf_density_pct,
       stat.leaf_pages,
       stat.empty_pages
  FROM pg_stat_user_indexes i
  JOIN pg_index x ON x.indexrelid = i.indexrelid
  JOIN pg_class c ON c.oid = i.indexrelid,
       LATERAL pgstatindex(i.indexrelid::regclass::text) stat
 WHERE pg_relation_size(i.indexrelid) > 1024 * 1024
 ORDER BY stat.avg_leaf_density ASC
 LIMIT 20;
```

---

## migrations / schema introspection

### List the N most recently applied migrations
**DB:** mmff_vector (pool) — same shape works on vector_artefacts and mmff_library, each has its own `schema_migrations`
**Use when:** "what's the latest migration?", checking if a migration applied, debugging "did my migration run?"
**Gotcha:** the column is `filename` (not `version` — that's a Rails/Knex-ism that doesn't apply here). The PK is `filename`, ordered by `applied_at`. Schema is just two cols: `filename text PK, applied_at timestamptz default now()`.
```sql
SELECT filename, applied_at
FROM schema_migrations
ORDER BY applied_at DESC
LIMIT 5;
```
