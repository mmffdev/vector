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
