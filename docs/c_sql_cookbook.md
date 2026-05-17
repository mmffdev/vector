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

_no entries yet — first novel artefact query goes here_

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
