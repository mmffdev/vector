# Second Demotion Catalogue Audit — 2026-05-29

**Source DB:** `vector_artefacts` (live, via tunnel `localhost:5435`)
**Inputs:** Rick's 13-item second-pass demotion list + `dev/research/rally_core_field_audit.md` + post-mig-146/147/148 substrate state.
**Method:** Read-only — `artefacts_fields_library` name/label search, `artefacts_types_fields` bindings join, `artefacts_fields_values` count per row, Rally cross-ref from local OpenAPI audit.

---

## Synopsis

**This list is mostly NOT-in-catalogue.** Of Rick's 13 items, only 7 have catalogue rows under the names he gave (and most are the `pi_*` / `us_*` Vector-prefixed variants from the original seed, not the clean names). The other 6 items (`labels`, `label_type`, `release`, `sprint`, `tags`, `work_accepted_date`) refer to concepts whose **only catalogue representation is the prefixed variant** — but `release` and `sprint` are already CORE on `artefacts` (`artefacts_id_timebox_release`, `artefacts_id_timebox_sprint`) so those catalogue rows are pure-archive demotions, not new columns. **Top scope-gating risk:** every item in this list except `labels`/`tags`/`release`/`work_accepted_date` is execution-tier-only (Defect, Story, Risk) — and Postgres CHECK constraints cannot subquery `artefacts_types.artefacts_types_scope` / `_slot`, so all the gating has to be **trigger-based or lint-only**. Recommend the demotion order opens with the safe universal fields (`work_accepted_date`, `release` already-done, `sprint` already-done, `labels`+`tags` merged), then defect-only (`steps_to_reproduce`, `regression`, `test_case_status`), then strategy-only (`strategic_investment_weight`, `value_stream_identifier`), and treats the entire `risk_*` family as **deferred** — they belong to the in-flight Risk artefact-type sidecar (PLA-0052), not flat columns on `artefacts`.

---

## Numbers summary

- **Total demotion-list items examined:** 13
- **Items with at least one matching catalogue row:** 12 (only `schedule_state` doesn't match the plain name — it lives only as `us_schedule_state`; treating that as a match below makes it 13/13)
- **Total catalogue rows touched by the search:** 24 (across 11 active + 13 archived)
- **Items NOT present as plain-name rows (need NEW core columns, not "demotion" in the strict sense):** `labels`, `label_type` (live as `lidentifier_*`), `release`, `sprint`, `tags`, `work_accepted_date`. 6 of 13.
- **Total `artefacts_fields_values` row count across all 24 catalogue rows:** **0** (clean — no backfill needed for any item).
- **Rows safe to archive cleanly (zero values + maps to an EXISTING `artefacts` column):** `release`-family + `sprint`-family + the entire `risk_*` family (deferred to PLA-0052) + `schedule_state` (Rick: DELETE) = ~10 catalogue rows.
- **Items needing NEW core columns on `artefacts`:** `labels` (TEXT[] or join), `label_type`, `regression`, `steps_to_reproduce`, `strategic_investment_weight`, `tags` (probably same column as labels — see cross-cutting analysis), `test_case_status`, `value_stream_identifier`, `work_accepted_date`. 9 candidate columns (or 8 if labels+tags merge).

---

## Per-field audit

### 1. labels — "all artefacts (multi-tag)"

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `d1cd660c-d0cc-4ba4-95c6-39f266d54d2d` | `pi_lidentifier_labels` | Labels | multiselect | tenant | NO |

No plain `labels` row exists. There's also a `lidentifier_type` (label-type) row and a now-archived `lidentifier_colour` family (handled in mig 146 — `lidentifier_colour` → `artefacts_colour`). The active `pi_lidentifier_labels` is the only "labels"-as-a-data-set surface.

**Bindings:** 1 — `Portfolio Item` (the now-ARCHIVED type, scope=work, no slot). So the row is bound to a dead type and is effectively orphaned. Universal/`labels` is not bound anywhere live.

**Value count:** 0.

**Rally cross-ref:** Rally treats labels-as-tags via `Tags` (Collection, many-to-many) on every artefact type. There is no per-artefact `Labels` attribute in the Rally schemas — Rally collapses labels into `Tags`. The `lidentifier_*` family is Vector's own renaming (per `rally_core_field_audit.md` §note 3 + §line 404).

**Proposed column:**
- Name: `artefacts_labels` TEXT[] NULL (Postgres array; GIN index for membership)
- OR a join table `artefacts_labels` with `(artefacts_id_artefact, artefacts_labels_label)` — Rally-correct, multi-tenant-safe, supports per-workspace controlled vocab if needed
- Nullable: YES
- Scope-gating: **universal** (Rick: "all artefacts") — no CHECK needed
- Indexes: GIN on the array column (`ON artefacts USING gin (artefacts_labels)`) OR partial b-tree on the join table

**Recommendation:** NEW. Combine with item 10 (`tags`) — see cross-cutting analysis §1. Archive the orphaned `pi_lidentifier_labels` catalogue row. Choice between TEXT[] (simpler) vs join table (Rally-correct) is a planning decision.

---

### 2. label_type — "all artefacts"

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `8c1c676e-3625-4c45-8362-004cc4095f3f` | `lidentifier_type` | Label Type | textbox | tenant | NO |
| `e403f5d3-40f9-421d-8cfe-f20024da656c` | `us_lidentifier_type` | Label Type | textbox | tenant | YES |

**Bindings:** `lidentifier_type` is bound to 2 active types — Defect (`wrk_defect`) + Risk (`wrk_risk`). NOT universal as Rick wants — currently scoped to two work-tier types only.

**Value count:** 0.

**Rally cross-ref:** No clean Rally analogue. Rally's `FormattedID` prefix carries the "type" semantically (e.g. "US123" vs "DE456") and `TestCase` has a `Type` string but for test-type categorisation, not for label-typing. Per `rally_core_field_audit.md` §line 425, this row was flagged KEEP-CUSTOM in pass 1.

**Proposed column:**
- Name: `artefacts_label_type` TEXT NULL
- Nullable: YES
- CHECK: enum is unknown — Rick's brief doesn't list values. If "label type" categorises the label vocab (e.g. `priority|category|component`), a CHECK is doable; if open-string, none.
- Scope-gating: universal per Rick. Currently bound to Defect+Risk only — the BACKFILL of existing field-values (zero, so nothing to move) + UNBINDING of the existing two types must happen in the demotion migration.

**Recommendation:** NEW. **OPEN QUESTION for Rick:** what does `label_type` actually represent? The label's category, the artefact's identifier-prefix style, or something else? Without knowing the controlled vocab the column shape is a guess.

---

### 3. regression — defects only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `9b46258c-89a6-45e6-8bcd-7a12a89507e0` | `regression` | Regression | boolean | tenant | NO |

**Bindings:** 1 — Defect (`wrk_defect`). Matches Rick's scope.

**Value count:** 0.

**Rally cross-ref:** Rally Defect schema does NOT carry a `Regression` boolean. Rally tracks regression-ness via Tag or via TestCase `Type` (per `rally_core_field_audit.md` §line 442) — i.e. there is no flat Rally attribute. Recommendation in pass 1 was KEEP-CUSTOM.

**Proposed column:**
- Name: `artefacts_is_regression` BOOLEAN NOT NULL DEFAULT false
- Nullable: NO (default false)
- CHECK: none (boolean)
- Index: partial `WHERE artefacts_is_regression = true AND artefacts_archived_at IS NULL` (mirror `idx_artefacts_id_subscription_expedite` pattern, ~5 of these now)
- Scope-gating: **Defect-only**. Cannot enforce via Postgres CHECK because CHECK can't subquery `artefacts_types`. Options:
  - **A. Trigger** — `BEFORE INSERT/UPDATE` raises `EXCEPTION` if `artefacts_is_regression IS NOT NULL` AND the row's `artefacts_id_artefact_type` is not a Defect slot. Authoritative.
  - **B. Application gate only** — `service.go` validates; DB is permissive. Cheaper but weaker.
  - **C. Lint-only** — like the existing `lint:no-direct-workspace-id` pattern. Cheapest, no runtime guard.
  - **Trade-off:** trigger is correct per "server is the gate" HARD RULE; lint is fine if the only writers are the Go service (which already validates type slots). **Recommend trigger** for defect-only fields shipped together (this + steps_to_reproduce + test_case_status).

**Recommendation:** NEW. Demote with defect-only scope guard via trigger.

---

### 4. release — all artefacts

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `07760201-9d04-44e9-ba22-a404cfe97bab` | `us_release_id` | Release | textbox | tenant | NO |

No plain `release` row. Only the `us_`-prefixed variant.

**Bindings:** 0 — orphaned, no live bindings.

**Value count:** 0.

**Rally cross-ref:** Rally `Release` exists on HR, Defect, Feature (PortfolioItem subtype) as a `ref:ReleaseRef`. Vector ALREADY models this **correctly** as `artefacts.artefacts_id_timebox_release` (uuid FK to `timeboxes_releases`, with index `idx_artefacts_id_timebox_release`).

**Proposed column:** **Already exists.** No new column needed.

**Recommendation:** DEMOTE-EXISTING. Archive `us_release_id`. No migration column-add needed — this is purely metadata cleanup, identical to the pattern used for `blocked`/`blocked_reason` in mig 146.

---

### 5. risk_* family — risks only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `a4c09e5b-b07d-415f-9164-2615c308ee97` | `pi_risk_impact` | Risk Impact | select | tenant | YES |
| `94d0729b-fcae-488e-8168-2c3504a26190` | `pi_risk_score` | Risk Score | decimal | tenant | YES |
| `011a83a1-ebc0-4b9e-ac02-ad3203fba2d6` | `risk_impact` | Risk Impact | select | tenant | NO |
| `9b591442-231a-4209-a4b1-52309481d3ba` | `risk_probability` | Risk Probability | select | tenant | NO |
| `57243538-d3de-4aac-ab8f-9396d49c1656` | `risk_score` | Risk Score | decimal | tenant | NO |
| `1ec189b6-69e0-4edd-92f6-5bb86dbe65d7` | `us_risk_impact` | Risk Impact | select | tenant | YES |
| `085cfac0-e7e8-4266-84f2-934bdd5a1ed5` | `us_risk_probability` | Risk Probability | select | tenant | YES |
| `551a85ca-1d78-4c72-8b4c-a5fa76df1872` | `us_risk_score` | Risk Score | decimal | tenant | YES |

3 active rows (`risk_impact`, `risk_probability`, `risk_score`) + 5 archived legacy variants. The plain-named active trio is what to act on.

**Bindings (active rows only):**
- `risk_impact` — 3 types: Defect, Portfolio Item (archived), Risk
- `risk_probability` — 2 types: Portfolio Item (archived), Risk
- `risk_score` — 3 types: Defect, Portfolio Item (archived), Risk

(Note: Rick says "all risks only" — current bindings include Defect, which contradicts the desired scope. Demotion must drop the Defect binding too.)

**Value counts:** all 0.

**Enum vocab (from `options_json`):**
- `risk_impact`: `["low","medium","high","critical"]`
- `risk_probability`: `["low","medium","high"]`
- `risk_score`: numeric (no enum)

**Rally cross-ref:** Rally treats risks as **first-class child artefacts** (PortfolioItem `Risks` is a `ref:Collection` of Risk objects), NOT as attributes on the parent. The only Rally PI attribute is `RiskScore` (integer). Per `rally_core_field_audit.md` §line 443-445 + §note 5, the right model is to put these on a Risk artefact-type sidecar.

**Proposed column:**
- **NONE on `artefacts`.** Per `rally_core_field_audit.md` recommendation + design spec §line 58 (`TD-RISKS-PROMOTE-WITH-PLA052`), this work waits for the Risk artefact-type build (PLA-0052).
- If forced to ship today: `artefacts_risk_impact` TEXT CHECK (low|medium|high|critical), `artefacts_risk_probability` TEXT CHECK (low|medium|high), `artefacts_risk_score` NUMERIC. All scope-gated to Risk only (trigger-based).

**Recommendation:** DEFER to PLA-0052. The catalogue rows can be archived NOW (zero values, no information loss) but the columns belong on `artefacts_risks` (or whatever the Risk-sidecar table becomes) not on the parent `artefacts`. **BLOCKER candidate** — needs Rick's call: archive-only now and wait for PLA-0052, or build the columns today and double-pay when PLA-0052 lands.

---

### 6. schedule_state — NOT USED, DELETE entirely

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `0950411b-9c56-4332-a109-4fd310091582` | `us_schedule_state` | Schedule State | select | tenant | NO |

No plain `schedule_state` row.

**Bindings:** 0.

**Value count:** 0.

**Enum vocab:** `["Defined","In-Progress","Completed","Accepted"]` — the classic Rally HR `ScheduleState` ladder.

**Rally cross-ref:** Rally HR + Defect both carry `ScheduleState` (string) with the canonical four values. Vector intentionally rejects this attribute in favour of the `flow_states` substrate (`artefacts.artefacts_id_flow_state` FK + `flows` + `flows_states` tables). Rick's call: DELETE.

**Proposed column:** NONE.

**Recommendation:** ARCHIVE. Clean — zero bindings, zero values, redundant with the flow-states substrate. Add to the next demotion migration.

---

### 7. sprint — all artefacts, execution-tier only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `028f4de5-a602-4274-ab49-d32f76b22fe5` | `us_sprint_id` | Sprint | textbox | tenant | NO |

No plain `sprint` row.

**Bindings:** 0 — orphaned.

**Value count:** 0.

**Rally cross-ref:** Rally `Iteration` exists on HR, Defect, Task as `ref:IterationRef`. Vector models this as `artefacts.artefacts_id_timebox_sprint` (uuid FK to `timeboxes_sprints`) + `artefacts.artefacts_timebox_sprint_label` (text denorm).

**Proposed column:** **Already exists.** `artefacts_id_timebox_sprint` is the FK, indexed.

**Scope-gating:** Rick says execution-tier only. The current column is universal (any artefact can have a sprint FK). The gating must be enforced on write — Rick's "execution-tier only" maps to `artefacts_types_scope='work'`. Strategy-tier types (Feature, Theme, Initiative, etc.) should not get a sprint FK. Options:
- A. Trigger: `BEFORE INSERT/UPDATE` raises if `artefacts_id_timebox_sprint IS NOT NULL` AND the row's type has scope='strategy'.
- B. Service-layer guard in `backend/internal/artefactitems/service.go` patch validator (already houses `validDefectSeverities` etc).
- C. Lint+migration-doc only.

**Recommendation:** DEMOTE-EXISTING (archive the catalogue row). Separately, file a **TD-SPRINT-EXEC-TIER-GATE** to add the execution-tier scope guard (trigger or service-layer) — the current column is universal but Rick wants it execution-only. Not strictly part of this catalogue cleanup but rides on the same diagnosis.

---

### 8. steps_to_reproduce — defects only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `c0b55473-176f-4e68-a816-83fb73b54bb1` | `steps_to_reproduce` | Steps to Reproduce | richtext | tenant | NO |

**Bindings:** 1 — Defect (`wrk_defect`). Matches Rick's scope.

**Value count:** 0.

**Rally cross-ref:** Rally Defect does NOT have a dedicated `StepsToReproduce` attribute — Rally uses free-form `Description`. Per `rally_core_field_audit.md` §line 446, pass 1 said KEEP-CUSTOM. Rick's second pass says core — Vector-specific decision, perfectly defensible (every defect tool has steps-to-reproduce as a first-class field).

**Proposed column:**
- Name: `artefacts_steps_to_reproduce` TEXT NULL + `artefacts_steps_to_reproduce_doc` JSONB NULL (mirror the `notes`/`notes_doc` + `description`/`description_doc` richtext-pair pattern)
- Nullable: YES
- CHECK: none (richtext)
- Index: none unless searched (likely it's in the `tsvector` GIN already — confirm in implementation)
- Scope-gating: **Defect-only**. Trigger-based (same approach as `regression`).

**Recommendation:** NEW. Bundle with `regression` + `test_case_status` in a single defect-fields migration with one shared trigger.

---

### 9. strategic_investment_weight — strategic artefacts only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `030ab7a3-fa45-41df-8172-feb5ff707b1c` | `pi_strategic_investment_weight` | Strategic Investment Weight | textbox | tenant | NO |

**Bindings:** 1 — Portfolio Item (ARCHIVED type). Effectively orphaned to a live type.

**Value count:** 0.

**Rally cross-ref:** Rally PI has several "value" attributes: `UserBusinessValue` (integer), `ValueScore` (integer), `WSJFScore` (number). Per `rally_core_field_audit.md` §line 438, pass 1 flagged this CORE-CANDIDATE — uncertain which Rally attribute is the right mapping.

**Proposed column:**
- Name: `artefacts_strategic_investment_weight` NUMERIC(10,2) NULL (or INTEGER if Rally `UserBusinessValue` is the model — Rally treats it as integer)
- Nullable: YES
- CHECK: optional `>= 0` (negative weight is nonsense)
- Scope-gating: **strategy-tier only** (`artefacts_types_scope='strategy'`). Trigger-based.

**Recommendation:** NEW. Bundle with item 12 (`value_stream_identifier`) — both are strategy-tier-only and ship together with one strategy-scope trigger. **Sub-question for Rick:** integer or decimal weight? Affects column type.

---

### 10. tags — all artefacts (multi-tag)

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `d54bf88e-a625-42dc-90ec-8de0f31f842c` | `pi_lidentifier_tags` | Tags | multiselect | tenant | NO |

No plain `tags` row.

**Bindings:** 1 — Portfolio Item (ARCHIVED type). Orphaned.

**Value count:** 0.

**Rally cross-ref:** Rally `Tags` exists on every artefact type as `ref:Collection` (many-to-many join). This is Rally's canonical many-to-many label substrate.

**Proposed column:** **See cross-cutting analysis §1 — likely merge with `labels` (item 1).** Same Rally type (`Tags` is the only Rally surface for labels/tags collectively). One column name wins.

**Recommendation:** NEW or MERGE. See §1 of cross-cutting analysis.

---

### 11. test_case_status — defects only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `50432e0c-2b02-4c06-a732-9ca0acf0553f` | `us_test_case_status` | Test Case Status | textbox | tenant | NO |

No plain `test_case_status` row.

**Bindings:** 0 — orphaned.

**Value count:** 0.

**Rally cross-ref:** Rally HR + Defect both have `TestCaseStatus` (string). Vector currently has no equivalent core column. Rick says defects-only — Rally has it on both HR and Defect.

**Proposed column:**
- Name: `artefacts_test_case_status` TEXT NULL (or `artefacts_defect_test_case_status` per design consistency with `artefacts_defect_severity` + `artefacts_defect_status` if defect-only — see cross-cutting analysis §5)
- Nullable: YES
- CHECK: enum unknown — Rally exposes string. Recommend `('NONE','PASSED','FAILED','BLOCKED','MIXED')` based on common test-case ladders, but **needs Rick's vocab decision**.
- Scope-gating: defect-only (trigger).

**Recommendation:** NEW. Vocab decision needed from Rick.

---

### 12. value_stream_identifier — strategic artefacts only

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `d9d84715-31eb-4600-9736-0a47995f2026` | `pi_value_stream_identifier` | Value Stream Identifier | textbox | tenant | NO |

**Bindings:** 1 — Portfolio Item (ARCHIVED type). Orphaned.

**Value count:** 0.

**Rally cross-ref:** No direct equivalent in core Rally PI schemas — Rally tracks value streams via the separate `VSMProductPortfolioItem` / `VSMMetricPortfolioItem` schemas (per `rally_core_field_audit.md` §line 440). Pass 1 flagged KEEP-CUSTOM.

**Proposed column:**
- Name: `artefacts_value_stream_identifier` TEXT NULL (free-text identifier; if VSM substrate becomes a real table later, this becomes the FK column)
- Nullable: YES
- CHECK: none
- Scope-gating: strategy-tier-only (trigger; same trigger as `strategic_investment_weight`).

**Recommendation:** NEW. Bundle with item 9 in a single strategy-fields migration.

---

### 13. work_accepted_date — all artefacts (timestamp)

**Catalogue row(s):**

| row_id | name | label | type | scope | archived |
|---|---|---|---|---|---|
| `603bc782-fc88-45d4-9432-94a4690bd599` | `pi_date_work_accepted` | Work Accepted Date | date | tenant | NO |

No plain `work_accepted_date` row.

**Bindings:** 1 — Portfolio Item (ARCHIVED type). Orphaned.

**Value count:** 0.

**Rally cross-ref:** Rally HR has `AcceptedDate` (string) — a per-story Rally attribute. PI subtypes don't have a direct `AcceptedDate` (closest: `LastRollupDate`). Per `rally_core_field_audit.md` §line 427+§note 7, pass 1 flagged CORE-CANDIDATE with a note that the `pi_` prefix is probably misleading — this is really an HR (Story) attribute that wandered into the PI namespace.

**Proposed column:**
- Name: `artefacts_work_accepted_at` TIMESTAMPTZ NULL (Rick says "timestamp" — so TZ-aware, not DATE)
- Nullable: YES
- CHECK: none
- Index: partial B-tree `WHERE artefacts_work_accepted_at IS NOT NULL AND artefacts_archived_at IS NULL` (likely useful for "stuff accepted in date range" queries)
- Scope-gating: universal per Rick. No gate needed.

**Recommendation:** NEW. Universal column — ships with the safe-universal batch (items 1+10 merged, 4 already done, 7 already done, 13).

---

## Cross-cutting analysis

### F.1 — `labels` vs `tags`

Both are Rick's verbatim items #1 and #10, both "all artefacts (multi-tag)", and the catalogue carries only `pi_lidentifier_labels` + `pi_lidentifier_tags` as the live representation. Rally collapses both into a single concept (`Tags`, `ref:Collection`) — Rally has no per-artefact `Labels` attribute.

**Recommendation: one column wins.** Rally calls it `Tags`. Vector's `lidentifier_*` family in the catalogue is Vector's own renaming. Three options:

- **A. Single `artefacts_tags` TEXT[]** — Rally name, simplest substrate, GIN index for membership, easy denormalisation. Drop both catalogue rows.
- **B. Single `artefacts_labels` TEXT[]** — Vector's preferred name (per the `lidentifier_*` family naming history). Same shape as A.
- **C. Separate `artefacts_labels` + `artefacts_tags` columns** — keeps both concepts distinct on the wire. Two columns, two indexes, double-pay forever. **Don't recommend** unless Rick has a model where labels and tags are semantically different (he hasn't said so).

**Lean: A or B, with the name being Rick's call.** I'd pick **`artefacts_tags`** because (a) Rally-correct, (b) "tags" is the universal industry term across JIRA/Linear/GitHub. Then archive both `pi_lidentifier_labels` + `pi_lidentifier_tags` catalogue rows in the same migration.

**Sub-decision: TEXT[] vs join table.** TEXT[] is faster to ship, GIN-indexes well for membership, but provides no controlled vocab / per-workspace tag registry. A join table (`artefacts_tags` with `(artefacts_id_artefact, artefacts_tags_tag)`) would let Vector ship a "tag registry per workspace" later. For shipping speed, **TEXT[] now, file TD-TAGS-REGISTRY for the join-table promotion** if vocab control becomes a need.

### F.2 — Risk family enumeration

Rows found and their disposition:

| row | status | bindings | values | recommendation |
|---|---|---|---|---|
| `risk_impact` | ACTIVE | 3 (Defect, PI archived, Risk) | 0 | ARCHIVE — belongs on Risk sidecar (PLA-0052) |
| `risk_probability` | ACTIVE | 2 (PI archived, Risk) | 0 | ARCHIVE — same |
| `risk_score` | ACTIVE | 3 (Defect, PI archived, Risk) | 0 | ARCHIVE — same |
| `pi_risk_impact` | ARCHIVED | 0 | 0 | already archived |
| `pi_risk_score` | ARCHIVED | 0 | 0 | already archived |
| `us_risk_impact` | ARCHIVED | 0 | 0 | already archived |
| `us_risk_probability` | ARCHIVED | 0 | 0 | already archived |
| `us_risk_score` | ARCHIVED | 0 | 0 | already archived |

**Recommendation:** archive the 3 active rows in the next demotion migration WITHOUT adding columns on `artefacts`. The Risk artefact-type design in `docs/c_c_risk_artefact_type.md` (PLA-0052) is the right home — it's mid-design and will likely ship a `artefacts_risks` sidecar or similar. Pre-empting it with flat columns on `artefacts` would create double-pay debt the moment PLA-0052 lands. File **TD-RISKS-PROMOTE-WITH-PLA052** (already named in the previous design spec §line 58).

**BLOCKER candidate** — needs Rick's explicit confirmation: archive-now-defer-columns, vs build-flat-now-and-migrate-when-PLA052-lands.

### F.3 — Scope-tier model

`artefacts_types` carries two scope-related columns:

1. **`artefacts_types_scope`** TEXT NOT NULL, CHECK `('work','strategy')` — the **primary tier discriminator**. This is the column to gate "execution-tier-only" vs "strategy-tier-only" fields against.
2. **`artefacts_types_slot`** TEXT NULL, CHECK `('wrk_epic','wrk_story','wrk_defect','wrk_task','wrk_risk')` — the **finer-grained execution-tier slot**. Used for "Defect only", "Story only", etc. Note: strategy-tier types have NULL slot.

The current live tally (active types only): 56 strategy, 100 work (split: 20 epic + 20 story + 20 defect + 20 task + 20 risk + 0 unslotted-work — actually 37 unslotted work in the previous query but those are pre-slot legacy types per the analysis).

**Recommendation for planning:**
- "all artefacts" gates: no scope check
- "execution-tier only" (Rick's `sprint` item): `artefacts_types_scope='work'`
- "strategic artefacts only" (Rick's `strategic_investment_weight`, `value_stream_identifier` items): `artefacts_types_scope='strategy'`
- "Defect only" (Rick's `regression`, `steps_to_reproduce`, `test_case_status` items): `artefacts_types_slot='wrk_defect'`
- "Risk only" (Rick's risk_* family): `artefacts_types_slot='wrk_risk'`

Postgres CHECK constraints **cannot subquery these**. Three enforcement options:
- **Trigger on `artefacts` BEFORE INSERT/UPDATE** — definitive, server-side gate. Recommended per "server is the gate" HARD RULE.
- **Service-layer validator** in `backend/internal/artefactitems/service.go` (already houses `validDefectSeverities`). Cheaper to write, weaker guarantee (raw SQL writes bypass it — but there are none in the Vector codebase per audit).
- **Lint + tests** — like the existing `sentinel_clamp_test.go` and `lint:no-direct-workspace-id`. Cheapest, no runtime guard. Acceptable IF every writer is known.

**Recommendation:** **trigger for the defect-only set + strategy-only set** (one trigger per scope group). Service-layer validators continue to provide friendly errors before the trigger fires. Lint is supplementary.

### F.4 — schedule_state special case

`us_schedule_state` (the only catalogue row for this concept): 0 bindings, 0 values, enum vocab present in `options_json` (`Defined|In-Progress|Completed|Accepted`). **Clean archive — no work to migrate.** Rick's instruction (DELETE entirely) is achievable by setting `archived_at`; no column add, no data move, no risk. Bundle in the next migration's archive list.

### F.5 — Defect-only fields (regression, steps_to_reproduce, test_case_status)

mig 147 (today) already established the `artefacts_defect_*` prefix for defect-only columns: `artefacts_defect_severity`, `artefacts_defect_status`. Two design choices for the new round:

- **A. Continue the `artefacts_defect_*` prefix** — `artefacts_defect_regression` (or `_is_regression`), `artefacts_defect_steps_to_reproduce`, `artefacts_defect_test_case_status`. Pros: groups defect-only fields visually + by prefix; aids the lint that enforces full-table-name prefix + scope alignment. Cons: longer column names; "regression" / "test case status" aren't always lexicographically obvious as defect-only.
- **B. Plain `artefacts_*` prefix** — `artefacts_is_regression`, `artefacts_steps_to_reproduce`, `artefacts_test_case_status`. Pros: simpler, shorter, matches Rally naming (Rally just calls them `Regression` etc.). Cons: scope-gate enforcement is harder to audit at a glance — looking at the column name alone you can't tell it's defect-only.

**Recommendation: A (continue `artefacts_defect_*` prefix).** Consistency with mig 147 wins, and the prefix becomes a self-documenting scope-tier hint. Apply the same logic for the strategy-only set: `artefacts_strategic_investment_weight` already lives on the table from mig 147; if Rick's new `strategic_investment_weight` item maps to it, **double-check whether mig 147's column already covers it** (the spec says yes — same column name). For `value_stream_identifier`, propose `artefacts_strategic_value_stream_identifier` to match the prefix convention.

**Caveat on item 9 — `strategic_investment_weight` may already exist.** mig 147 added `artefacts_strategic_investment_group` (TEXT). It did NOT add `artefacts_strategic_investment_weight`. So the demotion of `pi_strategic_investment_weight` IS new column work. Confirmed against `\d artefacts`.

---

## Next-step recommendations

### Demotion order (lowest risk → highest)

1. **Safe-universal batch** — archive-only catalogue rows + add universal columns. Ship first.
   - Archive `us_release_id` (release already core)
   - Archive `us_sprint_id` (sprint already core; file TD-SPRINT-EXEC-TIER-GATE for the scope guard)
   - Archive `pi_lidentifier_labels` + `pi_lidentifier_tags` AND add `artefacts_tags` TEXT[] with GIN index
   - Add `artefacts_work_accepted_at` TIMESTAMPTZ
   - Archive `us_schedule_state` (Rick: DELETE)

2. **Defect-only batch** — three new columns + one trigger.
   - Add `artefacts_defect_is_regression` BOOLEAN NOT NULL DEFAULT false + partial index
   - Add `artefacts_defect_steps_to_reproduce` TEXT + `artefacts_defect_steps_to_reproduce_doc` JSONB
   - Add `artefacts_defect_test_case_status` TEXT + CHECK constraint (vocab TBD by Rick)
   - One `BEFORE INSERT/UPDATE ON artefacts` trigger that raises if any of these are non-null AND the row's type slot is not `wrk_defect`
   - Archive `regression`, `steps_to_reproduce`, `us_test_case_status`

3. **Strategy-only batch** — two new columns + one trigger.
   - Add `artefacts_strategic_investment_weight` NUMERIC(10,2) (vocab Rick: integer or decimal?)
   - Add `artefacts_strategic_value_stream_identifier` TEXT
   - One trigger gating strategy-only columns to `artefacts_types_scope='strategy'`
   - Archive `pi_strategic_investment_weight`, `pi_value_stream_identifier`

4. **Risk family — DEFER.** Archive the 3 active risk_* rows but DO NOT add columns. File / refresh TD-RISKS-PROMOTE-WITH-PLA052. Columns belong on the Risk sidecar from PLA-0052.

5. **Label-type — DEFER OR ASK.** `label_type` semantics are ambiguous (label-category vs identifier-prefix-style vs something else). Block on Rick's vocab decision before column shape.

### Blocking decisions Rick should make before the build session

1. **Risks (item 5)** — archive-only now and wait for PLA-0052, or build flat columns on `artefacts` today and migrate when PLA-0052 lands?
2. **labels vs tags (items 1+10)** — single `artefacts_tags` TEXT[] column? Or separate label + tag columns? Or join table?
3. **label_type (item 2)** — what does it actually represent? Need vocab.
4. **test_case_status (item 11)** — what's the enum vocab? (Suggested default: `NONE|PASSED|FAILED|BLOCKED|MIXED`.)
5. **strategic_investment_weight (item 9)** — integer or decimal? Range?
6. **Sprint scope-gating (item 7)** — confirm the gate is "execution-tier" (`scope='work'`) and not a more specific slot set. The current FK is universal — does Rick want a strict guard or a service-layer warn-only check?

### Files to revisit during the build session

- `db/vector_artefacts/schema/` — next migration NNN sequence (149 or higher per `<migration>` skill)
- `backend/internal/artefactitems/columns.go` — add ColumnSpec entries for each new core column
- `backend/internal/artefactitems/types.go` — add `WorkItem` struct fields + validation maps for new enums
- `backend/internal/artefactitems/sql.go` — SELECT + PATCH whitelist updates
- `backend/internal/artefactitems/service.go` — defect/strategy scope validators
- `app/components/ObjectTreeV2/adapters/customFieldsAdapter.tsx` — synthesised CORE rows already wired; will pick up new columns from `/work-items/columns` automatically per the spec

### Don't forget

- HARD RULE: SY003 regen after substrate change
- HARD RULE: full-column-name prefix enforced by `lint:column-prefix`
- HARD RULE: inspect `git diff --cached --stat` before every commit
- HARD RULE: defect enum values are lowercase (set by mig 147)
- Migration DOWN scripts required per project pattern
