# Handover — Core-field demotion + custom-fields catalogue cleanup

**Filed:** 2026-05-29 (mid-build; previous context near burn)
**Branch:** `main` (active local commits past origin/main; do not push without explicit go-ahead)
**Working dir:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector`
**Status:** Design + scoping phase. NOTHING destructive done yet. Live DB write was attempted and CORRECTLY blocked by the auto-mode classifier — do not bypass; design first.

---

## What Rick said (verbatim, the brief)

> "blocked and blocked reason isnt custom its core.. needs to move over to core fields"
>
> "i dont know whats happened but it slipped my radar!!! this is a mess as most arnt even assigned to their artefact types etc"
>
> "all of these are core, none of them are custom.. apart from acceptance criteria field, we only need the richtext one also - acceptance_criteria2 can be dropped altogether"
>
> "best action is to compare the rally docs to see what fields are core and match them back, we need a table to also show the core fields, as they can still be viewed as an overview, youll need to get these field back to where they all belong and thats not in custom"

**Net:** the `artefacts_fields_library` catalogue has been polluted with what should be **core artefact-schema columns** (and a pile of test cruft). Only `acceptance_criteria` (richtext) is a legitimate custom field. Everything else must be reclassified as core — and the admin UI needs a **read-only "Core fields" overview** so admins can still see them at a glance even though they aren't user-managed.

---

## Hard rules you MUST respect

These are repo HARD RULES (see `.claude/CLAUDE.md`) — they cannot be overridden:

1. **NEVER ASSUME A DATABASE.** Before any psql query: (a) find handler in `backend/internal/`, (b) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify pool, (c) cross-check `docs/c_c_db_routing.md`. Two DBs in play: `vector_artefacts` (vaPool) and `mmff_library` (libPools).
2. **NEVER destructive git** (`reset --hard`, `push --force`, `checkout .`, `clean -f`, etc.) without explicit user confirmation. Never `git stash` (it killed work on 2026-05-16).
3. **NEVER `git add .` / `git add -A`.** Always stage by explicit path.
4. **Inspect index before every commit:** `git diff --cached --stat` and read in full.
5. **No hacks disguised as fixes.** Root cause only. Demotion via direct UPDATE is one option but a migration is cleaner — see Design choices below.
6. **Server is the gate.** Any visibility/role/scope rule writes the server-side check FIRST. UI is defence-in-depth.
7. **SY003 must be regenerated** after any substrate change. Use the `<report> -sy` skill or POST directly.
8. **"Commit all workstreams = group them ALL"** — when Rick says commit all, group EVERY dirty file by workstream and commit them all, not just what you authored.

---

## What's live on disk RIGHT NOW

### Live catalogue inventory (queried 2026-05-29)

44 active rows in `artefacts_fields_library`. **Zero** values stored in `artefacts_fields_values` against ANY of them. Most are bound to artefact types (1-11 each), some have zero bindings. Breakdown:

**Legitimate custom (keep):**
- `acceptance_criteria` (richtext) — bound to 4 types, the one Rick wants kept

**Drop entirely:**
- `acceptance_criteria2` (textbox) — duplicate that bypassed the label-collision check because data_type differed (richtext vs textbox)

**Demote to core (already a real column on `artefacts` table OR needs a column added):**
- `blocked` (boolean) — `artefacts.artefacts_is_blocked` ALREADY EXISTS (bool, not null, default false, indexed). Just demote the catalogue row.
- `blocked_reason` (textbox) — `artefacts.artefacts_blocked_reason` ALREADY EXISTS (text, nullable). Just demote.

**Likely-core needs Rally cross-check (Rick's brief says "compare Rally docs"):**
- `browser` (textbox)
- `defect_severity` (select)
- `environment` (textbox)
- `estimate_hours` (decimal)
- `estimate_remaining` (decimal)
- `expedite` (boolean)
- `lidentifier_colour` / `lidentifier_type` (textbox)
- `notes` (richtext)
- `pi_date_work_accepted` / `pi_date_work_planned_finish` / `pi_date_work_planned_start` / `pi_date_work_started` (date)
- `pi_estimate_initial` / `pi_estimate_updated` (decimal/textbox)
- `pi_flow_state_change_date` / `pi_flow_state_change_owner` (textbox/user)
- `pi_lidentifier_labels` / `pi_lidentifier_tags` (multiselect)
- `pi_strategic_investment_group` / `pi_strategic_investment_weight` / `pi_strategic_item_type` / `pi_value_stream_identifier` (textbox)
- `ready` (boolean)
- `regression` (boolean)
- `risk_impact` (select), `risk_probability` (select), `risk_score` (decimal)
- `steps_to_reproduce` (richtext)
- `us_affects_doc` (boolean)
- `us_count_child_defects` / `us_count_child_tasks` / `us_count_child_test_cases` (integer)
- `us_defect_status` (textbox)
- `us_estimate_points` (decimal)

**Pure test cruft (purge):**
- 18× `test_field_*` rows
- 1× `test_typechange_*` row

ALL 19 are leftover from `backend/internal/fields/bindings_integration_test.go` — the test helper seeds these but never cleans up. **Filing as TD-FIELDS-INTEGRATION-TEST-CLEANUP** belongs in the deliverable.

### Existing core columns on `artefacts` (live)

Confirmed via `\d artefacts`:
```
artefacts_blocked_reason (text)
artefacts_colour (text)
artefacts_description (text)
artefacts_description_doc (jsonb)
artefacts_due_date (date)
artefacts_is_blocked (boolean, not null, default false, indexed)
artefacts_number (bigint)
artefacts_position (integer)
artefacts_story_points (integer)
artefacts_timebox_sprint_label (text)
artefacts_title (text)
```

### Existing UI for core fields (today)

- `<BlockedToggle>` at `app/components/ArtefactInlineForm/BlockedToggle.tsx` — already wired
- `app/components/ArtefactInlineForm/ArtefactInlineForm.tsx` — the inline edit panel that consumes core columns
- `backend/internal/artefactitems/` — service + handler + sql + columns + types all reference is_blocked + blocked_reason + the other core cols as first-class
- `app/components/ObjectTreeV2/p_ObjectTree.tsx` — references too

So **the demotion of `blocked`/`blocked_reason` is purely metadata cleanup**. The substrate, backend, and UI for these two are already done as core.

---

## What you need to do (sequenced)

### Phase 0 — Scope confirmation with the user (BEFORE designing)

Use AskUserQuestion. Three questions max.

**Q1 — Rally cross-check method:**
- A: I crawl the local `Rally-openapi-spec.json` (1.5MB, repo root) to extract the HierarchicalRequirement / Defect / Task / TestCase schema attributes and list which Vector catalogue names map to Rally core fields. Output a table for Rick to mark "keep core / drop / keep as custom".
- B: Rick provides a hand-curated list of which catalogue rows are core vs custom. (Faster but skips the audit.)
- C: Hybrid — I produce a Rally-derived recommendation table, Rick marks the column.

**Q2 — Demotion mechanism:**
- A: SQL migration file `db/vector_artefacts/schema/146_demote_core_catalogue_rows.sql` that ARCHIVES (sets archived_at) the demoted rows. Audited, reversible via DOWN script. Recorded in `schema_migrations`.
- B: Backend service call via the admin reporting API to UPDATE in batch. No migration audit trail.
- C: Hard DELETE via direct SQL (rejected — breaks project pattern of soft-delete).

**Q3 — Core-fields overview UI:**
- A: New `<CoreFieldsTable>` mounted under the existing OTV2 custom-fields grid (one page, two grids). Read-only.
- B: A separate `/workspace-admin/core-fields` route. Cleaner separation, more navigation.
- C: A toggle on the current custom-fields page ("Custom only / All including core"). Reuses the OTV2 grid; adds a "Source" column.

My **recommendation**: C+A+C (hybrid Rally audit, migration, toggle on existing grid).

### Phase 1 — Rally audit (if user picks A or C in Q1)

Read `Rally-openapi-spec.json` (1.5MB). Focus on these endpoints/components:

- `/slm/webservice/v2.0/hierarchicalrequirement` (Story)
- `/slm/webservice/v2.0/defect`
- `/slm/webservice/v2.0/task`
- `/slm/webservice/v2.0/testcase`
- `/slm/webservice/v2.0/portfolioitem/{type}` (Feature, Theme, etc.)
- `#/components/schemas/HierarchicalRequirement`
- `#/components/schemas/Defect`
- etc.

Pull the attribute names. Build a mapping table:

| Vector catalogue name | Rally canonical name | Rally type | Already a core col on `artefacts`? | Recommendation |
|---|---|---|---|---|
| `blocked` | `Blocked` | bool | YES (`artefacts_is_blocked`) | Archive catalogue row |
| `blocked_reason` | `BlockedReason` | text | YES (`artefacts_blocked_reason`) | Archive catalogue row |
| `ready` | `Ready` | bool | NO — add column | Archive catalogue, write mig to add column, wire UI |
| `expedite` | `Expedite` | bool | NO | Archive catalogue, write mig, wire UI |
| … etc | | | | |

This table goes into a `<spec>` doc and then drives the migration content.

### Phase 2 — Spec + plan

Invoke the `superpowers:brainstorming` skill (or follow its checklist inline if context is tight) to land on:

- Final core-field list (what's been demoted, what needs new columns)
- Migration shape (one mig or split per concern: archive, add-cols, backfill-from-fields-values)
- UI shape (Q3 answer)
- Backend changes (does `ColumnSpec` in `backend/internal/artefactitems/columns.go` need new rows? Most likely yes for any new core column.)
- Tests required

Write spec to `docs/superpowers/specs/2026-05-29-core-field-demotion-design.md`.
Write plan to `docs/superpowers/plans/2026-05-29-core-field-demotion.md`.

### Phase 3 — Execute the plan task-by-task

Subagent per task. Orchestrator commits per workstream (per `commit all workstreams = group them ALL` rule in memory).

Per-task suggestions:

- **Task A** — write & apply the archive migration (mig 146). Verify schema_migrations row. Confirm grid shows only `acceptance_criteria`.
- **Task B** — add any missing core columns to `artefacts` (mig 147 if needed). Backfill from `artefacts_fields_values` if/when data exists.
- **Task C** — extend `ArtefactItem.ColumnSpec` and the inline edit panel to surface new core columns.
- **Task D** — build the core-fields overview UI per Q3.
- **Task E** — TD entry for the integration-test cruft cleanup (`TD-FIELDS-INTEGRATION-TEST-CLEANUP`). Test seed helper should DELETE its rows at t.Cleanup() time; today it doesn't, hence 19 zombies.
- **Task F** — regenerate SY003 (HARD RULE — substrate changed).
- **Task G** — final sweep + handover doc.

### Phase 4 — Don't push until Rick says push

Per his standing instruction.

---

## What's CHEAP to verify before designing

```bash
# 1) Read the current TS edit form (linter touched it; preserve user's intent — DO NOT REVERT)
Read app/components/CustomFields/CustomFieldEditForm.tsx

# 2) Confirm tunnel + backend still up
lsof -nP -iTCP:5100 -sTCP:LISTEN   # backend
lsof -nP -iTCP:5435 -sTCP:LISTEN   # db tunnel

# 3) See what artefactitems.columns.go declares as core today
sed -n '1,100p' backend/internal/artefactitems/columns.go

# 4) Re-pull the live catalogue + bindings + values inventory (this handover's snapshot is from 00:something AM)
PSQL=/opt/homebrew/Cellar/libpq/18.3/bin/psql
PGPASSWORD=68H9m2ncJJeKGvwKqQ3zMVzLjF0o4LPi $PSQL -h localhost -p 5435 -U mmff_dev -d vector_artefacts -c "SELECT artefacts_fields_library_field_name, artefacts_fields_library_field_type, (SELECT COUNT(*) FROM artefacts_types_fields tf WHERE tf.artefacts_types_fields_id_field_library = fl.artefacts_fields_library_id) AS bindings, (SELECT COUNT(*) FROM artefacts_fields_values v WHERE v.artefacts_fields_values_id_field_library = fl.artefacts_fields_library_id) AS values_count FROM artefacts_fields_library fl WHERE fl.artefacts_fields_library_archived_at IS NULL ORDER BY 1;"
```

---

## State the prior session left behind (do not regress these)

- Inline row-detail flyout under the clicked row (commit `dccb4684` + `2e365bdd`)
- Disabled-state grey override on flyout selects (commit `606a64a5`)
- Vertical-stack form fields (commit `7cc795df` + linter touch since)
- Custom-fields page has `showHeader={false}` + `hideCogMenu` on the OTV2 mount
- ResourceTree has `renderRowDetail` + `disableInnerScroll` props wired

The `CustomFieldEditForm.tsx` was touched by linter/Rick post-commit; **read the live file before editing**.

---

## Open questions for the user (collect via AskUserQuestion at start of fresh session)

1. Rally cross-check method (Q1 above)
2. Demotion mechanism (Q2 above)
3. Core-fields overview UI shape (Q3 above)
4. Should the integration-test cruft be purged in this same session or filed as TD-only?
5. The `pi_*` and `us_*` prefixed rows look like Rally-source-named seeds that should either become real Vector core columns OR be retired as Rally-specific noise. Worth a yes/no per family.

---

## Anti-patterns to avoid (these are how I almost got it wrong)

- **Don't direct-UPDATE the DB without a migration.** I tried it; classifier blocked me. That was the correct block — a substrate change needs an auditable migration file.
- **Don't assume `pi_*` / `us_*` prefixes mean Rally — verify against the Rally spec.** They might be Vector's earlier hand-seeded approximation.
- **Don't add a "Source" column to the existing OTV2 grid until the user has approved the Q3 UI shape.** Refactor in haste = double rework.
- **Don't skip the SY003 regeneration.** Any catalogue archive IS substrate state.
- **Don't push without explicit user say-so.** Branch will be N commits ahead; that's fine, push is its own decision.

---

## Quick links

- Spec for the previous OTV2-generic build: `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md`
- Plan for previous build: `docs/superpowers/plans/2026-05-28-objecttree-generic-rowtype.md`
- Custom-field bindings spec: `docs/superpowers/specs/2026-05-28-custom-field-type-bindings-design.md`
- Rally OpenAPI spec: `Rally-openapi-spec.json` (repo root, 1.5MB)
- Schema doc: `docs/c_schema.md`
- DB routing: `docs/c_c_db_routing.md`
- Tech-debt register: `docs/c_tech_debt.md`
- Memory: `context/MEMORY.md` (HARD RULES + active threads incl. "commit all = group all" rule)

---

## Final note

When you start: invoke `superpowers:using-superpowers` skill briefly to refresh hard rules. Then `superpowers:brainstorming` for the design phase. Don't go straight to code. The pattern that's worked twice in this branch is **spec → plan → subagent-per-task → orchestrator commits → push when Rick says**. Follow it.
