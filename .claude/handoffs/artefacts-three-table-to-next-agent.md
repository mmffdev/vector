---
name: Artefacts Three-Table Rewrite — Handoff to Next Agent
description: Summary of stories 00151–00156 (artefact schema rewrite + search index worker); what shipped, what's next, no DB collision with library work
type: project
---

## What Just Shipped

**Stories 00151–00156** — Three-table artefact pattern + search index outbox worker:

- **00151** — `db/schema/060_artefact_schema_tables.sql` (vector DB)
  - Drops old four-table pattern: `_template_forms` + `_template_form_fields` (CASCADE) for all 5 Phase 1 artefact types
  - Drops `template_form_id` FK column from all 5 core tables (`o_artefacts_*`)
  - Creates 5 new `*_schema` tables, one per artefact type:
    - `o_artefacts_execution_user_stories_schema`
    - `o_artefacts_execution_defects_schema`
    - `o_artefacts_execution_tasks_schema`
    - `o_artefacts_execution_test_cases_schema`
    - `o_artefacts_strategic_schema`
  - Each `_schema` table: id UUID PK, subscription_id FK, field_name TEXT, label TEXT, type TEXT (CHECK constraint on 11 valid kinds), required BOOLEAN, position INTEGER, default_value TEXT, options_json JSONB, config_json JSONB, created_at/updated_at TIMESTAMPTZ, archived_at TIMESTAMPTZ
  - **UNIQUE(subscription_id, field_name)** enforces workspace isolation
  - Index on (subscription_id, position) WHERE archived_at IS NULL for ordered field rendering

- **00152** — `db/schema/061_artefact_field_values_reshape.sql` (vector DB)
  - Reshapes all 5 `*_field_values` tables from heterogeneous columns → typed columns
  - Drops: `template_field_id`, `value_text`, `value_number`, `value_boolean`, `value_date`, `value_jsonb`
  - Adds typed columns: `string_value` TEXT, `number_value` NUMERIC(19,4), `text_value` TEXT, `date_value` DATE
  - Adds `schema_field_id` UUID FK → corresponding `_schema(id)` ON DELETE SET NULL — values survive schema row deletion
  - Retains `field_name` denormalised + `UNIQUE(artefact_id, field_name)` for upsert
  - Index on schema_field_id WHERE NOT NULL

- **00153/00154/00155** — `backend/internal/artefacts/` (single generic package serving all 5 types)
  - **`types.go`**: registry map (scope_key → table triple), validFieldKinds, sentinel errors, DTOs
  - **`service.go`**: Service struct with full CRUD:
    - Core: Create (with nextKeyNum sequence), Get, Patch, Archive
    - Schema: ListSchema, CreateSchema, PatchSchema (type immutability enforced), ArchiveSchema
    - FieldValues: ListFieldValues, WriteFieldValue (upsert with schema_field_id resolution), BulkWriteFieldValues
  - **`handler.go`**: HTTP handlers + handleErr mapper (404/400/409/500)
  - Routes mounted in `main.go` under `/api/artefacts/{type}`:
    - `POST /api/artefacts/:type` — create
    - `GET /api/artefacts/:type/:id` — read
    - `PATCH /api/artefacts/:type/:id` — update
    - `DELETE /api/artefacts/:type/:id` — archive
    - `GET /api/artefacts/:type/:id/fields` — list field values
    - `PUT /api/artefacts/:type/:id/fields/:field_name` — upsert one
    - `POST /api/artefacts/:type/:id/fields/bulk` — bulk write
    - `GET/POST/PATCH/DELETE /api/artefacts/:type/schema[/:schema_id]` — **padmin-only** (RequireRole gate)

- **00156** — `backend/internal/searchworker/worker.go` (NEW package)
  - Consumes `o_search_index_outbox` rows with `FOR UPDATE SKIP LOCKED` — at-least-once delivery, multi-instance safe
  - Wake-up: `pg_notify('search_index_queue')` (fast path) + 5s polling ticker (fallback)
  - For each claimed row:
    1. Fetches title + description + content_plain_text from core artefact table
    2. Recomputes TSVECTOR via `to_tsvector('english', combined)`
    3. Calls Ollama HTTP API (`POST /api/embeddings`) for `content_embedding` vector
    4. Writes both back to core table in single UPDATE
    5. Deletes outbox row on success; on failure increments attempts + clears claimed_at for retry
  - Max 5 retry attempts before row is left alone (dead-letter via attempts field)
  - Wired into `main.go` as goroutine started before `srv.ListenAndServe()`, bound to `shutdownCtx`
  - Config from env: `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `nomic-embed-text`)
  - **Build clean** ✅

## No DB Collision With Your Work

- **You worked on `mmff_library` DB** — migration `010_portfolio_templates.sql`, seed `004_portfolio_templates.sql`
- **I worked on `mmff_vector` DB** — migrations `060_artefact_schema_tables.sql`, `061_artefact_field_values_reshape.sql`
- **Different databases.** Zero overlap. Your `f0ad61f` and my pending commit can both land on main without rebase.

The pre-existing WIP commit `fa9b004` you noted ("Artefacts feature — schema, service, handler, routes from parallel agent") is **my earlier session's work** — I picked it up after compaction and finished wiring the searchworker into `main.go`.

## Dev Database State

- ✅ Migrations 060 + 061 applied to dev (vector DB, via `./migrate -env .env.dev`)
- ❌ NOT yet applied to staging/production
- ✅ All 5 `*_schema` tables exist, all 5 `*_field_values` tables reshaped on dev

## What's Pending

**Story 00157** — Samantha SDK fields API contract doc (NOT YET WRITTEN). Scope:
- `samantha.portfolio.renderField` JSON-pass options object schema
- `getSchema` response shape
- `getValue` / `setValue` semantics
- Type-to-renderer map (textbox/richtext/integer/decimal/date/boolean/select/multiselect/radio/user/url)
- `f_` prefix convention for custom fields in API responses
- Staged-write flow for new artefacts (BulkWriteFieldValues)
- Workspace scoping guarantee (UNIQUE(subscription_id, field_name) at schema level)

**Uncommitted work in tree** (will be committed next):
- `M backend/cmd/server/main.go` — searchworker wiring + artefacts route mount
- `M backend/server` — rebuilt binary
- `?? backend/internal/searchworker/` — new package
- `?? .claude/handoffs/` — this file

## Critical: Search Index Worker Operational Notes

- **Ollama must be running** on `OLLAMA_URL` for the worker to make progress. If Ollama is down, attempts increments to 5 then the row is parked. No automatic dead-letter table.
- **The worker runs in every backend instance.** `FOR UPDATE SKIP LOCKED` prevents double-processing across replicas.
- **The outbox trigger** (presumed in migration 058) fires `pg_notify` on INSERT — that's the fast wake-up path. If trigger is missing, the 5s ticker still drains.
- **No retry backoff yet** — failed rows retry immediately on next poll. If Ollama is flapping, expect attempt counters to climb fast. Consider adding exponential backoff (story for later).

## API Surface for Frontend / Custom Apps

The `/api/artefacts/{type}` namespace is now the single entry point for all 5 Phase 1 artefact types. Frontend (and Samantha SDK once 00157 lands) reads/writes via:
- Core CRUD on the artefact row
- Schema introspection (`GET /api/artefacts/:type/schema`) — returns the active field definitions for the caller's workspace
- Field values read (`GET .../fields`) — returns all field values with `schema_field_id` join
- Field values write (`PUT .../fields/:field_name` or `POST .../fields/bulk`)

`{type}` ∈ `{execution_user_stories, execution_defects, execution_tasks, execution_test_cases, strategic}`

## Recent Commits

```
fa9b004 WIP: Artefacts feature — schema, service, handler, routes (from parallel agent)
f0ad61f Portfolio model: replace portfolio_models+layers with portfolio_templates (R010)
```

(my final searchworker + main.go wiring not yet committed at time of this handoff)

## What's Next For You

1. **If you're testing adoption end-to-end** — adoption saga writes to `subscription_layers`; my work doesn't touch that. Independent.
2. **If you're touching the artefact tables** — please coordinate. Schema rows are workspace-scoped (UNIQUE(subscription_id, field_name)); don't bypass the registry.
3. **If you're adding a 6th artefact type** — add it to `registry` in `backend/internal/artefacts/types.go` AND `coreTableMap` in `backend/internal/searchworker/worker.go`. Both maps are the source of truth.
4. **Padmin-only schema mutation** — `RequireRole(models.RolePAdmin)` gates `/api/artefacts/:type/schema/*`. Don't expose to user/gadmin.

## Key Files

- `backend/internal/artefacts/types.go` — registry, sentinel errors, DTOs
- `backend/internal/artefacts/service.go` — core/schema/field-values business logic
- `backend/internal/artefacts/handler.go` — HTTP handlers + error mapping
- `backend/internal/searchworker/worker.go` — outbox consumer + Ollama embedding
- `backend/cmd/server/main.go` — route mount (line ~XXX) + worker goroutine start (line ~565)
- `db/schema/060_artefact_schema_tables.sql` — schema tables migration
- `db/schema/061_artefact_field_values_reshape.sql` — field values reshape migration

All compiling, build clean, ready for 00157 (Samantha SDK doc) and commit.
