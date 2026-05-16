# Risk artefact type — design + grill findings

**Status:** Design locked 2026-05-16. PLA-0052 implements. Driven by the user requirement: *"risks act the same as defects."*

**Read this before:** writing any code under PLA-0052, or before adding a NEW system artefact type that isn't Risk (the per-subscription seeding finding applies to all future system rows).

**Parent:** [`.claude/CLAUDE.md`](../.claude/CLAUDE.md). **Related:** [`c_c_naming_conventions.md`](c_c_naming_conventions.md), [`c_c_db_routing.md`](c_c_db_routing.md), [`c_tech_debt.md`](c_tech_debt.md).

---

## §1 — One-line summary

Risk is a `scope='work'` system artefact type that mirrors Defect 1:1: same hierarchy depth (top-level, no parent), same two-flow shape (primary `Risk Flow` + secondary `Risk State`), same field-binding pattern. It appears as a row inside `/work-items` (primary surface) AND at `/risk` as a filtered, risk-specific presentation of the same data (secondary surface). One source of truth in `artefacts`, two renderings.

---

## §2 — Decisions locked

| Decision | Value | Why |
|---|---|---|
| Name | `Risk` | Matches mock IDs `RSK-NNNN`; matches `pages` row already present at `/risk`. |
| Prefix | `RSK` (3 letters) | Matches the mock IDs. Precedent: `PRW` (Portfolio Runway) also 3 letters. Schema has no length cap and no lint forbids 3 chars. |
| Scope | `work` | Risks behave like Defects — created in flight, owned by an assignee, flow through states. Strategy scope is for layered taxonomies. Library `portfolio_template_layer_definitions` is strategy-only. |
| Source | `system` | Seeded by `010_seed_system_artefact_types.sql` per subscription, mirrored per workspace by `portfoliomodels.adopt_work_types`. Same lifecycle as Defect. |
| Sort order | `25` (between Defect=20 and Task=30) | Slots Risk into the existing artefact-type sort without shifting other types. Combined with frontend `TYPE_TIER`: Epic→1, Story→2, Defect→3, Task→4, **Risk→5**. |
| Colour | `#dc2626` (red) | Domain-appropriate; doesn't collide with Defect's indigo `#6366f1`. |
| Hierarchy | Top-level (no parent) | Same as Defect (`artefacts_types_id_parent_type IS NULL`). |
| Primary flow | `Risk Flow` — Identified→Analysing→Mitigating→Closed→Accepted (kind-aligned: backlog/todo/in_progress/done/accepted) | Risk-tuned names; same 5 kinds as Defect so all kind-driven UI keeps working. |
| Secondary flow | `Risk State` — 7 states: Identified→Assessing→Mitigating→Monitoring→Closed→Accepted-Residual→Escalated | Matches Defect's pattern of a richer secondary state-machine for domain-specific lifecycle. |
| Fields | `risk_score` (required, decimal), `risk_impact` (required, select), `risk_probability` (required, select) + `notes`, `blocked`, `blocked_reason`, `expedite`, `ready`, `acceptance_criteria` (mitigation plan), `environment` | 3 risk-specific fields already exist in `artefacts_fields_library` (currently bound to Defect as decoration). They are PROMOTED to first-class on Risk. The Defect-lifted set provides the common work-item surface. |
| `pi_risk_probability` rename | → `risk_probability` | The `pi_` prefix was a hangover from Portfolio Item ownership. Rename + backfill `artefacts_fields_values.id_field_library` references, then grep the frontend for any literal-name lookups. |
| Primary surface | `/work-items` (row alongside Epic/Story/Task/Defect) | Defect has no standalone page; honour "same as defects" literally. |
| Secondary surface | `/risk` (filtered view) | Existing mock page becomes a real filtered ObjectTree over the same data, with a risk-specific summary header (severity × likelihood). |
| Backend hardcoded-list refactor | Patch the 5 hits, file TD | Ship Risk fast. `TD-WORKITEMS-GENERIC` (S2) tracks the generic refactor (replace `WorkItemsSummary` fixed fields + CASE sort with DB-driven enumeration). |

---

## §3 — Why a multi-agent grill was used

Four parallel `Explore` agents investigated four non-overlapping coupling surfaces in ~3 minutes wall time:

1. **Backend coupling** — what in `backend/` hardcodes Defect or the work-type list.
2. **Frontend coupling** — what in `app/`/`dev/` hardcodes Defect.
3. **Adoption mechanics** — how system types reach tenant workspaces; library role; `flows_defaults` wiring.
4. **Page/addressable substrate** — what the `/risk` page rewrite needs.

This caught **two issues that "copy from Defect" would have missed**:

- **System artefact types are per-subscription, not global** (`010_seed_system_artefact_types.sql` takes `p_subscription_id`). A naïve INSERT of one Risk row would only work for one subscription. Real fix: extend the seed function + add a backfill migration that runs the seed across every existing subscription.
- **`WorkItemsSummary` has fixed-shape fields** (`.Epics .Stories .Tasks .Defects`). Adding Risk means adding a `.Risks` field — the summary endpoint is NOT generic, despite looking generic from the `.ByType` map next to it.

---

## §4 — Coupling inventory (full)

### §4.1 — Backend BLOCKERS (5)

All in [`backend/internal/artefactitems/`](../backend/internal/artefactitems/):

| File:Line | What | Action |
|---|---|---|
| [`types.go:373`](../backend/internal/artefactitems/types.go#L373) | `validItemTypesByScope["work"]` whitelist | Add `"risk": true` |
| [`types.go:338`](../backend/internal/artefactitems/types.go#L338) | `WorkItemsSummary.Defects int` field | Add `Risks int` sibling field |
| [`service.go:306`](../backend/internal/artefactitems/service.go#L306) | `out.Defects = out.ByType["defect"]` populate | Add `out.Risks = out.ByType["risk"]` |
| [`service.go:850`](../backend/internal/artefactitems/service.go#L850) | SQL CASE sort ordinal | Add `WHEN 'risk' THEN 5` |
| [`db/vector_artefacts/schema/010_seed_system_artefact_types.sql`](../db/vector_artefacts/schema/010_seed_system_artefact_types.sql) | Hardcoded 4-tuple seed | Add `('Risk', 'RSK', 25, '#dc2626')` |

Generic (Risk inherits automatically): the adoption writer ([`portfoliomodels/adopt_work_types.go`](../backend/internal/portfoliomodels/adopt_work_types.go)) reads live system rows at runtime — no enumeration. Webhooks, DTO mappers, public-API surface are all scope-dynamic. No hidden UUID or prefix checks in business logic.

### §4.2 — Frontend BLOCKERS (9)

| File:Line | What | Action |
|---|---|---|
| [`app/components/work-items-tree-config.tsx:157`](../app/components/work-items-tree-config.tsx#L157) | `TYPE_TIER` hierarchy sort | Add `risk: 5` |
| [`app/components/work-items-tree-config.tsx:618-623`](../app/components/work-items-tree-config.tsx#L618-L623) | `TYPE_CHIP_OPTIONS` filter chip array | Add `{ value: "risk", label: "Risk" }` |
| [`app/components/CustomFieldManager.tsx:54-59`](../app/components/CustomFieldManager.tsx#L54-L59) | `ITEM_TYPE_TO_PREFIX` map | Add `risk: "RSK"` |
| [`app/components/CustomFieldManager.tsx:84`](../app/components/CustomFieldManager.tsx#L84) | JSDoc comment naming types | Update comment to include risk |
| [`app/(user)/workspace-admin/custom-fields/work-items/page.tsx:17`](../app/(user)/workspace-admin/custom-fields/work-items/page.tsx#L17) | Hardcoded admin row | Add `{ key: "risk", label: "Risk", prefix: "RSK" }` |
| [`app/(user)/workspace-settings/workspace-settings/custom-fields/work-items/page.tsx:17`](../app/(user)/workspace-settings/workspace-settings/custom-fields/work-items/page.tsx#L17) | Duplicated row | Same addition (file is a duplicate — TD-WORKITEMS-DUPE candidate) |
| [`app/components/Badge.tsx:54-59`](../app/components/Badge.tsx#L54-L59) | `DOMAIN_TONES["work-item-type"]` | Add `risk: "danger"` (or new tone if needed) |
| [`app/components/ObjectTree/p_ObjectTreeRegistry.tsx:97`](../app/components/ObjectTree/p_ObjectTreeRegistry.tsx#L97) | JSDoc type union | Update comment to include `"risk"` |
| [`app/(user)/work-items/page.tsx:80-89`](../app/(user)/work-items/page.tsx#L80-L89) | `summaryCells` array with `s.defects` | Add `RISKS` cell reading `s.risks` (tone `danger`) |

Generic (no change needed):
- `wizardLoader` resolves component refs by name — Risk inherits the same `WorkItemsPanelHeader` / `WorkItemsFilterChips`.
- `p_wizard_workitems.json` is type-agnostic (`scope: "work"`) — no new sidecar file needed for primary surface.
- ObjectTree itself enumerates types from the API, not from a fixed list.

### §4.3 — Adoption mechanics — the per-subscription gotcha

System rows in `artefacts_types` are **keyed by `(subscription_id, scope, prefix)`**, not global. The seed function [`010_seed_system_artefact_types.sql`](../db/vector_artefacts/schema/010_seed_system_artefact_types.sql) takes `p_subscription_id` and creates 4 rows per subscription. When a new workspace is provisioned within an existing subscription, [`portfoliomodels.adopt_work_types`](../backend/internal/portfoliomodels/adopt_work_types.go) mirrors those system rows into a per-workspace `source='tenant'` copy.

Implications for Risk:

1. The seed function must be extended to insert Risk alongside the existing 4 types.
2. A **backfill migration** must run the extended seed across every existing subscription (one row per subscription per scope; ON CONFLICT DO NOTHING for idempotency).
3. A **second backfill** must run the adoption writer for every existing workspace, mirroring the new system Risk row as a tenant Risk row (so existing workspaces immediately have a Risk type to use).
4. Future workspaces auto-adopt at provisioning time via the existing path — no change there.
5. `mmff_library.portfolio_template_layer_definitions` plays no role — work-scope types are NOT library-driven.
6. `flows_defaults` is auto-snapshotted from `flows.is_default=TRUE` ([`044_seed_flow_defaults_snapshot.sql`](../db/vector_artefacts/schema/044_seed_flow_defaults_snapshot.sql)). Wiring Risk Flow with `is_default=TRUE` makes the defaults row free.

### §4.4 — Page/addressable substrate

| Concern | Finding | Action |
|---|---|---|
| `/risk` `pages` row | **Already exists** (`key_enum='risk'`, `tag_enum='strategy'`, icon `warning`). Verified by direct query. | No migration needed for nav. May want to flip `tag_enum` from `strategy` to `planning` to match `/work-items`. |
| `pageId="risk"` addressable | Free-text key; auto-registered at runtime via `useRegisterAddressable`. | No DB pre-reg needed. |
| `panel_risk_header` addressable | Same — runtime-registered. | Add second panel `risks_grid_tree_ll` wrapping ObjectTree (mirrors work-items). |
| Wizard sidecar | New `p_wizard_risks.json` IS needed for the `/risk` filtered surface (different `resourceUrl`, different `dataType`, different `defaultSortKey`). Primary `/work-items` surface inherits the existing sidecar. | Create [`app/components/ObjectTree/configs/p_wizard_risks.json`](../app/components/ObjectTree/configs/p_wizard_risks.json) keyed on `dataType: "risks"`. |
| Summary endpoint | `/work-items/summary` returns fixed-shape summary. `/risk` will need its own summary endpoint OR consume the same summary and project the `s.risks` subset. | Add `/risks/summary` returning severity × likelihood matrix counts. Document choice in PLA. |

---

## §5 — Migration plan (high level)

Migration numbers reserved against `db/vector_artefacts/schema/` (next is `071_`):

| # | File | Effect |
|---|---|---|
| 071 | `seed_system_risk_artefact_type.sql` | Extend `seed_system_artefact_types(subscription_id)` to include Risk; backfill across all subscriptions; idempotent ON CONFLICT. |
| 072 | `rename_pi_risk_probability_to_risk_probability.sql` | UPDATE `artefacts_fields_library SET field_name='risk_probability' WHERE field_name='pi_risk_probability'`. Cascade is implicit — `artefacts_fields_values` references by `id_field_library` UUID, not by name. |
| 073 | `seed_risk_default_flow.sql` | Insert `Risk Flow` + 5 states (Identified/Analysing/Mitigating/Closed/Accepted, kinds backlog/todo/in_progress/done/accepted, is_initial on Identified, is_pullable on Analysing) + transitions (Defect Flow shape). `flows_is_default=TRUE`. |
| 074 | `seed_risk_state_secondary_flow.sql` | Insert `Risk State` flow (non-default) + 7 states (Identified/Assessing/Mitigating/Monitoring/Closed/Accepted-Residual/Escalated) + free transition graph. |
| 075 | `seed_risk_type_field_bindings.sql` | Insert `artefacts_types_fields` rows binding the 11 fields to Risk. Required: risk_score, risk_impact, risk_probability. |
| 076 | `seed_artefacts_number_sequence_risk.sql` | Insert `artefacts_number_sequences` row keyed to Risk → produces `RSK-0001…`. |
| 077 | `adopt_risk_into_existing_workspaces.sql` | One-shot backfill: for every existing live workspace, INSERT a `source='tenant'` Risk row mirroring the system row. ON CONFLICT DO NOTHING. |

Each migration has a paired DOWN file in `db/vector_artefacts/schema/down/`. The seed-function update in 071 is forward-only (changing a CREATE OR REPLACE FUNCTION definition has no meaningful DOWN — the old definition is restored from git history if rolled back).

---

## §6 — Carry-forward debt items

| ID | Severity | What | Trigger |
|---|---|---|---|
| `TD-WORKITEMS-GENERIC` | S2 | Replace fixed `WorkItemsSummary` fields (`.Epics .Stories .Tasks .Defects .Risks`) and the CASE sort clause with DB-driven enumeration. | Pay down on the next new artefact type, OR when summary shape changes (e.g. adding a `.severity_high` aggregate). |
| `TD-WORKITEMS-DUPE` | S3 | `app/(user)/workspace-admin/custom-fields/work-items/page.tsx` and `app/(user)/workspace-settings/workspace-settings/custom-fields/work-items/page.tsx` are byte-equivalent (almost). De-dupe. | Pay down on the next custom-fields admin change. |
| `TD-RISK-PAGE-TAG` | S3 | `/risk` page row has `tag_enum='strategy'` — likely should be `planning` to match `/work-items`. | Confirm with user; one-row UPDATE. |

Filed in [`c_tech_debt.md`](c_tech_debt.md) under "PLA-0052 follow-ups."

---

## §7 — What this changes elsewhere

- [`c_c_naming_conventions.md`](c_c_naming_conventions.md) — gains a note that 3-letter `artefacts_types_prefix` values are allowed (precedent: `PRW`, `RSK`). Secondary-flow naming convention codified as `<Type> State` (Defect State, Risk State).
- [`c_schema.md`](c_schema.md) — Risk row in the artefact-types catalog summary.
- [`c_c_db_routing.md`](c_c_db_routing.md) — no change (no new tables, no new pools).
- [`c_plan_index.md`](c_plan_index.md) — PLA-0052 row added.
- [`Vector_Scope.md`](../Vector_Scope.md) — PLA-0052 entered as in-flight.
