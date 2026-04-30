---
name: Session bootup — three-table artefact schema design + research papers R013–R015 + stories 00151–00157
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: a5f9602b-0644-4cea-999f-b70468753594
---

## Current state (last updated: 2026-04-30)

**Active branch:** `main`
**Story index last issued:** `00157`
**Phase:** PH-0005

---

## Planka card states

**In progress / Doing:**
- None — board is clean after deleting stale cards

**Backlog (ready to start):**
- 00151 — SQL: Drop _template_forms tables, create _schema tables for all 5 Phase 1 artefact types (EST-F5, RISK-MED)
- 00152 — SQL: Reshape _field_values tables — typed columns + schema_field_id FK (EST-F5, RISK-HIGH)
- 00153 — Backend: Generic artefact CRUD service and handler for all 5 Phase 1 types (EST-F8, RISK-MED)
- 00154 — Backend: Schema management API for padmin — field definitions per workspace (EST-F5, RISK-MED)
- 00155 — Backend: Field values read/write API — per-artefact typed value access (EST-F5, RISK-MED)
- 00156 — Backend: Search index outbox worker — TSVECTOR + embedding via Ollama (EST-F8, RISK-HIGH)
- 00157 — Dev doc: Samantha SDK fields API contract — renderField, getSchema, getValue/setValue (EST-F3, RISK-LOW)

**To Do (unrelated, still valid):**
- 00066 — Backend: log layer changes to audit_log
- 00067 — Backend: GET /api/subscription/layers/history
- 00068 — Frontend: layer change history panel
- 00120–00123 — Navigation profiles feature (profile-scoped prefs, UI, seed)

**Deleted this session (stale, superseded by three-table design):**
- 00116, 00139–00148 — old four-table / portfolio item pattern cards

---

## Uncommitted on branch

- `dev/research/R010.json` — fully rewritten to three-table pattern: §3 DDL, §4 workspace isolation SQL, §5 Samantha fields API (all three control levels + type→renderer map), §7 core column set, §8 Phase 1 type list
- `dev/research/R013.json` — NEW: Jira custom fields architecture (5-layer, EAV typed columns, context scoping, implications for Vector)
- `dev/research/R014.json` — NEW: Samantha fields API surface — renderField options object full schema, three control levels, staged-write flow
- `dev/research/R015.json` — NEW: Rally custom fields — TypeDefinition/AttributeDefinition/AllowedValues, RealAttributeType, workspace vs project scoping
- `docs/c_story_index.md` — Last issued updated from 00150 → 00157

---

## What shipped this session

- **Design pivot:** four-table pattern → three-table pattern (core + _schema + _field_values)
- **_schema table:** UNIQUE(subscription_id, field_name) for workspace isolation; type TEXT CHECK constraint as renderer selector; options_json JSONB on schema row
- **_field_values typed columns:** string_value TEXT, number_value NUMERIC(19,4), text_value TEXT, date_value DATE — mirrors Jira's customfieldvalue EAV pattern
- **R010 complete rewrite** — finalised three-table design, Samantha fields API, workspace A/B isolation examples
- **R013** — Jira custom field architecture research
- **R014** — Samantha fields API surface formal paper
- **R015** — Rally custom field architecture research (TypeDefinition → AttributeDefinition → AllowedValues)
- **Stories 00151–00157** — 7 Planka cards created, all labels verified
- **Board cleanup** — 11 stale cards deleted (00116, 00139–00148)

---

## Recent commits

```
87196a4 Schema: o_ artefact tables 049–059 + R010 §6.4/§7 update
66a6523 WIP: template-artefact pivot (R010) + pgvector validation (R012) + CGL backup
3cbfa4b Backend: pgxpool MinConns=2, MaxConnIdleTime=5m — fix idle cold-start lag
8a0587b Nav: useTabState hook — tab/filter state synced to URL for deep-link + reload
ff0ad55 Charts: petal geometry tightened, octagon→circle centres, arc core circles removed
b39f07f UI: Nav prefs reset to defaults — two-stage confirmation
3b8af90 Backup: extend backup-on-push.sh to dump both mmff_vector and mmff_library
c0148ef Theme system: dark-mode toggle, filter UI, chart core fixes, 3D label depth (00126-00130)
```

---

## What's next

1. Commit the 5 uncommitted files (R010, R013, R014, R015, c_story_index.md)
2. Say "go" on 00151 — write migration 060: drop _template_forms/_template_form_fields, create all 5 _schema tables
3. Say "go" on 00152 — write migration 061: reshape all 5 _field_values tables (typed columns + schema_field_id FK)
4. Say "go" on 00153 — generic artefact CRUD Go service + handler (POST/GET/PATCH/DELETE /api/artefacts/:type/:id)
5. Say "go" on 00154 — schema management API (padmin-only, type immutability enforcement via 409)
6. Say "go" on 00155 — field values read/write API (visibility-filtered, upsert, bulk)
7. Say "go" on 00156 — search index outbox Go worker (FOR UPDATE SKIP LOCKED, Ollama HTTP, TSVECTOR writeback)
8. Say "go" on 00157 — Samantha SDK fields API contract doc

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100` (backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Three-table pattern:** core + _schema (UNIQUE subscription_id+field_name) + _field_values (typed: string_value, number_value, text_value, date_value)
- **_schema.type drives rendering:** textbox/richtext/integer/decimal/date/boolean/select/multiselect/radio/user/url → React component registry
- **schema_field_id FK:** nullable ON DELETE SET NULL — values survive schema row deletion; field_name denormalised for queries
- **Workspace isolation:** subscription_id row-level filtering on _schema only — no separate schema tables per workspace
- **f_ prefix:** custom fields in Samantha API responses (vs system fields with no prefix); analogous to Rally's c_ prefix
- **Samantha SDK namespace:** `samantha.fields.*` for field API; `samantha.portfolio.*` for portfolio API
- **Planka POST requires type field:** `"type": "story"` must be in POST /api/lists/:id/cards payload or returns 400
- **Active DB env:** dev — tunnel localhost:5435 → VPS 77.68.33.216
- **R010 is canonical spec** for the three-table artefact architecture — read it before touching any artefact schema work
