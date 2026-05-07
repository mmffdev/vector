# v2 work-items cutover — story draft

**Plan ID:** `PLA-0023` (next free — `c_plan_index.md` last issued `PLA-0022`; verify with `ls dev/plans/`)
**Story ID range:** `00461`–`00475` (15 stories — `c_story_index.md` last issued `00460`; verify before allocation)
**Phase:** `PH-0005` (confirmed against `.claude/memory/boot1.md`)
**Risk profile:** **HIGH** — cross-DB cutover; the production wire shape (`/api/work-items`) is consumed by `WorkItemsTree` and any wire drift breaks the page; schema decisions on 9 missing fields lock in for production; cross-DB user/subscription joins are *impossible* and must be redesigned, not papered over.

---

## Up-front decisions (locked into this draft)

These resolve the open questions in handovers 01/02 so the stories are concrete. Each is one of two paths the cutover agent could pick — picked here, justified, and assumed below.

1. **9 missing wire fields → real columns on `artefacts`, NOT EAV.** Path: handover 01 §3 column-add recommendations for `priority`, `story_points`, `due_date`, plus a new `sprints` table + `artefacts.sprint_id` FK. EAV keeps the schema "pure" but the rollup-points recursive CTE and the `?priority=` / `?sprint_id=` / `?sort=points` / `?sort=priority` filter+sort paths become catastrophic without indexes. Real columns is the lower-risk path for cutover; the EAV slots remain available for genuinely user-defined fields.
2. **`flow_state_code` vocabulary → preserve via SELECT-side translation.** Path 01 §3 (a). The wire keeps emitting the 5-value Vector taxonomy (`backlog/ready/doing/completed/accepted`) by `CASE flow_states.kind WHEN 'todo' THEN 'backlog' …` in the SQL. The 5→4 collapse means `'ready'` and `'accepted'` round-trip-safely become `'backlog'`/`'completed'`; if any frontend switch needs the old fidelity it's a follow-up. This keeps `WorkItemsTree` untouched at cutover.
3. **`root_feature_id` → drop from wire.** Path 01 §3 last bullet. It's a denormalisation aid; the v2 hierarchy can be reconstructed by walking `parent_artefact_id`. Frontend already tolerates `null` for this field. If a consumer breaks, that's a follow-up story, not a cutover blocker.
4. **`owner` decoration → in-Go post-fetch from `mmff_vector.users`.** Path 01 §5 (a). Two queries per page (artefacts + slim users batch keyed by distinct `owned_by_user_id`s). One extra query is acceptable; building a users mirror is a separate, larger, write-coupling project that can be done if perf demands it later.
5. **`key_num` rendering → backfill `artefacts.number` 1:1 from `obj_work_items.key_num`** during ETL. Public IDs stay as `WI-NN` (legacy `prefix` was always `WI` on the unified counter). After cutover, new rows get per-`(subscription, type)` numbering naturally; the visible-ID-changes-by-type acceptance is consciously deferred.
6. **Cutover style → feature flag (`WORK_ITEMS_V2`) on the Go handler, NOT a hard rename.** Both code paths live until the flag has been on in dev + staging-equivalent without rollback for a defined burn-in window. Only then does v1 code get deleted.

---

## Recommended order

1. **00461** — SQL: schema migration adding `priority`, `story_points`, `due_date`, `sprint_id` columns + new `sprints` table to `vector_artefacts`
2. **00462** — DEV: invoke `seed_system_artefact_types(<sub>)` for the dev tenant + patch `010_seed_system_artefact_types.sql` to self-invoke
3. **00463** — DEV: promote `03-fixture-seed.sql` from handoffs into `db/artefacts_schema/seed/01_work_items_fixture.sql` and apply to dev
4. **00464** — API: scaffold `backend/internal/workitemsv2/` package (handler + service skeleton) reading `vector_artefacts.artefacts`
5. **00465** — API: implement v2 list query — JOINs (`artefact_types`, `flow_states`), `flow_state_code` translation, recursive `rollup_points` CTE retargeted at `parent_artefact_id`
6. **00466** — API: implement v2 list filter parsing parity (`status`, `priority`, `item_type`, `sprint_id`, `owner_id`, `parent_id`, `limit`, `offset`)
7. **00467** — API: implement v2 ORDER BY whitelist parity (`id|title|status|priority|points|sprint|due` + `dir` clamp)
8. **00468** — API: cross-DB owner decoration — distinct `owned_by_user_id` batch fetch from `mmff_vector.users`, post-decorate in Go
9. **00469** — API: wire v2 handler into `auth.Service.RequireAuth` + `RequireFreshPassword` + per-route 120/min IP rate limiter
10. **00470** — API: emit RFC 9457 Problem Details on every 4xx/5xx via `httperr.Write`/`WriteValidation`
11. **00471** — GOV: feature-flag the work-items list route — `WORK_ITEMS_V2=true` env var routes to v2; default false routes to v1
12. **00472** — SQL: ETL — backfill `vector_artefacts.artefacts` from `mmff_vector.obj_work_items` via `postgres_fdw` (id-preserving + `number` from `key_num`)
13. **00473** — DEV: parity smoke test against dev — login, list, sort each whitelisted column, filter by every supported param, archive a row, JSON-diff v1 vs v2 wire shapes for the same subscription
14. **00474** — ITM: repoint `WorkItemsTree` (and its config) to consume v2 — only when the flag has burned in for ≥48h on dev with zero parity diffs
15. **00475** — DEV: post-cutover follow-up doc — record what was deferred (templates UX, ranking-NOTIFY trigger on `artefacts`, `entityrefs` vocabulary) and the burn-in evidence; update `c_c_vector_artefacts_backfill.md` with cutover outcome

---

## 00461 — SQL: add missing wire-field columns + sprints table to `vector_artefacts`

**Layer:** migration
**Feature:** `FE-SQL-NNNN` (next free counter — propose `FE-SQL-0020`; this is a pure DDL change to a database, decision-tree Layer 3.1)
**EST:** F5 (one migration file, four columns + one new table with FK + indexes; trivial DDL but must match exact CHECK constraints from `mmff_vector` — non-trivial parity check)
**RISK:** S2 (locks in schema decisions for the cutover window; getting CHECK lists wrong forces a follow-up migration)
**Depends on:** none
**Plan label:** `PLA-0023`

### Description
Add the four missing wire-field columns to `vector_artefacts.artefacts` and create a `sprints` table mirroring `mmff_vector.sprints`. Without these the Go v2 handler cannot project the production wire shape for `priority`, `story_points`, `due_date`, `sprint_id`, or the `sprint: {id, alias}` ref. Decision locked above (Up-front Decision #1) — real columns, not EAV.

### Acceptance criteria
- New file `db/artefacts_schema/012_artefacts_wire_field_columns.sql` adds:
  - `artefacts.priority TEXT NULL` with CHECK `priority IN ('critical','high','medium','low')` matching `065_execution_core_columns.sql`
  - `artefacts.story_points INTEGER NULL` with CHECK `story_points >= 0`
  - `artefacts.due_date DATE NULL`
  - `artefacts.sprint_id UUID NULL` (soft FK to the new `sprints` table — actual FK once that table exists in 013)
- New file `db/artefacts_schema/013_sprints.sql` creates `sprints` (`id UUID PK`, `subscription_id UUID NOT NULL`, `workspace_id UUID NOT NULL`, `name TEXT NOT NULL`, `start_date DATE`, `end_date DATE`, `archived_at TIMESTAMPTZ NULL`, `created_at`, `updated_at` with `set_updated_at()` trigger). Mirror exactly the column list of `mmff_vector.sprints`.
- `artefacts.sprint_id` becomes a hard FK `REFERENCES sprints(id) ON DELETE SET NULL` in 013.
- Indexes added: `artefacts_priority` on `(priority)` (partial: `WHERE archived_at IS NULL`), `artefacts_sprint` on `(sprint_id)` (partial: `WHERE archived_at IS NULL AND sprint_id IS NOT NULL`), `artefacts_due_date` on `(due_date)` (partial: `WHERE archived_at IS NULL AND due_date IS NOT NULL`).
- `go run ./backend/cmd/migrate -db vector_artefacts` applies and shows two new rows in `schema_migrations` for the dev DB.
- Reverse-direction script lives under `db/artefacts_schema/down/012_…sql` and `…/013_…sql` per the project convention.

### Files likely touched
- `db/artefacts_schema/012_artefacts_wire_field_columns.sql` (new)
- `db/artefacts_schema/013_sprints.sql` (new)
- `db/artefacts_schema/down/012_*.sql` and `down/013_*.sql` (new, if convention applies)
- `docs/c_schema.md` (one-line additions for the 4 columns + sprints table)

### Notes / open questions
- Does the project's artefacts-schema convention split sprints into a separate file (recommended — single-purpose) or piggyback on 012? Default above is split.
- The `sprint_position`/`backlog_position` two-column ranking shape from `obj_work_items` is intentionally NOT mirrored. The v2 default ORDER preserves a single `position` column per handover 01 §4 — the loss of independent backlog-vs-sprint ordering is logged in the post-cutover doc (00475).

---

## 00462 — DEV: invoke `seed_system_artefact_types` + patch 010 to self-invoke

**Layer:** migration / dev
**Feature:** `FE-DEV-NNNN` (next free DEV counter — propose `FE-DEV-0023`; internal seed plumbing)
**EST:** F2 (single SQL line + a 5-line patch to an existing migration; trivial)
**RISK:** S1 (BLOCKER for 00463 per handover 03-readme PREREQ-1; until this runs, the fixture seed `RAISE EXCEPTION`s and rolls back)
**Depends on:** 00461 (so the column adds are present before any artefact rows insert)
**Plan label:** `PLA-0023`

### Description
The four system work `artefact_types` (Story/US, Defect/DE, Task/TA, Epic/EP) are not auto-seeded for the dev tenant. `010_seed_system_artefact_types.sql` defines `seed_system_artefact_types(uuid)` but does not invoke it (only `011_seed_system_strategy_types.sql` self-invokes). This story (a) invokes it once for the dev tenant, (b) patches 010 to self-invoke for `00000000-…-0001` mirroring 011's pattern, so the implicit ordering trap is gone for future tenants.

### Acceptance criteria
- `SELECT seed_system_artefact_types('00000000-0000-0000-0000-000000000001'::uuid);` runs against dev `vector_artefacts` and returns without error.
- `db/artefacts_schema/010_seed_system_artefact_types.sql` gets a tail invocation block matching `011_seed_system_strategy_types.sql` (read 011 verbatim before patching).
- Verification query passes: `SELECT count(*) FROM artefact_types WHERE subscription_id = '00000000-…-0001' AND scope = 'work' AND archived_at IS NULL;` returns `4`.
- Verification: per-type default flow + states present — `SELECT count(*) FROM flow_states fs JOIN flows f ON f.id = fs.flow_id WHERE f.is_default AND f.artefact_type_id IN (SELECT id FROM artefact_types WHERE subscription_id = '…' AND scope = 'work');` returns `16` (4 types × 4 kinds: todo/in_progress/done/cancelled).

### Files likely touched
- `db/artefacts_schema/010_seed_system_artefact_types.sql` (patch — append self-invoke)

### Notes / open questions
- The patch to 010 changes a previously-applied migration's hash. Confirm whether the project's migrate runner re-checksums or only-on-pending — if the former, the patch ships as a new migration `db/artefacts_schema/014_…sql` instead. Default above assumes patch-in-place; if not, escalate to next migration number.

---

## 00463 — DEV: promote fixture seed to `db/artefacts_schema/seed/` + apply to dev

**Layer:** migration / dev
**Feature:** `FE-DEV-NNNN` (propose `FE-DEV-0024`; seed promotion is dev-tooling)
**EST:** F2 (file move + dir create + one psql apply; idempotent guard already present)
**RISK:** S2 (touches dev data, not prod, but the row UUIDs collide cross-DB by design — re-running is a no-op only if the `ON CONFLICT (id) DO NOTHING` guard holds; if the file is mutated mid-promotion, that guarantee dies)
**Depends on:** 00461 (columns exist), 00462 (system types present, otherwise the DO-block aborts)
**Plan label:** `PLA-0023`

### Description
Move `.claude/handoffs/v2-cutover/03-fixture-seed.sql` to `db/artefacts_schema/seed/01_work_items_fixture.sql` (creating the seed dir, which does not exist yet). Apply against dev `vector_artefacts` to give the v2 handler 15 rows (3 epics + 6 stories + 4 tasks + 2 defects) to read. The new file is byte-identical to the handover apart from the path-aware header comment. Per handover 03-readme "Final destination if accepted" guidance.

### Acceptance criteria
- File present at `db/artefacts_schema/seed/01_work_items_fixture.sql` (new directory created).
- Handover copy at `.claude/handoffs/v2-cutover/03-fixture-seed.sql` deleted (or left as a tombstone with a one-line `-- Promoted to db/artefacts_schema/seed/01_work_items_fixture.sql` comment).
- Applied to dev: `psql -h localhost -p $(./dev/scripts/resolve-dev-db-port.sh | cut -f1) -U mmff_dev -d vector_artefacts -v ON_ERROR_STOP=1 -f db/artefacts_schema/seed/01_work_items_fixture.sql` returns the success NOTICE: `Work Items v2 fixture seed complete (15 artefacts: 3 epic, 6 story, 4 task, 2 defect).`
- All four verification queries from `03-fixture-seed-readme.md` §"Verification queries" pass.

### Files likely touched
- `db/artefacts_schema/seed/01_work_items_fixture.sql` (new — file move)
- `.claude/handoffs/v2-cutover/03-fixture-seed.sql` (delete or tombstone)

### Notes / open questions
- The fixture does **not** populate `priority` / `story_points` / `due_date` / `sprint_id` (the columns added by 00461). For the smoke story (00473) to demonstrate `?priority=` / `?sprint_id=` filter parity, the fixture either (a) stays bare and the smoke uses a separate row insert, or (b) the fixture grows a follow-up patch. Recommendation: (a) — keep this story scope-tight; smoke handles its own data.

---

## 00464 — API: scaffold `backend/internal/workitemsv2/` package skeleton

**Layer:** backend
**Feature:** `FE-API-NNNN` (propose `FE-API-0025`; new REST endpoint package)
**EST:** F3 (file scaffold + service constructor + handler skeleton + main.go wiring + types.go copied verbatim from `internal/workitems` so the wire contract is identical at the type level — small but needs care)
**RISK:** S2 (the package boundary decision is sticky — if scaffolded wrong it costs 6 follow-up stories to unwind)
**Depends on:** none (parallel-safe with 00461–00463)
**Plan label:** `PLA-0023`

### Description
Stand up a sibling package to `backend/internal/workitems/` named `workitemsv2/` reading from `vector_artefacts`. Wiring is minimal — the package owns its own `*pgxpool.Pool` (configured against `VECTOR_ARTEFACTS_DB_URL` / equivalent env), exposes `Service` + `Handler` mirroring the v1 surface, and registers under `/api/v2/work-items` in `backend/cmd/server/main.go`. No filters, no sort, no decoration in this story — just a stub list returning an empty page in the production wire shape so 00465–00468 have a target to fill.

### Acceptance criteria
- New package: `backend/internal/workitemsv2/{handler.go, service.go, types.go, doc.go}`. `types.go` is byte-identical to `backend/internal/workitems/types.go` (the wire contract MUST not drift at the struct level).
- New pool wiring: `backend/cmd/server/main.go` opens a second `pgxpool` keyed on `VECTOR_ARTEFACTS_DB_URL` with a clear log line on connect.
- Stub: `(*Service).ListWorkItems(ctx, subscriptionID, filters) (items []WorkItem, total int, err error)` returns `[]WorkItem{}, 0, nil` (no SQL yet). `(*Handler).List` calls it and writes `{ "items": [], "total": 0 }`.
- Route registered: `r.Get("/api/v2/work-items", workitemsv2Handler.List)` mounted in the same group structure as `/api/work-items` (auth + rate-limit middleware deferred to 00469).
- `go build ./...` clean. `go vet ./internal/workitemsv2/...` clean.

### Files likely touched
- `backend/internal/workitemsv2/handler.go` (new)
- `backend/internal/workitemsv2/service.go` (new)
- `backend/internal/workitemsv2/types.go` (new — copy of v1)
- `backend/internal/workitemsv2/doc.go` (new)
- `backend/cmd/server/main.go` (add pool + route)

### Notes / open questions
- Pool config — does the project want one pool config struct in `config/` or per-package wiring? Confirm against existing pattern (`mmff_library` integration is the closest analogue).
- The Next.js PoC at `app/api/v2/work-items/route.ts` is **kept** through cutover (it serves the `/v2/work-items` reference page); after cutover (00475 follow-ups) it can be retired or repointed at the Go v2 endpoint.

---

## 00465 — API: v2 list query — JOINs, `flow_state_code` translation, rollup CTE

**Layer:** backend
**Feature:** `FE-API-NNNN` (propose `FE-API-0026`; same package, distinct surface — keeping one card per area lets EST/RISK ride per concern)
**EST:** F8 (the recursive `rollup_points` CTE retarget + `kind→canonical_code` CASE + `artefact_types` join + `flow_states` join + nullable coalescing + parity check against 24 wire fields)
**RISK:** S2 (any field projecting null where v1 projected non-null breaks `WorkItemsTree` cells — needs an exhaustive diff against the v1 SELECT list)
**Depends on:** 00461 (columns), 00463 (rows to read), 00464 (package)
**Plan label:** `PLA-0023`

### Description
Replace the stub in `(*Service).ListWorkItems` with the production-shape SELECT against `artefacts a JOIN artefact_types at JOIN flow_states fs`. Project all 24 wire fields per handover 01 §2. Translate `flow_states.kind` → 5-value `flow_state_code` via SELECT-side CASE. Retarget the `rollup_points` recursive CTE at `artefacts` / `parent_artefact_id` / `story_points` (now a real column). Implement `children_count` correlated subquery against `parent_artefact_id`. `total` count via mirror `Svc.CountWorkItems` query.

### Acceptance criteria
- `(*Service).ListWorkItems` returns rows whose JSON marshals byte-for-byte the same shape as the v1 endpoint when given the fixture data — verified by a Go test that calls both services and `reflect.DeepEqual`s the results minus the inherent UUID and timestamp differences (see test plan in 00473).
- `flow_state_code` CASE table: `'todo'→'backlog'`, `'in_progress'→'doing'`, `'done'→'completed'`, `'cancelled'→'cancelled'`. (`'ready'`/`'accepted'` have no v2 source — documented as a known collapse in `c_c_vector_artefacts_backfill.md` per Up-front Decision #2.)
- `item_type` derived via `lower(at.name)` (matches handover 01 §2; falls back to prefix-inversion if names drift in custom tenant types).
- `rollup_points` CTE matches v1 algorithm: `coalesce(rollup, story_points)` per row.
- `key_num` projected from `artefacts.number`. `root_feature_id` projected as JSON `null` (Up-front Decision #3).
- `owner` and `sprint` refs projected as `null` in this story (decorated in 00468 / sprints filter in 00466).
- Coalesces every column the v1 wire emits as non-nullable (`flow_state_id::text` → `''`, `created_by_user_id` → `''` with one-line comment that this loosens v1's NOT NULL guarantee — flagged tech-debt S3).

### Files likely touched
- `backend/internal/workitemsv2/service.go`
- `backend/internal/workitemsv2/types.go` (only if a CASE-required transform forces a column type change — should not)

### Notes / open questions
- `created_by_user_id` is nullable in v2 vs NOT NULL in v1. This is a real shape loosening; the wire still types it as `string` but the field can now be `""`. Logged as tech-debt S3 trigger=`if any consumer hits the empty string path in dev`. Don't tighten in this story.

---

## 00466 — API: v2 list filter parsing parity (`status`/`priority`/`item_type`/`sprint_id`/`owner_id`/`parent_id`/`limit`/`offset`)

**Layer:** backend
**Feature:** `FE-API-NNNN` (propose `FE-API-0027`)
**EST:** F5 (8 filter slots, each a 2-line WHERE addition + parameterised bind; `?status=` needs the inverse translation `'open'→'todo'` etc.; `?item_type=` needs the prefix-or-name lookup)
**RISK:** S2 (a missed filter silently returns wider results — the page-level "Open work items only" UI breaks invisibly if `?status=` is dropped)
**Depends on:** 00465
**Plan label:** `PLA-0023`

### Description
Parse all eight filter params from the request and bind them in WHERE per handover 01 §4. The `?status=` translation reverses the SELECT-side CASE from 00465. `?item_type=` resolves to `at.prefix` (most stable per handover 01). `?sprint_id=` becomes `a.sprint_id = $N` once 00461 lands. The `?parent_id=` "default to top-level when both `parent_id` and `item_type` are absent" branch in v1 (`wi.parent_id IS NULL`) is preserved verbatim against `a.parent_artefact_id IS NULL`.

### Acceptance criteria
- All eight params mirrored from `backend/internal/workitems/handler.go:33-66` parsing logic, each bound positionally (no string interpolation).
- `?status=open` → `fs.kind = 'todo'` etc. via the inverse CASE — covered by a Go unit test on the translation function.
- `?item_type=story|task|defect|epic` → `at.prefix = 'US'|'TA'|'DE'|'EP'`.
- The `parent_id IS NULL` default branch is exercised by the smoke test (00473).
- Parameter cap matches v1: `?limit=` clamps to 200 (handler-level) and 5000 (service-level), `?offset=` clamps to non-negative.

### Files likely touched
- `backend/internal/workitemsv2/handler.go`
- `backend/internal/workitemsv2/service.go`

### Notes / open questions
- `?owner_id=` filter requires the column from 00461 (`owned_by_user_id`) — no missing dependency; it's a v2-existing column. The `owner_id` wire field maps to `owned_by_user_id` per handover 01 §2.

---

## 00467 — API: v2 ORDER BY whitelist parity (`id|title|status|priority|points|sprint|due` + `dir` clamp)

**Layer:** backend
**Feature:** `FE-API-NNNN` (propose `FE-API-0028`)
**EST:** F5 (7 sort keys + dir clamp + the per-key tier-then-number CASE for `id` + the "fall back to `key_num`" tiebreaker on every key)
**RISK:** S2 (whitelist mistake = SQL-injection vector if user input ever lands in the ORDER BY string — the v1 implementation at `service.go:106-150` is the gold standard and must be mirrored exactly)
**Depends on:** 00465 (query exists), 00461 (priority/story_points/due_date columns exist)
**Plan label:** `PLA-0023`

### Description
Implement the seven-key sort whitelist matching `backend/internal/workitems/service.go:106-150` (commit `c8fc029`) against the v2 schema. Default order is `a.position NULLS LAST, a.number ASC` (the lost backlog-vs-sprint split is documented). Tier-then-number ordering for `?sort=id` uses the prefix CASE (`EP=1, US=2, TA=3, DE=4, *=99`). Direction clamp accepts only `asc`/`desc`, defaults to `asc`.

### Acceptance criteria
- Whitelist is an explicit `switch` statement, not a map lookup — matches the v1 style.
- Each non-default sort emits the `, a.number ASC` tiebreaker.
- `?sort=points` projects the recursive `rollup_points` value, not raw `story_points` — matches v1 `coalesce(rollupPointsExpr, wi.story_points)`.
- A request with a non-whitelisted `?sort=foo` falls back to default order (no SQL injection — hardcoded ORDER fragment).
- `?dir=invalid` clamps to `asc`. Empty/missing `?sort=` and/or `?dir=` use the default order.

### Files likely touched
- `backend/internal/workitemsv2/service.go`

### Notes / open questions
- None. The v1 implementation is the spec; this story is a transliteration with column renames.

---

## 00468 — API: cross-DB owner decoration (post-fetch from `mmff_vector.users`)

**Layer:** backend
**Feature:** `FE-API-NNNN` (propose `FE-API-0029`; the cross-DB pattern is a first-of-its-kind in this package)
**EST:** F8 (two-pass fetch logic, distinct-user-ID collection, batch query against the `mmff_vector` pool, in-memory join, plus the `display_name` fallback chain matching `OwnerChip` — first/last name → email — so the wire field doesn't drift)
**RISK:** S2 (cross-DB join failure modes are subtle — deleted users, archived users, mismatched IDs across DBs all silently return null `owner` and the page shows missing avatars)
**Depends on:** 00465 (rows have `owned_by_user_id` to collect)
**Plan label:** `PLA-0023`

### Description
After `(*Service).ListWorkItems` returns a page of artefact rows, collect the distinct non-null `owned_by_user_id`s and run one batched query against the `mmff_vector` pool: `SELECT id, first_name, last_name, email, avatar_url FROM users WHERE id = ANY($1::uuid[])`. Decorate each artefact's `owner` field with `{id, display_name, avatar_url}` per handover 01 §2 + the `OwnerChip` derivation. Rows whose user lookup fails get `owner: null` (matches today's deleted-user behaviour per `app/components/work-items-tree-config.tsx:51-53`).

### Acceptance criteria
- Service struct holds two pools: `vectorArtefactsPool` and `mmffVectorPool` (the latter is the existing pool).
- One extra query per `List` call (not per row) — verified by unit test asserting `mockMmffVectorPool.QueryCalled == 1` for a 5-row page.
- Distinct-ID collection: input `[u1, u1, u2, nil, u3, u2]` → query gets `[u1, u2, u3]`.
- `display_name` derivation matches `OwnerChip`: `coalesce(nullif(trim(first_name||' '||last_name),''), email)`.
- Wire field `owner_id` continues to project the raw `owned_by_user_id` (v1 contract — `WorkItemsTree` reads it for write paths).
- A page where every owner lookup fails still returns the full artefact list with `owner: null` on every row — does not 500.

### Files likely touched
- `backend/internal/workitemsv2/service.go`
- `backend/internal/workitemsv2/types.go` (if `OwnerRef` needs adjustment — should not, the type is shared)

### Notes / open questions
- Acceptable error mode if the `mmff_vector` pool itself is unreachable: degrade gracefully (artefacts list returns with all `owner: null`, log warning) or 503 the request? Lean toward degrade-with-warning to match v1's resilience to user-row anomalies. Confirm with user before code.

---

## 00469 — API: wire v2 handler into `RequireAuth` + `RequireFreshPassword` + 120/min rate limiter

**Layer:** backend
**Feature:** `FE-SEC-NNNN` (propose `FE-SEC-0011`; security middleware composition is SEC-domain per decision tree, not API-domain)
**EST:** F3 (one route group nest in `main.go`, three middleware applies; each middleware is already in the codebase)
**RISK:** S1 (an unauthenticated v2 endpoint behind the production app domain is a tenant-isolation breach — handover 02 flags this MISSING; this story is the fix)
**Depends on:** 00464 (route exists)
**Plan label:** `PLA-0023`

### Description
Wrap the v2 work-items route group with the same middleware stack the v1 route gets at `backend/cmd/server/main.go:706-726`: `auth.Service.RequireAuth`, `auth.Service.RequireFreshPassword`, and `httprate.LimitByIP(120, time.Minute)`. The handler reads the user from context via `auth.UserFromCtx(r.Context())` and uses `u.SubscriptionID.String()` as the tenant scope — replacing any fixture constant. CSRF is global per `main.go:306` and applies to GET as a passthrough; nothing extra needed for read-only routes.

### Acceptance criteria
- `/api/v2/work-items` returns 401 when called without `Authorization: Bearer <jwt>` or `?access_token=`.
- Returns 403 when the authenticated user has not refreshed their password (matches v1 behaviour).
- Returns 429 after 120 requests/min from a single IP (matches v1 bucket).
- `subscription_id` bound to `$1` in the WHERE comes from `u.SubscriptionID`, never a constant.
- A GET request with no `X-CSRF-Token` succeeds (read-only; CSRF middleware passes through).
- Smoke: cross-tenant test — user in subscription A cannot see rows from subscription B (already enforced by the WHERE; this is the *test* of the middleware, not the middleware itself).

### Files likely touched
- `backend/cmd/server/main.go`
- `backend/internal/workitemsv2/handler.go` (replace any fixture subscription constant with `auth.UserFromCtx`)

### Notes / open questions
- The v1 list does not currently wrap a `RequirePermission("work_items.read")` — the catalogue has no such permission per handover 02. Match v1: don't introduce one in this cutover. Logged as a tech-debt S3 entry "v2 list endpoint inherits v1's missing fine-grained read permission — promote when `work_items.read` is added to the catalogue".

---

## 00470 — API: emit RFC 9457 Problem Details on every 4xx/5xx

**Layer:** backend
**Feature:** `FE-API-NNNN` (propose `FE-API-0030`; error-format parity is a contract concern)
**EST:** F3 (every error path in the handler routed through `httperr.Write` / `httperr.WriteValidation`; small surface — list-only endpoint has 4-5 error branches max)
**RISK:** S2 (frontend error-handling reads `application/problem+json` shape; if v2 emits `{error: <string>}` it breaks `WorkItemsTree`'s error toast layer when the cutover flips)
**Depends on:** 00464 (handler exists), 00466 (validation paths exist)
**Plan label:** `PLA-0023`

### Description
Replace any ad-hoc `writeJSON(w, code, map[string]any{"error": …})` in `workitemsv2/handler.go` with calls into `backend/internal/httperr` so every 4xx/5xx response emits `Content-Type: application/problem+json` with `type/title/status/detail/instance` and (where applicable) `violations[]`. Mirrors the v1 handler's error paths at `backend/internal/workitems/handler.go:71, 77, 109, 115, 118`.

### Acceptance criteria
- Every error branch in `workitemsv2/handler.go` calls `httperr.Write(...)` or `httperr.WriteValidation(...)` — verified by a `grep -n 'NextResponse\|writeJSON.*error' backend/internal/workitemsv2/` returning zero hits.
- A 400 response (e.g. `?limit=foo`) returns `Content-Type: application/problem+json` with `status: 400, title: "Bad Request"` and a `violations[]` entry citing the offending param.
- A 500 (forced via test fault injection) returns `Content-Type: application/problem+json` with `status: 500, title: "Internal Server Error"` and no `detail` leak of internal error text.
- A 401 from upstream `RequireAuth` (story 00469) is already RFC 9457 — no change needed in this story; assert it stays that way under the new wrapper.

### Files likely touched
- `backend/internal/workitemsv2/handler.go`

### Notes / open questions
- None. `httperr.Write` is the established pattern (`backend/internal/httperr/httperr.go:33-54`); transliteration only.

---

## 00471 — GOV: feature-flag the work-items list route (`WORK_ITEMS_V2`)

**Layer:** backend
**Feature:** `FE-GOV-NNNN` (propose `FE-GOV-0003`; feature flag is the canonical GOV use case per decision tree Layer 3.4)
**EST:** F3 (one env-var read at startup, one route mux switch, one log line on which path is live)
**RISK:** S1 (the feature flag IS the rollback mechanism — if it's wired wrong, the cutover has no off-switch and the team is back to a hard-rename rollback model with hot-deploy)
**Depends on:** 00464 (v2 route exists), 00465 (v2 returns wire-shape data)
**Plan label:** `PLA-0023`

### Description
At server startup, read `WORK_ITEMS_V2` from env. When `=true`, mount the v2 handler at `/api/work-items` (the legacy URL, so `WorkItemsTree` doesn't need to know). When unset/false (default), mount the v1 handler at `/api/work-items` as today. The v2 route at `/api/v2/work-items` is always mounted (so the parallel agent / smoke test can exercise it regardless of flag). Per Up-front Decision #6.

### Acceptance criteria
- `WORK_ITEMS_V2=true` env var causes `/api/work-items` to be served by `workitemsv2.Handler`.
- Unset / `WORK_ITEMS_V2=false` causes `/api/work-items` to be served by the existing `workitems.Handler` (v1).
- `/api/v2/work-items` is mounted in both modes (read-side; for parity testing).
- One log line at startup: `work-items handler: v2` or `work-items handler: v1 (set WORK_ITEMS_V2=true to flip)`.
- Toggling the flag without code changes flips the production list endpoint — verified by smoke (00473).
- Flag default is `false` for the cutover window; the user flips to `true` only after burn-in (Up-front Decision #6).

### Files likely touched
- `backend/cmd/server/main.go` (mux switch + env read)
- `backend/internal/config/` (if the project has a central env struct — add `WorkItemsV2 bool` field)
- `docs/c_c_vector_artefacts_backfill.md` (one line documenting the flag and the roll-back semantic)

### Notes / open questions
- Burn-in window length is the user's call. Recommend: ≥48h on dev with zero parity diffs from the smoke story (00473) before proposing flag-on for any non-dev environment. Cutover doc (00475) records the actual window used.

---

## 00472 — SQL: ETL backfill `vector_artefacts.artefacts` from `mmff_vector.obj_work_items`

**Layer:** migration
**Feature:** `FE-SQL-NNNN` (propose `FE-SQL-0021`; ETL is DDL+DML at the schema boundary)
**EST:** F8 (eight ETL files per `c_c_vector_artefacts_backfill.md` §Backfill — but the cutover scope here is *just* the work-items slice: types are seeded by 00462, flows ditto, sprints get a one-shot copy, then artefacts. Four ETL files: `001_sprints.sql`, `002_artefacts_work.sql`, `003_field_values_work.sql` (deferred to follow-up), `004_verify_counts.sql`. Plus `postgres_fdw` setup if not already.)
**RISK:** S1 (ETL is the irreversible-feeling step — if `artefacts.number` is filled wrong, public IDs in the live page change visibly. Per Up-front Decision #5, backfill 1:1 from `key_num`, validate counts before flipping the flag.)
**Depends on:** 00461 (target columns), 00462 (target types), 00463 (proves seed path works end-to-end on dev)
**Plan label:** `PLA-0023`

### Description
Build the work-items slice of the cutover ETL per `c_c_vector_artefacts_backfill.md` §Backfill, scoped strictly to what the v2 list endpoint reads. Use `postgres_fdw` to expose `mmff_vector.obj_work_items` and `mmff_vector.sprints` as foreign tables in `vector_artefacts`, then `INSERT … SELECT` preserving source UUIDs + `number = key_num` + cross-DB `subscription_id` / `workspace_id` / `created_by_user_id` / `owned_by_user_id` (assigned_to_user_id ← owner_id since v1 has no separate assigned column). Verification SQL must show row counts match per `(subscription_id, item_type)` tuple. Run on dev only in this story; staging/prod ETL is a separate cutover-day story outside this draft.

### Acceptance criteria
- New dir `db/artefacts_schema/cutover/work-items/` (or per project convention) with files `001_sprints.sql`, `002_artefacts_work.sql`, `003_verify_counts.sql`.
- `postgres_fdw` extension installed + foreign server + user mapping documented in the dir's README.md (handover-style brief, not full doc).
- `001_sprints.sql` copies all live (`archived_at IS NULL`) sprint rows with source UUIDs preserved.
- `002_artefacts_work.sql` copies all live `obj_work_items` rows mapping: `id→id`, `subscription_id→subscription_id`, `workspace_id→workspace_id`, `key_num→number`, `item_type→artefact_type_id` (resolved by prefix lookup against `artefact_types`), `flow_state_id→flow_state_id` (resolved cross-DB if needed), `parent_id→parent_artefact_id`, `priority→priority`, `story_points→story_points`, `sprint_id→sprint_id`, `due_date→due_date`, `owner_id→owned_by_user_id`, `created_by→created_by_user_id`, `created_at→created_at`, timestamps preserved.
- `003_verify_counts.sql` returns zero rows for the diff query: `SELECT subscription_id, item_type, count(*) FROM mmff_vector.obj_work_items WHERE archived_at IS NULL GROUP BY 1,2 EXCEPT SELECT a.subscription_id, lower(at.name), count(*) FROM artefacts a JOIN artefact_types at ON at.id = a.artefact_type_id WHERE a.archived_at IS NULL AND at.scope = 'work' GROUP BY 1,2`.
- Applied on dev. Row counts in dev `vector_artefacts.artefacts` for `subscription_id = '00000000-…-0001'` match the dev `mmff_vector.obj_work_items` count for the same subscription.
- The fixture seed (00463) and the ETL coexist — fixture's `10000000-…` UUIDs do not collide with real data UUIDs (different ranges by construction).

### Files likely touched
- `db/artefacts_schema/cutover/work-items/001_sprints.sql` (new)
- `db/artefacts_schema/cutover/work-items/002_artefacts_work.sql` (new)
- `db/artefacts_schema/cutover/work-items/003_verify_counts.sql` (new)
- `db/artefacts_schema/cutover/work-items/README.md` (new, brief)
- `docs/c_c_vector_artefacts_backfill.md` (one paragraph: "work-items slice ETL landed in PLA-0023/00472")

### Notes / open questions
- The flow_state_id cross-DB resolution is non-trivial: `obj_work_items.flow_state_id → o_flow_tenant.id` in `mmff_vector`, but the new target is `vector_artefacts.flow_states.id`. The mapping requires (a) loading `o_flow_tenant` rows via fdw, (b) matching by name + canonical_code per type, (c) writing the matched `flow_states.id` into the artefacts rows. This is the riskiest part of the ETL — reserve the smoke story's sort-by-status check to validate.
- Field-values (custom EAV) ETL is deliberately **out of scope** of this story (no wire-field reads it; logged as follow-up).
- Production ETL window planning belongs in 00475 (post-cutover doc) — this story is dev-only.

---

## 00473 — DEV: parity smoke test — login, list, sort, filter, archive, JSON-diff v1 vs v2

**Layer:** test
**Feature:** `FE-DEV-NNNN` (propose `FE-DEV-0025`; integration-test infrastructure is DEV-domain per decision tree Layer 3.9)
**EST:** F8 (12+ assertions across 7 query shapes; needs scripted login, two API calls per shape (v1 vs v2), JSON-canonicalised diff, plus archive write-side check; written as a Go integration test or a Bash + jq script — prefer Go for in-package assertions)
**RISK:** S1 (this story IS the cutover gate per Up-front Decision #6 — without smoke evidence, the flag flip is blind)
**Depends on:** 00465–00470 (full v2 read parity), 00471 (flag), 00472 (real data to compare against on dev)
**Plan label:** `PLA-0023`

### Description
Author an end-to-end test against dev that logs in as `padmin@mmffdev.com`, calls `/api/work-items` (v1 path) and `/api/v2/work-items` (v2 path) for an identical set of param permutations, JSON-canonicalises both responses, and asserts byte-equal items minus a documented allow-list of acceptable drifts (e.g. `flow_state_code` 5→4 collapse, `root_feature_id` always null on v2). Also exercises the v2 archive path *only as a 405* (cutover scope is read-only — write parity is a follow-up plan, not this PLA). Output is a checked-in test plus a one-shot script under `dev/scripts/v2-cutover-smoke.sh` that runs in CI-like mode locally.

### Acceptance criteria
- Test file `backend/internal/workitemsv2/parity_test.go` (or `dev/tests/v2_parity/...`) exists.
- Asserts byte-equal JSON for at minimum these param shapes:
  - `?limit=50` (default sort)
  - `?sort=id&dir=asc`, `?sort=title&dir=desc`, `?sort=status&dir=asc`, `?sort=priority&dir=desc`, `?sort=points&dir=asc`, `?sort=sprint&dir=asc`, `?sort=due&dir=asc`
  - `?status=open`, `?priority=high`, `?item_type=story`, `?owner_id=<padmin-uuid>`, `?sprint_id=<some-uuid>`, `?parent_id=<some-uuid>`, `?parent_id=` (top-level branch)
- For each shape, the v1 vs v2 diff is empty after the documented allow-list.
- Allow-list documented in the test file's package comment.
- v2 returns 405 (or 404) on POST/PATCH/DELETE — the cutover is read-only.
- One-shot script `dev/scripts/v2-cutover-smoke.sh` runs the same sequence via curl + jq for hand-verification by the user.
- Test passes on dev with the flag in either position (the v1 endpoint is reached the same way; the v2 endpoint is always at `/api/v2/work-items`).

### Files likely touched
- `backend/internal/workitemsv2/parity_test.go` (new)
- `dev/scripts/v2-cutover-smoke.sh` (new)

### Notes / open questions
- Is there an existing pattern for full-stack integration tests in this repo? If so, follow it; if not, this story may bloat — split out the script into 00473b if estimate creeps past F13.

---

## 00474 — ITM: repoint `WorkItemsTree` (post-burn-in)

**Layer:** frontend
**Feature:** `FE-ITM-NNNN` (propose `FE-ITM-0007`; work-items page is ITM-domain)
**EST:** F2 (zero changes if the cutover's wire-shape parity is real — the story is mostly the burn-in evidence + the flag flip operation + a confirmation visual)
**RISK:** S2 (nominally low risk given parity is proven by 00473, but the surface is the user-visible page — any drift from the smoke is now a hot bug)
**Depends on:** 00471 (flag), 00472 (real data), 00473 (parity proven)
**Plan label:** `PLA-0023`

### Description
Flip `WORK_ITEMS_V2=true` on dev. Reload `/work-items`. Confirm `WorkItemsTree` renders identically. Capture a screenshot and a network HAR of the list call as the cutover-evidence artefact. Update `boot1.md` (or the active session memory file) with the flip date. **No frontend code changes** — that's the whole point of the wire-shape preservation; this story exists to make the flip a tracked event with explicit acceptance, not a casual `kubectl set env`.

### Acceptance criteria
- Burn-in evidence: 48h+ of `WORK_ITEMS_V2=false` running on dev with the v2 endpoint receiving identical traffic patterns (smoke script in 00473 run hourly via cron). Zero parity diffs in that window.
- Flag flipped to `true` on dev. Backend log line confirms `work-items handler: v2`.
- `/work-items` page loads. Tree renders all 15 fixture rows + any real ETL'd rows. Sort by every column works. Owner chips render. Sprint pills render. Due dates render.
- Screenshot saved to `.claude/handoffs/v2-cutover/04-cutover-evidence.png`.
- HAR saved to `.claude/handoffs/v2-cutover/04-cutover-list-har.json`.
- `boot1.md` updated with cutover-flip date.
- Note in the story description that **the parallel agent was already unblocked from 00471 onwards** (stable URL behind the flag) — this story is the production-handler flip, not the parallel-agent unblock.

### Files likely touched
- (none — operational story; backend env change only)
- `.claude/memory/boot1.md` (update)
- `.claude/handoffs/v2-cutover/04-cutover-evidence.png` + `04-cutover-list-har.json` (new artefacts)

### Notes / open questions
- If parity diffs surface during burn-in, this story does NOT proceed — it splits into a fix story + a re-burn-in. Don't compress.

---

## 00475 — DEV: post-cutover follow-up doc + deferred-work register

**Layer:** docs
**Feature:** `FE-DEV-NNNN` (propose `FE-DEV-0026`)
**EST:** F2 (one new leaf doc + edits to two existing index docs)
**RISK:** S3 (record-only; if not done, the deferred work falls off the radar — but no immediate breakage)
**Depends on:** 00474 (cutover live)
**Plan label:** `PLA-0023`

### Description
Author the cutover post-mortem and the deferred-work register so the next person in the chair knows what was conscientiously NOT done. Items: `obj_work_items` and the per-type tables stay live (drop is a separate plan after ≥7 days clean); custom-fields write surface against `vector_artefacts.artefact_field_values` is unimplemented; `entityrefs` vocabulary needs `'artefact_work'`/`'artefact_strategy'` entries; ranking-NOTIFY trigger needs to be re-attached to `artefacts` for the live drag-and-drop to fire post-cutover; `flow_state_code` 5→4 collapse is documented; templates UX replacement is unbuilt.

### Acceptance criteria
- New file `.claude/handoffs/v2-cutover/05-post-cutover-followups.md` (or `docs/c_c_v2_workitems_cutover_followups.md` — pick the durable home; recommend `docs/`).
- Doc lists each deferred item with: what, why deferred, trigger to address, owner.
- `c_c_vector_artefacts_backfill.md` updated: status moves from "PoC complete, cutover not started" → "work-items slice cut over PLA-0023; PRT/strategy slice still pending".
- `c_scope.md` updated to reflect the cutover state.
- Tech-debt register entries created (S3 each) for the four documented deferrals: 5→4 vocabulary collapse, missing fine-grained `work_items.read` permission, EAV custom-field reads not yet wired into v2, ranking NOTIFY trigger pending re-attach.

### Files likely touched
- `docs/c_c_v2_workitems_cutover_followups.md` (new)
- `docs/c_c_vector_artefacts_backfill.md` (status header update + one paragraph in §Post-cutover)
- `docs/c_scope.md` (one row update)
- `docs/c_tech_debt.md` (4 new entries)

### Notes / open questions
- None. Recording-only.

---

## Wave totals

- **Total stories:** 15 (00461–00475)
- **Highest individual EST:** F8 (00465 list query, 00468 owner decoration, 00472 ETL, 00473 smoke)
- **Total wave EST (sum of Fibonacci values):** 2+2+2+3+8+5+5+8+3+3+3+8+8+2+2 = **64**
- **Risk profile:** 3× S1 (00469 auth wiring, 00471 feature flag, 00472 ETL, 00473 smoke), the rest S2/S3
- **Parallel-agent unblock point:** 00471 (stable URL at `/api/v2/work-items` behind the flag) — NOT 00474 (which is the production flag-flip)

---

## Open questions for the user before `<stories>` runs

1. **Plan ID confirmation.** Draft assumes `PLA-0023`. Verify with `ls dev/plans/` against the `c_plan_index.md` `PLA-0022` last-issued entry. If a plan was created since this draft, increment.
2. **Up-front decisions (1–6).** All six are *recommendations*. The user should sanity-check each before storifying. Decisions #1 (real columns vs EAV) and #4 (post-fetch vs users mirror) are the highest-impact and most reversible-at-cost.
3. **Burn-in window length** for Up-front Decision #6 / story 00474. Default recommendation 48h on dev with zero parity diffs; user may want longer or run staging-equivalent first.
4. **Story 00462 — patch-in-place vs new migration.** Depends on the project's migrate runner's behaviour around mutating already-applied files. If it re-checksums, the patch becomes migration `014` instead.
5. **Story 00465 — `created_by_user_id` nullability loosening.** Acceptable to ship the `coalesce(…, '')` to preserve the wire's non-nullable string contract? Or tighten the v2 schema to NOT NULL via a follow-up? Default: ship the coalesce, log S3 debt.
6. **Story 00468 — owner-pool failure mode.** Degrade-with-warning (recommended) vs hard-503. User's call.
7. **Story 00472 — `flow_state_id` cross-DB resolution.** The mapping from `o_flow_tenant.id` (mmff_vector) to `flow_states.id` (vector_artefacts) is non-trivial; this story may need to split if the resolution turns out gnarlier than the F8 estimate. Flag for re-estimate during `<stories>` Step 0.
8. **Feature-counter allocations.** Eight new counters proposed (`FE-SQL-0020`, `FE-SQL-0021`, `FE-DEV-0023..26`, `FE-API-0025..30`, `FE-SEC-0011`, `FE-GOV-0003`, `FE-ITM-0007`). Confirm against the registry table in `docs/c_feature_areas.md` before storifying — counters drift.
