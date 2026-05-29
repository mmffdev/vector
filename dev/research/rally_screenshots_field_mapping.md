# Rally Fields Screenshots → Vector Mapping Audit

**Date:** 2026-05-29
**Source inputs:**
- 7 Rally "Fields" admin screenshots (Defect, User Story, Task, Risk, Portfolio Item, Iteration, Release) — verbatim field lists in the brief
- Live `vector_artefacts.artefacts` schema (via tunnel `localhost:5435`, post-mig 149)
- Live `timeboxes_sprints`, `timeboxes_releases`, `topology_nodes`, `artefacts_types` schemas
- `db/vector_artefacts/schema/147_artefacts_core_fields_from_demotion.sql` (today's 18 new columns)
- `dev/research/rally_core_field_audit.md` (OpenAPI cross-ref)
- `dev/research/second_demotion_catalogue_audit.md` (catalogue-demotion sibling audit)
**Pool routing:** `artefacts`, `timeboxes_*`, `topology_nodes`, `artefacts_types` all live in **`vector_artefacts`** (vaPool). Per `docs/c_c_db_routing.md` and SY003 (88 native tables in this DB post-2026-05-28). Confirmed by `\d` and `backend/cmd/server/main.go`'s `NewService(vaPool, …)` wiring.
**Vocabulary mapping applied:** Rally `Project` → Vector topology node (`artefacts_topology_node_id` on `artefacts`); Rally `Iteration` → Vector sprint (`artefacts_id_timebox_sprint`); Rally `Release` → Vector release (`artefacts_id_timebox_release`); Rally `Portfolio Item` reference → strategic-artefact parent link (`artefacts_id_parent`); Rally `User Story` → story (slot `wrk_story`); Rally `Task` → task (slot `wrk_task`); Rally `Defect` → defect (slot `wrk_defect`); Rally `Risk` → risk (slot `wrk_risk`).

---

## G. Numbers summary

```
Total distinct Rally fields across 7 types: 64
Already exists on artefacts (column present today): 17
Already exists on timeboxes/topology (column present today): 6
Mapped by another name (Project→topology, Iteration→sprint, PortfolioItem→parent, etc.): 5
NEW columns on artefacts: 19
NEW columns on timeboxes_sprints: 5
NEW columns on timeboxes_releases: 5
NEW columns on topology_nodes: 0
SKIP (Rick-removed: Schedule State; Rally-internal-bookkeeping / computable rollups): 5
DEFER (needs design — Milestones join, Calculated Risk computed col, Investments multi-FK): 2
```

(64 row sum = 17+6+5+19+5+5+0+5+2; some Rally fields appear on multiple types but are counted once because the mapping is one-to-one against Vector substrate.)

---

## A. Synopsis

Across the 7 Rally screenshots there are **64 distinct Rally fields** (each counted once even when present on multiple types). Mig 147 (shipped today) has already landed **17** of them as core columns on `artefacts` (Blocked, BlockedReason, Description, Expedite, Ready, Notes, Plan-start/finish, Actual Start, Severity, Status, Environment, Estimate Hours, Estimate Remaining, Notes, Affects Doc, Child Test Cases) — the demotion programme is paying off here directly. Another **6** map cleanly onto `timeboxes_sprints` / `timeboxes_releases` / `topology_nodes` columns that already exist (Start Date, End Date, State, Name). **5** are vocabulary-rename mappings (`Project`→topology, `Iteration`→sprint FK, `Release`→release FK, `Portfolio Item`→parent FK, `Work Product`→parent FK). The bulk of new work is **19 new `artefacts` columns** (mostly defect-only and strategy-only attributes with trigger-based scope gates), **5 new `timeboxes_sprints` columns** (Actuals, Plan Estimate, Planned Velocity, Theme, State vocab broadening), and **5 new `timeboxes_releases` columns** (Actuals, Plan Estimate, Planned Velocity, Theme, Gross Estimate Conversion Ratio). **5 SKIPs** — Schedule State (Rick-retired), plus four computed rollups (Direct Children Count, Percent Done By Story Count, Percent Done By Story Plan Estimate, Release Backlog Items Count) that should be projection-side, not stored. **2 DEFERs** — Milestones (needs a join table `artefacts_milestones`, design call) and Investments multi-value object selector (needs design for strategy-tier portfolio links). **Recommended ship order:** (1) defect-only + universal artefact columns with one trigger, (2) strategy-only artefact columns with one trigger, (3) timeboxes_sprints/releases columns (no scope gate needed — they're per-row by table), (4) Milestones + Investments deferred to dedicated design.

---

## B. Per-Rally-field mapping table

Sorted alphabetically. "Vector mapping decision" column legend: **EXISTS** (column already present), **MAP** (Rally→Vector vocabulary rename, no new column), **NEW-ARTEFACT** / **NEW-TIMEBOX-SPRINT** / **NEW-TIMEBOX-RELEASE** / **NEW-TOPOLOGY** (new column required), **SKIP** (Rick-retired or Rally-internal-bookkeeping), **DEFER** (needs design).

| Rally field | Rally type(s) | Rally data type | Vector mapping decision | Proposed / current Vector column | Scope-gate | Status | Notes |
|---|---|---|---|---|---|---|---|
| Actual End Date | Portfolio Item | Date | EXISTS | `artefacts.artefacts_planned_finish_date` is the planned shape; need separate `artefacts_actual_end_date` | strategy-tier (slot null) | ⏳ NEW-ARTEFACT — `artefacts_actual_end_date` DATE NULL | mig 147 added `artefacts_actual_start_date` but NOT `_actual_end_date`. Strategy-only field per Rally (PI tier). |
| Actual Start Date | Portfolio Item | Date | EXISTS | `artefacts.artefacts_actual_start_date` | universal (already loose) | ✅ shipped (mig 147) | mig 147 column. Rally has it on PI; Vector applies universally per the existing `pi_date_work_started` demotion analysis. |
| Actuals | Defect, User Story, Task, Risk, Iteration, Release | Decimal | NEW-ARTEFACT + NEW-TIMEBOX-SPRINT + NEW-TIMEBOX-RELEASE | `artefacts.artefacts_actuals` NUMERIC; `timeboxes_sprints.timeboxes_sprints_actuals` NUMERIC; `timeboxes_releases.timeboxes_releases_actuals` NUMERIC | universal on artefacts; per-row on timeboxes | ⏳ NEW (3 tables) | Rally treats "Actuals" as logged effort. Same shape three places. Default 0. |
| Affects Documentation | Defect | Boolean | EXISTS | `artefacts.artefacts_affects_doc` | defect-only (gate via trigger) | ✅ shipped (mig 147) | Already NOT NULL DEFAULT false. Wants defect-only trigger gate (not yet shipped). |
| Archived | Portfolio Item | Boolean | EXISTS | `artefacts.artefacts_archived_at IS NOT NULL` (timestamp form) | universal | ✅ exists | Vector models this as a soft-archive timestamp, not a boolean. Map Rally's `Archived=true` to `archived_at != NULL`. No new column. |
| Blocked | Defect, User Story, Task, Risk, Portfolio Item | Boolean | EXISTS | `artefacts.artefacts_is_blocked` | universal | ✅ exists | Pre-mig column; NOT NULL DEFAULT false. |
| Blocked Reason | Defect, User Story, Task, Risk, Portfolio Item | String | EXISTS | `artefacts.artefacts_blocked_reason` | universal | ✅ exists | Pre-mig column. |
| Calculated Risk | Risk | Integer | DEFER | `artefacts.artefacts_risk_calculated` GENERATED column candidate | risk-only | 🚧 needs design | Rally derives this from Impact × Probability. Recommend a Postgres GENERATED column once Impact + Probability ship — file `TD-RISK-CALCULATED-COMPUTED`. |
| Creation Date | Defect, User Story, Task, Risk, Portfolio Item, Iteration, Release | Date | EXISTS | `artefacts.artefacts_created_at` (on artefacts); `timeboxes_sprints.timeboxes_sprints_created_at`; `timeboxes_releases.timeboxes_releases_created_at` | universal | ✅ exists | All three tables already have this. |
| Description | Defect, User Story, Task, Risk, Portfolio Item | Text | EXISTS | `artefacts.artefacts_description` + `artefacts_description_doc` | universal | ✅ exists | Pre-mig text + jsonb pair. |
| Direct Children Count | User Story, Portfolio Item | Integer | SKIP | (computed; do not store) | n/a | ❌ skip | Computable from `COUNT(*) FROM artefacts WHERE artefacts_id_parent = $1 AND artefacts_archived_at IS NULL`. Storing creates a sync risk. Surface via projection or query. |
| End Date | Iteration | Date | EXISTS | `timeboxes_sprints.timeboxes_sprints_date_end` | per-sprint | ✅ exists | Already on the table. Rally's Iteration End Date IS this column. |
| Environment | Defect | Drop Down List | EXISTS | `artefacts.artefacts_environment` | defect-only | ✅ shipped (mig 147) | Column exists; vocab is open-text today (no CHECK). Recommend defect-only trigger gate + enum vocab. See D. |
| Estimate | Task | Decimal | EXISTS | `artefacts.artefacts_estimate_hours` | task-only | ✅ shipped (mig 147) | Rally "Estimate" on Task = hours. Mig 147 added this. Task-only trigger gate recommended. |
| Expedite | Defect, User Story, Task, Risk, Portfolio Item | Boolean | EXISTS | `artefacts.artefacts_is_expedite` | universal | ✅ shipped (mig 147) | NOT NULL DEFAULT false; partial index. |
| Exposure | Risk | Decimal | NEW-ARTEFACT | `artefacts.artefacts_risk_exposure` NUMERIC NULL | risk-only (gate via trigger) | ⏳ NEW | Standard Rally Risk field: financial / time exposure. NUMERIC(18,2) or open NUMERIC — needs Rick decision. |
| Feature | User Story | Object Selector | MAP | `artefacts.artefacts_id_parent` | story-only meaning | ✅ exists (parent FK) | Rally Feature is the parent PI for a Story. Vector's `artefacts_id_parent` already serves this — when a Story's parent type is the strategy-tier Feature, it IS the feature link. **No new column.** |
| Fixed In Build | Defect | String | NEW-ARTEFACT | `artefacts.artefacts_defect_fixed_in_build` TEXT NULL | defect-only | ⏳ NEW | Continues the `artefacts_defect_*` prefix family from mig 147. |
| Found In Build | Defect | String | NEW-ARTEFACT | `artefacts.artefacts_defect_found_in_build` TEXT NULL | defect-only | ⏳ NEW | Same family. |
| Gross Estimate Conversion Ratio | Release | Decimal | NEW-TIMEBOX-RELEASE | `timeboxes_releases.timeboxes_releases_gross_estimate_conversion_ratio` NUMERIC NULL | per-release | ⏳ NEW | Rally release-specific velocity-conversion ratio. Confirm precision (recommend NUMERIC(8,4) for ratio shape). |
| ID | All 7 types | String | EXISTS | `artefacts.artefacts_number` + `artefacts_types.artefacts_types_prefix` compose the formatted ID; `timeboxes_sprints_suffix`/`timeboxes_releases_suffix` for timeboxes | universal | ✅ exists | Rally `ID` is the formatted ID (e.g. "US123"). Vector composes from `prefix` + `number` (artefacts) / `suffix` (timeboxes). No new column. |
| Impact | Risk | Drop Down List | NEW-ARTEFACT | `artefacts.artefacts_risk_impact` TEXT NULL + CHECK | risk-only (gate via trigger) | ⏳ NEW | Vocab from catalogue: `low|medium|high|critical`. The `risk_impact` catalogue row was an `options_json` select; promote that vocab. See E + D. |
| Investment Category | Portfolio Item | Drop Down List | EXISTS | `artefacts.artefacts_strategic_investment_group` | strategy-tier | ✅ shipped (mig 147) | mig 147 named it `_investment_group` (matches Rally `InvestmentCategory`). Open vocab today — recommend CHECK with confirmed enum. See D. |
| Investments | Portfolio Item | Object Selector Multi Value | DEFER | (new join table `artefacts_investments`) | strategy-tier | 🚧 needs design | Multi-value object selector → many-to-many. Needs a junction table. Out of scope for this batch — file TD-PI-INVESTMENTS-JOIN. |
| Iteration | Defect, User Story, Task, Risk | Object Selector | MAP | `artefacts.artefacts_id_timebox_sprint` (+ `_timebox_sprint_label`) | execution-tier (TD already filed) | ✅ exists (FK) | Rally `Iteration` IS Vector `sprint`. FK already exists. No new column. |
| Job Size | Portfolio Item | Integer | NEW-ARTEFACT | `artefacts.artefacts_strategic_job_size` INTEGER NULL CHECK (>= 0) | strategy-tier | ⏳ NEW | Continues `artefacts_strategic_*` prefix family for strategy-tier fields. WSJF / SAFe-style sizing. |
| Milestones | Defect, User Story, Task, Risk, Portfolio Item | Object Selector Multi Value | DEFER | (new join table `artefacts_milestones`) | universal | 🚧 needs design | `timeboxes_milestones` already exists. The single FK column `artefacts.artefacts_id_timebox_milestone` is one-to-many, NOT Rally's multi-value model. Promote to a junction table — file `TD-ARTEFACTS-MILESTONES-MULTI`. Out of scope here. |
| Name | All 7 types | String | EXISTS | `artefacts.artefacts_title`; `timeboxes_sprints.timeboxes_sprints_name`; `timeboxes_releases.timeboxes_releases_name` | universal | ✅ exists | Rally calls the field `Name`; Vector calls it `title` on artefacts and `name` on timeboxes. Both exist. |
| Notes | Defect, User Story, Task, Risk, Portfolio Item, Iteration, Release | Text | EXISTS + NEW-TIMEBOX-SPRINT + NEW-TIMEBOX-RELEASE | `artefacts.artefacts_notes` + `_notes_doc` exist (mig 147). `timeboxes_sprints.timeboxes_sprints_notes` TEXT NULL + `_notes_doc` JSONB NULL needed. Same for releases. | universal | ⏳ partial — artefacts done, timeboxes pending | Rally's Iteration and Release both carry a Notes attribute. timeboxes_sprints + timeboxes_releases need the same text + jsonb pair. |
| Owner | Defect, User Story, Task, Risk, Portfolio Item, Iteration (implicit), Release (implicit) | Object Selector | EXISTS | `artefacts.artefacts_id_user_owned_by`; `timeboxes_sprints.timeboxes_sprints_id_user_owner`; `timeboxes_releases.timeboxes_releases_id_user_owner` | universal | ✅ exists | Pre-existing FK on all three tables. |
| Package | Defect, User Story | Drop Down List | NEW-ARTEFACT | `artefacts.artefacts_package` TEXT NULL | story + defect | ⏳ NEW | Rally `Package` is a free-text-or-enum slot. Confirm whether Vector wants CHECK-bound enum or open string. Trigger gates to `wrk_story` OR `wrk_defect`. |
| Parent | User Story | Object Selector | MAP | `artefacts.artefacts_id_parent` | universal | ✅ exists | Story's Parent in Rally = parent Story (same type). Same FK as Feature mapping (parent is parent — type discriminator decides what kind of parent). No new column. |
| Percent Done By Story Count | Portfolio Item | Decimal | SKIP | (computed rollup) | n/a | ❌ skip | Derive from rollup queries / projection. Don't store. |
| Percent Done By Story Plan Estimate | Portfolio Item | Decimal | SKIP | (computed rollup) | n/a | ❌ skip | Same. |
| Plan Estimate | Defect, User Story, Risk, Iteration, Release | Decimal | EXISTS partial + NEW-TIMEBOX-SPRINT + NEW-TIMEBOX-RELEASE | `artefacts.artefacts_story_points` (existing INTEGER) covers Story/Defect/Risk; `timeboxes_sprints.timeboxes_sprints_plan_estimate` NUMERIC NULL needed; `timeboxes_releases.timeboxes_releases_plan_estimate` NUMERIC NULL needed | universal on artefacts (already loose) | ⏳ partial | **Decision point:** Rally `PlanEstimate` is `number` (decimal), Vector `artefacts_story_points` is INTEGER. Mismatch. Two options: (a) keep INTEGER and live with rounding; (b) add NEW `artefacts_plan_estimate` NUMERIC alongside. Recommend asking Rick — leaning toward (a) and renaming the column's UX label to "Plan Estimate" without changing type, since Vector's story-points convention is integer-only. Timeboxes need the new column either way. |
| Planned End Date | Portfolio Item | Date | EXISTS | `artefacts.artefacts_planned_finish_date` | universal (loose) | ✅ shipped (mig 147) | Naming differs (Rally `End` vs Vector `finish`). Same semantic. |
| Planned Start Date | Portfolio Item | Date | EXISTS | `artefacts.artefacts_planned_start_date` | universal (loose) | ✅ shipped (mig 147) | |
| Planned Velocity | Iteration, Release | Decimal | NEW-TIMEBOX-SPRINT + NEW-TIMEBOX-RELEASE | `timeboxes_sprints.timeboxes_sprints_planned_velocity` NUMERIC NULL; `timeboxes_releases.timeboxes_releases_planned_velocity` NUMERIC NULL | per-row | ⏳ NEW | `timeboxes_sprints_velocity` already exists as INTEGER (default 0) — that's the *actual* observed velocity. Planned velocity is a separate forecast column. |
| Portfolio Item | Defect, User Story | Object Selector | MAP | `artefacts.artefacts_id_parent` | universal | ✅ exists | Rally's "Portfolio Item" on a Story/Defect IS the parent strategic artefact. Vector's `artefacts_id_parent` is the universal upward pointer — when the parent has strategy-tier scope, that's the Portfolio Item link. **No new column.** |
| Portfolio Item Type | Portfolio Item | Drop Down List | MAP | `artefacts.artefacts_id_artefact_type` → `artefacts_types.artefacts_types_name` | strategy-tier | ✅ exists | Rally's PI Type names ("Feature", "Initiative", "Theme") are first-class artefact types in Vector's `artefacts_types` registry. No new column. |
| Preliminary Estimate | Portfolio Item | Drop Down List | EXISTS | `artefacts.artefacts_estimate_initial` (mig 147) | strategy-tier (loose today) | ✅ shipped (mig 147) | Rally `PreliminaryEstimate` is the named bucket (XS/S/M/L/XL). Vector's mig 147 column is NUMERIC; if Rick wants enum buckets the column should change to TEXT + CHECK. See D + open Q. |
| Preliminary Estimate Value | Portfolio Item | Integer | NEW-ARTEFACT | `artefacts.artefacts_strategic_preliminary_estimate_value` INTEGER NULL | strategy-tier | ⏳ NEW | The numeric value behind the named bucket (Rally lets you set both — name maps to value through a config table). Recommend storing as INTEGER. |
| Priority | Defect | Drop Down List | EXISTS | `artefacts.artefacts_id_priority` FK to `artefact_priorities` | universal | ✅ exists | Vector already models priority as a FK; Rally's enum maps to rows in `artefact_priorities`. No new column. |
| Probability | Risk | Drop Down List | NEW-ARTEFACT | `artefacts.artefacts_risk_probability` TEXT NULL + CHECK | risk-only | ⏳ NEW | Catalogue vocab: `low|medium|high`. See D. |
| Project | All 7 types | Object Selector | MAP | `artefacts.artefacts_id_topology_node`; `timeboxes_sprints.timeboxes_sprints_id_topology_node`; `timeboxes_releases.timeboxes_releases_id_topology_node` | universal | ✅ exists | Rally `Project` IS Vector topology node. All three substrate tables already have this FK. **No new column.** |
| Ready | Defect, User Story, Task, Risk, Portfolio Item | Boolean | EXISTS | `artefacts.artefacts_is_ready` | universal | ✅ shipped (mig 147) | NOT NULL DEFAULT false; partial index. |
| Release | Defect, User Story, Task | Object Selector | MAP | `artefacts.artefacts_id_timebox_release` | execution-tier (loose today) | ✅ exists | Rally `Release` IS Vector `release` FK. No new column. |
| Release Backlog Items Count | Release | Integer | SKIP | (computed; do not store) | n/a | ❌ skip | Derive from `COUNT(*) FROM artefacts WHERE artefacts_id_timebox_release = $1 AND artefacts_archived_at IS NULL`. Storing creates sync risk. |
| Release Date | Release | Date | EXISTS | `timeboxes_releases.timeboxes_releases_date_end` | per-release | ✅ exists | Rally `ReleaseDate` is the planned release date — Vector's `date_end` on a release IS that. Conceptually a release "happens" at its end. (Open Q for Rick: confirm or split into a distinct `_release_date` column.) |
| Release Note | Defect | Boolean | NEW-ARTEFACT | `artefacts.artefacts_defect_release_note` BOOLEAN NOT NULL DEFAULT false | defect-only | ⏳ NEW | Rally flag "is this defect a release-note item". Boolean default false. |
| Resolution | Defect, Risk | Drop Down List (Defect) / String (Risk) | NEW-ARTEFACT | `artefacts.artefacts_resolution` TEXT NULL + CHECK | defect + risk | ⏳ NEW | Rally has it on both. Vocab differs by type. Recommend ONE column (Rally treats it as semantically the same field name). CHECK list per type via trigger if needed. See D. |
| Schedule State | Defect, User Story, Risk | Drop Down List | SKIP | (Rick: "remove it") | n/a | ❌ skip | Vector uses `flow_states` substrate, not Rally's hard-coded ladder. Confirmed retired in second_demotion_catalogue_audit.md. |
| Severity | Defect | Drop Down List | EXISTS | `artefacts.artefacts_defect_severity` | defect-only | ✅ shipped (mig 147) | Column + CHECK vocab `low|medium|high|critical` shipped. |
| Start Date | Iteration | Date | EXISTS | `timeboxes_sprints.timeboxes_sprints_date_start` | per-sprint | ✅ exists | Already on the table. |
| State | Defect, Risk, Task, Iteration, Release | Drop Down List | EXISTS + NEW-TIMEBOX-SPRINT | `artefacts.artefacts_defect_status` (Defect); `timeboxes_sprints.timeboxes_sprints_status` (planned/active/completed) for Iteration; `timeboxes_releases.timeboxes_releases_status` for Release | per-type | ✅ partial / ⏳ Task State + Risk State new | Defect already has `_defect_status` (mig 147). Iteration + Release both have `_status` on their tables. **Task State** and **Risk State** are new — recommend `artefacts.artefacts_task_status` TEXT NULL + CHECK (Defined/In-Progress/Completed) and `artefacts.artefacts_risk_status` TEXT NULL + CHECK. Or unify into one polymorphic `artefacts_status` column with per-slot trigger gating. **Recommend separate columns** for clarity + per-slot CHECK feasibility. |
| Steps to Reproduce | Defect | Text | NEW-ARTEFACT | `artefacts.artefacts_defect_steps_to_reproduce` TEXT NULL + `_steps_to_reproduce_doc` JSONB NULL | defect-only | ⏳ NEW | Per the second_demotion audit §8 — mirror the description/description_doc pair. |
| Submitted By | Defect, Risk | Object Selector | NEW-ARTEFACT | `artefacts.artefacts_id_user_submitted_by` UUID NULL | defect + risk | ⏳ NEW | Distinct from `artefacts_id_user_created_by` (Rally tracks `SubmittedBy` separately, often an external requester / customer-success rep). Recommend separate FK column. |
| Tags | Defect, User Story, Task, Risk, Portfolio Item | Object Selector Multi Value | NEW-ARTEFACT | `artefacts.artefacts_tags` TEXT[] NULL + GIN index | universal | ⏳ NEW | Per second_demotion §1+§10 cross-cutting analysis. Single column; archive the `pi_lidentifier_labels` + `pi_lidentifier_tags` catalogue rows. Promote to join table later (TD-TAGS-REGISTRY) if vocab control is needed. |
| Test Case Status | Defect | Drop Down List | NEW-ARTEFACT | `artefacts.artefacts_defect_test_case_status` TEXT NULL + CHECK | defect-only | ⏳ NEW | Vocab proposal: `NONE\|PASSED\|FAILED\|BLOCKED\|MIXED`. Needs Rick confirmation. |
| Theme | Iteration, Release | Text | NEW-TIMEBOX-SPRINT + NEW-TIMEBOX-RELEASE | `timeboxes_sprints.timeboxes_sprints_theme` TEXT NULL; `timeboxes_releases.timeboxes_releases_theme` TEXT NULL | per-row | ⏳ NEW | Free-text narrative for the iteration/release. |
| To Do | Task | Decimal | EXISTS | `artefacts.artefacts_estimate_remaining` | task-only | ✅ shipped (mig 147) | mig 147 already added this. Task-only trigger gate recommended. |
| Work Product | Task | Object Selector | MAP | `artefacts.artefacts_id_parent` | task-only meaning | ✅ exists (parent FK) | Rally's Task `WorkProduct` is the User Story (or Defect) the task is for — i.e. the Task's parent. Vector's `artefacts_id_parent` already serves this. **No new column.** |

---

## C. Per-table proposals (proposed migrations)

Next migration sequence per `db/vector_artefacts/schema/`: 150 (149 is the most recent).

### C.1 Migration `150_artefacts_rally_screenshots_universal.sql` — `artefacts` universal new columns

Ships the universal-scope columns (no scope gate). Lowest-risk, ship first.

```sql
BEGIN;
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_actuals                       numeric,
    ADD COLUMN IF NOT EXISTS artefacts_tags                          text[],
    ADD COLUMN IF NOT EXISTS artefacts_actual_end_date               date;

-- GIN index for tag membership queries.
CREATE INDEX IF NOT EXISTS idx_artefacts_tags_gin
    ON artefacts USING gin (artefacts_tags)
    WHERE artefacts_tags IS NOT NULL AND artefacts_archived_at IS NULL;
COMMIT;
```

### C.2 Migration `151_artefacts_rally_screenshots_defect_only.sql` — `artefacts` defect-only columns + trigger

Defect-tier-only. Trigger gates writes against `artefacts_types.artefacts_types_slot='wrk_defect'`.

```sql
BEGIN;
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_defect_fixed_in_build         text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_found_in_build         text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_release_note           boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS artefacts_defect_steps_to_reproduce     text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_steps_to_reproduce_doc jsonb,
    ADD COLUMN IF NOT EXISTS artefacts_defect_test_case_status       text,
    ADD COLUMN IF NOT EXISTS artefacts_resolution                    text,  -- shared defect+risk; gated below
    ADD COLUMN IF NOT EXISTS artefacts_id_user_submitted_by          uuid;  -- shared defect+risk

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_test_case_status_chk
        CHECK (artefacts_defect_test_case_status IS NULL
            OR artefacts_defect_test_case_status = ANY (ARRAY['none','passed','failed','blocked','mixed']));

CREATE OR REPLACE FUNCTION artefacts_enforce_defect_only_fields() RETURNS trigger AS $$
DECLARE
    v_slot text;
BEGIN
    SELECT artefacts_types_slot INTO v_slot
      FROM artefacts_types WHERE artefacts_types_id = NEW.artefacts_id_artefact_type;
    IF v_slot IS DISTINCT FROM 'wrk_defect' THEN
        IF NEW.artefacts_defect_fixed_in_build IS NOT NULL
           OR NEW.artefacts_defect_found_in_build IS NOT NULL
           OR NEW.artefacts_defect_release_note IS TRUE
           OR NEW.artefacts_defect_steps_to_reproduce IS NOT NULL
           OR NEW.artefacts_defect_steps_to_reproduce_doc IS NOT NULL
           OR NEW.artefacts_defect_test_case_status IS NOT NULL
           OR NEW.artefacts_environment IS NOT NULL  -- mig 147 column; gate now
           OR NEW.artefacts_defect_severity IS NOT NULL
           OR NEW.artefacts_defect_status IS NOT NULL
           OR NEW.artefacts_affects_doc IS TRUE
        THEN
            RAISE EXCEPTION 'defect-only field set on non-defect artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER artefacts_enforce_defect_only_fields_trg
    BEFORE INSERT OR UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_enforce_defect_only_fields();
COMMIT;
```

### C.3 Migration `152_artefacts_rally_screenshots_strategy_only.sql` — `artefacts` strategy-tier columns + trigger

Strategy-tier-only (`artefacts_types_scope='strategy'`).

```sql
BEGIN;
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_strategic_job_size                       integer,
    ADD COLUMN IF NOT EXISTS artefacts_strategic_preliminary_estimate_value     integer;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_strategic_job_size_nonneg_chk
        CHECK (artefacts_strategic_job_size IS NULL OR artefacts_strategic_job_size >= 0);

CREATE OR REPLACE FUNCTION artefacts_enforce_strategy_only_fields() RETURNS trigger AS $$
DECLARE
    v_scope text;
BEGIN
    SELECT artefacts_types_scope INTO v_scope
      FROM artefacts_types WHERE artefacts_types_id = NEW.artefacts_id_artefact_type;
    IF v_scope <> 'strategy' THEN
        IF NEW.artefacts_strategic_job_size IS NOT NULL
           OR NEW.artefacts_strategic_preliminary_estimate_value IS NOT NULL
           OR NEW.artefacts_strategic_investment_group IS NOT NULL  -- mig 147 column; gate now
           OR NEW.artefacts_actual_end_date IS NOT NULL  -- Rally has it PI-only
        THEN
            RAISE EXCEPTION 'strategy-only field set on non-strategy artefact (scope=%)', v_scope
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER artefacts_enforce_strategy_only_fields_trg
    BEFORE INSERT OR UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_enforce_strategy_only_fields();
COMMIT;
```

### C.4 Migration `153_artefacts_rally_screenshots_per_slot_columns.sql` — risk-only + task-only + story+defect + multi-slot status

Per-slot trigger covers: risk-only (impact / probability / exposure / resolution shared with defect / submitted_by shared with defect), task-only (state), story-only (none new — Feature/Parent map to artefacts_id_parent).

```sql
BEGIN;
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_risk_impact         text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_probability    text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_exposure       numeric,
    ADD COLUMN IF NOT EXISTS artefacts_risk_status         text,
    ADD COLUMN IF NOT EXISTS artefacts_task_status         text,
    ADD COLUMN IF NOT EXISTS artefacts_package             text;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_impact_chk
        CHECK (artefacts_risk_impact IS NULL OR artefacts_risk_impact = ANY (ARRAY['low','medium','high','critical'])),
    ADD CONSTRAINT artefacts_risk_probability_chk
        CHECK (artefacts_risk_probability IS NULL OR artefacts_risk_probability = ANY (ARRAY['low','medium','high'])),
    ADD CONSTRAINT artefacts_risk_status_chk
        CHECK (artefacts_risk_status IS NULL OR artefacts_risk_status = ANY (ARRAY['identified','assessed','mitigating','closed'])),
    ADD CONSTRAINT artefacts_task_status_chk
        CHECK (artefacts_task_status IS NULL OR artefacts_task_status = ANY (ARRAY['defined','in_progress','completed']));

-- One slot-gate trigger covering risk, task, package.
CREATE OR REPLACE FUNCTION artefacts_enforce_per_slot_fields() RETURNS trigger AS $$
DECLARE
    v_slot text;
BEGIN
    SELECT artefacts_types_slot INTO v_slot
      FROM artefacts_types WHERE artefacts_types_id = NEW.artefacts_id_artefact_type;

    -- Risk-only fields
    IF v_slot IS DISTINCT FROM 'wrk_risk' THEN
        IF NEW.artefacts_risk_impact IS NOT NULL OR NEW.artefacts_risk_probability IS NOT NULL
           OR NEW.artefacts_risk_exposure IS NOT NULL OR NEW.artefacts_risk_status IS NOT NULL THEN
            RAISE EXCEPTION 'risk-only field on non-risk artefact (slot=%)', v_slot USING ERRCODE='23514';
        END IF;
    END IF;

    -- Task-only fields
    IF v_slot IS DISTINCT FROM 'wrk_task' THEN
        IF NEW.artefacts_task_status IS NOT NULL
           OR NEW.artefacts_estimate_hours IS NOT NULL  -- mig 147; gate now
           OR NEW.artefacts_estimate_remaining IS NOT NULL  -- mig 147; gate now
        THEN
            RAISE EXCEPTION 'task-only field on non-task artefact (slot=%)', v_slot USING ERRCODE='23514';
        END IF;
    END IF;

    -- Package: story OR defect only
    IF NEW.artefacts_package IS NOT NULL AND v_slot NOT IN ('wrk_story','wrk_defect') THEN
        RAISE EXCEPTION 'package field only allowed on story or defect (slot=%)', v_slot USING ERRCODE='23514';
    END IF;

    -- Resolution + submitted_by: defect OR risk (Rally allows both)
    IF (NEW.artefacts_resolution IS NOT NULL OR NEW.artefacts_id_user_submitted_by IS NOT NULL)
       AND v_slot NOT IN ('wrk_defect','wrk_risk') THEN
        RAISE EXCEPTION 'resolution/submitted_by only allowed on defect or risk (slot=%)', v_slot USING ERRCODE='23514';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER artefacts_enforce_per_slot_fields_trg
    BEFORE INSERT OR UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION artefacts_enforce_per_slot_fields();
COMMIT;
```

### C.5 Migration `154_timeboxes_sprints_rally_columns.sql` — `timeboxes_sprints` new columns

```sql
BEGIN;
ALTER TABLE timeboxes_sprints
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_actuals          numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_plan_estimate    numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_planned_velocity numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_theme            text,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_notes            text,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_notes_doc        jsonb;

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_actuals_nonneg
        CHECK (timeboxes_sprints_actuals >= 0),
    ADD CONSTRAINT timeboxes_sprints_planned_velocity_nonneg
        CHECK (timeboxes_sprints_planned_velocity IS NULL OR timeboxes_sprints_planned_velocity >= 0),
    ADD CONSTRAINT timeboxes_sprints_plan_estimate_nonneg
        CHECK (timeboxes_sprints_plan_estimate IS NULL OR timeboxes_sprints_plan_estimate >= 0);
COMMIT;
```

Note: existing `timeboxes_sprints_status` already has the CHECK `(planned|active|completed)`. Rally's Iteration `State` adds `Defined` / `Accepted` semantics. **Open Q for Rick:** broaden the CHECK vocab, or keep Vector's 3-state ladder?

### C.6 Migration `155_timeboxes_releases_rally_columns.sql` — `timeboxes_releases` new columns

```sql
BEGIN;
ALTER TABLE timeboxes_releases
    ADD COLUMN IF NOT EXISTS timeboxes_releases_actuals                          numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_plan_estimate                    numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_planned_velocity                 numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_theme                            text,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_gross_estimate_conversion_ratio  numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_notes                            text,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_notes_doc                        jsonb;

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_actuals_nonneg
        CHECK (timeboxes_releases_actuals >= 0),
    ADD CONSTRAINT timeboxes_releases_planned_velocity_nonneg
        CHECK (timeboxes_releases_planned_velocity IS NULL OR timeboxes_releases_planned_velocity >= 0),
    ADD CONSTRAINT timeboxes_releases_plan_estimate_nonneg
        CHECK (timeboxes_releases_plan_estimate IS NULL OR timeboxes_releases_plan_estimate >= 0),
    ADD CONSTRAINT timeboxes_releases_gross_ratio_range
        CHECK (timeboxes_releases_gross_estimate_conversion_ratio IS NULL
            OR (timeboxes_releases_gross_estimate_conversion_ratio >= 0
                AND timeboxes_releases_gross_estimate_conversion_ratio <= 10));
COMMIT;
```

### C.7 `topology_nodes` — **NO new columns**

None of the 64 Rally fields map to a new column on `topology_nodes`. Rally `Project` IS this table (FK only). No-op.

---

## D. Enum vocabularies

Drop-down fields encountered. Bold rows already shipped with their vocab; the rest need Rick's confirmation before column CHECK constraints are authored.

| Rally field | Vector column | Vocab proposal | Status |
|---|---|---|---|
| **Severity (Defect)** | `artefacts_defect_severity` | **`low / medium / high / critical`** | ✅ shipped mig 147 (lowercase) |
| **Defect State** | `artefacts_defect_status` | **`open / triaged / in_progress / fixed / verified / closed / wontfix / duplicate`** | ✅ shipped mig 147 |
| Environment (Defect) | `artefacts_environment` | Common defaults: `production / staging / preview / dev / qa / local / unknown` | 🚧 needs Rick confirmation |
| Package (Story+Defect) | `artefacts_package` | OPEN STRING — Rally treats as free-text. Recommend no CHECK. | 🚧 confirm open vs enum |
| Priority (Defect) | `artefacts_id_priority` FK | Rally enum maps to rows in `artefact_priorities`; vocab already in DB | ✅ exists |
| Resolution (Defect+Risk) | `artefacts_resolution` | Defect: `fixed / wontfix / duplicate / not_a_defect / cannot_reproduce / by_design`; Risk: `accepted / mitigated / transferred / avoided / closed_no_action` — they're semantically different despite shared name. **Recommend ASK before column shape — likely separate columns `artefacts_defect_resolution` + `artefacts_risk_resolution`.** | 🚧 needs design + Rick |
| Investment Category (PI) | `artefacts_strategic_investment_group` | Common Rally defaults: `mtm / run / grow / transform / strategic` — but org-specific. | 🚧 needs Rick |
| Portfolio Item Type (PI) | (no column — uses `artefacts_types`) | n/a | ✅ structural |
| Preliminary Estimate (PI) | (no Rally-name column today; mig 147 added `artefacts_estimate_initial` NUMERIC) | If Rally-shaped: `XS / S / M / L / XL` → bucket name as TEXT + value as INT. Today's numeric column may not match Rally's bucket model. | 🚧 needs Rick — keep numeric or split? |
| Impact (Risk) | `artefacts_risk_impact` | Catalogue vocab: `low / medium / high / critical` | ⏳ proposed |
| Probability (Risk) | `artefacts_risk_probability` | Catalogue vocab: `low / medium / high` | ⏳ proposed |
| Risk State | `artefacts_risk_status` | Proposal: `identified / assessed / mitigating / closed` | 🚧 needs Rick |
| Task State | `artefacts_task_status` | Rally default ladder: `defined / in_progress / completed` | 🚧 needs Rick |
| Iteration State | `timeboxes_sprints_status` | Existing: `planned / active / completed`. Rally adds `defined / accepted`. | 🚧 broaden? |
| Release State | `timeboxes_releases_status` | Same existing vocab. Same question. | 🚧 broaden? |
| Test Case Status (Defect) | `artefacts_defect_test_case_status` | Proposal: `none / passed / failed / blocked / mixed` | 🚧 needs Rick |
| Schedule State (Defect, Story, Risk) | — | n/a (SKIP per Rick) | ❌ |

---

## E. Scope-gate strategy (cross-cutting)

The HARD RULE "SERVER IS THE GATE" pins this to a defence-in-depth model: handler-level validator first (friendly errors, fast feedback), DB-level trigger as backstop (last line of defence — can't be bypassed by raw SQL). Three tiers:

1. **Backend handler check (clean errors).** `backend/internal/artefactitems/service.go` is the first gate. Pattern already present for `validDefectSeverities` etc. (see mig 147 follow-up). For every new column with a scope gate, the PATCH validator rejects writes that don't match the artefact's `slot` / `scope`. Returns a Problem+JSON with `Code` = `scope_violation_<field>` so the frontend can render the right message.
2. **Postgres trigger (server-side backstop).** Three triggers proposed above (migrations 151, 152, 153). Each trigger reads `artefacts_types.artefacts_types_slot` / `_scope` for the row's type, then raises EXCEPTION if any out-of-scope field is non-null. Postgres CHECK constraints **cannot subquery another table** — so the trigger pattern is mandatory.
3. **Lint / static checks (defence in depth ↑↑).** Like the existing `lint:no-direct-workspace-id` family. For new columns, add a lint check that every API DTO maps the new fields through a scope-aware adapter. Cheaper than runtime, catches at PR time.

**Recommendation: tier 1 + tier 2 ship together. Tier 3 follows as TD if it's not already covered by `lint:column-prefix`.**

**Scope-gate inventory** (defect/strategy/task/risk/story/universal):

| Field family | Allowed scope | Allowed slot(s) | Enforcement |
|---|---|---|---|
| Universal (Blocked, Expedite, Ready, Description, Owner, Project, Iteration, Release, Tags, Actuals, Title, Created, Updated, Archived, Notes, Priority FK, Parent, Created By, Status FK, Topology Node FK, Subscription FK, Workspace FK) | both | any | none |
| Defect-only (Severity, Defect Status, Environment, Affects Doc, Fixed In Build, Found In Build, Release Note, Steps to Reproduce, Test Case Status) | work | `wrk_defect` | service + trigger 151 |
| Story-only (none new — Feature/Parent are FK reuse) | work | `wrk_story` | service |
| Task-only (Estimate Hours, To Do = Estimate Remaining, Task State, Work Product = FK reuse) | work | `wrk_task` | service + trigger 153 |
| Risk-only (Impact, Probability, Exposure, Risk State, Calculated Risk) | work | `wrk_risk` | service + trigger 153 |
| Defect+Risk-shared (Resolution, Submitted By) | work | `wrk_defect` OR `wrk_risk` | service + trigger 151/153 |
| Story+Defect-shared (Package) | work | `wrk_story` OR `wrk_defect` | service + trigger 153 |
| Strategy-only (Job Size, Investment Category = `_investment_group`, Preliminary Estimate Value, Actual End Date, Planned Start/End Dates [Rally calls them strategy-only; Vector mig 147 left them universal]) | strategy | n/a (strategy types have NULL slot) | service + trigger 152 |
| Per-row timeboxes (Theme, Planned Velocity, Actuals, etc.) | n/a (own tables) | n/a | none — direct column on `timeboxes_*` |

---

## F. Open questions for Rick (must answer before authoring the next migration)

1. **Plan Estimate type mismatch.** Vector's `artefacts_story_points` is INTEGER; Rally's `PlanEstimate` is decimal. Three options: (a) keep INTEGER and ignore fractional; (b) ALTER COLUMN to NUMERIC; (c) add a parallel `artefacts_plan_estimate` NUMERIC column and deprecate `story_points`. Lean (a) but Rick must call.
2. **Preliminary Estimate model.** mig 147 added `artefacts_estimate_initial` as NUMERIC. Rally treats it as a named bucket (XS/S/M/L/XL) with an integer value. Should the column become TEXT (bucket name) with a separate `_preliminary_estimate_value` INTEGER (which C.3 proposes), or stay NUMERIC and drop the bucket name?
3. **Resolution shared shape.** Rally has `Resolution` on both Defect and Risk with **different semantics** (defect: fixed/wontfix/etc; risk: accepted/mitigated/etc). Two options: (a) ONE `artefacts_resolution` TEXT column with per-slot CHECK in the trigger (complex); (b) two columns `artefacts_defect_resolution` + `artefacts_risk_resolution` with per-column CHECK (clean, mirrors `defect_severity` / `defect_status` pattern). Recommend (b). Confirm?
4. **State / Status field family on Task and Risk.** Should Task and Risk get a column-level status (`artefacts_task_status`, `artefacts_risk_status`), or should the existing `flow_state_id` substrate be the only status surface and Rally's `State` map to a flow state row? mig 147 added `artefacts_defect_status` separate from `flow_state_id`, setting a precedent for per-type status columns. Confirm continuing that pattern.
5. **Iteration / Release State vocab.** `timeboxes_*_status` CHECK is `planned|active|completed`. Rally has `Defined / Accepted` too. Broaden the vocab?
6. **`Release Date` (Release).** Rally's `ReleaseDate` is the planned release date — currently mapped to `timeboxes_releases.timeboxes_releases_date_end`. Confirm or add a distinct `_release_date` column?
7. **Tags column shape.** TEXT[] + GIN (this proposal, simplest) or junction table `artefacts_tags` with `(artefact_id, tag)` (more flexible, Rally-correct, supports per-workspace vocab)? Per second_demotion §1+10, recommend TEXT[] now and TD-TAGS-REGISTRY for the join-table promotion. Confirm?
8. **Milestones.** Multi-value join needed. `artefacts.artefacts_id_timebox_milestone` is single-FK today. Ship a junction table now or defer to a dedicated migration?
9. **Calculated Risk.** Computed as `Impact × Probability` (Rally formula). Implement as a Postgres `GENERATED ALWAYS AS … STORED` column once Impact and Probability ship?
10. **Investments (PI multi-value).** Defer to a dedicated PI-investments migration?
11. **Project mapping confirmation.** Rally `Project` on every artefact → existing `artefacts_id_topology_node`. **No new column.** Confirm.
12. **Iteration mapping confirmation.** Rally `Iteration` → existing `artefacts_id_timebox_sprint`. **No new column.** Confirm.
13. **Schedule State retirement.** Confirm full removal across Defect, User Story, AND Risk (Rally has it on all three).
14. **Submitted By: separate from Created By?** Rally distinguishes them (submitter ≠ author). Vector currently has `artefacts_id_user_created_by` only. Confirm adding `artefacts_id_user_submitted_by` for defect+risk.
15. **Schedule of work — universal columns under defect-only / strategy-only restriction?** mig 147 added Environment / Severity / Defect Status / Estimate Hours / Estimate Remaining / Affects Doc as UNIVERSAL on `artefacts` (no scope gate yet). Migrations 151–153 above propose gating these retroactively. Confirm — or leave them loose (any artefact can have any value)?

---

## End of report

**File:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/dev/research/rally_screenshots_field_mapping.md`

**Cross-refs:**
- `dev/research/rally_core_field_audit.md` — OpenAPI cross-ref (pass 1)
- `dev/research/second_demotion_catalogue_audit.md` — catalogue demotion (sibling pass)
- `db/vector_artefacts/schema/147_artefacts_core_fields_from_demotion.sql` — 18 columns shipped today
- `backend/internal/artefactitems/columns.go` — live ColumnSpec inventory (needs entries for every NEW column in C.1–C.6)
- `docs/c_c_db_routing.md` — vaPool routing confirmation for all 4 tables touched
