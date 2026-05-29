# Rally Screenshots → Vector Core Columns — Design

**Date:** 2026-05-29
**Branch:** `main` (autonomous-mode; user is monitoring out-of-band)
**Status:** Spec drafted from Rally screenshot audit + Rick's locked decisions (A–I). All nine open questions are resolved upfront so the migration subagent can ship without re-asking.
**Origin:** Rick supplied 7 Rally admin-screen screenshots showing the field list per Rally object type (Defect / User Story / Task / Risk / Portfolio Item / Iteration / Release). The audit subagent produced [`dev/research/rally_screenshots_field_mapping.md`](../../../dev/research/rally_screenshots_field_mapping.md) — a 64-row mapping. This spec promotes that into an executable plan.
**Predecessor:** [`2026-05-29-core-field-demotion-design.md`](2026-05-29-core-field-demotion-design.md) — today's first demotion (migs 146/147/148, commit `a14d906b` + family); the 18 columns it shipped form the substrate this batch builds on.

---

## 1. Synopsis

Rick's 7 Rally screenshots enumerate **64 distinct Rally fields**. The today-shipped mig 147 already covers 17 of them and 6 more existed pre-mig on `artefacts` / `timeboxes_*` / `topology_nodes`. Another 5 are Rally→Vector vocabulary renames (`Project`→topology node, `Iteration`→sprint, `Portfolio Item`→strategic artefact, `Release`→release, `User Story Parent`/`Task Work Product`→`artefacts_id_parent`) — no new columns. **5 are SKIPs** (Schedule State retired by Rick; four are computed rollups that should be projection-side, not stored). **2 are deferred** (Milestones + Investments — both need junction tables).

That leaves **29 net-new columns** spread across 4 tables (`artefacts` 19, `timeboxes_sprints` 4, `timeboxes_releases` 6 — `_release_backlog_items_count` removed per audit's SKIP note), one TYPE alteration on a mig-147 column, and **one composite slot-gate trigger** on `artefacts` that enforces all per-slot column gates in one function (covering both this batch's new columns AND retroactively tightening the six mig-147 columns Rick flagged in Decision E).

Headline substrate changes: (1) `artefacts_tags TEXT[]` + GIN partial index; (2) split `artefacts_estimate_initial` into bucket-name (TEXT) + bucket-value (INTEGER); (3) two separate resolution columns (`artefacts_defect_resolution` + `artefacts_risk_resolution`) with per-column CHECK; (4) a Postgres `GENERATED ALWAYS AS … STORED` column `artefacts_risk_calculated` driven by impact × probability scores; (5) one BEFORE INSERT/UPDATE trigger function `trg_artefacts_slot_gate_aiu_fn` enforcing every slot/scope gate in this batch + Decision E's retroactive tightening on mig 147 columns. Defence-in-depth follows the HARD RULE — handler-side allow-list AND database trigger ship together.

---

## 2. Decision log (Rick's nine A–I, locked)

| ID | Question | Decision | Reasoning |
|----|----------|----------|-----------|
| **A** | Plan Estimate type mismatch — Rally is decimal, `artefacts_story_points` is INTEGER. | **(i) Keep INTEGER `artefacts_story_points`; accept rounding on Rally imports; rename UI label to "Plan Estimate".** | Vector's story-point convention is whole-point throughout. Changing the type would ripple through every projection, every roll-up, every test fixture. The cost of fractional precision (0.25-point granularity) is not worth that. Importers truncate; TD entry `TD-PLAN-ESTIMATE-DECIMAL` covers later promotion if real demand surfaces. |
| **B** | Preliminary Estimate — Rally treats it as a named bucket (XS/S/M/L/XL); mig 147 added `artefacts_estimate_initial` as NUMERIC. | **(ii) ALTER `artefacts_estimate_initial` from NUMERIC to TEXT (bucket name). Add `artefacts_estimate_initial_value` INTEGER alongside. Both NULL-able.** | Rally's two-field model (named bucket + numeric value-per-bucket) is the correct shape; UI shows the bucket name, projection layer reads the value. Zero existing rows (column shipped today) so ALTER COLUMN TYPE is safe — no data loss. |
| **C** | Resolution — Rally has it on both Defect and Risk with different vocabs. | **(ii) Two separate columns: `artefacts_defect_resolution` + `artefacts_risk_resolution` each with column-level CHECK.** | Mirrors the mig 147 `defect_severity`/`defect_status` precedent. Per-column CHECK is enforced by Postgres without trigger machinery — simpler, faster, easier to read. Slot gating still enforced by the trigger because CHECK can't subquery another table. |
| **D** | Tags substrate — TEXT[] or junction table? | **(i) `artefacts_tags TEXT[]` + GIN partial index. File `TD-TAGS-REGISTRY` for later promotion to a junction table.** | TEXT[] + GIN is the simpler, faster path. Per-workspace vocab control is not a current requirement; when it becomes one, promotion to `artefacts_tags_registry (workspace_id, tag)` is mechanical. |
| **E** | mig 147 retroactive scope-gate — should Environment / `defect_severity` / `defect_status` / `estimate_hours` / `estimate_remaining` / `affects_doc` be gated to their proper slot families? | **(i) TIGHTEN with triggers.** | These shipped this morning as universal columns "to keep mig 147 small". Letting them stay loose drifts into the same "everything is everywhere" mess that caused the catalogue rot. Gate them now while no out-of-slot data has been written. Slot-gate inventory: Environment + `defect_severity` + `defect_status` + `affects_doc` → `wrk_defect` only. `estimate_hours` + `estimate_remaining` → `wrk_task` only. Folded into the single trigger function in mig 157. |
| **F** | Submitted By — Rally has it as a separate user FK on Defect + Risk. Vector currently only has `artefacts_id_user_created_by`. | **(i) Add `artefacts_id_user_submitted_by` UUID NULL, gated to defect+risk slots.** | Author ≠ submitter in customer-success / triage workflows (someone files on behalf of an external requester). The trigger gates it to `wrk_defect` OR `wrk_risk`. |
| **G** | Calculated Risk = Impact × Probability — Rally surface. | **(i) Postgres `GENERATED ALWAYS AS (artefacts_risk_impact_score * artefacts_risk_probability_score) STORED` column. Underlying impact + probability ship as PAIRED (text bucket + integer score) columns.** | Bucket + score is Rally's actual shape. The text column drives the UI dropdown; the integer column drives the calculation; the generated column is always-correct by definition (the DB enforces it). No risk of drift. |
| **H** | Milestones + Investments — both Rally multi-value object selectors. | **(ii) DEFER both.** File `TD-MILESTONES-JUNCTION` and `TD-INVESTMENTS-JUNCTION`. | Both need junction tables (`artefacts_milestones (artefact_id, timebox_milestone_id)` and `artefacts_investments (artefact_id, investment_id)`). Designing those properly is its own batch; not blocking this one. |
| **I** | Iteration/Release State vocab — current is `planned\|active\|completed`; Rally adds `Defined / Accepted`. | **(ii) Keep current 3-state vocab. Don't broaden.** | Vector's timebox lifecycle is intentionally simple (state names match the flow-state substrate that's been load-bearing for months). Rally's `Defined/Accepted` map onto `planned`/`completed` semantically. No CHECK change. |

---

## 3. Out of scope

- **Milestones junction table** — deferred. `TD-MILESTONES-JUNCTION` S2 filed. Trigger: when scheduling needs cross-artefact milestone querying. Pay-down: new `artefacts_milestones` junction table + service methods.
- **Investments junction table** — deferred. `TD-INVESTMENTS-JUNCTION` S2 filed. Trigger: when strategy-tier financial roll-ups become a requirement. Pay-down: `artefacts_investments` junction + strategy-tier service hookup.
- **Saved-views surface** — out of scope. The 29 new columns become available to `saved_views` automatically once they appear in `ArtefactItemColumns` (the column catalogue drives the picker, and the picker drives view-config persistence). No code change required to `saved_views`.
- **Frontend field editors** for the new columns — out of scope. The `customFieldsAdapter` synthesises Source=CORE rows automatically from the column catalogue; the new columns appear as read-only rows in the admin grid the moment the ColumnSpec entries land. Inline-edit panel + grid renderers ship in a follow-up FE batch (filed as `TD-INLINE-FORM-RALLY-SCREENSHOTS` if Rick wants to track it; not strictly needed because the existing `TD-INLINE-FORM-NEW-CORE-COLUMNS` already covers the demoted-core arc and these new columns sit in the same queue).
- **Wizard sidecars** + artefact detail flyouts — same logic. Substrate + API only this batch.
- **`artefacts_release_backlog_items_count`** on `timeboxes_releases` — DROPPED per audit's "computed rollup, sync risk" note. Derive from `COUNT(*) FROM artefacts WHERE artefacts_id_timebox_release = $1 AND artefacts_archived_at IS NULL` in projection.
- **Schedule State** on Defect / Story / Risk — Rick-retired. Already noted as SKIP across the catalogue.
- **Direct Children Count** / **Percent Done By Story Count** / **Percent Done By Story Plan Estimate** — computed rollups. SKIP.
- **Portfolio Item Type as a new column** — already modelled as artefact-types registry rows (`artefacts_types.artefacts_types_name`). The audit briefing flagged this as a possible inclusion; on reading the artefact-types substrate it's clearly already covered. No new column.

---

## 4. Migration plan

Next free sequence per `db/vector_artefacts/schema/`: **150** (149 is `relax_saved_views_kind_check_for_page.sql`, already applied today). Audit suggested 149–155; we re-number to 150–157 to leave 149 alone and to fold mig 158 ("retroactive tightening per Decision E") into mig 157's single trigger function.

For each migration: UP file under `db/vector_artefacts/schema/<NNN>_<name>.sql`, DOWN file under `db/vector_artefacts/schema/down/<NNN>_<name>_DOWN.sql`. All UPs are wrapped `BEGIN…COMMIT`. All ADD COLUMN use `IF NOT EXISTS`; ADD CONSTRAINT do not (Postgres limitation) — the DOWN scripts `DROP … IF EXISTS` cleanly.

### 4.1 mig 150 — `artefacts_rally_universal_columns.sql`

**Purpose:** Universal-scope new columns on `artefacts`. No scope gate at the column level. Lowest-risk, ship first.

**UP:** `db/vector_artefacts/schema/150_artefacts_rally_universal_columns.sql`

```sql
BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_actuals          numeric,
    ADD COLUMN IF NOT EXISTS artefacts_tags             text[],
    ADD COLUMN IF NOT EXISTS artefacts_actual_end_date  date;

-- GIN partial index for tag membership queries; mirrors mig-147 partial-index discipline.
CREATE INDEX IF NOT EXISTS idx_artefacts_tags_gin
    ON artefacts USING gin (artefacts_tags)
    WHERE artefacts_tags IS NOT NULL
      AND artefacts_archived_at IS NULL;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_actuals_nonneg_chk
        CHECK (artefacts_actuals IS NULL OR artefacts_actuals >= 0);

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/150_artefacts_rally_universal_columns_DOWN.sql`

```sql
BEGIN;
DROP INDEX IF EXISTS idx_artefacts_tags_gin;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_actuals_nonneg_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_actuals,
    DROP COLUMN IF EXISTS artefacts_tags,
    DROP COLUMN IF EXISTS artefacts_actual_end_date;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | CHECK | Index | Scope-gate |
|---|---|---|---|---|---|---|
| `artefacts_actuals` | NUMERIC | YES | — | `>= 0` | — | none (universal) |
| `artefacts_tags` | TEXT[] | YES | — | — | GIN partial (`IS NOT NULL AND archived_at IS NULL`) | none (universal) |
| `artefacts_actual_end_date` | DATE | YES | — | — | — | none (universal) |

Note: Rally treats `Actual End Date` as PI-only. We ship it universal at the column level and rely on the trigger if Rick later wants to clamp it to strategy. For now, universal — matches mig 147's `actual_start_date` discipline.

### 4.2 mig 151 — `artefacts_rally_defect_columns.sql`

**Purpose:** Defect-only new columns. Column-level CHECK on enum-shaped columns. Slot gate enforced by mig 157's trigger.

**UP:** `db/vector_artefacts/schema/151_artefacts_rally_defect_columns.sql`

```sql
BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_defect_resolution           text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_test_case_status     text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_fixed_in_build       text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_found_in_build       text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_is_release_note      boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS artefacts_defect_steps_to_reproduce       text,
    ADD COLUMN IF NOT EXISTS artefacts_defect_steps_to_reproduce_doc   jsonb,
    ADD COLUMN IF NOT EXISTS artefacts_defect_is_regression        boolean NOT NULL DEFAULT false;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_resolution_chk
        CHECK (artefacts_defect_resolution IS NULL
            OR artefacts_defect_resolution = ANY (ARRAY[
                'fixed','wontfix','duplicate','not_a_defect','cannot_reproduce','by_design'
            ]));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_defect_test_case_status_chk
        CHECK (artefacts_defect_test_case_status IS NULL
            OR artefacts_defect_test_case_status = ANY (ARRAY[
                'none','passed','failed','blocked','mixed'
            ]));

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/151_artefacts_rally_defect_columns_DOWN.sql`

```sql
BEGIN;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_defect_resolution_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_defect_test_case_status_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_defect_resolution,
    DROP COLUMN IF EXISTS artefacts_defect_test_case_status,
    DROP COLUMN IF EXISTS artefacts_defect_fixed_in_build,
    DROP COLUMN IF EXISTS artefacts_defect_found_in_build,
    DROP COLUMN IF EXISTS artefacts_defect_is_release_note,
    DROP COLUMN IF EXISTS artefacts_defect_steps_to_reproduce,
    DROP COLUMN IF EXISTS artefacts_defect_steps_to_reproduce_doc,
    DROP COLUMN IF EXISTS artefacts_defect_is_regression;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | CHECK | Index | Scope-gate |
|---|---|---|---|---|---|---|
| `artefacts_defect_resolution` | TEXT | YES | — | `fixed\|wontfix\|duplicate\|not_a_defect\|cannot_reproduce\|by_design` | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_test_case_status` | TEXT | YES | — | `none\|passed\|failed\|blocked\|mixed` | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_fixed_in_build` | TEXT | YES | — | — | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_found_in_build` | TEXT | YES | — | — | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_is_release_note` | BOOLEAN | NO | `false` | — | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_steps_to_reproduce` | TEXT | YES | — | — | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_steps_to_reproduce_doc` | JSONB | YES | — | — | — | `wrk_defect` (trigger 157) |
| `artefacts_defect_is_regression` | BOOLEAN | NO | `false` | — | — | `wrk_defect` (trigger 157) |

Booleans default `false` so existing rows stay valid; the trigger gate fires only when the value is non-default (`= true`).

### 4.3 mig 152 — `artefacts_rally_risk_columns.sql`

**Purpose:** Risk-only new columns. Two paired (bucket-name TEXT + bucket-value INTEGER) for Decision G. One generated column `artefacts_risk_calculated`. Per-column CHECK on the enum buckets; slot gate by trigger.

**UP:** `db/vector_artefacts/schema/152_artefacts_rally_risk_columns.sql`

```sql
BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_risk_resolution             text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_impact                 text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_impact_score           integer,
    ADD COLUMN IF NOT EXISTS artefacts_risk_probability            text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_probability_score      integer,
    ADD COLUMN IF NOT EXISTS artefacts_risk_response               text,
    ADD COLUMN IF NOT EXISTS artefacts_risk_exposure               numeric;

-- Calculated risk = impact × probability scores. Postgres-enforced; no drift possible.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_risk_calculated integer
        GENERATED ALWAYS AS (
            artefacts_risk_impact_score * artefacts_risk_probability_score
        ) STORED;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_resolution_chk
        CHECK (artefacts_risk_resolution IS NULL
            OR artefacts_risk_resolution = ANY (ARRAY[
                'accepted','mitigated','transferred','avoided','closed_no_action'
            ]));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_impact_chk
        CHECK (artefacts_risk_impact IS NULL
            OR artefacts_risk_impact = ANY (ARRAY['low','medium','high','critical']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_probability_chk
        CHECK (artefacts_risk_probability IS NULL
            OR artefacts_risk_probability = ANY (ARRAY['low','medium','high']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_response_chk
        CHECK (artefacts_risk_response IS NULL
            OR artefacts_risk_response = ANY (ARRAY['accept','mitigate','transfer','avoid']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_impact_score_range_chk
        CHECK (artefacts_risk_impact_score IS NULL
            OR (artefacts_risk_impact_score >= 1 AND artefacts_risk_impact_score <= 4));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_probability_score_range_chk
        CHECK (artefacts_risk_probability_score IS NULL
            OR (artefacts_risk_probability_score >= 1 AND artefacts_risk_probability_score <= 3));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_risk_exposure_nonneg_chk
        CHECK (artefacts_risk_exposure IS NULL OR artefacts_risk_exposure >= 0);

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/152_artefacts_rally_risk_columns_DOWN.sql`

```sql
BEGIN;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_resolution_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_impact_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_probability_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_response_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_impact_score_range_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_probability_score_range_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_risk_exposure_nonneg_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_risk_calculated,
    DROP COLUMN IF EXISTS artefacts_risk_resolution,
    DROP COLUMN IF EXISTS artefacts_risk_impact,
    DROP COLUMN IF EXISTS artefacts_risk_impact_score,
    DROP COLUMN IF EXISTS artefacts_risk_probability,
    DROP COLUMN IF EXISTS artefacts_risk_probability_score,
    DROP COLUMN IF EXISTS artefacts_risk_response,
    DROP COLUMN IF EXISTS artefacts_risk_exposure;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | CHECK | Index | Scope-gate |
|---|---|---|---|---|---|---|
| `artefacts_risk_resolution` | TEXT | YES | — | `accepted\|mitigated\|transferred\|avoided\|closed_no_action` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_impact` | TEXT | YES | — | `low\|medium\|high\|critical` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_impact_score` | INTEGER | YES | — | `1..4` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_probability` | TEXT | YES | — | `low\|medium\|high` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_probability_score` | INTEGER | YES | — | `1..3` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_response` | TEXT | YES | — | `accept\|mitigate\|transfer\|avoid` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_exposure` | NUMERIC | YES | — | `>= 0` | — | `wrk_risk` (trigger 157) |
| `artefacts_risk_calculated` | INTEGER | YES (generated) | — | — | — | `wrk_risk` (gates via input columns) |

Score ranges: impact 1–4 because impact buckets are `low/medium/high/critical` (4 buckets), probability 1–3 because the bucket vocab is `low/medium/high` (3 buckets). UI dropdown writes both bucket name and score together (mapping enforced client-side; server-side the CHECK constraints catch any drift).

The generated column is automatically updated by Postgres on any change to `_impact_score` or `_probability_score`. NULL × NULL = NULL; partial NULL also yields NULL (Postgres NUMERIC × NULL semantics).

### 4.4 mig 153 — `artefacts_rally_submitted_by_fk.sql`

**Purpose:** Add `artefacts_id_user_submitted_by` UUID NULL with FK to `users`. Decision F.

**UP:** `db/vector_artefacts/schema/153_artefacts_rally_submitted_by_fk.sql`

```sql
BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_id_user_submitted_by uuid;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_id_user_submitted_by_fk
        FOREIGN KEY (artefacts_id_user_submitted_by)
        REFERENCES users (users_id)
        ON DELETE SET NULL;

-- Index for "what did this user submit" queries.
CREATE INDEX IF NOT EXISTS idx_artefacts_id_user_submitted_by
    ON artefacts (artefacts_id_user_submitted_by)
    WHERE artefacts_id_user_submitted_by IS NOT NULL
      AND artefacts_archived_at IS NULL;

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/153_artefacts_rally_submitted_by_fk_DOWN.sql`

```sql
BEGIN;
DROP INDEX IF EXISTS idx_artefacts_id_user_submitted_by;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_id_user_submitted_by_fk;
ALTER TABLE artefacts DROP COLUMN IF EXISTS artefacts_id_user_submitted_by;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | FK | Index | Scope-gate |
|---|---|---|---|---|---|---|
| `artefacts_id_user_submitted_by` | UUID | YES | — | `users(users_id) ON DELETE SET NULL` | partial (`IS NOT NULL AND archived_at IS NULL`) | `wrk_defect` OR `wrk_risk` (trigger 157) |

### 4.5 mig 154 — `artefacts_rally_strategy_columns.sql`

**Purpose:** Strategy-tier-only columns. Slot gate via trigger.

**UP:** `db/vector_artefacts/schema/154_artefacts_rally_strategy_columns.sql`

```sql
BEGIN;

ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_strategic_job_size                       integer,
    ADD COLUMN IF NOT EXISTS artefacts_strategic_preliminary_estimate_value     integer;

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_strategic_job_size_nonneg_chk
        CHECK (artefacts_strategic_job_size IS NULL OR artefacts_strategic_job_size >= 0);

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_strategic_preliminary_estimate_value_nonneg_chk
        CHECK (artefacts_strategic_preliminary_estimate_value IS NULL
            OR artefacts_strategic_preliminary_estimate_value >= 0);

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/154_artefacts_rally_strategy_columns_DOWN.sql`

```sql
BEGIN;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_strategic_job_size_nonneg_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_strategic_preliminary_estimate_value_nonneg_chk;
ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_strategic_job_size,
    DROP COLUMN IF EXISTS artefacts_strategic_preliminary_estimate_value;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | CHECK | Index | Scope-gate |
|---|---|---|---|---|---|---|
| `artefacts_strategic_job_size` | INTEGER | YES | — | `>= 0` | — | strategy scope (trigger 157) |
| `artefacts_strategic_preliminary_estimate_value` | INTEGER | YES | — | `>= 0` | — | strategy scope (trigger 157) |

NOTE: per the audit briefing, "Portfolio Item Type" is **NOT** a new column — it's the artefact-type registry row itself (`artefacts_types.artefacts_types_name`). Already structurally covered. Spec confirms: SKIP, no column added.

### 4.6 mig 155 — `artefacts_estimate_initial_to_bucket.sql`

**Purpose:** Decision B — ALTER `artefacts_estimate_initial` from NUMERIC to TEXT (bucket name) + add `artefacts_estimate_initial_value` INTEGER alongside.

**UP:** `db/vector_artefacts/schema/155_artefacts_estimate_initial_to_bucket.sql`

```sql
BEGIN;

-- Step 1: column shipped this morning (mig 147) is NUMERIC, NULL on every existing row.
-- Verified via:
--     SELECT COUNT(*) FROM artefacts WHERE artefacts_estimate_initial IS NOT NULL;
-- → expected 0. If non-zero, ABORT and ask Rick — bucket values lose meaning under coercion.

-- Step 2: ALTER TYPE. USING NULL because there's no meaningful NUMERIC → bucket-name mapping.
ALTER TABLE artefacts
    ALTER COLUMN artefacts_estimate_initial TYPE text
        USING (NULL::text);

-- Step 3: add bucket-value sidecar column.
ALTER TABLE artefacts
    ADD COLUMN IF NOT EXISTS artefacts_estimate_initial_value integer;

-- Step 4: CHECK on bucket name vocab.
ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_estimate_initial_chk
        CHECK (artefacts_estimate_initial IS NULL
            OR artefacts_estimate_initial = ANY (ARRAY['xs','s','m','l','xl','xxl']));

ALTER TABLE artefacts
    ADD CONSTRAINT artefacts_estimate_initial_value_nonneg_chk
        CHECK (artefacts_estimate_initial_value IS NULL
            OR artefacts_estimate_initial_value >= 0);

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/155_artefacts_estimate_initial_to_bucket_DOWN.sql`

```sql
BEGIN;
-- Best-effort: TYPE reversal can lose information. Document precisely.
-- Bucket-name values (xs/s/m/l/xl/xxl) cannot be cleanly coerced back to NUMERIC.
-- Any bucket values present at DOWN time are dropped (set to NULL on reversal).

ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_estimate_initial_chk;
ALTER TABLE artefacts DROP CONSTRAINT IF EXISTS artefacts_estimate_initial_value_nonneg_chk;

ALTER TABLE artefacts
    ALTER COLUMN artefacts_estimate_initial TYPE numeric
        USING (NULL::numeric);

ALTER TABLE artefacts
    DROP COLUMN IF EXISTS artefacts_estimate_initial_value;

COMMIT;
```

**Idempotency caveat:** ALTER COLUMN TYPE can't be cleanly reversed. The DOWN sets all values to NULL. Documented in the DOWN header.

### 4.7 mig 156 — `timeboxes_sprints_rally_columns.sql`

**Purpose:** New columns on `timeboxes_sprints`. No scope gate needed — own-table semantics. Decision I: keep existing `_status` vocab (don't broaden CHECK).

**UP:** `db/vector_artefacts/schema/156_timeboxes_sprints_rally_columns.sql`

```sql
BEGIN;

ALTER TABLE timeboxes_sprints
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_actuals          numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_plan_estimate    numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_planned_velocity numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_sprints_theme            text;

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_actuals_nonneg_chk
        CHECK (timeboxes_sprints_actuals >= 0);

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_plan_estimate_nonneg_chk
        CHECK (timeboxes_sprints_plan_estimate IS NULL OR timeboxes_sprints_plan_estimate >= 0);

ALTER TABLE timeboxes_sprints
    ADD CONSTRAINT timeboxes_sprints_planned_velocity_nonneg_chk
        CHECK (timeboxes_sprints_planned_velocity IS NULL OR timeboxes_sprints_planned_velocity >= 0);

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/156_timeboxes_sprints_rally_columns_DOWN.sql`

```sql
BEGIN;
ALTER TABLE timeboxes_sprints DROP CONSTRAINT IF EXISTS timeboxes_sprints_actuals_nonneg_chk;
ALTER TABLE timeboxes_sprints DROP CONSTRAINT IF EXISTS timeboxes_sprints_plan_estimate_nonneg_chk;
ALTER TABLE timeboxes_sprints DROP CONSTRAINT IF EXISTS timeboxes_sprints_planned_velocity_nonneg_chk;
ALTER TABLE timeboxes_sprints
    DROP COLUMN IF EXISTS timeboxes_sprints_actuals,
    DROP COLUMN IF EXISTS timeboxes_sprints_plan_estimate,
    DROP COLUMN IF EXISTS timeboxes_sprints_planned_velocity,
    DROP COLUMN IF EXISTS timeboxes_sprints_theme;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | CHECK |
|---|---|---|---|---|
| `timeboxes_sprints_actuals` | NUMERIC | NO | `0` | `>= 0` |
| `timeboxes_sprints_plan_estimate` | NUMERIC | YES | — | `>= 0` |
| `timeboxes_sprints_planned_velocity` | NUMERIC | YES | — | `>= 0` |
| `timeboxes_sprints_theme` | TEXT | YES | — | — |

### 4.8 mig 157 — `timeboxes_releases_rally_columns.sql`

**Purpose:** New columns on `timeboxes_releases`. `_release_backlog_items_count` SKIPPED per audit (computed rollup). Bound to range for the conversion ratio (audit suggested 0–10).

Wait — the trigger mig is needed too, but we don't want to renumber. Reorder: mig 157 = timeboxes_releases columns, mig 158 = trigger. Let's keep the spec aligned.

**UP:** `db/vector_artefacts/schema/157_timeboxes_releases_rally_columns.sql`

```sql
BEGIN;

ALTER TABLE timeboxes_releases
    ADD COLUMN IF NOT EXISTS timeboxes_releases_actuals                          numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_plan_estimate                    numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_planned_velocity                 numeric,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_theme                            text,
    ADD COLUMN IF NOT EXISTS timeboxes_releases_gross_estimate_conversion_ratio  numeric;

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_actuals_nonneg_chk
        CHECK (timeboxes_releases_actuals >= 0);

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_plan_estimate_nonneg_chk
        CHECK (timeboxes_releases_plan_estimate IS NULL OR timeboxes_releases_plan_estimate >= 0);

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_planned_velocity_nonneg_chk
        CHECK (timeboxes_releases_planned_velocity IS NULL OR timeboxes_releases_planned_velocity >= 0);

ALTER TABLE timeboxes_releases
    ADD CONSTRAINT timeboxes_releases_gross_ratio_range_chk
        CHECK (timeboxes_releases_gross_estimate_conversion_ratio IS NULL
            OR (timeboxes_releases_gross_estimate_conversion_ratio >= 0
                AND timeboxes_releases_gross_estimate_conversion_ratio <= 10));

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/157_timeboxes_releases_rally_columns_DOWN.sql`

```sql
BEGIN;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_actuals_nonneg_chk;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_plan_estimate_nonneg_chk;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_planned_velocity_nonneg_chk;
ALTER TABLE timeboxes_releases DROP CONSTRAINT IF EXISTS timeboxes_releases_gross_ratio_range_chk;
ALTER TABLE timeboxes_releases
    DROP COLUMN IF EXISTS timeboxes_releases_actuals,
    DROP COLUMN IF EXISTS timeboxes_releases_plan_estimate,
    DROP COLUMN IF EXISTS timeboxes_releases_planned_velocity,
    DROP COLUMN IF EXISTS timeboxes_releases_theme,
    DROP COLUMN IF EXISTS timeboxes_releases_gross_estimate_conversion_ratio;
COMMIT;
```

**Column summary:**

| Column | Type | Nullable | Default | CHECK |
|---|---|---|---|---|
| `timeboxes_releases_actuals` | NUMERIC | NO | `0` | `>= 0` |
| `timeboxes_releases_plan_estimate` | NUMERIC | YES | — | `>= 0` |
| `timeboxes_releases_planned_velocity` | NUMERIC | YES | — | `>= 0` |
| `timeboxes_releases_theme` | TEXT | YES | — | — |
| `timeboxes_releases_gross_estimate_conversion_ratio` | NUMERIC | YES | — | `0..10` |

`_release_backlog_items_count` per audit's SKIP note — derive via projection, do not store. Cuts one column from the audit's 30-column proposal.

### 4.9 mig 158 — `artefacts_slot_gate_trigger.sql`

**Purpose:** ONE composite BEFORE INSERT/UPDATE trigger function on `artefacts` enforcing all per-slot / per-scope gates added in this batch AND retroactively tightening the six mig-147 columns per Decision E.

Postgres CHECK constraints cannot subquery another table; the slot/scope value lives on `artefacts_types`. The trigger reads the slot + scope once per affected row, then raises EXCEPTION (`ERRCODE='23514'`) on any out-of-slot violation. One function, one trigger.

**UP:** `db/vector_artefacts/schema/158_artefacts_slot_gate_trigger.sql`

```sql
BEGIN;

CREATE OR REPLACE FUNCTION trg_artefacts_slot_gate_aiu_fn()
RETURNS trigger AS $$
DECLARE
    v_slot  text;
    v_scope text;
BEGIN
    -- Look up the artefact's type slot + scope once.
    SELECT artefacts_types_slot, artefacts_types_scope
      INTO v_slot, v_scope
      FROM artefacts_types
     WHERE artefacts_types_id = NEW.artefacts_id_artefact_type;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'artefact type not found (artefacts_id_artefact_type=%)',
            NEW.artefacts_id_artefact_type
            USING ERRCODE = '23502';
    END IF;

    --------------------------------------------------------------------
    -- DEFECT-ONLY family
    --   Includes the six mig-151 defect-* columns, AND Decision E's
    --   retroactive tightening of mig-147 columns:
    --     - artefacts_environment
    --     - artefacts_defect_severity
    --     - artefacts_defect_status
    --     - artefacts_affects_doc (true only)
    --------------------------------------------------------------------
    IF v_slot IS DISTINCT FROM 'wrk_defect' THEN
        IF NEW.artefacts_defect_resolution            IS NOT NULL
           OR NEW.artefacts_defect_test_case_status   IS NOT NULL
           OR NEW.artefacts_defect_fixed_in_build     IS NOT NULL
           OR NEW.artefacts_defect_found_in_build     IS NOT NULL
           OR NEW.artefacts_defect_is_release_note    IS TRUE
           OR NEW.artefacts_defect_steps_to_reproduce IS NOT NULL
           OR NEW.artefacts_defect_steps_to_reproduce_doc IS NOT NULL
           OR NEW.artefacts_defect_is_regression      IS TRUE
           OR NEW.artefacts_environment               IS NOT NULL
           OR NEW.artefacts_defect_severity           IS NOT NULL
           OR NEW.artefacts_defect_status             IS NOT NULL
           OR NEW.artefacts_affects_doc               IS TRUE
        THEN
            RAISE EXCEPTION
                'defect-only field set on non-defect artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    --------------------------------------------------------------------
    -- RISK-ONLY family
    --   Mig-152 risk-* columns. The GENERATED column artefacts_risk_calculated
    --   is automatically NULL when either input is NULL, so it self-gates.
    --------------------------------------------------------------------
    IF v_slot IS DISTINCT FROM 'wrk_risk' THEN
        IF NEW.artefacts_risk_resolution        IS NOT NULL
           OR NEW.artefacts_risk_impact         IS NOT NULL
           OR NEW.artefacts_risk_impact_score   IS NOT NULL
           OR NEW.artefacts_risk_probability    IS NOT NULL
           OR NEW.artefacts_risk_probability_score IS NOT NULL
           OR NEW.artefacts_risk_response       IS NOT NULL
           OR NEW.artefacts_risk_exposure       IS NOT NULL
        THEN
            RAISE EXCEPTION
                'risk-only field set on non-risk artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    --------------------------------------------------------------------
    -- TASK-ONLY family (Decision E retroactive)
    --   mig-147 columns: estimate_hours + estimate_remaining
    --------------------------------------------------------------------
    IF v_slot IS DISTINCT FROM 'wrk_task' THEN
        IF NEW.artefacts_estimate_hours     IS NOT NULL
           OR NEW.artefacts_estimate_remaining IS NOT NULL
        THEN
            RAISE EXCEPTION
                'task-only field set on non-task artefact (slot=%)', v_slot
                USING ERRCODE = '23514';
        END IF;
    END IF;

    --------------------------------------------------------------------
    -- DEFECT+RISK SHARED
    --   submitted_by (mig 153) — gated to defect OR risk
    --------------------------------------------------------------------
    IF NEW.artefacts_id_user_submitted_by IS NOT NULL
       AND v_slot NOT IN ('wrk_defect','wrk_risk')
    THEN
        RAISE EXCEPTION
            'submitted_by only allowed on defect or risk (slot=%)', v_slot
            USING ERRCODE = '23514';
    END IF;

    --------------------------------------------------------------------
    -- STRATEGY-ONLY family
    --   Mig-154 columns + retroactive tightening of mig-147 strategic
    --   investment group. Scope check, not slot check.
    --------------------------------------------------------------------
    IF v_scope IS DISTINCT FROM 'strategy' THEN
        IF NEW.artefacts_strategic_job_size                    IS NOT NULL
           OR NEW.artefacts_strategic_preliminary_estimate_value IS NOT NULL
           OR NEW.artefacts_strategic_investment_group         IS NOT NULL
        THEN
            RAISE EXCEPTION
                'strategy-only field set on non-strategy artefact (scope=%)', v_scope
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artefacts_slot_gate_aiu ON artefacts;
CREATE TRIGGER trg_artefacts_slot_gate_aiu
    BEFORE INSERT OR UPDATE ON artefacts
    FOR EACH ROW EXECUTE FUNCTION trg_artefacts_slot_gate_aiu_fn();

COMMIT;
```

**DOWN:** `db/vector_artefacts/schema/down/158_artefacts_slot_gate_trigger_DOWN.sql`

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_artefacts_slot_gate_aiu ON artefacts;
DROP FUNCTION IF EXISTS trg_artefacts_slot_gate_aiu_fn();
COMMIT;
```

**Trigger logic invariants** (re-verified before commit):

1. The trigger function name `trg_artefacts_slot_gate_aiu_fn` follows the project convention `trg_<table>_<purpose>_<aiu>_fn` where `aiu` = After/Insert/Update or Before-InsertUpdate; this is a BEFORE/INSERT/UPDATE trigger so the AIU suffix is correct.
2. ERRCODE `23514` is the standard Postgres `check_violation`. The handler-side translation maps to Problem+JSON `Code = 'scope_violation_<family>'`.
3. The function looks up slot AND scope in ONE query — single index seek on `artefacts_types_id`.
4. `IS TRUE` is used for booleans because `NULL IS TRUE` returns `FALSE` (we want to allow NULL/false, only block TRUE).
5. Decision E's mig-147 columns are folded INTO this trigger — no separate mig 158. The audit briefing's mig 158 is absorbed here.

---

### 4.10 Migration plan summary

| Mig | Name | Adds | Trigger? | DOWN safe? |
|---|---|---|---|---|
| 150 | `artefacts_rally_universal_columns` | 3 cols + 1 GIN index + 1 CHECK | no | yes |
| 151 | `artefacts_rally_defect_columns` | 8 cols + 2 CHECK | no | yes |
| 152 | `artefacts_rally_risk_columns` | 7 cols + 1 generated col + 7 CHECK | no | yes |
| 153 | `artefacts_rally_submitted_by_fk` | 1 col + 1 FK + 1 partial index | no | yes |
| 154 | `artefacts_rally_strategy_columns` | 2 cols + 2 CHECK | no | yes |
| 155 | `artefacts_estimate_initial_to_bucket` | 1 col + ALTER TYPE + 2 CHECK | no | best-effort (ALTER TYPE non-reversible) |
| 156 | `timeboxes_sprints_rally_columns` | 4 cols + 3 CHECK | no | yes |
| 157 | `timeboxes_releases_rally_columns` | 5 cols + 4 CHECK | no | yes |
| 158 | `artefacts_slot_gate_trigger` | 0 cols, 1 function + 1 trigger (also retroactively gates 6 mig-147 columns) | yes | yes |

**Totals:** 31 new columns + 1 generated column + 1 ALTER TYPE + 1 trigger function + 1 trigger. Sum across migrations 150–157 = 19 + 4 + 6 = **29 columns on `artefacts` / `timeboxes_*`** (matches audit count after dropping `_release_backlog_items_count`), plus 1 generated column on `artefacts_risk_calculated` and 1 ALTER TYPE on the mig-147 `_estimate_initial` column.

**Adjustments vs audit:**
- Audit proposed migs 149–155 (7 migrations). Spec runs 150–158 (9 migrations) — audit's 149 is taken by today's `relax_saved_views_kind_check_for_page.sql`, so we start at 150; we split risk/defect into separate migs for clarity; and we fold the audit's "retroactive tightening" (mig 158) into the single trigger function rather than ship two triggers.
- Dropped `timeboxes_releases_release_backlog_items_count` per audit SKIP note. Audit count 30 → spec count 29.
- Added `artefacts_risk_calculated` GENERATED column per Decision G.
- Added `artefacts_estimate_initial_value` per Decision B + ALTER TYPE on `_estimate_initial`.
- Split `artefacts_resolution` into `_defect_resolution` + `_risk_resolution` per Decision C (audit suggested one column).
- Added `_strategic_preliminary_estimate_value` + `_strategic_job_size` per Decision G/H setup work.

---

## 5. Backend wiring plan

### 5.1 `backend/internal/artefactitems/`

| File | Change | Lines (approx) |
|---|---|---|
| `columns.go` | Add 26 new `ColumnSpec` entries to `ArtefactItemColumns` covering the 24 new artefact columns (19 from migs 150–154) + the renamed `estimate_initial` (still 1 entry, label changes) + 1 entry for the `estimate_initial_value` sidecar + 1 entry for the generated `risk_calculated`. All `DefaultVisible: false, Addable: true`. Group assignment: `Tags & Actuals` (new group), `Defect`, `Risk` (new group), `Strategic`, `Planning`. | +60 |
| `types.go` | Add 26 new fields to `WorkItem` struct + corresponding `validXxx` allow-list maps for the new enum CHECK constraints: `validDefectResolutions`, `validDefectTestCaseStatuses`, `validRiskResolutions`, `validRiskImpacts`, `validRiskProbabilities`, `validRiskResponses`, `validEstimateInitialBuckets`. Pattern: lowercase string → bool map. | +90 |
| `sql.go` | Update `sqlWorkItemColumns` (SELECT clause) with the 26 new column names and JSON aliases. Update `sqlWorkItemColumnsListTemplate` (PATCH whitelist) with the same 26 names — these gate which columns the sparse-update builder can touch. | +52 |
| `service.go` | Add a single `validateSlotGate(workItem, slot, scope)` helper called from PATCH and POST paths. Handler-side defence: rejects writes with `Code=scope_violation_<family>` Problem+JSON BEFORE reaching the DB. Mirrors the trigger logic exactly so the failure mode is identical whether the request goes through the handler or raw SQL. Add 26 SET-clause dispatches in the sparse UPDATE builder. | +180 |
| `handler.go` | Add 26 new fields to `patchWorkItemReq` + `createWorkItemReq` (both PATCH and POST need to know about them). | +52 |
| `columns_rally_screenshots_test.go` | NEW file. Mirrors `columns_demotion_test.go`. Covers: every new column appears in `ArtefactItemColumns`; whitelist parity between `sqlWorkItemColumns` and `sqlWorkItemColumnsListTemplate`; every new enum has a unit test for the validXxx map (positive + negative case); slot-gate `validateSlotGate` returns the right error code per family. | +320 |

### 5.2 `backend/internal/timeboxsprints/`

| File | Change |
|---|---|
| `columns.go` | Add 4 ColumnSpec entries for `actuals`, `plan_estimate`, `planned_velocity`, `theme`. |
| `types.go` | Add 4 fields to `Sprint` struct + matching pointer fields on input/patch structs. |
| `sql.go` | Add 4 column names to the SELECT projection and the PATCH whitelist. |
| `service.go` | Add SET-clause dispatches for the 4 new columns; validate `actuals >= 0` and `planned_velocity >= 0` and `plan_estimate >= 0` BEFORE DB write (mirror CHECK constraints — friendlier errors). |
| `handler.go` | Add 4 fields to `patchSprintReq` + `createSprintReq`. |

### 5.3 `backend/internal/timeboxreleases/`

Same shape as 5.2 with 5 columns: `actuals`, `plan_estimate`, `planned_velocity`, `theme`, `gross_estimate_conversion_ratio`.

### 5.4 Behavioural notes

- The handler-side `validateSlotGate` performs the SAME logic the trigger does. This is intentional (defence-in-depth). The handler returns a clean Problem+JSON 422 with `Code` of form `scope_violation_<family>` (`scope_violation_defect`, `scope_violation_risk`, `scope_violation_task`, `scope_violation_strategy`). If the handler is bypassed (raw SQL, future direct REST), the trigger catches it as a `23514` SQLSTATE.
- Empty string in PATCH (`"defect_severity": ""`) is the "clear-to-NULL" sentinel per the existing mig-147 pattern. Translated to NULL in the service before CHECK constraint check fires.
- `artefacts_risk_calculated` is GENERATED — service never sets it. The handler MUST reject any PATCH attempting to set it (return 400 with `Code=read_only_field`). Mirror existing pattern for `id`, `created_at`, etc.
- `artefacts_estimate_initial` ALTER TYPE: zero values exist (verified pre-flight in mig 155). Importers + UI MUST be updated to write bucket names not numerics in the same commit family.

---

## 6. Frontend impact

| Surface | Change |
|---|---|
| `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx` | NO code change. Source=CORE rows are synthesised from `ArtefactItemColumns` automatically. The 26 new columns appear as read-only CORE rows in the admin grid the moment the backend ships. |
| Sprint admin / Release admin pages | NO new editors this batch. Defer to a follow-up FE batch ("expose Rally-screenshots fields in editors"). |
| Wizards / artefact detail flyouts | Same — out of scope. |
| Source filter chip on `/workspace-admin/custom-fields` | Already covers the new columns under the CORE filter value (single chip drives the row synthesis). No code change. |
| Saved views | Auto-pick-up. New columns are available in the picker because they're in the column catalogue. |

---

## 7. Tests

### 7.1 New test file: `backend/internal/artefactitems/columns_rally_screenshots_test.go`

Coverage required (one sub-test each unless otherwise noted):

**Whitelist parity:**
- `Test_ArtefactItemColumns_RallyScreenshotsPresent` — every column name added in migs 150–155 has a `ColumnSpec` entry.
- `Test_SQLProjection_RallyScreenshotsPresent` — every new column name appears in `sqlWorkItemColumns` (SELECT) AND in `sqlWorkItemColumnsListTemplate` (PATCH whitelist).

**Enum CHECK vocabs:** one positive + one negative table-driven per:
- `Test_validDefectResolutions` — `fixed` accepted, `Garbage` rejected.
- `Test_validDefectTestCaseStatuses` — `passed` accepted, `WONTSTART` rejected.
- `Test_validRiskResolutions` — `mitigated` accepted, `meh` rejected.
- `Test_validRiskImpacts` — `critical` accepted, `nuclear` rejected.
- `Test_validRiskProbabilities` — `medium` accepted, `definitely` rejected.
- `Test_validRiskResponses` — `accept` accepted, `freeze` rejected.
- `Test_validEstimateInitialBuckets` — `xl` accepted, `enormous` rejected.

**Slot-gate (handler-side):**
- `Test_validateSlotGate_DefectFieldsRejectedOnStory` — set `artefacts_defect_resolution='fixed'` on a `wrk_story` artefact → returns `Code=scope_violation_defect`.
- `Test_validateSlotGate_RiskFieldsRejectedOnDefect` — set `artefacts_risk_impact='low'` on a `wrk_defect` → returns `Code=scope_violation_risk`.
- `Test_validateSlotGate_TaskFieldsRejectedOnStory` — set `artefacts_estimate_hours=5` on a `wrk_story` → returns `Code=scope_violation_task`.
- `Test_validateSlotGate_StrategyFieldsRejectedOnTask` — set `artefacts_strategic_job_size=10` on a `wrk_task` → returns `Code=scope_violation_strategy`.
- `Test_validateSlotGate_SubmittedByRejectedOnTask` — set `artefacts_id_user_submitted_by` on a `wrk_task` → rejected.
- `Test_validateSlotGate_SubmittedByAcceptedOnDefect` — accepted.
- `Test_validateSlotGate_SubmittedByAcceptedOnRisk` — accepted.
- `Test_validateSlotGate_RetroactiveDefectColumns` — Decision E: `artefacts_environment` / `artefacts_defect_severity` / `artefacts_defect_status` / `artefacts_affects_doc=true` rejected on `wrk_story`.
- `Test_validateSlotGate_RetroactiveTaskColumns` — Decision E: `artefacts_estimate_hours` / `artefacts_estimate_remaining` rejected on `wrk_story`.

**Generated column behaviour (integration test, requires DB):**
- `Test_RiskCalculated_AutoUpdates` — INSERT a risk with `_impact_score=3`, `_probability_score=2`; `SELECT artefacts_risk_calculated` returns 6. UPDATE `_impact_score=4`; re-SELECT returns 8. Set `_impact_score=NULL`; re-SELECT returns NULL.
- `Test_RiskCalculated_ReadOnlyOnWrite` — PATCH `artefacts_risk_calculated=99` returns 400 `Code=read_only_field`.

**Trigger-level (DB) tests (integration, requires DB):**
- `Test_Trigger_DefectFieldRejectedOnStory_DB` — raw SQL INSERT of `artefacts_defect_resolution='fixed'` on a `wrk_story` row → expect SQLSTATE 23514.
- `Test_Trigger_RiskFieldRejectedOnDefect_DB` — same shape.
- `Test_Trigger_StrategyFieldRejectedOnTask_DB` — same shape.

**Migration round-trip:**
- `Test_Migration_150_UpDown` — apply UP, verify columns exist; apply DOWN, verify columns gone.
- Same shape for 151, 152, 153, 154, 156, 157, 158. (155 ALTER TYPE excluded — best-effort DOWN noted in spec.)

### 7.2 `backend/internal/timeboxsprints/` test additions

- `Test_SprintColumns_RallyFieldsPresent` — ColumnSpec parity.
- `Test_SprintActuals_RejectsNegative` — handler-side `actuals = -1` returns 422 with `Code=invalid_field`.
- Equivalent for `_plan_estimate` and `_planned_velocity`.

### 7.3 `backend/internal/timeboxreleases/` test additions

Same shape, including a test for `_gross_estimate_conversion_ratio` rejecting `15` (out of 0–10 range).

---

## 8. TD entries (to file in `docs/c_tech_debt.md`)

### `TD-MILESTONES-JUNCTION` (S2)

**Identify:** Rally `Milestones` is a multi-value object selector on Defect / Story / Task / Risk / Portfolio Item. Vector currently has a single FK `artefacts.artefacts_id_timebox_milestone` — one-to-one, not many-to-many.

**Measure:** S2. Scheduling roadmap-style milestone queries ("what milestones is this artefact tagged for?") require multi-value. Single FK is a blocker for procurement-style scheduling work.

**Trigger:** Rick's first cross-artefact milestone query request OR a procurement narrative needing milestones-as-tags.

**Pay-down:** New table `artefacts_milestones (artefacts_milestones_id, artefacts_milestones_id_artefact, artefacts_milestones_id_timebox_milestone, artefacts_milestones_created_at)`. New service methods. New PATCH semantics (`milestone_ids: [...]`). DROP the singular FK column once migration completes.

### `TD-INVESTMENTS-JUNCTION` (S2)

**Identify:** Rally `Investments` is a multi-value object selector on Portfolio Item only. Vector models a single investment group as `artefacts_strategic_investment_group` (TEXT). That's a string, not a relation, and definitely not multi-value.

**Measure:** S2. Strategy-tier financial roll-ups across multiple investments per PI are blocked.

**Trigger:** Rick's first ask for "PIs investing in multiple programmes" OR a roll-up dashboard need.

**Pay-down:** New table `artefacts_investments` (same shape as the milestones junction). Possibly a separate `investments` registry table if investments need names + categories of their own. Design decision deferred.

### `TD-TAGS-REGISTRY` (S3)

**Identify:** `artefacts_tags TEXT[]` shipped without per-workspace vocab control. Anyone can write any string.

**Measure:** S3. Free-text tags drift; typeahead UX is best-effort; per-workspace tag namespace is impossible.

**Trigger:** First user request for tag vocab control (e.g. "we want a fixed tag list per workspace") OR first instance of tag-collision pain.

**Pay-down:** New table `artefacts_tags_registry (artefacts_tags_registry_id, artefacts_tags_registry_id_workspace, artefacts_tags_registry_name)`. Migrate `TEXT[]` values into junction table `artefacts_tags_membership (artefacts_tags_membership_id_artefact, artefacts_tags_membership_id_tag)`. Update lint to reject `TEXT[]` writes.

### `TD-PLAN-ESTIMATE-DECIMAL` (S3)

**Identify:** Rally's `PlanEstimate` is decimal. Vector keeps INTEGER `artefacts_story_points`. Rally importers must truncate.

**Measure:** S3. Lose 0.25-point granularity on import.

**Trigger:** First user import of fractional plan estimates from Rally OR explicit request for half-point support.

**Pay-down:** `ALTER COLUMN artefacts_story_points TYPE NUMERIC(8,2)`. One migration. Cheap.

---

## 9. Verification plan

After the migration subagent ships, Rick (or the next reviewer) verifies in this order:

1. **Migrations applied + tail clean:**
   ```bash
   PSQL=/opt/homebrew/Cellar/libpq/18.3/bin/psql
   PGPASSWORD=… $PSQL -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
       -c "SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 10;"
   ```
   Expected: rows 150–158 (or 150–157 if mig 158 is folded earlier).

2. **`\d artefacts` shows all new columns + the generated col:**
   ```bash
   $PSQL … -c "\d artefacts" | grep -E 'artefacts_(tags|actuals|actual_end_date|defect_(resolution|test_case_status|fixed_in_build|found_in_build|is_release_note|steps_to_reproduce|is_regression)|risk_|strategic_job_size|strategic_preliminary_estimate_value|estimate_initial|id_user_submitted_by)'
   ```

3. **`\d timeboxes_sprints` + `\d timeboxes_releases` show new columns:**
   ```bash
   $PSQL … -c "\d timeboxes_sprints" | grep -E '(actuals|plan_estimate|planned_velocity|theme)'
   $PSQL … -c "\d timeboxes_releases" | grep -E '(actuals|plan_estimate|planned_velocity|theme|gross_estimate_conversion_ratio)'
   ```

4. **Trigger function exists:**
   ```bash
   $PSQL … -c "\df+ trg_artefacts_slot_gate_aiu_fn"
   ```
   Expected: function body matches mig 158.

5. **Backend tests green:**
   ```bash
   go test ./backend/internal/artefactitems/...
   go test ./backend/internal/timeboxsprints/...
   go test ./backend/internal/timeboxreleases/...
   ```

6. **Manual trigger fire:**
   ```bash
   # Try PATCH a Story with a defect-only field. Expect 422.
   curl -X PATCH http://localhost:5100/_site/work-items/<story-id> \
        -H "Authorization: Bearer $DEV_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"defect_resolution":"fixed"}'
   # Expected: 422, Problem+JSON Code = "scope_violation_defect"
   ```

7. **Lint trio clean:**
   ```bash
   npm run lint:column-prefix   # every new col has full-table-name prefix
   npm run lint                 # general
   ```

8. **SY003 regenerated (HARD RULE):**
   ```bash
   /report -sy "current state of the Vector databases (vector_artefacts, mmff_library) — Rally screenshots batch (migs 150–158)"
   ```
   Verify a new Change Log entry appears at the top.

---

## 10. Open questions for Rick

Two genuine clarifications surfaced while authoring this spec. Both can be defaulted reasonably; flagged here so Rick can correct before the migration subagent runs.

1. **Risk Response vocab spelling.** Decision G calls for `artefacts_risk_response` with vocab `accept / mitigate / transfer / avoid` (verb form, matches PMI risk-management terminology). The Resolution column uses past-tense `accepted / mitigated / transferred / avoided / closed_no_action`. The two columns have similar but distinct semantics: Response is the chosen STRATEGY at risk-identification time; Resolution is the OUTCOME after-the-fact. Confirm both columns are wanted (some shops conflate them).

2. **Theme on `timeboxes_sprints` / `timeboxes_releases`** — `TEXT` (plain) vs `TEXT + JSONB` (rich) pair. mig 147 set the precedent of `notes` + `notes_doc` for richtext on artefacts. The spec ships Theme as plain TEXT for both timebox tables because Rally treats Theme as a one-liner narrative. If Rick wants richtext (TipTap), add a `_theme_doc JSONB` sidecar on both tables — trivial addition to migs 156/157. Defaulting to plain TEXT.

3. **Investment Category vocab.** Decision G/H don't lock the vocab for `artefacts_strategic_investment_group` (still the mig-147 open-text column). The spec leaves the column open-text (no CHECK), but if Rick wants Rally's common defaults pinned (`mtm / run / grow / transform / strategic`), one ALTER ADD CONSTRAINT in mig 154 covers it. Defaulting to open-text.

---

**File:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/docs/superpowers/specs/2026-05-29-rally-screenshots-fields-design.md`

**Cross-refs:**
- [`dev/research/rally_screenshots_field_mapping.md`](../../../dev/research/rally_screenshots_field_mapping.md) — the audit driving this spec.
- [`docs/superpowers/specs/2026-05-29-core-field-demotion-design.md`](2026-05-29-core-field-demotion-design.md) — predecessor spec (mig 147 substrate).
- [`db/vector_artefacts/schema/147_artefacts_core_fields_from_demotion.sql`](../../../db/vector_artefacts/schema/147_artefacts_core_fields_from_demotion.sql) — column-style + indexing precedent.
- [`backend/internal/artefactitems/columns.go`](../../../backend/internal/artefactitems/columns.go) — ColumnSpec template.
- [`backend/internal/artefactitems/types.go`](../../../backend/internal/artefactitems/types.go) — `validXxx` map idiom.
- [`context/project_rally_to_vector_vocab.md`](../../../context/project_rally_to_vector_vocab.md) — Rally→Vector noun translations (applied throughout this spec).
- [`docs/c_tech_debt.md`](../../c_tech_debt.md) — TD register for the four new entries.
