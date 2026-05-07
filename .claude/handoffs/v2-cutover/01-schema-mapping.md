# v2 cutover — schema mapping (work-items)

Read-only reference. The cutover replaces reads against `mmff_vector.obj_work_items` with reads against `vector_artefacts.artefacts` (rows where the joined `artefact_types.scope = 'work'`). The frontend wire contract — the JSON shape `WorkItemsTree` consumes — must remain identical.

Source files this document is derived from:
- `backend/internal/workitems/handler.go:28-81` (List handler + filter parsing)
- `backend/internal/workitems/service.go:55-191` (ListWorkItems query + ORDER BY whitelist) and `:197-241` (CountWorkItems)
- `backend/internal/workitems/types.go:34-97` (WorkItem / OwnerRef / SprintRef wire structs)
- `db/schema/051_artefacts_execution_user_stories.sql:44-66` (original core)
- `db/schema/063_work_items_rename_and_epics.sql:100-176` (rename + item_type/parent_id/root_feature_id)
- `db/schema/065_execution_core_columns.sql:34-97` (sprints + status/priority/story_points/sprint_id)
- `db/schema/066_work_items_expand_types.sql:1-10` (item_type CHECK extended to epic/story/task/defect)
- `db/schema/068_ranking_position_columns.sql:25-48` (backlog_position / sprint_position)
- `db/schema/119_artefact_flow_state_fk.sql:104-131` (flow_state_id NOT NULL + index)
- `db/schema/121_work_items_due_date.sql:8-9` (due_date)
- `db/schema/123_rename_tables_to_obj_family.sql:27-28` (rename to `obj_work_items`)
- `db/artefacts_schema/003_artefact_types.sql:23-57` (`artefact_types`)
- `db/artefacts_schema/004_flows.sql:22-114` (`flows` / `flow_states` / `flow_transitions`)
- `db/artefacts_schema/005_artefacts.sql:30-73` (`artefacts`)
- `db/artefacts_schema/006_field_library.sql:17-57` and `007_artefact_type_fields.sql` and `008_artefact_field_values.sql:21-47` (custom-field plumbing)
- `db/artefacts_schema/010_seed_system_artefact_types.sql:33-95` (seed: Story/Defect/Task/Epic types + default flow + 4 canonical states)
- `app/api/v2/work-items/route.ts:34-66` (existing PoC reader — slim shape, not the production wire shape)
- `app/v2/work-items/page.tsx:23-42` (PoC page consumer)

---

## 1. Summary

The mapping is **one-row-per-thing on both sides** (no fan-out): each `obj_work_items` row maps to exactly one `vector_artefacts.artefacts` row whose `artefact_types.scope = 'work'`. The shape change is mostly *normalisation*:
- The string discriminator `obj_work_items.item_type` (`'epic'|'story'|'task'|'defect'`) becomes an FK `artefacts.artefact_type_id` → `artefact_types`. The wire string is recovered by joining `artefact_types` and lower-casing `name`, or by looking up the row's `prefix` ('US'/'DE'/'TA'/'EP') and inverting it.
- `obj_work_items.flow_state_id` → `o_flow_tenant.id` (tenant-scoped flow row, with a per-subscription `name` and `canonical_code` already used by the wire). v2 splits this two ways: `artefacts.flow_state_id` → `flow_states.id`, with `flow_states.name` matching today's `fs.name` and `flow_states.kind` (`'todo'|'in_progress'|'done'|'cancelled'`) replacing today's `canonical_code`.
- Identity columns rename: `key_num` (per-subscription monotonic id, used by the public ID prefix-NN code) → `number` (per-`(subscription, type)`, so the *visible* public id changes from `WI-42` to `US-42` / `EP-3` / `TA-7` / `DE-12`).
- Ownership splits across three columns: `owner_id` (single field) → `created_by_user_id` + `assigned_to_user_id` + `owned_by_user_id`. The wire's `owner_id`/`owner` projection maps to **`owned_by_user_id`** by analogy (the existing PoC route doesn't expose owner at all yet).
- Two columns lose a first-class home and must be served from `artefact_field_values` (custom EAV) or by adding columns: `story_points` (today: core column with CHECK ≥ 0) and `sprint_id` (today: FK to `sprints`). `vector_artefacts` has no `sprints` table at all.
- One column is dropped silently by the new schema: `root_feature_id` (denormalised pointer used to keep tree-view scope cheap).
- `backlog_position` / `sprint_position` (the two-column "exactly one non-NULL" ranking shape) collapses to a single `artefacts.position` integer — the sprint vs. backlog split must be reconstructed (e.g. via the sprint custom field or by adding a column).
- The full child-count + recursive rollup-points subqueries continue to work — just retargeted at `artefacts` with `parent_artefact_id` instead of `parent_id`.

Joins required for the v2 list query (one row per artefact):
1. `artefacts a JOIN artefact_types at ON at.id = a.artefact_type_id` — for the `item_type` wire string.
2. `LEFT JOIN flow_states fs ON fs.id = a.flow_state_id` — for `flow_state_name` and `flow_state_code` (the wire's `flow_state_code` will need a kind→canonical-code translation).
3. `LEFT JOIN mmff_vector.users u …` — **cross-database join is NOT supported in Postgres**, so the v2 reader must either (a) post-fetch user rows by ID in a second query and decorate, or (b) duplicate the slim user fields into `vector_artefacts` (mirror table). Today's handler does this in-DB; v2 cannot.
4. Sprint reference (`sprint_id`/`sprint`) has no v2 source (no sprints table) — see MISSING.

---

## 2. Wire-field mapping

The wire row is the JSON shape encoded by `WorkItem` in `backend/internal/workitems/types.go:34-65`. The list response is `{ "items": [WorkItem...], "total": int }` (handler.go:80).

| Wire field | Current source | v2 source | Transformer | Notes |
|---|---|---|---|---|
| `id` | `obj_work_items.id` (uuid) | `artefacts.id` (uuid) | identity | UUID PK on both sides. Two different UUID spaces unless the cutover preserves IDs end-to-end. |
| `subscription_id` | `obj_work_items.subscription_id` | `artefacts.subscription_id` | identity | Soft FK → `mmff_vector.subscriptions(id)` on v2 (cross-DB), hard FK today. |
| `key_num` | `obj_work_items.key_num` (BIGINT, unique per subscription) | `artefacts.number` (BIGINT) | cast (column rename, semantic shift) | v2 counter is unique per-`(subscription, artefact_type_id)` (`db/artefacts_schema/005_artefacts.sql:77`). Today's counter is unique per-subscription. **Public IDs rendered downstream will not match unless backfill renumbers** — see MISSING. |
| `item_type` | `obj_work_items.item_type` TEXT, CHECK in `('epic','story','task','defect')` | `artefact_types.name` lower-cased via JOIN on `artefacts.artefact_type_id` | join lookup + case-fold | Seed names are `Story`/`Defect`/`Task`/`Epic` (`010_seed_system_artefact_types.sql:35-39`). Lower-case the JOIN result, or inverse-map prefix (`US`→`story`, `DE`→`defect`, `TA`→`task`, `EP`→`epic`). |
| `title` | `obj_work_items.title` | `artefacts.title` | identity | Both NOT NULL. |
| `description` | `obj_work_items.description` | `artefacts.description` | identity | Both nullable. |
| `status` | `obj_work_items.status` TEXT, CHECK in `('open','in_progress','done','cancelled')` | derived from `flow_states.kind` via JOIN on `artefacts.flow_state_id` | derived | The legacy `status` column is documented as a one-release shadow (`119_artefact_flow_state_fk.sql:38-40`, soon to be dropped by migration 120). v2 has no shadow column at all. Map `flow_states.kind` directly: `'todo'→'open'`, `'in_progress'→'in_progress'`, `'done'→'done'`, `'cancelled'→'cancelled'`. |
| `flow_state_id` | `obj_work_items.flow_state_id` → `o_flow_tenant.id` | `artefacts.flow_state_id` → `flow_states.id` | identity (uuid space differs) | Both UUIDs; both nullable in spirit. v2 column is nullable (`005_artefacts.sql:58`); today's column is NOT NULL after backfill (`119:127-128`). Wire field is `string` (not `*string`) — empty string when NULL on v2 (the SQL today already does `coalesce(wi.flow_state_id::text, '')`). |
| `flow_state_name` | `o_flow_tenant.name` via JOIN | `flow_states.name` via JOIN on `artefacts.flow_state_id` | join lookup | Same on the wire — just a different source table. |
| `flow_state_code` | `o_flow_tenant.canonical_code` (`'backlog'/'ready'/'doing'/'completed'/'accepted'`) | `flow_states.kind` via JOIN | derived (vocabulary shift) | **The vocabularies do not match.** Today's `canonical_code` set is the 5-value Vector taxonomy; v2's `flow_states.kind` is the 4-value Jira-ish set (`todo/in_progress/done/cancelled`). Frontend code that switches on `flow_state_code` will need an explicit translation table or wire-shape change. See MISSING. |
| `priority` | `obj_work_items.priority` TEXT, CHECK in `('critical','high','medium','low')` | **MISSING** — no column on `artefacts`; would live in `artefact_field_values` keyed by a `field_library` row named `priority` | MISSING — needs design | `005_artefacts.sql` core columns explicitly exclude priority (header comment, lines 23-25). Either (a) add `artefacts.priority` as a real column, (b) bind a `field_library` row and read via `artefact_field_values.string_value`, or (c) drop from wire. (b) is N+1 unless joined; see §5. |
| `story_points` | `obj_work_items.story_points` INTEGER nullable | **MISSING** — same as priority; `field_library` row keyed `story_points`, value in `artefact_field_values.number_value` | MISSING — needs design | Same analysis as priority. The artefacts schema header (`005_artefacts.sql:23-25`) is explicit: `story_points` is a custom field, not a core column. |
| `rollup_points` | recursive CTE summing `story_points` over descendants of `wi.id` (`service.go:32-49`) | recursive CTE over `artefacts.parent_artefact_id`, summing `artefact_field_values.number_value` filtered by the `story_points` field_library_id | derived (depends on story_points decision) | If story_points moves to `artefact_field_values`, the rollup CTE needs a join into that table per descendant. The shape is identical (`parent_id` → `parent_artefact_id`) but performance changes. |
| `sprint_id` | `obj_work_items.sprint_id` → `sprints.id` | **MISSING** — no `sprints` table in `vector_artefacts` | MISSING — needs design | No sprints anywhere in `db/artefacts_schema/`. Either (a) keep `mmff_vector.sprints` as the canonical table and store the UUID in `artefact_field_values.string_value` against a `sprint_id` field_library row, (b) create a sprints table in `vector_artefacts`, or (c) drop sprint from the wire entirely. |
| `sprint` | `LEFT JOIN sprints s ON s.id = wi.sprint_id AND s.archived_at IS NULL` projects `{id, alias=name}` | **MISSING** — depends on sprint_id resolution | MISSING — needs design | Whatever sprint_id stores, the wire shape `{id, alias}` must be retrievable. With option (a) above, this becomes a cross-DB lookup (N+1); with option (b), an in-DB JOIN. |
| `parent_id` | `obj_work_items.parent_id` (self-FK) | `artefacts.parent_artefact_id` (self-FK, ON DELETE SET NULL — same) | identity (column rename) | `005_artefacts.sql:53`. |
| `root_feature_id` | `obj_work_items.root_feature_id` (loose UUID, no FK) | **MISSING** — no equivalent column on `artefacts` | MISSING — needs design | The artefacts schema does not denormalise this. Either compute on read (walk parent_artefact_id up to the strategy-layer parent), drop from wire, or add a column. The Go service uses it to seed itself on insert (`service.go:440`); read-side use is mostly the tree breadcrumbs. |
| `owner_id` | `obj_work_items.owner_id` (NOT NULL FK → `users.id`) | `artefacts.owned_by_user_id` (UUID, soft FK, nullable) | identity + nullable-coalesce | v2 splits ownership into 3 columns (`005_artefacts.sql:60-63`); the most direct match to today's `owner_id` is `owned_by_user_id`. The handler's wire field is non-nullable today; v2 must coalesce or change the wire to `*string`. |
| `owner` | `LEFT JOIN users u ON u.id = wi.owner_id` projecting `{id, display_name, avatar_url}` | `LEFT JOIN mmff_vector.users …` (NOT POSSIBLE — different database) | derived (cross-DB) | **Cross-database joins are not supported in Postgres** (`db/artefacts_schema/001_init_vector_artefacts.sql:16-19`). The Go reader must post-fetch users from `mmff_vector` and decorate in code, or maintain a mirror users table inside `vector_artefacts`. See §5 (N+1). |
| `due_date` | `obj_work_items.due_date::text` (DATE, nullable) | **MISSING** — no `due_date` column on `artefacts`; would live in `artefact_field_values.date_value` | MISSING — needs design | Same triage as priority/story_points. Recently added (migration 121, PLA-0021/00460), so the cleanest path is adding `artefacts.due_date` as a real column. |
| `created_by` | `obj_work_items.created_by` (NOT NULL FK → users) | `artefacts.created_by_user_id` (nullable, soft FK) | identity (column rename) | Wire field is `string` (not nullable); v2 column is nullable — coalesce or accept the loosening. |
| `created_at` | `obj_work_items.created_at` TIMESTAMPTZ | `artefacts.created_at` | identity | Both `now()` default. |
| `updated_at` | `obj_work_items.updated_at` (set by trigger) | `artefacts.updated_at` (set by `set_updated_at()` trigger, `005_artefacts.sql:107`) | identity | Trigger semantics match. |
| `archived_at` | `obj_work_items.archived_at` nullable | `artefacts.archived_at` nullable | identity | Soft-archive shape preserved. |
| `children_count` | correlated subquery over `obj_work_items` filtered by `parent_id = wi.id AND archived_at IS NULL` (`service.go:172-173`) | same shape, retargeted: `SELECT COUNT(*) FROM artefacts c WHERE c.parent_artefact_id = a.id AND c.archived_at IS NULL` | identity (column rename) | Index `artefacts_parent` (`005_artefacts.sql:88-90`) covers this. |

---

## 3. MISSING fields — recommendations

Each row below is a wire field that has no clean v2 source today. Recommendation per item; the cutover agent will pick one.

| Wire field | Recommendation |
|---|---|
| `priority` | Add `artefacts.priority TEXT` column with same CHECK as today (`'critical'|'high'|'medium'|'low'`). It's a universal first-class filterable per `065_execution_core_columns.sql:1-25` rationale. EAV via `artefact_field_values` is the schema's intent but kills `?priority=` filtering performance. |
| `story_points` | Add `artefacts.story_points INTEGER` column. Same argument as priority. The recursive rollup CTE (`service.go:32-49`) becomes catastrophic if every descendant has to join `artefact_field_values`. |
| `sprint_id` | Add a `sprints` table in `vector_artefacts` (mirroring `mmff_vector.sprints`), and `artefacts.sprint_id` as a real FK. The cross-DB alternative (keep sprints in `mmff_vector`, store UUID in EAV) loses the JOIN entirely. |
| `sprint` (`{id, alias}` projection) | Falls out of the sprint_id decision above. If sprints move to `vector_artefacts`, the LEFT JOIN works as today. |
| `due_date` | Add `artefacts.due_date DATE NULL` column. Mirrors today's migration 121 verbatim. |
| `root_feature_id` | Drop from the wire shape. It's a denormalisation aid for tree-scope queries; the v2 hierarchy walks `artefacts.parent_artefact_id` and the same scope is recoverable on the client. If kept, add as a nullable column with no FK and a writer that maintains it (matches today's `service.go:440`). |
| `owner` (decorated user JOIN) | Two viable paths: (a) **post-fetch in Go** — list artefact rows, collect distinct `owned_by_user_id`s, hit `mmff_vector.users` once, decorate in memory. One extra query per page. (b) **mirror users into `vector_artefacts`** — slim table (`id`, `display_name`, `avatar_url`) maintained by the user-write path. Tighter SQL; new write coupling. (a) is the lower-risk default for cutover. |
| `flow_state_code` (vocabulary shift) | Either (a) translate `flow_states.kind` → today's 5-value `canonical_code` taxonomy in the SELECT (`CASE kind WHEN 'todo' THEN 'backlog' …`), or (b) change the wire field to carry `kind` directly and update frontend switches. (a) preserves the wire contract; (b) is cleaner long-term. The 5→4 collapse means `'ready'` and `'accepted'` have no v2 home. |
| `key_num` rendering | Today's wire emits raw `key_num` and the frontend (or downstream renderers) renders the public ID. v2's per-`(subscription, type)` numbering will produce different visible IDs unless the cutover renumbers existing rows during backfill. Recommendation: backfill `artefacts.number` from `obj_work_items.key_num` 1:1 (accepting the temporary uniqueness violation across types within a subscription, then rebalance), or accept that public IDs change. |

---

## 4. Filter / sort parameter mapping

The List endpoint accepts the params parsed at `handler.go:32-66`. Current SQL is built in `service.go:62-100` (filters) and `:110-150` (sort). Below is the v2 SQL fragment for each, assuming the v2 reader is built around `artefacts a JOIN artefact_types at ON at.id = a.artefact_type_id LEFT JOIN flow_states fs ON fs.id = a.flow_state_id`.

| Param | Today (service.go) | v2 fragment |
|---|---|---|
| `?status=open` | `wi.status = $N` | `fs.kind = $N_translated` where translation is `'open'→'todo'`, `'in_progress'→'in_progress'`, `'done'→'done'`, `'cancelled'→'cancelled'`. Or, if a real `status` column is added back, identity. |
| `?priority=high` | `wi.priority = $N` | If `priority` column added: `a.priority = $N`. If kept in EAV: `EXISTS (SELECT 1 FROM artefact_field_values v JOIN field_library fl ON fl.id = v.field_library_id WHERE v.artefact_id = a.id AND fl.field_name = 'priority' AND v.string_value = $N)`. The EAV form is unindexable for this filter and should not be the default. |
| `?item_type=story` | `wi.item_type = $N` | `at.name = $N_titlecase` (e.g. `'Story'`), or `lower(at.name) = $N`, or `at.prefix = $N_prefix` (`'US'/'DE'/'TA'/'EP'`). Prefix is the most stable since `name` is mutable per the schema. |
| `?owner_id=<uuid>` | `wi.owner_id = $N` | `a.owned_by_user_id = $N`. (Pick the same column the wire's `owner_id` is sourced from.) |
| `?sprint_id=<uuid>` | `wi.sprint_id = $N` | If sprints table added to `vector_artefacts`: `a.sprint_id = $N`. If EAV: `EXISTS (SELECT 1 FROM artefact_field_values v JOIN field_library fl ON fl.id = v.field_library_id WHERE v.artefact_id = a.id AND fl.field_name = 'sprint_id' AND v.string_value = $N::text)`. EAV form unindexable. |
| `?parent_id=<uuid>` | `wi.parent_id = $N` (and the default-top-level branch when both `parent_id` and `item_type` are absent: `wi.parent_id IS NULL`) | `a.parent_artefact_id = $N` (and default branch: `a.parent_artefact_id IS NULL`). |
| `?sort=id&dir=asc` | `CASE wi.item_type WHEN 'epic' THEN 1 …` then `wi.key_num` | `CASE at.prefix WHEN 'EP' THEN 1 WHEN 'US' THEN 2 WHEN 'TA' THEN 3 WHEN 'DE' THEN 4 ELSE 99 END ASC, a.number $DIR` (preserves tier-then-number ordering). |
| `?sort=title` | `wi.title $DIR, wi.key_num ASC` | `a.title $DIR, a.number ASC`. |
| `?sort=status` | `fs.flow_position $DIR NULLS LAST, wi.key_num ASC` | `fs.sort_order $DIR NULLS LAST, a.number ASC` (`flow_states.sort_order` is the v2 analogue of `o_flow_tenant.flow_position`, see `004_flows.sql:68`). |
| `?sort=priority` | `CASE wi.priority WHEN 'critical' THEN 0 …` | If `priority` column added: identical CASE on `a.priority`. If EAV: requires LEFT JOIN to `artefact_field_values` filtered by the priority `field_library_id` and CASE on `string_value`. |
| `?sort=points` | `coalesce(rollupPointsExpr, wi.story_points) $DIR NULLS LAST, wi.key_num ASC` | If `story_points` column added: identical CASE on `a.story_points` and the same recursive CTE retargeted at `artefacts`/`parent_artefact_id`. If EAV: rollup CTE must join `artefact_field_values` per row (catastrophic). |
| `?sort=sprint` | `wi.sprint_id $DIR NULLS LAST, wi.key_num ASC` | Depends on sprint_id decision — if column added, identical. If EAV, sort by the EAV string_value. |
| `?sort=due` | `wi.updated_at $DIR NULLS LAST, wi.key_num ASC` (placeholder until WS4-C — but service.go header for `case "due"` says due_date is added; the SQL still falls back to `updated_at`, see `:147-148`) | If `due_date` column added: `a.due_date $DIR NULLS LAST, a.number ASC`. |
| Default order | `coalesce(wi.sprint_position, wi.backlog_position) NULLS LAST, wi.key_num ASC` (`service.go:110`) | `a.position NULLS LAST, a.number ASC` — but **the sprint-vs-backlog split is lost**. If the cutover wants to preserve "in-sprint rows order independently of backlog rows", it needs to keep `backlog_position`/`sprint_position` as separate columns or filter by sprint context first. |
| `?limit=50` | `LIMIT $N` (capped at 5000 in service, 200 in handler doc) | identity. |
| `?offset=0` | `OFFSET $N` | identity. |

---

## 5. N+1 risks

| Field | Risk | Mitigation |
|---|---|---|
| `owner` (and any future user decoration) | Cross-DB JOIN to `mmff_vector.users` is impossible from `vector_artefacts` (`001_init_vector_artefacts.sql:16-19`). A naive per-row lookup is N+1; a per-page batch lookup is one extra query. | Two-pass fetch: collect distinct user IDs from the page, single query against `mmff_vector.users`, decorate in Go. Or maintain a slim users mirror inside `vector_artefacts`. |
| `flow_state_code` | None — joined via `flow_states` in-DB. | Translation from `kind` to `canonical_code` is a SELECT-side CASE, no extra query. |
| `item_type` | None — `artefact_types` is in-DB and pre-joined. | The JOIN is unconditional; use the same query plan today's handler uses. Tiny table (4 rows × N subscriptions). |
| `priority`, `story_points`, `sprint_id`, `due_date` (if EAV) | Each becomes a per-row sub-select against `artefact_field_values`. With 4 fields across a 5000-row page, that is 20k extra index lookups per list. | **Strong recommendation: add real columns** (per §3). EAV is for genuinely tenant-defined fields, not for fields the wire contract carries on every row. |
| `rollup_points` (recursive CTE) | If `story_points` lives in `artefact_field_values`, every recursive step now needs an EAV join. Per-page cost scales with subtree depth × breadth × EAV-join cost. | Tied to the story_points decision — recommend real column. |
| Per-row `prefix` / `name` → `item_type` lowercase | Single JOIN to `artefact_types`; tiny table; cached in plan. Not a risk. | None. |
| `children_count` | One correlated subquery per row, same as today. Index `artefacts_parent` (`005_artefacts.sql:88-90`) keeps it cheap. | None. |
