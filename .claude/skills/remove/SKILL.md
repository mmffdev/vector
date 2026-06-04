---
name: remove
description: Dev-only substrate wipes for clean-slate iteration. Flags — `-dag` truncate every dependency map / edge / edge_event so the dependency model can be rebuilt step-by-step. Always counts before, demands an explicit "yes" confirmation. Dev only. More flags will be added later (alongside `-dag`, never breaking its contract).
---

# `<remove>` Skill

Dev-only **data** wipes (schema stays intact) so substrates can be rebuilt from zero for step-by-step validation. Distinct from `<artefacts>` (which wipes tenant artefact data via the backend handler) — this skill targets developer-facing test data on tables where there is no handler-level cascade to honour, so it talks to Postgres directly via the same `backend/.env.dev` connection the rest of the dev tooling uses.

Current flags:

| Flag | Database | Tables affected | Pre-flight |
|---|---|---|---|
| `-dag` | `vector_artefacts` (vaPool) | `artefact_dependency_edge_events`, `artefact_dependency_edges`, `artefact_dependency_maps` (TRUNCATE in that order, RESTART IDENTITY) | `COUNT(*)` per table |

Future flags will live alongside `-dag`; never break the `-dag` contract.

---

## HARD RULES — non-negotiable

1. **Dev only.** Backend env is pinned to `dev` (CLAUDE.md HARD RULE). Connection comes from `backend/.env.dev` (`VA_DB_*` for vector_artefacts). If `.env.dev` is missing or env points elsewhere, abort.
2. **Pre-flight counts first.** Always GROUP-COUNT before truncating. If every target table is already 0, report "Nothing to wipe." and exit — no confirmation needed, no `TRUNCATE` issued.
3. **Explicit confirmation per invocation.** Never reuse a previous "yes". The prompt is literally:
   > "Confirm: TRUNCATE `<table-list>` on `<db>` — `<N>` rows total (`<per-table breakdown>`)? Type `yes` to proceed."
   Accept only an exact `yes` (case-insensitive). Anything else → "Aborted — nothing wiped."
4. **Verify after wipe.** Re-count the same tables; report `before → after`. If any table is non-zero, that's a bug — surface the row count, don't claim success.
5. **TRUNCATE, never DELETE.** Goal is clean-slate; `RESTART IDENTITY` resets sequences. `CASCADE` is not needed because the truncate list is explicit and ordered child-first; if a future flag adds a table with a dependent we don't know about, fix the flag's table list — don't reach for `CASCADE`.
6. **Never assume a database.** Each flag pins its DB + tables in the table above. Adding a new flag means tracing the handler in `backend/internal/`, confirming the pool variable in `backend/cmd/server/main.go`, and cross-checking `docs/c_c_db_routing.md` before adding the row.
7. **No psql global env contamination.** Source `backend/.env.dev` inside a sub-shell or `set -a; source …; set +a` block; do not export DB creds into the parent shell.

---

## Preconditions

- `backend/.env.dev` exists and is readable.
- A writable `psql` binary on disk. macOS dev default: `/opt/homebrew/Cellar/libpq/<version>/bin/psql`. `pg-mcp.sh` is read-only by design and CANNOT be used for this skill — it routes through `SafeSqlDriver` which rejects `TRUNCATE`.
- The dev tunnel is up on the port named in `VA_DB_PORT` (default `5435`). Quick check: `nc -z localhost "$VA_DB_PORT"`.

---

## Flow — `-dag` (wipe dependency model)

### Step 0 — Setup

Resolve creds + psql binary; export nothing to the parent shell.

```bash
ROOT="/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
PSQL=$(ls /opt/homebrew/Cellar/libpq/*/bin/psql 2>/dev/null | head -1)
[[ -x "$PSQL" ]] || { echo "psql not found"; exit 1; }
[[ -f "$ROOT/backend/.env.dev" ]] || { echo ".env.dev missing"; exit 1; }
```

### Step 1 — Pre-flight count

```bash
( set -a; source "$ROOT/backend/.env.dev"; set +a
  PGPASSWORD="$VA_DB_PASSWORD" "$PSQL" \
    -h "$VA_DB_HOST" -p "$VA_DB_PORT" -U "$VA_DB_USER" -d "$VA_DB_NAME" -At -c "
      SELECT 'maps:'   || COUNT(*) FROM artefact_dependency_maps
      UNION ALL
      SELECT 'edges:'  || COUNT(*) FROM artefact_dependency_edges
      UNION ALL
      SELECT 'events:' || COUNT(*) FROM artefact_dependency_edge_events;
  " )
```

If all three are `0` → "Nothing to wipe." and stop.

### Step 2 — Confirm

Prompt the user with the exact wording from HARD RULE 3. Only `yes` proceeds.

### Step 3 — Truncate

Single statement, child-first ordering:

```bash
( set -a; source "$ROOT/backend/.env.dev"; set +a
  PGPASSWORD="$VA_DB_PASSWORD" "$PSQL" \
    -h "$VA_DB_HOST" -p "$VA_DB_PORT" -U "$VA_DB_USER" -d "$VA_DB_NAME" -c "
      TRUNCATE TABLE
        artefact_dependency_edge_events,
        artefact_dependency_edges,
        artefact_dependency_maps
      RESTART IDENTITY;
  " )
```

### Step 4 — Verify

Re-run the count query from Step 1. Report `before → after`. If anything is non-zero, surface it; do not claim success.

---

## Output contract

On success:

```
Wiped DAG substrate on vector_artefacts:
  artefact_dependency_maps:        <N> → 0
  artefact_dependency_edges:       <N> → 0
  artefact_dependency_edge_events: <N> → 0
```

On nothing-to-do:

```
DAG substrate already empty — nothing to wipe.
```

On abort:

```
Aborted — nothing wiped.
```

---

## Reference

- Tables defined under `backend/internal/dependencies/sql.go` (`sqlPingMaps`, `sqlPingEdges`, `sqlPingEdgeEvents` are the canonical naming).
- Service wired to `vaPool` in `backend/cmd/server/main.go` (`dependencies.NewService(vaPool)`).
- DB routing map: [`docs/c_c_db_routing.md`](../../../docs/c_c_db_routing.md).
- Cookbook entry: append to [`docs/c_sql_cookbook.md`](../../../docs/c_sql_cookbook.md) under "Wipe DAG substrate (clean-sheet reset)" the first time this skill is used in anger so the SQL is grep-discoverable outside the skill.
