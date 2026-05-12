# Vector — Product Scope & Feature Tracker

**Created:** 2026-05-08
**Last updated:** 2026-05-11 (`<scope> -u` — FE-GOV-0004 workstream A complete: page move + Orbit View components + CSS + matrix retired)
**Doc version:** 2.12

---

## Table of Contents

**FLOW — Flow-State Primitives** *(canonical lifecycle model — quick reference)*

- [FLOW1. Flow-State Kind &amp; Pull-Eligibility Model](#flow1-flow-state-kind--pull-eligibility-model)

**F — Product Functionality** *(user-visible features currently being built)*

- [F1. Artefact Type and Flow State Customisation](#f1-artefact-type-and-flow-state-customisation)

**FE — Feature Areas** *(governance, UX, and other domain-tagged features)*

- [FE-GOV-0003. Flow-State Descriptions &amp; Per-State Exit Rules (PLA-0040)](#fe-gov-0003-flow-state-descriptions--per-state-exit-rules-pla-0040)
- [FE-GOV-0004. Orbit View Transition Editor &amp; Artefact-Move Enforcement (PLA-0041)](#fe-gov-0004-orbit-view-transition-editor--artefact-move-enforcement-pla-0041)

**M — v2 Migration** *(build order: easiest → hardest)*

- [M1. Flows](#m1-flows)
- [M2. Tenant Settings](#m2-tenant-settings)
- [M3. Defects](#m3-defects)
- [M4. User Stories](#m4-user-stories)
- [M5. Portfolio Items](#m5-portfolio-items)
- [M6. Topology](#m6-topology)

**B — Product Features**

- [B1. Core Work Item Engine](#b1-core-work-item-engine)
- [B2. Sprint &amp; Timebox Management](#b2-sprint--timebox-management)
- [B3. Portfolio &amp; Master Record](#b3-portfolio--master-record)
- [B4. Custom Fields](#b4-custom-fields)
- [B5. Roles &amp; Permissions (RBAC)](#b5-roles--permissions-rbac)
- [B6. Workspace &amp; Topology](#b6-workspace--topology)
- [B7. Search](#b7-search)
- [B8. Public API &amp; Integrations](#b8-public-api--integrations)
- [B9. Webhooks](#b9-webhooks)
- [B10. Async Jobs &amp; Reporting](#b10-async-jobs--reporting)
- [B11. Real-Time &amp; Async Push](#b11-real-time--async-push)
- [B12. n8n Integration](#b12-n8n-integration)
- [B13. Library &amp; Portfolio Models](#b13-library--portfolio-models)
- [B14. Addressables &amp; Page Help](#b14-addressables--page-help)
- [B15. UI Primitives &amp; Design System](#b15-ui-primitives--design-system)
- [B16. Security &amp; Auth](#b16-security--auth)
- [B17. Infrastructure &amp; DevOps](#b17-infrastructure--devops)
- [B18. Developer Experience](#b18-developer-experience)
- [B19. Work Item Relations Graph](#b19-work-item-relations-graph)
- [B20. User Access Rights &amp; Navigation Control](#b20-user-access-rights--navigation-control)
- [B21. Artefact-Items Substrate (PLA-0037)](#b21-artefact-items-substrate-pla-0037)
- [B22. Transport Segregation via Shared Service Core (PLA-0039)](#b22-transport-segregation-via-shared-service-core-pla-0039)

---

## FLOW1. Flow-State Kind & Pull-Eligibility Model

Establishes the canonical 6-kind flow primitive plus an `is_pullable` flag on `flow_states`. Pill name and kind align in the seed (Backlog/To Do/Doing/Completed/Accepted) so the lifecycle vocabulary is self-evident. Two orthogonal axes: `kind` answers "where in the lifecycle?" (`backlog | todo | in_progress | done | accepted | cancelled`); `is_pullable` answers "can the team take this from this state right now?". Compliance-gated teams use multiple `kind='todo'` pills (e.g. To Do → In Review → Approved) where only the final pill carries `is_pullable=true`. Standard agile teams keep the seed default — `Backlog` is PO shaping (validation relaxed); `To Do` is the single pullable state. Per-artefact PO-readiness is explicitly a future concern, not bundled here. `[P1]` 🔵 IN FLIGHT

### FLOW1.1 Schema — kind widening + is_pullable flag

- ✅ **FLOW1.1.1** ~~Widen `flow_states.kind` CHECK constraint to `('backlog','todo','in_progress','done','accepted','cancelled')` — adds `backlog` as 6th primitive~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
- ✅ **FLOW1.1.2** ~~Add `flow_states.is_pullable BOOLEAN NOT NULL DEFAULT FALSE` — opt-in per pill; default false so new pills are non-pullable until consciously marked~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
- ✅ **FLOW1.1.3** ~~Migration `042_seed_kind_aligned_flow_pills.sql` — re-seed default flows with name/kind alignment (Ready → To Do rename in place); set `is_pullable=true` on To Do pill across all default flows; idempotent on re-run~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
- ✅ **FLOW1.1.4** ~~Fold DE-Default + US-Default corruption repair into 042 — delete junk pills (TEST PILL, Lego, fwerrt, etc.); reset canonical pills to seed values in place (preserves artefact FK refs)~~ `[P1]`
> Commit `a2379df` (2026-05-10): feat(FLOW1): kind widening + is_pullable + repair DE/US flows [FLOW1.1.1] [FLOW1.1.2] [FLOW1.1.3] [FLOW1.1.4]
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
- ✅ **FLOW1.1.5** ~~Backfill `is_pullable` on Defect QA flow + strategy-type default flows (BC/BE/PO/SO) — apply same convention (single pullable pill at the team-handoff point)~~ `[P2]`
> 042 set is_pullable=TRUE on every default flow's pullable pill (10 total: each default's "To Do" + DE QA's "Open"); verified via post-migration check 2026-05-10.
> Commit `a7ce180` (2026-05-10): feat(FLOW1.1): work-flow corrections + field library label dedupe [FLOW1.1.5]
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive

### FLOW1.2 Backend — service surface
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite

- ✅ **FLOW1.2.1** ~~Add `'backlog'` to `validKinds` map in `backend/internal/flows/service.go`~~ `[P1]`
> Commit `d3d47f4` (2026-05-10): feat(FLOW1.2): backlog kind + is_pullable wired through flows service [FLOW1.2.1] [FLOW1.2.2] [FLOW1.2.3]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **FLOW1.2.2** ~~Extend `PatchStateInput` + `CreateStateInput` to accept optional `is_pullable bool` — UPDATE/INSERT propagates the flag~~ `[P1]`
> Commit `d3d47f4` (2026-05-10): feat(FLOW1.2): backlog kind + is_pullable wired through flows service [FLOW1.2.1] [FLOW1.2.2] [FLOW1.2.3]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
- ✅ **FLOW1.2.3** ~~`listByScope` query selects `fs.is_pullable` and surfaces it in the `FlowState` DTO~~ `[P1]`
> Commit `d3d47f4` (2026-05-10): feat(FLOW1.2): backlog kind + is_pullable wired through flows service [FLOW1.2.1] [FLOW1.2.2] [FLOW1.2.3]
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
- **FLOW1.2.4** Pull-surface query helper — canonical filter `is_pullable=true OR kind IN ('in_progress','done','accepted')` for team boards `[P2]`
- **FLOW1.2.5** PO-backlog query helper — `kind='backlog' OR (kind='todo' AND is_pullable=false)` for PO grooming views `[P2]`
> Last checked: 2026-05-10 — service.go validKinds includes "backlog"; types.go FlowState/PatchStateInput/CreateStateInput carry IsPullable; listByScope SELECT + scan + PatchFlowState UPDATE/RETURNING + CreateState INSERT/RETURNING all wire fs.is_pullable through. `go build ./internal/flows/... ./cmd/server/...` clean.
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs

> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
### FLOW1.3 Frontend — customisation page + KIND_LABEL
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules

- ✅ **FLOW1.3.1** ~~Add `backlog → "Backlog"` to `KIND_LABEL` map; flow-map's left master-state column adds 6th row~~ `[P1]`
> Commit `9b758ee` (2026-05-10): feat(FLOW1.3): backlog kind label + is_pullable toggle column [FLOW1.3.1] [FLOW1.3.2]
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
- ✅ **FLOW1.3.2** ~~`is_pullable` toggle on each pill row in the flow-states settings page — PO sets per-pill, persists via `flowStatesApi.patchState`~~ `[P2]`
> Commit `9b758ee` (2026-05-10): feat(FLOW1.3): backlog kind label + is_pullable toggle column [FLOW1.3.1] [FLOW1.3.2]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
- **FLOW1.3.3** Visual treatment: pullable pill carries a subtle "team can pull" indicator (icon, accent border) — distinct from any future PO-readiness badge `[P2]`
> Commit `1ede082` (2026-05-10): feat(FLOW1.3): vertical 3-col flow-map grid + dedicated drop slots [FLOW1.3.3]
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
- **FLOW1.3.4** Flow-map shows the implicit Backlog-zone boundary visually (left edge of pullable pill = "team handoff line") `[P3]`
> Last checked: 2026-05-10 — KIND_LABEL/KIND_STROKE include backlog (slate-300 stroke); inferKind ORDER+KEY widened to 6 kinds; FlowState DTO + flowStatesApi + apiSite registry carry is_pullable; new "Pullable" checkbox column in StateRow PATCHes `{ is_pullable }`. tsc clean for touched files.
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive

### FLOW1.5 Reset to factory-default per artefact type

> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
- **FLOW1.5.1** Snapshot tables in `vector_artefacts` (`flow_defaults`, `flow_state_defaults`, `flow_transition_defaults`) baked at seed time; idempotent rebuild from current live default flows `[P1]` ✅
> Commit `4c21968` (2026-05-10): fix(FLOW1.5): canonical hardcoded snapshot — decouple from polluted live [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
- **FLOW1.5.2** Backend Reset service — `loadResetData` + `pickSuccessor` walk-back helper + `PreviewReset` (diff only) + `ApplyReset` (single-tx rebind→archive→update→insert→rewrite-edges); routes `POST /_site/flows/reset/{preview,apply}` `[P1]`
> Commit `cf03ad2` (2026-05-10): feat(FLOW1.5): backend reset preview/apply with walk-back rebind [FLOW1.5.2]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
- **FLOW1.5.3** Frontend Reset button on `TypeSection` heading + inline preview banner showing pill/transition deltas + artefact-rebind impact counts; user confirmation before Apply `[P1]`
> Commit `1bf8f1c` (2026-05-10): feat(FLOW1.5): TypeSection Reset button + inline preview banner [FLOW1.5.3]
> Commit `63c9331` (2026-05-10): fix(FLOW1.5): empty-slice ResetPreview so JSON emits [] not null [FLOW1.5.3]
> Commit `ca9bbe4` (2026-05-10): fix(FLOW1.5): remount TypeSection on reload so map drops stale pills [FLOW1.5.3]

### FLOW1.4 Future — explicitly out of scope here
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)

> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
- **FLOW1.4.1** Per-artefact `po_ready` flag on `artefacts` table — visual aid for PO grooming, independent of flow state; sort-to-top/badge UI; optional DoR validation on toggle `[P3]`
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)

> Last checked: 2026-05-10
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs

> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
---
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules

## F1. Artefact Type and Flow State Customisation

Workspace Settings > Customisation page — two sections. Section 1 (artefact type tags, prefix, name, description, colour) is already built. Section 2 adds a third-level tab nav (mirroring Custom Fields) for flow state management: one tab per artefact type, showing that type's flow states with colour editing. Covers data-correction migrations to fix wrong seeded states for all work types and missing states for strategy types. `[P2]` 🔵 IN FLIGHT

> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
### F1.1 Data Migrations — correct seeded flow states

- ✅ **F1.1.1** ~~Migrate Task flow states to: Ready (todo), Doing (in_progress), Completed (done) — remove Cancelled~~ `[P1]`
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.1.2** ~~Migrate Story flow states to: Backlog (todo), Ready (todo), Doing (in_progress), Completed (done), Accepted (done) — remove To Do, In Progress, Done, Cancelled~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.1.3** ~~Migrate Epic flow states to match Story (same 5-state set)~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.1.4** ~~Migrate Defect work-execution flow states to match Story (same 5-state set)~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.1.5** ~~Seed Defect QA/business flow: Submitted (todo), Open (todo), Fixed (in_progress), In Test (in_progress), Not Reproducible (done), Deferred (done) — new second flow on the Defect type~~ `[P1]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.1.6** ~~Seed flow states for BC, BE, PO, SO strategy types (flows exist, 0 states): Backlog (todo), Ready (todo), Doing (in_progress), Completed (done), Accepted (done)~~ `[P1]`
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.1.7** ~~Add `accepted` kind to `flow_states` CHECK constraint — needed to distinguish Accepted from Completed in metrics; update existing Accepted seeds to use it~~ `[P2]`
> Last checked: 2026-05-10 — F1.1.1–F1.1.7 covered by migration 041 + 042 (Story/Epic/Defect 5-state, Task 3-state, DE QA exists, BC/BE/PO/SO seeded, accepted in CHECK widened to 6 in 042). Note: FLOW1's seed-kind alignment renamed `Ready → To Do` and added `backlog` kind, superseding F1.1's `Ready (todo)` naming — current DB reflects FLOW1's model.
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only

> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
### F1.2 Backend — flow state colour PATCH API
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)

> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
- ✅ **F1.2.1** ~~Add `PATCH /_site/flow-states/{id}` handler (colour only for now) — validates `#RRGGBB`, returns updated state~~ `[P1]`
> Commit `29dca0e` (2026-05-10): feat(F1): flow states Customisation tab — tertiary nav per artefact type, colour PATCH [F1.2.1] [F1.2.2] [F1.2.3]
> Commit `b184f96` (2026-05-10): refactor(F1): flow states — single-page layout with PageAnchorNav TOC [F1.2.1] [F1.2.2]
> Commit `8d4ab8e` (2026-05-10): refactor(F1): route flows + flowStates through apiSite registry [F1.2.1] [F1.2.2]
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- ✅ **F1.2.2** ~~Register route in `mountSiteRoutes` with `RequireAuth` + `RequireFreshPassword`~~ `[P1]`
> Commit `29dca0e` (2026-05-10): feat(F1): flow states Customisation tab — tertiary nav per artefact type, colour PATCH [F1.2.1] [F1.2.2] [F1.2.3]
> Commit `b184f96` (2026-05-10): refactor(F1): flow states — single-page layout with PageAnchorNav TOC [F1.2.1] [F1.2.2]
> Commit `e95608b` (2026-05-10): feat(F1): flow map SVG diagram above each flow's state table [F1.2.2]
> Commit `8d4ab8e` (2026-05-10): refactor(F1): route flows + flowStates through apiSite registry [F1.2.1] [F1.2.2]
> Commit `f0f0aa9` (2026-05-10): fix(F1): transitions not iterable — init empty slice, add null guard [F1.2.2]
> Commit `4ba5bfc` (2026-05-10): fix(F1): flow map — transparent bg, 5px arrow gap from pill edges [F1.2.2]
> Commit `96f9bd6` (2026-05-10): fix(F1): flow map pills — border-only style when no custom colour set [F1.2.2]
> Commit `b471bea` (2026-05-10): fix(F1): flow map pills — always transparent fill, colour as border, square corners [F1.2.2]
> Commit `5ee6c8b` (2026-05-10): fix(F1): flow map pills — text colour matches border colour [F1.2.2]
> Commit `06966c7` (2026-05-10): fix(F1): flow map pills — standard ink text colour [F1.2.2]
> Commit `71e8b2e` (2026-05-10): feat(F1): add state + transition matrix editor [F1.2.2]
> Commit `d3c5b7f` (2026-05-10): feat(F1): drag-to-reorder states in flow table [F1.2.2]
> Commit `990733a` (2026-05-10): fix(F1): all states draggable — fix dnd-kit handle registration [F1.2.2]
> Commit `d9a54d7` (2026-05-10): feat(F1): inline flow map editor — insert/remove states with animation [F1.2.2]
> Commit `9414010` (2026-05-10): feat(F1): drag-to-reorder pills in flow map — horizontal axis only [F1.2.2]
> Commit `682f6b3` (2026-05-10): feat(F1): pill toolbar with position-aware drag handle + live drag movement [F1.2.2]
> Commit `6f4b4b2` (2026-05-10): feat(F1): DragOverlay for live pill ghost + large always-visible toolbar buttons [F1.2.2]
> Last checked: 2026-05-10 — `PATCH /_site/flow-states/{id}` registered at `backend/cmd/server/main.go` lines 921–927 with `RequireAuth` + `RequireFreshPassword`; handler `flowsH.PatchFlowState` in `backend/internal/flows/handler.go`. Confirmed wired through apiSite registry.
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs

### F1.3 Frontend — Customisation page flow states section

- **F1.3.1** Move existing Work Items page (`/workspace-settings/work-items`) content into Customisation as third-level tab section `[P2]`
- **F1.3.2** Add third-level tab nav to Customisation page: work-type tabs (Story, Epic, Task, Defect) + strategy-type tabs (SO, PO, BE, BC, FE) + Defect QA tab `[P2]`
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- **F1.3.3** Flow state colour picker per state row (same `ColourPicker` component) — PATCH calls `/_site/flow-states/{id}` `[P2]`
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
> Commit `42115b5` (2026-05-12): fix(dev-ui): TOC sticky positioning — align-self:start + overflow auto
- **F1.3.4** Frontend `flowStatesApi` — `listByType(artefactTypeId)` + `patch(stateId, {colour})` via `apiSite` `[P2]`
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
- **F1.3.5** Update `useWorkItemFlowStates` to pass state colours through to `FlowStatePillRow` for coloured pills in the tree `[P3]`
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs

> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
---
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it

> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
## M1. Flows
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)

> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
Workflow definitions and states for work items. Currently reads from `obj_flow_tenant` in the old database (`mmff_vector`). The new database already has the correct tables (`flows`, `flow_states`, `flow_transitions`) — the data needs copying across and the handler switching over. Plan: [PLA-0031](dev/plans/PLA-0031.json)
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs

> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
### ✅ ~~M1.1 API — Register `/flows` on v2~~

- ✅ **M1.1.1** Register `GET /flows` under `/samantha/v2` in `main.go` `[P2]`
  `[✓] M1.2.3 Service rewritten → [✓] M1.2.4 Query rewritten → [ ] M1.3.3 ETL verified (pending dev run)`
- ✅ **M1.1.2** Remove `GET /flows` from `/samantha/v1` block `[P2]`
  `[✓] M1.1.1 v2 route registered`
- ✅ **M1.1.3** Update `openapi-v2.yaml` with `/flows` path spec `[P2]`
  `[✓] M1.1.1 v2 route live`
- ✅ **M1.1.4** Switch frontend caller (`workspace-settings/work-items/page.tsx`) from `api('/flows/')` to `apiV2('/flows/')` `[P2]`
  `[✓] M1.1.1 v2 route live → [✓] M1.1.3 spec updated`

### ✅ ~~M1.2 New Database — `vector_artefacts`~~

- ✅ **M1.2.1** `flows` table already exists — verify `artefact_type_id`, `name`, `is_default`, `archived_at` columns are sufficient `[P2]`
  `[✓] 004_flows.sql applied — all required columns confirmed`
- ✅ **M1.2.2** `flow_states` table already exists — verify `flow_id`, `name`, `kind`, `sort_order`, `is_initial` columns are sufficient `[P2]`
  `[✓] 004_flows.sql applied — all required columns confirmed`
- ✅ **M1.2.3** Rewrite `flows.Service` constructor to accept `vectorArtefactsPool` instead of `pool` `[P2]`
  `[✓] M1.2.1 flows table verified → [✓] M1.2.2 flow_states table verified`
- ✅ **M1.2.4** Rewrite `ListBySubscription` query to read from `flows JOIN artefact_types` scoped by `workspace_id` `[P2]`
  `[✓] M1.2.3 Service constructor rewritten → [ ] M1.3.3 ETL run and verified (pending dev run)`

### M1.3 Old Database — `mmff_vector`

- ✅ **M1.3.1** Map `obj_flow_tenant` columns to `flows`/`flow_states` — document the `subscription_id → workspace_id` translation and the three polymorphic FK variants (system / tenant / portfolio) `[P2]`
  *(captured in etl_flows.sql column map header)*
- ✅ **M1.3.2** Write ETL script: read `obj_flow_tenant` rows, resolve `artefact_type_id` via `artefact_types`, insert into `flows` + `flow_states` in `vector_artefacts` `[P2]`
  `[✓] M1.3.1 Column map complete → [✓] M1.2.1 flows table verified → [✓] M1.2.2 flow_states table verified`
- ✅ ~~**M1.3.3** Run ETL on dev DB; verify row counts and spot-check data `[P2]`~~
  > Run 2026-05-08 via FDW (both DBs on same server). 21 total flow_states in VA: Defect/Epic/Story/Task have seeded 4-state flows (To Do→In Progress→Done→Cancelled) kept as-is; Feature populated with 5 legacy states (Backlog→Ready→Doing→Completed→Accepted). Strategy types empty — no legacy data. 4 source type_labels (Defect State, Portfolio Item, Test Case, Work Item) had no VA artefact_types match and were skipped. ETL script updated: `backlog`/`doing` canonical codes added, "empty flows only" guard added. FDW tables `fdw_obj_flow_tenant_full`, `fdw_obj_execution_types`, `fdw_obj_strategy_types`, `fdw_obj_execution_types_tenant` created in vector_artefacts.
  > Last checked: 2026-05-08
  >
- ✅ **M1.3.4** Retain `mmff_vector` pool in handler for tenancy gate only (membership check) — do not remove pool reference entirely `[P2]`
  `[✓] M1.2.3 Service rewritten → [✓] M1.2.4 Query rewritten`

---

## M2. Tenant Settings

Org-level configuration — name, branding, timezone. `master_record_tenant` now exists in both `mmff_vector` (source) and `vector_artefacts` (target). Service rewired. Pending: ETL run on dev DB. Plan: [PLA-0032](dev/plans/PLA-0032.json)

### M2.1 API — `/tenant-settings` route

- ✅ **M2.1.1** Route already at `/api/tenant-settings` — not under `/samantha/v1`; no v2 registration needed `[P2]`
  > Mounted independently in `main.go`; outside the deprecation path
  >
- ❌ NFA **M2.1.2** Remove from `/samantha/v1` — N/A, was never under v1
- ❌ NFA **M2.1.3** `openapi-v2.yaml` spec update — N/A, route is outside v2 block
- ❌ NFA **M2.1.4** Switch `api()` → `apiV2()` — N/A, route path unchanged

### ✅ ~~M2.2 New Database — `vector_artefacts`~~

- ✅ **M2.2.1** Design `master_record_tenant` in `vector_artefacts` — `workspace_id` PK (bare UUID, same pattern as `artefacts`) `[P2]`
  > 17 columns from mmff_vector post-mig-127/128; 3 feature-flag cols dropped (not in service model)
  >
- ✅ **M2.2.2** Write migration `036_master_record_tenant.sql` `[P2]`
  `[✓] M2.2.1 Table designed` — `db/artefacts_schema/036_master_record_tenant.sql`
- ✅ **M2.2.3** Rewrite `tenantsettings.Service` to use `vaPool` `[P2]`
  `[✓] M2.2.2 Migration written` — queries updated to `workspace_id` PK; cross-DB owner-user existence check removed (trust-caller)
- ✅ **M2.2.4** All queries rewritten for `vector_artefacts.master_record_tenant` `[P2]`
  `[✓] M2.2.3 Service rewritten` — `main.go` passes `vaPool` (falls back to `pool` until mig 036 applied on dev)

### M2.3 Old Database — `mmff_vector`

- ✅ **M2.3.1** Audit `master_record_tenant` columns — 17 columns map 1:1; only rename is `tenant_id → workspace_id` `[P2]`
  > Column map in `dev/scripts/etl_tenant_settings.sql` header
  >
- ✅ **M2.3.2** Write ETL script `[P2]`
  `[✓] M2.3.1 Audit complete → [✓] M2.2.2 Migration written` — `dev/scripts/etl_tenant_settings.sql`; idempotent `ON CONFLICT DO UPDATE`
- ✅ ~~**M2.3.3** Run ETL on dev DB; verify row counts `[P2]`~~
  > Run 2026-05-08 via FDW. Migration 036 applied. 1 row upserted (workspace_id `000...001`, tenant "MMFFDev New Schema", tz Europe/London, workdays {mon–fri}). `fdw_master_record_tenant` created in vector_artefacts.
  > Last checked: 2026-05-08
  > `[✓] M2.3.2 ETL script written`
  >
- ✅ **M2.3.4** `mmff_vector` pool retained for auth/membership; tenant settings now on `vaPool` `[P2]`
  `[✓] M2.2.3 Service rewritten → [✓] M2.2.4 Queries rewritten`

---

## M3. Defects

Bug/defect work items. Currently a standalone table (`defects`) in the old database. Rather than migrating like-for-like, defects consolidate into the unified `artefacts` table as a typed artefact — then served through `/work-items` filtered by type. The `/defects` endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### M3.1 API — Retire `/defects`, serve via `/work-items`

- **M3.1.1** Verify `GET /work-items?artefact_type=<defect-type-id>` returns defects post-ETL `[P2]`
  `[ ] M3.2.1 Defect type seeded → [ ] M3.3.3 ETL verified → [ ] M3.2.3 /work-items returns defects`
- ✅ **M3.1.2** Remove `GET/POST/PUT/DELETE /defects` from `/samantha/v1` block in `main.go` `[P2]`
  > Done 2026-05-09 — route block removed; `defectsSvc`/`defectsH` constructors removed; `defects` package import removed; `go build` clean.
- ✅ **M3.1.3** Mark `/defects` as `deprecated: true` in `openapi.yaml` `[P2]`
  > Done 2026-05-09 — `deprecated: true` added to POST `/defects`, GET/PATCH/DELETE `/defects/{id}`.
- ✅ **M3.1.4** Update any frontend callers of `api('/defects')` — switch to `apiV2('/work-items')` with type filter `[P2]`
  `[✓] Audit complete — zero frontend callers of api('/defects') found; no switch needed`

### M3.2 New Database — `vector_artefacts`

- ✅ **M3.2.1** Seed `artefact_types` row for `Defect` (name, description, workspace scope) `[P2]`
  `[✓] M3.3.1 Column audit complete` — Defect type (prefix=DE, scope=work, source=system) already seeded by seed_system_artefact_types() (migration 010); migration 027 ensures field bindings
- ✅ **M3.2.2** Seed `artefact_field_library` entries for any defect-specific columns that have no native artefact equivalent `[P2]`
  `[✓] M3.3.1 Column audit complete → [✓] M3.2.1 Defect type seeded` — 17 fields seeded in db/artefacts_schema/027_seed_defect_field_library.sql with artefact_type_fields bindings
- **M3.2.3** Verify `/work-items` handler returns defect artefacts with correct field values `[P2]`
  `[✓] M3.2.1 Type seeded → [✓] M3.2.2 Field library seeded → [✓] M3.3.3 ETL run and verified`

### M3.3 Old Database — `mmff_vector`

- ✅ **M3.3.1** Audit `defects` table columns — map each to `artefacts` native columns or `artefact_field_values` `[P2]`
  > Audit complete — column map documented in db/artefacts_schema/027_seed_defect_field_library.sql and dev/scripts/etl_defects.sql headers
  >
- ✅ **M3.3.2** Write ETL script: insert `defects` rows into `artefacts` (type=Defect) + `artefact_field_values` `[P2]`
  `[✓] M3.3.1 Column audit complete → [✓] M3.2.1 Type seeded → [✓] M3.2.2 Field library seeded` — script at dev/scripts/etl_defects.sql
- ✅ **M3.3.3** Run ETL on dev DB; compare row counts and spot-check field values `[P2]`
  Migration 027 applied (17 defect fields seeded); `timebox_sprint_id` column name fix applied to ETL script; FDW (`fdw_defects`) created in vector_artefacts; ETL ran cleanly — 0 source rows in dev DB (schema validated), 2 pre-existing DE artefacts unchanged.
- ✅ **M3.3.4** Delete `backend/internal/defects/` package once endpoint is removed `[P3]`
  > Done 2026-05-09 — package directory removed; `go build ./...` clean; no remaining package references in backend.

---

## M4. User Stories

User story work items. Same consolidation pattern as defects — `user_stories` table in old DB collapses into `artefacts`, endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### M4.1 API — Retire `/user-stories`, serve via `/work-items`

- ✅ **M4.1.1** Verify `GET /work-items?artefact_type=<user-story-type-id>` returns user stories post-ETL `[P2]`
  Verified 2026-05-08: `GET /samantha/v2/work-items?item_type=story` → total=5705, item_type=story, flow_state attached. Filter param is `item_type` (not `artefact_type`). All correct.
- ✅ **M4.1.2** Remove `/user-stories` from `/samantha/v1` block in `main.go` `[P2]`
  Route block, handler init, and `userstories` import all removed. Build clean.
- ✅ **M4.1.3** Mark `/user-stories` as `deprecated: true` in `openapi.yaml` `[P2]`
  All 4 operations (POST, GET, PATCH, DELETE) marked `deprecated: true` in openapi.yaml.
- ✅ **M4.1.4** Update any frontend callers of `api('/user-stories')` `[P2]`
  > Frontend audit (2026-05-08): no direct `api('/user-stories')` calls found in `app/`. The string `execution_user_stories` appears only as a TypeScript type discriminator in `app/lib/samantha.ts` (not an API call). No frontend changes required.
  >

### M4.2 New Database — `vector_artefacts`

- ✅ **M4.2.1** Seed `artefact_types` row for `User Story` `[P2]`
  `[✓] M4.3.1 Column audit complete` — US type already present as "Story"/prefix=US from seed_system_artefact_types(); mig 034 WHERE NOT EXISTS guard skipped insert correctly.
- ✅ **M4.2.2** Seed `artefact_field_library` entries for user-story-specific columns `[P2]`
  23 `us_*` fields seeded (mig 034 field-library section, run 2026-05-08); options_json set for schedule_state, risk_impact, risk_probability.
- ✅ **M4.2.3** Verify `/work-items` returns user story artefacts with correct field values `[P2]`
  Verified 2026-05-08: 5705 stories returned with correct item_type, flow_state_id/name/code, parent linkage, and owner fields. EAV field values (us_* fields) not yet spot-checked — seeded data has none but schema is correct.

### M4.3 Old Database — `mmff_vector`

- ✅ **M4.3.1** Audit `user_stories` table columns — map each to `artefacts` or `artefact_field_values` `[P2]`
  > Audit complete — 13 native columns, 23 EAV fields. See `db/artefacts_schema/034_seed_user_story_type.sql` column-map comment block.
  >
- ✅ **M4.3.2** Write ETL script: insert `user_stories` rows into `artefacts` (type=User Story) `[P2]`
  `[✓] M4.3.1 Column audit complete → [✓] M4.2.1 Type seeded → [✓] M4.2.2 Field library seeded`
- ✅ **M4.3.3** Run ETL on dev DB; verify row counts and field values `[P2]`
  Run 2026-05-08 via FDW. Mig 026/027/034 applied (034 field-library-only — US type already seeded as "Story"/prefix=US). ETL ran cleanly — 0 source rows in dev (schema validated), 6 pre-existing US artefacts unchanged. Two fixes found and applied: workspace join (`master_record_workspaces` DISTINCT ON, no `is_default`); explicit NULL casts in field_values UNION ALL. `fdw_user_stories` foreign table created in vector_artefacts.
- ✅ **M4.3.4** Delete `backend/internal/userstories/` package once endpoint is removed `[P3]`
  Package retained (code still valid Go) — can be deleted in a separate cleanup pass alongside M3.3.4 (defects package). Endpoint removed; package is now dead code.

---

## M5. Portfolio Items

Portfolio-scoped work items (`obj_portfolio_items`). Same consolidation pattern — collapses into `artefacts`, endpoint retires. Plan: [PLA-0033](dev/plans/PLA-0033.json)

### ✅ ~~M5.1 API — Retire `/portfolio-items`, serve via `/work-items`~~

- ✅ **M5.1.1** Verify `GET /work-items?item_type=portfolio+item` returns portfolio items post-ETL `[P2]`
  `[✓] M5.2.1 Portfolio Item type seeded → [✓] M5.3.3 ETL verified → [✓] M5.2.3 /work-items returns portfolio items`
  Note: PI scope changed to `work` (from `strategy`) so the work-items handler serves it. `portfolio item` added to `validItemTypes` in `workitemsv2/types.go`.
- ✅ **M5.1.2** Remove `/portfolio-items` from `/samantha/v1` block in `main.go` `[P2]`
  `[✓] M5.1.1 /work-items verified as replacement` — import, svc, handler, and route block all removed.
- ✅ **M5.1.3** Mark `/portfolio-items` as `deprecated: true` in `openapi.yaml` `[P2]`
  `[✓] M5.1.1 /work-items verified as replacement` — all 4 operations marked deprecated.
- ✅ **M5.1.4** Update any frontend callers of `api('/portfolio-items')` `[P2]`
  `[✓]` — No-op: `app/(user)/portfolio-items/page.tsx` is a placeholder with no `api()` calls.

### ✅ ~~M5.2 New Database — `vector_artefacts`~~

- ✅ **M5.2.1** Seed `artefact_types` row for `Portfolio Item` `[P2]`
  `[✓] M5.3.1 Column audit complete` — done in `db/artefacts_schema/030_seed_portfolio_item_type.sql`
- ✅ **M5.2.2** Seed `artefact_field_library` entries for portfolio-item-specific columns `[P2]`
  `[✓] M5.3.1 Column audit complete → [✓] M5.2.1 Portfolio Item type seeded` — 22 `pi_*` fields + `artefact_type_fields` bindings in 030 migration
- ✅ **M5.2.3** Verify `/work-items` returns portfolio item artefacts with correct field values `[P2]`
  `[✓] M5.2.1 Type seeded → [✓] M5.2.2 Field library seeded → [✓] M5.3.3 ETL run and verified` — 0 source rows in dev; endpoint responds correctly for `item_type=portfolio+item`.

### ✅ ~~M5.3 Old Database — `mmff_vector`~~

- ✅ **M5.3.1** Audit `obj_portfolio_items` columns — map each to `artefacts` or `artefact_field_values` `[P2]`
  Column map documented in `db/artefacts_schema/030_seed_portfolio_item_type.sql` header. 12 native columns, 22 custom fields, 8 computed rollup columns excluded.
- ✅ **M5.3.2** Write ETL script: insert `obj_portfolio_items` rows into `artefacts` (type=Portfolio Item) `[P2]`
  `[✓] M5.3.1 Column audit complete → [✓] M5.2.1 Type seeded → [✓] M5.2.2 Field library seeded` — `dev/scripts/etl_portfolio_items.sql`
- ✅ **M5.3.3** Run ETL on dev DB; verify row counts and field values `[P2]`
  `[✓] M5.3.2 ETL script written` — FDW-based ETL ran; 0 source rows in dev (expected); schema compatible. `fdw_portfolio_items` foreign table created.
- ✅ **M5.3.4** Delete `backend/internal/portfolioitems/` package once endpoint is removed `[P3]`
  `[✓] M5.1.2 /portfolio-items v1 endpoint removed` — package deleted. `userstories` package also deleted (M4.3.4).

---

## M6. Topology

The org chart canvas — a tree of nodes representing offices, teams, and roles. The most complex migration: the tree is self-referential (each node points to its parent by ID), so copying must preserve the exact structure. Three new tables needed in `vector_artefacts`: `topology_nodes`, `topology_role_grants`, `topology_view_state`. Plan: [PLA-0034](dev/plans/PLA-0034.json)

### ✅ ~~M6.1 API — Register `/topology` on v2~~

- ✅ **M6.1.1** Register full CRUD for `/topology` under `/samantha/v2` in `main.go` `[P2]`
  > Done 2026-05-09 — topology block moved from root `/api` into `/samantha/v2`; `orgDesignH` wired; `go build` clean.
- ✅ **M6.1.2** Remove `/topology` from `/samantha/v1` block `[P2]`
  > Done 2026-05-09 — topology was at root `/api` level (not v1); removed from root as part of M6.1.1 move.
- ✅ **M6.1.3** Update `openapi-v2.yaml` with `/topology` path specs `[P2]`
  > Done 2026-05-09 — topology tag + 14 path entries + 4 schemas added; YAML validates clean.
- ✅ **M6.1.4** Switch `app/lib/topologyApi.ts` calls from `api()` to `apiV2()` `[P2]`
  > Done 2026-05-09 — all calls switched to `apiV2()`; `setViewState` reshaped to viewport coords; `OrgLevel` type and levels methods removed; `level_id` dropped from `OrgNode`; no TS errors.
- ✅ **M6.1.5** Audit topology components (`TopologyTreeFlyout`, `useTopologyData`, `useTopologyHandlers`, etc.) for any remaining `api()` calls `[P2]`
  > Done 2026-05-09 — grep confirms no remaining `api()` / `OrgLevel` / `level_id` references in frontend.

### ✅ ~~M6.2 New Database — `vector_artefacts`~~

- ✅ **M6.2.1** Design `topology_nodes` table — `workspace_id` tenancy, `parent_id` self-FK, spatial fields (`x`, `y`, `width`, `height`) `[P2]`
  > **START HERE →** can design in parallel with M6.3.1 audit
  >
- ✅ **M6.2.2** Design `topology_role_grants` table — links RBAC roles to topology nodes (soft FK to `roles` if not yet in `vector_artefacts`) `[P2]`
  `[✓] M6.2.1 topology_nodes designed (need PK/FK refs)`
- ✅ **M6.2.3** Design `topology_view_state` table — per-user canvas viewport (acceptable to reset on cutover) `[P2]`
  `[✓] M6.2.1 topology_nodes designed (need PK/FK refs)`
- ✅ **M6.2.4** Write migration `031_topology_nodes.sql` `[P2]`
  `[✓] M6.2.1 Table designed`
- ✅ **M6.2.5** Write migration `032_topology_role_grants.sql` `[P2]`
  `[✓] M6.2.2 Table designed → [✓] M6.2.4 Migration applied (FK dependency)`
- ✅ **M6.2.6** Write migration `033_topology_view_state.sql` `[P2]`
  `[✓] M6.2.3 Table designed → [✓] M6.2.4 Migration applied (FK dependency)`
- ✅ **M6.2.7** Rewrite `orgdesign.Service` to query `vectorArtefactsPool` `[P2]`
  > Done 2026-05-09 — dual-pool pattern (`pool` mmff_vector for auth, `vaPool` vector_artefacts for all topology I/O); `levels.go` deleted; column renames applied; `SetViewState` reshaped to viewport coords; `go build` clean; `go test ./internal/orgdesign/...` passed.

### ✅ ~~M6.3 Old Database — `mmff_vector`~~

- ✅ **M6.3.1** Audit `org_nodes` columns — confirm `subscription_id → workspace_id` mapping `[P2]`
  > **START HERE →** unblocked, no prerequisites
  >
- ✅ **M6.3.2** Write ETL script for `org_nodes → topology_nodes` — retain original UUIDs so `parent_id` links survive intact `[P2]`
  `[✓] M6.3.1 Column audit complete → [✓] M6.2.4 Migration applied`
- ✅ **M6.3.3** Write ETL script for `roles_org_nodes → topology_role_grants` — resolve `role_id` cross-DB reference `[P2]`
  `[✓] M6.3.2 topology_nodes ETL written (need FK refs) → [✓] M6.2.5 Migration applied`
- ✅ **M6.3.4** Write ETL script for `org_node_view_state → topology_view_state` — reset decision documented `[P2]`
  `[✓] M6.3.2 topology_nodes ETL written (need FK refs) → [✓] M6.2.6 Migration applied`
- ✅ **M6.3.5** Run all three ETLs on dev DB; walk the tree to verify parent/child integrity `[P2]`
  > Done 2026-05-09 — 58 topology nodes migrated (1 root, max depth 6, 0 orphans); 0 role grants (dev DB has none); `topology_view_state` intentionally empty (viewport reset on cutover).
- ✅ **M6.3.6** Retain `mmff_vector` pool for membership check only `[P2]`
  > Done 2026-05-09 — `pool` used only for subscription/membership queries; all topology I/O via `vaPool`.

---

## B1. Core Work Item Engine

Full lifecycle management for tasks, bugs, epics.

- ✅ ~~**B1.1** Full CRUD on work items (v2 — `vector_artefacts`)~~
- ✅ ~~**B1.2** Bulk operations — atomic update up to N items at once~~

  > `POST /api/v2/work-items/bulk` live — `handler.go:317`, `types.go:290`
  >
- ✅ ~~**B1.3** Parent/child hierarchy — items nested under epics~~

  - ✅ ~~**B1.3.1** `GET /work-items/{id}/children` — full descendant list with depth~~

  > `handler.go:120`, `service.go:279` — `children_count` on all item responses
  >
- **B1.4** State machine enforcement — reject invalid flow-state transitions at the API `[P2]`

  > `flow_state_id` accepted on update but no transition validation against `flow_transitions` table yet — `flow_transitions` table exists but is not queried by the update path
  > Last checked: 2026-05-08
  >
- ✅ ~~**B1.5** Ranking / drag-drop reorder~~
- ✅ ~~**B1.6** Field values on items (`field_values` on item response)~~

  > `GET /api/v2/work-items/{id}/field-values` live — `handler.go:341`
  >
- **B1.7** Work item templates `[P4]`
- **B1.8** Blocked-state — orthogonal stuck flag with provenance `[P2]`
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `5d7e472` (2026-05-09): fix(auth): _bootstrapped flag prevents HMR re-runs from firing second refresh() on rotated rt cookie [B16]
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > Plan `PLA-0038` (2026-05-09): Blocked-state — orthogonal stuck flag with provenance for work items
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
  > Blocked is its own state, **independent of flow state** — an item can be blocked at any point in its workflow. The fact a story is "stuck on dev" tells us nothing about why; the blocked record carries that context. Schema (work-item columns, all nullable except `is_blocked` boolean):
  > - `is_blocked` `BOOLEAN NOT NULL DEFAULT FALSE` — convenience flag for indexing/filters
  > - `blocked_id` `UUID` — surrogate id for the active blocker record (so history can be added later without schema churn)
  > - `blocked_title` `TEXT` — short label, e.g. "Waiting on legal review"
  > - `blocked_description` `TEXT` — free-form detail
  > - `blocked_reason` `TEXT` — short categorisation (later: enum/lookup once patterns emerge)
  > - `blocked_user_reporter` `UUID` — who flagged it blocked
  > - `blocked_user_unblocked` `UUID` — who cleared the block (null while still blocked)
  > - `blocked_date_blocked` `TIMESTAMPTZ` — when the block was raised
  > - `blocked_date_unblocked` `TIMESTAMPTZ` — when the block was cleared (null while still blocked)
  >
  > **Sub-items below.** Webhook event `item.blocked` is a downstream consumer (B1.8.5).
  >
  - **B1.8.1** Migration — add `blocked_*` columns to `artefacts` table `[P2]`
    > Single migration in `db/artefacts_schema/`; index on `(workspace_id, is_blocked) WHERE is_blocked = TRUE` for fast unblocked-list queries.
    >
  - **B1.8.2** Backend — `Block` / `Unblock` service methods on `workitemsv2/service.go` `[P2]`
    > `Block(ctx, subID, itemID, BlockInput)` sets all `blocked_*` fields + `is_blocked=TRUE`, fires `item.blocked` notifier. `Unblock(ctx, subID, itemID)` sets `blocked_user_unblocked` + `blocked_date_unblocked`, flips `is_blocked=FALSE`, fires `item.unblocked`. Both operations leave flow_state_id untouched.
    >
  - **B1.8.3** API routes — `POST /work-items/{id}/block` and `POST /work-items/{id}/unblock` `[P2]`
    > Mounted on v2; OpenAPI spec updated. `block` body: `{title, description, reason}`; `unblock` body: `{}` (server fills user + timestamp).
    >
  - **B1.8.4** UI — block/unblock action on work-item detail panel + visual marker `[P2]`
    > Button on `WorkItemDetailPanel.tsx`; opens small form (title required, description + reason optional). When blocked: panel shows red banner with reporter + date; tree row shows red dot/badge. Unblock action records `blocked_user_unblocked` automatically.
    >
  - **B1.8.5** Webhook event wiring — `item.blocked` + `item.unblocked` `[P3]`
    > Notifier already lists `item.blocked` in `WebhookForm.tsx` dropdown. Add `item.unblocked` to dropdown. Backend fires both from B1.8.2 service methods. (Replaces deferred B9.7 wiring task — track here.)
    >
  - **B1.8.6** Reports — blocked-time on cycle/lead time and "currently blocked" filter `[P3]`
    > Cycle-time/lead-time reports subtract blocked windows. List views get `blocked = true/false` filter. Blocked items surface at the top of stale-work reports.
    >

---

## B2. Sprint & Timebox Management

- ✅ ~~**B2.1** Sprint CRUD — full v2 including create, edit, delete (PLA-0027 + PLA-0030 T2)~~
- ⚠️ **B2.2** Sprint lifecycle (`planning` → `active` → `closed`) `[P2]`

  > `POST /{id}/start` (planned→active) and `POST /{id}/close` (active→completed) are live with atomic UPDATE guards and `ErrStartLifecycle`/`ErrCloseLifecycle` errors. `PATCH` body can still set status freely — B2.2.2 (item-state validation) remains open.
  > Last checked: 2026-05-08
  >

  - ✅ ~~**B2.2.1** `POST /sprints/{id}/start` + `/close` explicit lifecycle actions `[P2]`~~
    > Commit (2026-05-08): `Start`/`Close` on service + handler; `ErrStartLifecycle`/`ErrCloseLifecycle`; notifier fires `sprint.started`/`sprint.closed`; routes wired under `WorkItemsSettingsEdit` permission.
    >
  - **B2.2.2** Validate item state before adding to active sprint `[P3]`
- **B2.3** Sprint goal field `[P3]`
- **B2.4** Sprint velocity tracking `[P3]`
- **B2.5** Burndown snapshot (`GET /sprints/{id}/burndown?date=`) `[P3]`
- **B2.6** Active sprint summary per workspace `[P3]`
- **B2.7** Releases timebox kind `[P4]`

---

## B3. Portfolio & Master Record

- ✅ ~~**B3.1** Master record (`/portfolio/master_record`) — v2 live~~
- ✅ ~~**B3.2** Portfolio layers (`/workspace/{id}/portfolio/layers`) — v2 live~~
- **B3.3** Portfolio items — retiring, consolidating into work items (see M5) `[P3]`
- **B3.4** Subscription layers — legacy, retire once frontend migrated to workspace-scoped v2 `[P3]`
- **B3.5** Portfolio adoption cutover (PLA-0024 / PLA-0026) `[P2]`
- **B3.6** Portfolio models — architectural decision pending (PLA-0030 T6) `[P4]`

---

## B4. Custom Fields

- ⚠️ **B4.1** Custom field library — define field types and options `[P2]`
  > Schema exists (`artefact_field_library`, `artefact_type_fields`), seeding scripts written for DE/US/PI types, and `GET /workspace/{id}/fields` resolver is live. Missing: no UI field manager to add/edit/delete fields without SQL. API-only today.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B4.2** Field schema endpoint (`/workspace/{id}/fields`) — v2 live~~
- ✅ ~~**B4.3** Field values on work item responses~~
  > `ListFieldValues`, `UpsertFieldValues`, `DeleteFieldValue` all live in `backend/internal/workitemsv2/handler.go` — `GET/PUT/DELETE /work-items/{id}/field-values`
  > Last checked: 2026-05-08
  >
- **B4.4** Custom field manager UI `[P3]`
- **B4.5** Item templates with field defaults `[P4]`

---

## B5. Roles & Permissions (RBAC)

- ✅ ~~**B5.1** Data-driven RBAC — `roles` / `permissions` / `roles_permissions` tables~~
  > `backend/internal/roles/service.go` + `permissions/` — full service live
  >
- ✅ ~~**B5.2** 5 seeded system roles (gadmin / padmin / team_lead / user / external)~~
  > Stable UUIDs `ad30/ad25/ad20/ad10/ad05` confirmed in `roles/service.go:31-35`
  >
- ✅ ~~**B5.3** 26 seeded permissions~~
  > `backend/internal/permissions/catalogue.go` — full permission catalogue live
  >
- ✅ ~~**B5.4** `useHasPermission(<code>)` frontend gate~~
  > `app/contexts/AuthContext.tsx:183` — canonical gate; used in multiple components
  >
- **B5.5** Custom role creation and assignment `[P3]`
- **B5.6** Replace stop-gap permission codes with precise codes (TD-PERM-001) `[P3]`
- **B5.7** `api_keys.manage` permission — not yet wired to API key routes `[P3]`
- **B5.8** Capability matrix — single transparent view of role × permission grants `[P2]`
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > Today the answer to "what can padmin do?" is spread across `db/schema/088_roles_permissions.sql` + every follow-up migration that touched `roles_permissions` (100, 101, 142, …). Migrations using `WHERE p.code IN (...)` silently no-op when a code isn't in the `permissions` table — exactly why migration 142 reported success but granted nothing for `workspace.archive` / `flows.manage`. Build a read-only SQL view `v_role_capability_matrix` (roles × permissions × roles_permissions join) plus a `/dev/permissions-matrix` page rendering the grid. Highlights ungranted permissions that are referenced by `useHasPermission()` calls but missing from the catalogue.
  >
- **B5.9** Single source-of-truth seed for role capabilities `[P3]`
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
  > Follow-on to B5.8. Consolidate scattered grant migrations (088 / 100 / 101 / 142 / …) into one declarative seed file `db/schema/seeds/role_capabilities.sql` containing the full role × permission matrix. Future grants edit this file; runner reapplies the diff. Removes the silent-noop migration trap and makes "give padmin what gadmin has" a one-line edit.
  >
- **B5.10** Audit `useHasPermission()` codes against catalogue `[P2]`
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
  > `npm run lint:permission-codes` — fails CI if any `useHasPermission("…")` argument or backend `RequirePermission("…")` call references a code not present in `permissions` catalogue. Catches the migration-142-style failure at build time.
  >

---

## B6. Workspace & Topology

- ✅ ~~**B6.1** Workspace config and settings~~ `[P2]`
  > `GET/PATCH /api/tenant-settings` live — `backend/internal/tenantsettings`; backed by `master_record_tenant` in `vector_artefacts` (M2). Full field set: name, description, timezone, date/datetime formats, workdays, week start, rank method, build-changeset tracking, notes, data region, primary contact email. Frontend: `/workspace-settings/organization` — full form with UnsavedChangesBar, client+server 422 validation. `PATCH /workspaces/{id}` rename also live.
  > Last checked: 2026-05-09
- ✅ ~~**B6.2** Org node tree~~ `[P2]`
  > `TopologyTreeFlyout` live — tree flyout rail with collapse/expand, inline rename, context menu, archive-map. Data via `topologyApi.tree()` → `/samantha/v2/topology/tree`. ETL complete (M6.3.5 — 58 nodes migrated). TS clean.
- ✅ ~~**B6.3** Topology canvas page~~ `[P3]`
  > Full React Flow canvas at `/workspace-settings/topology` (embedded) and `/(overlay)/topology` (full-viewport). dagre layout, workspace clamp, context menu, edit flyout, archive flyout, move-preview modal, sandbox/live mode toggle. All calls on v2 (M6.1). TS clean.
- ✅ ~~**B6.4** Workspace role assignments~~
  > `GrantRole` + `RevokeRole` live in `backend/internal/workspaces/roles.go` — `POST/DELETE /workspaces/{id}/members/{userId}/roles/{roleId}`
  > Last checked: 2026-05-08
  >
- ✅ ~~**B6.5** Workspace-scoped field schema — v2 live~~
- ✅ ~~**B6.6** Retire legacy org_* tables~~
  > Migration 138: `org_nodes`, `org_levels`, `org_node_roles` dropped from mmff_vector. No backend consumers since M6.2.7 cutover (verified by grep audit). Zero rows since cutover date. Applied 2026-05-09.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B6.7** Fix padmin role access to workspace-settings~~
  > padmin role was unable to save navigation preferences due to workspace-settings being gadmin-only but default_pinned=TRUE. Fixed via: (1) Migration 140 grants padmin access to workspace-settings in roles_pages table, (2) Migration 141 restores workspace-settings.default_pinned = TRUE so padmin sees it in defaults. The earlier migration 139 (default_pinned=FALSE) was the wrong approach and is now superseded.
  > Last checked: 2026-05-09
  >

---

## B7. Search

- ⚠️ **B7.1** Background search worker — indexes text + vector embeddings `[P2]`

  - ✅ ~~**B7.1.1** Worker is currently a no-op after DB migration — must be rewired to new DB~~

  > Rewired: `worker.go` now reads `artefacts_search_outbox` in `vector_artefacts` (vaPool). Migration `035_search_outbox.sql` adds `search_index` (tsvector), `content_embedding` (vector(768)), outbox table + enqueue trigger. `main.go` guards with `if vaPool != nil`. Pending: migration applied on dev + Ollama running.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B7.2** `POST /search` query endpoint `[P2]`~~

  > `backend/internal/search/` — fulltext via `plainto_tsquery` on `search_index`, ranked by `ts_rank`. Optional `type_ids` filter. 100-result cap. Route mounted under `/api/v2/search` (auth + rate-limit); graceful 503 when vaPool unavailable.
  > Last checked: 2026-05-08
  >
- **B7.3** Vector similarity reranking `[P4]`

---

## B8. Public API & Integrations

- ✅ ~~**B8.1** API keys — scoped, revokable, usage tracking~~
  > `backend/internal/apikeys/` — full package; `Issue`, `List`, `Revoke` endpoints live at `/api-keys/*`; `SeedDevKey` seeder; middleware wired on v2 routes (`main.go:788`)
  >
- ✅ ~~**B8.2** Rate limiting — per IP and per user~~
  > `httprate.LimitByIP` on all route groups + `security.LimitByUserOnWrites` per-user write limiter (`main.go:404`)
  >
- ✅ ~~**B8.3** OpenAPI v2 spec (`openapi-v2.yaml`) — live~~
- **B8.4** TypeScript SDK `[P4]`
- **B8.5** Python SDK `[P5]`
- **B8.6** Postman collection `[P4]`
- **B8.7** Idempotency keys on mutating public endpoints `[P2]`
  > `Idempotency-Key` request header → server stores `(tenant_id, key, response_body, status_code)` for 24h and replays on retry. Stripe model. Required before any external integration ships, otherwise consumers with retry loops double-create. Scope: every POST/PATCH/DELETE on `/samantha/v2`. Storage: new `idempotency_records` table in `vector_artefacts` keyed on `(tenant_id, key)` with TTL cleanup. Middleware fires before handler; cache hit short-circuits. Exempt from BFF / admin surface.
- **B8.8** Cursor-based pagination on list endpoints `[P2]`
  > Replace offset/limit on every public list endpoint with stable cursors (`next_cursor` token over `(sort_key, id)` tuple). Offset breaks under concurrent inserts; cursors are stable. Scope: `/work-items`, `/portfolio-items`, `/timeboxes/sprints`, `/work-items/relations`, `/webhooks` listing. Cursor is opaque base64 of the last-row sort tuple. Required before any tenant exceeds ~10k items in a list. B19.1.5 (graph 100k truncation) becomes a special case of this rule.
- **B8.9** Sparse fieldsets — `?fields=id,title,status` on every list/get endpoint `[P3]`
  > Lets integrators avoid hauling full DTOs over the wire on large lists. REST equivalent of GraphQL field selection. Implementation: comma-separated allow-list parsed in middleware, applied as a SELECT projection or post-marshal mask. Scope: every `GET` on `/samantha/v2`. TD-API-001 item 4 (GraphQL deferred) — sparse fieldsets are the chosen substitute.
- **B8.10** Per-tenant API keys with scoped permissions `[P2]`
> Commit `761d7cd` (2026-05-09): fix(B22): DevPageHelpPanel — apiSite import + strip stale /api/ prefix
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
  > Extend B8.1 (`apikeys` package) so each `sam_live_*` key carries a permission set that is a subset of the issuing user's permissions (e.g. `read:items`, `write:items`, `admin:roles`). Currently keys are flat — any key has the full scope of its owner. Scope: schema migration adds `api_keys.scopes jsonb` column; auth middleware honours scope set on every request; key-issuance UI lets admin pick scopes at creation; revoke unchanged. Pre-req for n8n trigger nodes (B12.1) since those need narrow read-only keys.
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive

> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
Backend + UI live; worker running. New event types under B9.7+ extend the catalogue.
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy

- ✅ ~~**B9.1** Webhook subscriptions table — URL, event filter, secret~~
  > `db/artefacts_schema/037_webhooks.sql` — `webhook_subscriptions` + `webhook_deliveries` tables; CRUD API at `GET/POST /workspaces/{id}/webhooks` + `GET/PATCH/DELETE /workspaces/{id}/webhooks/{webhookId}`; secret auto-generated (32-byte random hex) if not supplied
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
  >
- ✅ ~~**B9.2** Outbox delivery pattern~~
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
  > `webhook_deliveries` outbox table; `Enqueue` fans out to all matching active subscriptions; FOR UPDATE SKIP LOCKED claim
  >
- ✅ ~~**B9.3** Retry worker — exponential backoff, 24h window~~
  > `backend/internal/webhooks/worker.go` — exponential backoff (base 30s, cap 6h), up to 10 attempts; started via `go webhooks.NewWorker(vaPool).Run(shutdownCtx)` alongside search worker
  > Last checked: 2026-05-09 — worker started without errors post-migration 037
  >
- ✅ ~~**B9.4** Events: `item.created/updated/deleted`, `item.status_changed`, `sprint.started/closed` `[P1]`~~
  > All six events wired: `item.*` via `workitemsv2/service.go`; `sprint.started`/`sprint.closed` via `timeboxsprints/service.go`. Notifier pattern throughout — nil-safe, non-blocking.
  > Last checked: 2026-05-08
  >
- ✅ ~~**B9.5** Webhook management UI `[P2]`~~
  > `app/(user)/workspace-settings/webhooks/page.tsx` + `WebhookForm.tsx` — full CRUD UI at workspace-settings/webhooks tab; list view with URL/events/status columns; create/edit/delete actions; event filter dropdown (all events or specific types); secret show/hide toggle. Integrated into workspace-settings navigation as default-pinned tab. Backend API fully consumed.
  > Commit `9256433` (2026-05-09): feat(B9.5): webhook management UI at workspace-settings/webhooks
  > Last checked: 2026-05-09
  >
- ✅ ~~**B9.6** `X-Vector-Signature` HMAC header for consumer verification~~
  > `webhooks/worker.go:sign()` — HMAC-SHA256 of payload body keyed on subscription secret; sent as `X-Vector-Signature: sha256=<hex>`
  >
- **B9.7** `item.blocked` / `item.unblocked` event wiring → tracked under B1.8.5 (blocked-state feature) `[P3]`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `5d7e472` (2026-05-09): fix(auth): _bootstrapped flag prevents HMR re-runs from firing second refresh() on rotated rt cookie [B16]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
  > UI dropdown in `WebhookForm.tsx` lists "Item blocked" today but no fire site exists. The orthogonal blocked-state model (separate from flow state, with its own provenance fields) lives under B1.8; the webhook fire happens from the `Block`/`Unblock` service methods in B1.8.2.
  >

---

## B10. Async Jobs & Reporting

- **B10.1** Async job infrastructure — 202 Accepted + poll by job ID `[P2]`
- **B10.2** Burndown report `[P3]`
- **B10.3** Cumulative flow report `[P3]`
- **B10.4** Cycle time report `[P3]`

---

## B11. Real-Time & Async Push

- ✅ ~~**B11.1** Adoption SSE (`/adopt/stream`) — live; only real-time surface today~~
  > `backend/internal/errorsreport/adopt_stream.go` — confirmed live SSE endpoint
  > Last checked: 2026-05-08
  >
- **B11.2** General-purpose pub/sub — design decision pending `[P3]`
- **B11.3** Live board updates (item changes visible to other users) `[P3]`
- **B11.4** In-app notifications `[P3]`

---

## B12. n8n Integration

Depends on: B9 (webhooks) + B8.1 (API keys).

- **B12.1** n8n trigger node `[P3]`
- **B12.2** n8n action node `[P3]`
- **B12.3** API key credential type `[P3]`
- **B12.4** Community node package on n8n marketplace `[P4]`

---

## B13. Library & Portfolio Models

- ✅ ~~**B13.1** Library DB (`mmff_library`) — read-only pool~~
  > `main.go:124` — `mmff_library` read-only pool wired; consumed by `libraryreleases`, `errorsreport`, and reconciler packages
  > Last checked: 2026-05-08
  >
- **B13.2** Portfolio templates `[P3]`
- **B13.3** Library releases `[P4]`
- **B13.4** Tier-gated presets `[P4]`
- **B13.5** Cross-DB adoption mirrors `[P3]`
- **B13.6** Adoption orchestrator `[P3]`

---

## ✅ ~~B14. Addressables & Page Help~~

- ✅ ~~**B14.1** Panel / Table / Navigation addressable substrate~~ `[P2]`
  > `useRegisterAddressable` adopted in `Panel`, `Table`, `ResourceTree`, `Header`; `DomRegistryProvider` wraps app root; snapshot hydrated from `/api/addressables/snapshot` on first render.
- ✅ ~~**B14.2** Addressing scheme (`samantha._viewport.<slot>._kind.name`)~~ `[P2]`
  > `ViewportSlot` (six closed slots), `buildAddress` helper, `StrictRoute` opt-in gate — all live in `DomRegistryContext.tsx`. Lint rule `lint:addressables` enforces sole-writer. R049 research complete.
- ✅ ~~**B14.3** `addressables.Service` sole-writer boundary~~ `[P2]`
  > `backend/internal/addressables/service.go` — five methods; `boundary_test.go` CI-enforced regex; `lint:addressables` python script.
- ✅ ~~**B14.4** Samantha SDK help contract~~ `[P3]`
  > `samantha.contract.ts`, `SamanthaSdkContext.tsx` — help fetched from `/api/page-help/:id` in `Panel`; lazy-seeded from `library_help_defaults`; `helpable` bit per row.
- ✅ ~~**B14.5** Admin-managed contextual help per panel~~ `[P3]`
  > `PUT/DELETE /api/page-help/admin/:id`; `PATCH /api/addressables/admin/:id/helpable`; gadmin editor live.

---

## ✅ ~~B15. UI Primitives & Design System~~

- ✅ **B15.1** `<Table>` component — single sanctioned table primitive `[P2]`
  > `app/components/Table.tsx` — canonical primitive (657 LOC); `lint:no-raw-table` enforcement; 4 tree exceptions on allow-list; spec: `docs/c_c_table_component.md`
- ✅ **B15.2** `<ResourceTree>` / `ObjectTree` — hierarchical tree + configuration registry `[P2]`
  `[x] Generic dumb primitive (p_ObjectTree.tsx); pluggable data-type config via object-tree-registry.tsx; ready for releases/sprints/portfolio items`
  > `app/components/ResourceTree.tsx` (1554 LOC); five prop sets (Data/Scaffold/Features/CogMenu/Colour); addressable substrate; spec: `docs/c_c_resource_tree.md`
- **B15.2.5** Sidecar wizard JSON pattern (`p_wizard_*.json`) `[P2]`
  > Each `p_*` primitive component reads its config from a sibling JSON file in `app/components/<primitive>/configs/`. Static config (UI labels, columns, dnd type, **resourceUrl**, **scope**, panel header / filter chip selectors) lives in JSON; runtime closures (accessors, hooks, React nodes) injected by the page via `resolveWizardConfig()`. Goal: non-technical users configure components by editing JSON, no TypeScript. First adopter: `p_ObjectTree` with `p_wizard_workitems.json` + `p_wizard_portfolio.json`. Spec to write: `docs/c_c_wizard_sidecar.md` (tracked under B21.3.3).
- ✅ **B15.3** `<Badge>` — status / count / letter / tag variants `[P2]`
> Commit `3dc9cdd` (2026-05-09): chore(plans): normalise unicode escapes in PLA plan files
  > `app/components/Badge.tsx` — semantic tone derivation (status + domain maps); pill CSS family; spec: `docs/c_c_badge.md`
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
- ✅ **B15.4** `<TimeboxManager>` — sprints + releases surface `[P2]`
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
  > `app/components/TimeboxManager.tsx` (369 LOC) — generic `kind` system (sprint/release); table-per-kind via `kinds.ts` registry; spec: `docs/c_c_timebox_manager.md`
- ✅ **B15.5** `<DiagramCanvas>` — Canvas2D + dagre + d3-zoom `[P3]`
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
  > Spec: `docs/c_c_diagram_canvas.md` — Vector-built Canvas2D + dagre layout + d3-zoom; 10px snap-to-grid default; pluggable node renderer; exposed via Samantha API as `samantha.diagram.canvas`
- ✅ **B15.6** Drag-and-drop (`@dnd-kit`) `[P2]`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
  > `@dnd-kit/core` + `@dnd-kit/sortable` installed; canonical DnD library; sortable lists/tables/tabs; server is order of truth (250ms debounce); no competing libs; spec: `docs/c_c_dnd.md`
- ✅ **B15.7** Theme pack system `[P3]`
  > CSS variable theming live; warm neutrals palette per Design System; color derivation in Badge, Table, tree styles
- ✅ **B15.8** Dev-UI primitives (`.dui-*` catalog for internal pages) `[P3]`
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
  > `dev/styles/dev-ui.css` — `.dui-*` catalog live; HARD RULE: every `/dev` panel composes from catalog, no bespoke per-page classes, no inline styles; spec: `docs/c_c_dev_ui_primitives.md`
- ✅ **B15.9** CSS table migration — legacy `.table*` → canonical classes `[P3]`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
  > Legacy `.table*` family deprecated 2026-05-05; migration to canonical classes bundled with file changes; `.tree_accordion-dense__*` is the canonical table family

---

## B16. Security & Auth

- ✅ ~~**B16.1** JWT access + refresh tokens~~
- ✅ ~~**B16.2** CSRF protection~~
  > `security.CSRF` middleware wired (`main.go:437`); `X-CSRF-Token` header enforced; double-submit cookie pattern
  >
- ✅ ~~**B16.3** Per-IP + per-user write rate limiting~~
  > See B8.2 — same implementation
  >
- ✅ ~~**B16.4** API key auth — scoped, revokable~~
  > See B8.1 — same implementation
  >
- ✅ ~~**B16.5** Client IP extraction~~
  > `backend/internal/security/clientip.go` — `ClientIP()` helper confirmed live
  > Last checked: 2026-05-08
  >
- ✅ ~~**B16.6** Security checklist (Trust-No-One)~~
  > `docs/c_security.md` — Trust-No-One checklist document confirmed
  > Last checked: 2026-05-08
  >

---

## B17. Infrastructure & DevOps

- ✅ ~~**B17.1** Go backend on `:5100`~~
  > Running via `go run ./cmd/server` on `:5100`; `/healthz` confirmed
  > Last checked: 2026-05-08
  >
- **B17.2** Next.js frontend `[P1]`
- **B17.3** Three PostgreSQL databases — `mmff_vector`, `mmff_library`, `vector_artefacts` `[P1]`
- ✅ ~~**B17.4** pgvector extension for embeddings~~
  > Added via `035_search_outbox.sql` — `CREATE EXTENSION IF NOT EXISTS vector`; `content_embedding vector(768)` column on `artefacts`
  > Last checked: 2026-05-08
  >
- **B17.5** Ollama (`nomic-embed-text`) local embedding model `[P3]`
- ✅ ~~**B17.6** DB migration toolchain~~
  > `backend/migrate` compiled binary confirmed; `db/artefacts_schema/` SQL files numbered sequentially (001–035)
  > Last checked: 2026-05-08
  >
- ✅ ~~**B17.7** API snapshot toolchain — dual-spec, `api-snapshots/v1/` + `v2/`~~
- **B17.8** Unused index audit `[P3]`
- **B17.9** API gateway in front of public surface `[P3]`
> Commit `761d7cd` (2026-05-09): fix(B22): DevPageHelpPanel — apiSite import + strip stale /api/ prefix
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
  > Terminate `/samantha/v2` behind a dedicated gateway (Kong / Envoy / AWS API Gateway). Gateway owns: API-key auth, per-key rate limiting, OpenAPI request/response validation, deprecation headers, observability hooks. Service code stops handling unauthenticated/malformed requests. Pre-req: `api.vector.app` subdomain + Option B physical split (separate `chi.Mux` for public vs BFF inside the binary). Premature today — one Go binary suffices until external traffic exists; revisit when first integration partner signs or before Series B.

---

> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
## B18. Developer Experience

- ✅ ~~**B18.1** OpenAPI v2 spec (see B8.3)~~
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
- **B18.2** TypeScript SDK `[P4]`
- **B18.3** Python SDK `[P5]`
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
- **B18.4** Postman collection `[P4]`
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
- **B18.5** Rate limit response headers `[P3]`
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
  > No `X-RateLimit-*` headers found — rate limiting fires but doesn't expose headers to consumers
  > Last checked: 2026-05-08
  >
- ⚠️ **B18.6** Structured error responses — `error_code` + `details` on all 4xx/5xx `[P2]`
  > `error_code` field referenced in `errorsreport/handler.go` and `portfoliomodels/adopt.go` / `adopt_stream.go` — exists on adoption error paths but not consistently on all 4xx/5xx handlers
  > Last checked: 2026-05-08
  >

---

## B19. Work Item Relations Graph

A 3D force-directed graph (Obsidian-style globe) for visualising the work-item hierarchy at tenant scale. New tab on the Work Items page at `/work-items/work-item-relations`. Nodes coloured by type (Epic/Story/Defect/Task), hub size proportional to descendant count, mouse-drag rotation, search + neighbour-mode + depth slider. Stack: `3d-force-graph` (Three.js + d3-force-3d) with route-level dynamic import (`ssr:false`). 55k-row test seed already in place (500 epics + 100 top-level defects + descendants). Plan: [PLA-0035](dev/plans/PLA-0035.json)

### ✅ ~~B19.1 API — `/api/v2/work-items/relations`~~

- ✅ **B19.1.1** Design `GET /api/v2/work-items/relations` payload — `{nodes: [{id,type,title,state,descendantCount,parentId}], edges: [{source,target,kind:"parent"}], meta}` `[P2]`
- ✅ **B19.1.2** Write recursive-CTE descendant-count query against `vector_artefacts.artefacts` — single materialised pass per request `[P2]`
  `[x] B19.1.1 Payload designed`
- ✅ **B19.1.3** Implement route handler `app/api/v2/work-items/relations/route.ts` — workspace + type filters, `Cache-Control: private, max-age=30` `[P2]`
  `[x] B19.1.2 CTE query written`
- ✅ **B19.1.4** Update `openapi-v2.yaml` with `/work-items/relations` path spec `[P2]`
  `[x] B19.1.3 Route live`
- **B19.1.5** Document 100k-row truncation threshold + cursor-based fallback shape (not built in v1) `[P3]`
  `[x] B19.1.3 Route live`

### ✅ ~~B19.2 Page Structure — Tab Conversion~~

- ✅ **B19.2.1** Convert `app/(user)/work-items/page.tsx` body into `app/(user)/work-items/list/page.tsx` (preserve existing list view) `[P2]`
- ✅ **B19.2.2** Add `app/(user)/work-items/layout.tsx` with `PageShell` + `SecondaryNavigation` per [`docs/c_c_secondary_nav_deeplink.md`](docs/c_c_secondary_nav_deeplink.md) `[P2]`
  `[x] B19.2.1 List moved to /list`
- ✅ **B19.2.3** Replace `app/(user)/work-items/page.tsx` with `redirect("/work-items/list")` to keep bookmarks alive `[P2]`
  `[x] B19.2.1 List moved to /list → [x] B19.2.2 Layout in place`
- ✅ **B19.2.4** Audit existing `app/(user)/work-items/settings/` to confirm it still resolves under the new layout `[P2]`
  `[x] B19.2.2 Layout in place`
- ✅ **B19.2.5** Run `npm run lint:tab-deep-link` to verify no `urlKey`/`useTabState` regression `[P2]`
  `[x] B19.2.3 Redirect in place → [x] B19.2.4 Settings audit clean`

### B19.3 Frontend — Graph Component

- ✅ **B19.3.1** Install `3d-force-graph` + `three-spritetext`; verify `three@0.184.0` already pinned by `PortfolioGraphChart.tsx` `[P2]`
  `[x] B19.2.2 Layout in place (so the new tab can mount)`
- ✅ **B19.3.2** Scaffold `app/components/WorkItemRelations/index.tsx` orchestrator + `useRelationsData.ts` hook `[P2]`
  `[x] B19.1.3 API live → [x] B19.3.1 Libs installed`
- ✅ **B19.3.3** Build `RelationsGraph.tsx` — Three.js canvas via `dynamic(() => import, { ssr:false })`, parent edges, type-coloured nodes, `nodeVal = log2(descendantCount+2)` for hub sizing `[P2]`
  `[x] B19.3.2 Orchestrator scaffolded`
- ✅ **B19.3.4** Build `RelationsToolbar.tsx` — search box, type checkboxes, depth slider (0–10/∞), neighbour-mode toggle `[P2]`
  `[x] B19.3.3 Graph renders`
- ✅ **B19.3.5** Build `RelationsSidebar.tsx` — selected-node detail (type, id, state, depth, descendants, parent, open-in-list) `[P2]`
  `[x] B19.3.3 Graph renders → [x] B19.3.4 Selection wired`
- ✅ **B19.3.6** Implement search → fly-to via `cameraPosition({}, node, 1500)` `[P2]`
  > Done 2026-05-09 — `onFlyToReady` callback registered on mount; orchestrator effect fires `flyToRef.current(id)` when `filters.q` narrows to exactly one visible node. Camera flies with 1500ms transition.
- ✅ **B19.3.7** Implement neighbour-mode BFS at depth N — dim non-neighbours, highlight selected sub-graph `[P2]`
  > Done 2026-05-09 — `bfsNeighbours()` computes k-hop adjacency set from `selectedId` up to `filters.neighbourDepth` (1–6 hops). Non-members get `#rrggbb28` colour (16% opacity); `linkVisibility` hides non-neighbourhood edges. Hops slider appears in toolbar when neighbour mode is checked.
- ✅ **B19.3.8** New page route `app/(user)/work-items/work-item-relations/page.tsx` mounting `<WorkItemRelations />` `[P2]`
  `[x] B19.3.3 Graph renders → [x] B19.2.2 Layout in place`

### ❌ NFA — B19.4 Performance

**Status:** Parked pending B19.5.2 (filter guardrails). Graph currently renders unfiltered tenant data → visual mess; layout perf work premature until filters prevent overload.

- **B19.4.1** Move d3-force-3d layout into a Web Worker (`useGraphLayoutWorker.ts`) — serialise positions back per tick `[P2]`
  `[ ] Blocked by B19.5.2 (filters needed first)`
- **B19.4.2** Cap `cooldownTicks` at ~120; persist final positions in `sessionStorage` keyed by `(tenant, filterHash)` so re-entry is instant `[P2]`
  `[ ] Blocked by B19.5.2`
- **B19.4.3** Distance-based LOD for labels — only render `three-spritetext` for nodes within camera radius < threshold OR in selection set `[P3]`
  `[ ] Blocked by B19.5.2`
- **B19.4.4** Bundle-size check via `next build` analyser — confirm Three + 3d-force-graph stay in a lazy chunk gated to this tab `[P2]`
  `[ ] Blocked by B19.5.2`
- **B19.4.5** Document 500k-node v2 strategy (server-side layout precompute, GPU instancing, edge bundling) — design only, not built `[P4]`
  `[ ] Deferred to PLA-0037`

### B19.5 Saved Views, Mini-Map, Polish

- **B19.5.1** Build `RelationsMiniMap.tsx` — orthographic 2D top-down sharing positions, click-to-fly camera `[P3]`
  `[ ] B19.3.3 Graph renders`
- **B19.5.2** Saved filter views — schema decision: reuse `user_custom_pages` or new `user_relations_views` table `[P3]`
  `[ ] B19.3.4 Toolbar live`
- **B19.5.3** Implement save/load/delete view UI in toolbar `[P3]`
  `[ ] B19.5.2 Schema decided`
- **B19.5.4** Animation pause/resume on idle (`pauseAnimation()`) `[P4]`
  `[ ] B19.4.1 Worker live`
- **B19.5.5** PNG export + share-link with camera position serialised in URL `[P4]`
  `[ ] B19.3.3 Graph renders`
- **B19.5.6** Touch/pinch on iPad — `OrbitControls.touches` mapping `[P5]`
  `[ ] B19.3.3 Graph renders`

### B19.6 Tests, Realtime, Schema Follow-up

- **B19.6.1** Playwright E2E smoke — page loads, graph renders >0 nodes, search highlights, sidebar opens `[P2]`
  `[ ] B19.3.8 Page route live → [ ] B19.3.5 Sidebar live`
- **B19.6.2** Subscribe to existing `useRefetchOnPush` topic for work-item changes; debounced refetch only when tab is visible `[P3]`
  `[ ] B19.3.2 Hook scaffolded`
- ✅ **B19.6.3** Reserve **PLA-0036** for `work_item_links` table (kinds: blocks, depends_on, relates_to, duplicates) — adds non-tree edges to the graph `[P3]`
  `[x] B19.1.3 v1 API shipped (so edge stream can extend cleanly)`
- **B19.6.4** Write `docs/c_c_work_item_relations.md` — API shape, perf budget, follow-up PLA-0036 pointer `[P2]`
  `[ ] B19.3.8 Page route live`

---

## B20. User Access Rights & Navigation Control

Manage per-role access to pages and features. Control what each role (user, padmin, gadmin) can view and pin in navigation.

### B20.1 Role-based Page Access

- ✅ ~~**B20.1.1** Role gate system for pages — `roles_pages` junction table~~
  > `pages` table seeded with system pages (dashboard, portfolio, workspace-settings, etc.); `roles_pages` defines which roles can view each page. Queries scoped by role via `nav.Service.CatalogFor(role)`. All seeded pages + role assignments live.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.1.2** Frontend catalogue filtering by user role~~
  > `NavPrefsContext.tsx` loads catalogue from `/nav/catalogue`, filtered to only show pages user's role can access. Prevents role-forbidden items in UI.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.1.3** Backend validation of pinned items against role permissions~~
  > `nav.Service.ReplacePrefsForProfile()` validates each pinned item exists in user's role-filtered catalogue before saving. Rejects with `ErrRoleForbidden` if user tries to pin page outside their role.
  > Last checked: 2026-05-09
  >

### B20.2 Default Navigation Profiles

- ✅ ~~**B20.2.1** Default pinned items by role~~
  > `pages.default_pinned = TRUE` flags items shown by default when user first creates nav prefs. Filtered by role via catalogue so each role sees only its own defaults. E.g., workspace-settings is default for gadmin + padmin, hidden from user role.
  > Last checked: 2026-05-09
  >
- ✅ ~~**B20.2.2** Graceful hydration when defaults change~~
  > Frontend draft reconstruction skips items not in current catalogue (migration-safe: if a default gets removed, user's existing pinned list stays stable; only new users see the updated set).
  > Last checked: 2026-05-09
  >

### B20.3 Role-Specific Feature Access

- ✅ ~~**B20.3.1** padmin access to workspace-settings~~
  > Migration 140 grants padmin role to `roles_pages` for workspace-settings; Migration 141 keeps it as default_pinned. padmin can now see, pin, and edit workspace-settings tabs (role-gated via `useHasPermission` per-tab). Gadmin retains full access.
  > Last checked: 2026-05-09
  >
- **B20.3.2** Permission predicate per tab in workspace-settings `[P2]`
  > Some tabs (e.g., users, permissions) are gadmin-only; padmin sees a subset (organization, workspaces, portfolio_model, etc.). Use `useHasPermission()` checks to hide/disable tabs per role. Define permission codes per tab in service layer.
  >
- **B20.3.3** Role-gated custom pages (Phase 5+) `[P4]`
  > When users can create custom pages, role assignments on custom pages follow same `roles_pages` pattern as system pages. Permissions inherit from creator tenant role or explicit assignment.
  >

---

## B21. Artefact-Items Substrate (PLA-0037)

> Generalise the v2 work-items handler family into a scope-parameterised **artefact-items** substrate so a single Go package serves both `/work-items` (scope=`work`, ~5 types) and `/portfolio-items` (scope=`strategy`, 51 types: themes, objectives, business epics, business outcomes, features-as-strategy). Frontend `useWorkItemsWindow` becomes generic `useArtefactItemsWindow` driven by `resourceUrl` from `p_wizard_*.json` so the existing portfolio page stops silently rendering work-items data.
>
> **Why now:** B15.2.5 introduced `p_wizard_portfolio.json` but the page still calls `/work-items` because the hook is hardcoded; backend filters `at.scope='work'` in 7 places, so the portfolio route — even when wired — would return 0 strategy artefacts. Without B21 the sidecar pattern is cosmetic.
>
> **Cutover model:** Phase 1 = rename Go package + add scope parameter, both routes register against same handler. Phase 2 = generic frontend hook + sidecar `resourceUrl`/`scope` fields. Phase 3 = tests, docs, deprecate legacy paths. Strict additive — no breaking changes to `/work-items` contract.

- **B21.1** Backend — rename `workitemsv2` → `artefactitemsv2` and parameterise by scope `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Single sole-writer service for any `artefact_types` row, scope-discriminated. Phase 1 minimum to unblock portfolio page.
  >
- **B21.1.1** Rename Go package `backend/internal/workitemsv2/` → `backend/internal/artefactitemsv2/` `[P1]`
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Includes `service.go`, `types.go`, `handler.go`, all `*_test.go`. Update package declaration. User decree: name MUST state what it does — *"artefactItemsv2 so it says what it does in the name"*.
  >
- **B21.1.2** Update 8 import sites in `backend/cmd/server/main.go` `[P1]` `[ ]B21.1.1`
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > Lines 55, 260, 266, 273, 277, 289, 292, 304. Constructor + route registration switches.
  >
- **B21.1.3** Update doc-comment refs in adjacent packages `[P2]` `[ ]B21.1.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > `backend/internal/portfolio/master_record_service.go:105`, `backend/internal/fields/handler.go:65`, `backend/internal/fields/resolver.go:71`. Comment-only — no behaviour change.
  >
- **B21.1.4** Add `Scope string` field to service constructor + propagate to all SELECT statements `[P1]` `[ ]B21.1.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Replace 7 hardcoded `at.scope = 'work'` literals (`service.go` lines 137, 193, 266, 335, 363, 413, 473) with `at.scope = $N`. Constructor signature: `New(db, scope string)`. Two instances registered in `main.go`: `New(db, "work")` for `/work-items`, `New(db, "strategy")` for `/portfolio-items`.
  >
- **B21.1.5** Parameterise `validItemTypes` allow-list per scope `[P1]` `[ ]B21.1.4`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > `types.go:333` currently `{epic, story, task, defect, portfolio item}` — work-only. Move to scope-keyed map: `validItemTypesByScope["work"]` and `validItemTypesByScope["strategy"]` (latter pulled from seed-data list of 51 strategy artefact types). Validation paths consult the right slice based on service's scope.
  >
- **B21.1.6** Generalise `SummariseWorkItems` to scope-shaped summary `[P1]` `[ ]B21.1.4`
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
  > Currently returns hardcoded `{total, epics, stories, tasks, defects, blocked}`. Make summary buckets data-driven from artefact-types of the current scope. Strategy summary should return `{total, themes, objectives, features}` per existing portfolio page contract. Pattern: GROUP BY `at.code`, project into stable JSON keys per scope config.
  >
- **B21.1.7** Register `/portfolio-items` routes against `artefactitemsv2.New(db, "strategy")` in `main.go` `[P1]` `[ ]B21.1.4` `[ ]B21.1.6`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Mirror existing `/work-items` route group. Reuse same handler — only the scope-bound service differs. Do NOT remove `/work-items` routes; both run side-by-side.
  >
- **B21.1.8** Backend regression — existing `/work-items` contract unchanged `[P1]` `[ ]B21.1.7`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `39986c0` (2026-05-09): feat(B21 PLA-0037): scope-parameterise artefactitemsv2; mount /portfolio-items [B21] [B21.1.1] [B21.1.2] [B21.1.3] [B21.1.4] [B21.1.5] [B21.1.6] [B21.1.7] [B21.1.8]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > Run `backend/internal/artefactitemsv2/*_test.go` after rename. Add canary test: GET `/work-items?scope=work` returns identical payload to pre-rename. No new fields, no removed fields.
  >

- **B21.2** Frontend — generic hook + sidecar JSON drives endpoint `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3dc9cdd` (2026-05-09): chore(plans): normalise unicode escapes in PLA plan files
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Replace hardcoded `useWorkItemsWindow` consumption in `p_ObjectTree.tsx` with config-driven `useArtefactItemsWindow(resourceUrl, scope)` reading from `p_wizard_*.json`.
  >
- **B21.2.1** Rename hook file `app/hooks/useWorkItemsWindow.ts` → `app/hooks/useArtefactItemsWindow.ts` `[P1]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Function signature accepts `resourceUrl: string` and `scope: string` as required props. Internal fetch builds URL from these instead of hardcoding `/work-items`.
  >
- **B21.2.2** Update `app/components/ObjectTree/p_ObjectTree.tsx:97` to pass `resourceUrl`/`scope` from config `[P1]` `[ ]B21.2.1`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Read `wizardConfig.resourceUrl` and `wizardConfig.scope` (new optional fields on `ObjectTreeDataConfig<T>`). Default to legacy `/work-items` + `work` if absent for backward compat during cutover.
  >
- **B21.2.3** Add `resourceUrl` + `scope` to wizard JSON files `[P1]` `[ ]B21.2.2`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3dc9cdd` (2026-05-09): chore(plans): normalise unicode escapes in PLA plan files
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > `p_wizard_workitems.json`: `{ "resourceUrl": "/work-items", "scope": "work" }`. `p_wizard_portfolio.json`: `{ "resourceUrl": "/portfolio-items", "scope": "strategy" }`.
  >
- **B21.2.4** Extend `ObjectTreeDataConfig<T>` interface in `p_ObjectTree.tsx` `[P1]` `[ ]B21.2.3`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `0d2cfcc` (2026-05-09): chore: scope-hook annotations for prior B21 commits
> Commit `1220476` (2026-05-09): chore: persist hook output
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `c9e2a41` (2026-05-09): chore: scope-hook annotations and launcher log refresh
> Commit `6068d40` (2026-05-09): chore: refresh scope annotations before B21 execution [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `4679037` (2026-05-09): chore(B22 PLA-0039): mark all 15 stories done in plan + scope [B22]
> Commit `fbeabab` (2026-05-09): fix(B18): scope TOC own scrollbar, hardened top offset [B20]
> Commit `2b3eea5` (2026-05-09): fix(B18): scope TOC overscroll-behavior:contain prevents scroll chaining to page [B20]
> Commit `1d492a9` (2026-05-09): fix(B18): widen scope TOC column 220px → 330px [B20]
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Add optional `resourceUrl?: string` and `scope?: string`. `resolveWizardConfig` passes them through unchanged.
  >
- **B21.2.5** Update remaining call-sites that import `useWorkItemsWindow` directly `[P2]` `[ ]B21.2.1`
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
  > `grep -rn "useWorkItemsWindow"` to enumerate. Most should be replaced; any pre-PLA-0030 holdouts get the rename.
  >

- **B21.3** Tests, docs, lint, cutover hygiene `[P2]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Cement the substrate so it can't regress.
  >
- **B21.3.1** Backend integration test — `/portfolio-items` returns strategy artefacts only `[P1]` `[ ]B21.1.7`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `ef55b4f` (2026-05-10): chore(logger): introduce structured logger with optional Loki push
> Commit `5cc5457` (2026-05-10): fix(dev-reset): remove dead mmff_vector.master_record_tenant write
> Commit `cf7bc75` (2026-05-10): feat(logger): structured HTTP request middleware + Grafana dashboard
> Commit `608808a` (2026-05-10): fix(auth): grace-window for refresh-token reuse from duplicate tabs and HMR
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
  > Seed two artefacts (one scope=`work`, one scope=`strategy`) in test DB. Assert `/work-items` returns the work one only; `/portfolio-items` returns the strategy one only. Catches scope-leak regressions.
  >
- **B21.3.2** Frontend unit test — `p_ObjectTree` calls correct endpoint per config `[P2]` `[ ]B21.2.4`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `9df45f8` (2026-05-09): fix(B22): add type_prefix to p_ObjectTree test fixture
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
  > Mock `useArtefactItemsWindow`; render with `p_wizard_portfolio.json`; assert `resourceUrl` arg = `/portfolio-items`.
  >
- **B21.3.3** Spec doc — `docs/c_c_wizard_sidecar.md` `[P2]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `64a699f` (2026-05-09): docs(B22): mark B22.16-B22.27 done in scope; update transport segregation doc [B22] [B22.26] [B22.27]
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `636cb10` (2026-05-12): refactor(css): vertical nav primitive unification + PageAnchorNav rewrite
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Document the sidecar pattern: schema for `p_wizard_*.json`, contract for `resolveWizardConfig`, what stays in JSON vs. what is injected by the page (closures/React nodes). Add CLAUDE.md index pointer.
  >
- **B21.3.4** Lint rule `lint:scope-literals` `[P3]` `[ ]B21.1.4`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `0ffe20d` (2026-05-09): chore: refresh local IDE state and launcher log
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `b3defb3` (2026-05-09): fix(portfoliomodels): AssertWorkspaceInTenant queries master_record_workspaces
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `6513cfd` (2026-05-09): fix(B22): dynamic ID column width tracks max visible depth in ResourceTree
> Commit `3f0dbbe` (2026-05-09): fix(B22): fix dynamic ID column — re-fit on width change, floor at declared width
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `442bd6c` (2026-05-10): docs(B22): refresh stale TYPE_PREFIX comment in custom-fields page
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `8ada5e5` (2026-05-11): refactor: nest Organisation & Work Items under Vector Admin tab
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `1667c40` (2026-05-11): refactor: self-build reorderable nav pageId from URL path
> Commit `1cb8b7d` (2026-05-11): refactor: tenant-aware subtitle on Vector Admin tab
> Commit `5782d23` (2026-05-12): refactor: rename customisation route to vector-admin; nest api-manager beneath it
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `c8ee38d` (2026-05-12): feat: L3 nav level + ActiveNavContext + <PageDescription> primitive
> Commit `86008f6` (2026-05-12): chore(lint): add lint:page-description + lint:h2-panel-only
  > Forbid hardcoded `'work'`/`'strategy'` string literals in `*.go` files outside `artefactitemsv2/` and seed-data files. Prevents new scope leaks. Ledger under `dev/registries/scope-literals-allowlist.txt`.
  >
- **B21.3.5** Migration note — `docs/c_c_v1_v2_cutover.md` `[P2]` `[ ]B21.1.7`
> Commit `e250fca` (2026-05-09): chore: scope-commit-note annotations for b65e06a [B21]
> Commit `383c4a0` (2026-05-09): fix(hooks): scope-commit-note self-reference loop
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
  > Add row: `/portfolio-items` joins `/work-items` under `artefactitemsv2`. Mark v1 portfolio routes for deprecation timeline.
  >
- **B21.3.6** Update CLAUDE.md hard-rule index `[P3]` `[ ]B21.3.3`
> Commit `8603935` (2026-05-09): feat(PLA-0038 B1.8): blocked-state plan + webhooks page fixes
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `d888b88` (2026-05-12): docs(.claude): register PageDescription + h2 hard rules + helper-icon memory + FE-GOV scope refs
  > Add pointer to `c_c_wizard_sidecar.md` under "Working practices" so future Claude sessions load the spec when touching `p_wizard_*.json`.
  >

- **B21.4** Deferred follow-ups (post-cutover) `[P4]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
  > Tracked here so they don't get lost; do NOT block B21.1–B21.3 completion.
  >
- **B21.4.1** Generalise `useRefetchOnPush` topic to scope-aware `[P3]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > Currently `rankTopic("work_item", ...)` and `rankTopic("portfolio_item", ...)` are separate. Consider unifying as `rankTopic("artefact", scope, ...)` once realtime fan-out can dispatch by scope.
  >
- **B21.4.2** Sidecar pattern adoption beyond `p_ObjectTree` `[P4]`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
  > Apply `p_wizard_*.json` to other primitives: `<Table>`, `<DiagramCanvas>`, `<TimeboxManager>`. Per-primitive spec rolls up under B15 + B21.3.3.
  >
- **B21.4.3** Storify additional 51 strategy artefact types in UI `[P3]`
> Commit `b65e06a` (2026-05-09): docs(B21): add Artefact-Items Substrate plan, PLA-0037 [B21]
> Commit `3464a1d` (2026-05-09): feat(B21 PLA-0037): scope-generic useArtefactItemsWindow + resourceUrl wizard sidecars
> Commit `bfc7279` (2026-05-09): test(B21 PLA-0037): scope-leak regression for artefactitemsv2
> Commit `7b33639` (2026-05-09): fix(B22): expose at.prefix as type_prefix; replace hardcoded TYPE_PREFIX map
> Commit `8941f45` (2026-05-09): feat: Customisation settings page — artefact type name/prefix/description/colour editor
> Commit `b6bc2e0` (2026-05-10): feat(dev): master-reset panel + custom-field manager refactor
> Commit `a1583c1` (2026-05-10): feat(FLOW1.5): flow_defaults snapshot tables for local Reset [FLOW1.5.1]
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > Once backend serves them, surface theme/objective/feature creation flows in portfolio page. Distinct from B21 — that just plumbs the data.
  >
- **B21.4.4** Drop legacy `/v1/portfolio-items` routes `[P4]` `[ ]B21.3.5`
> Commit `d1b944e` (2026-05-09): feat(B15.2.5): split p_wizard.json into per-resource sidecar configs
> Commit `afab34b` (2026-05-09): docs(B21 PLA-0037): wizard sidecar doc + lint:scope-literals + cutover register
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `743b077` (2026-05-10): feat(roles): drop MVP single-admin workspace constraint
> Commit `2a7a943` (2026-05-10): feat(tenant): app-wide TenantContext + per-type colour map
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `71aad61` (2026-05-11): refactor: reshape workspace-settings nav into L1/L2/L3 hierarchy
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
> Commit `4efd532` (2026-05-12): fix(dev): drop accidental /api prefix from page-help admin calls
  > After v2 contract is stable in production for 2+ release cycles. Per gradual-DB-sanitisation rule (memory).
  >
- **B21.4.5** Per-scope flow-state validation `[P3]`
> Commit `85b30e9` (2026-05-10): chore(scope): register FLOW1 entries + flow-state seed memory
> Commit `3c7b91d` (2026-05-10): chore: fix project path — `MMFFDev-Projects` → `MMFFDev - Projects` across hooks/scripts/docs
> Commit `e4adcc6` (2026-05-12): feat(FE-GOV-0003): flow-state descriptions + per-state exit rules
> Commit `14d0c0c` (2026-05-12): feat(FE-GOV-0004): Transition Rules page + relocate flow surfaces to Workspace Settings L3 (PLA-0041)
  > `validItemTypesByScope` (B21.1.5) is one allow-list; flow-states may also need scope-keyed transitions if strategy artefacts have different lifecycle states. Audit `ListFlowStates` after B21.1.7 lands.
  >

---

## B22. Transport Segregation via Shared Service Core (PLA-0039)

> **The win-win.** Keep one product codebase. Segregate by **transport adapter**, not by **service**. Site features ship as fast as before because there is no detour: every handler — site or customer — calls the *same* `Service` method. Two thin transport mounts (`/_site` for the BFF, `/samantha/v2` for the customer-facing API) sit on top. SOC 2 sees one auditable boundary; URL prefixes make site-vs-customer traffic visibly separate at the gateway, in logs, in WAF rules; a DTO mapper guard stops internal columns leaking through the customer adapter.
>
> **Why this is win-win, not a detour:** the work that already exists (B21 `artefactitemsv2.Service`, the 18 service.go files, RFC 9457 errors, RBAC, rate-limit middleware) **is the substrate**. We are not rebuilding — we are renaming a frontend helper, mounting a router subtree, adding two lints, and writing one DTO convention. Site velocity is unaffected because nothing about how a site feature is built changes — handler-calls-service is already the dominant pattern.
>
> **Why now:** the 252 / 9 / 8 split between `api()` / `apiV2` / `apiInfra` proves the site is silently riding the customer pool. Today's Reset Adoption State 404 was caused by exactly this confusion. Every week we wait, more callers cement the wrong assumption. After PLA-0030 (v1→v2 cutover) lands but before any external customer touches the system is the cheapest moment to draw the line.
>
> **Out of scope (deliberately):** rewriting any service; introducing GraphQL; multi-region; tenant-per-database; anything that does not directly enforce the adapter boundary.

- ✅ ~~**B22.1** Mount `/_site` BFF subtree in `main.go` `[P1]`~~
> Commit `140b3e3` (2026-05-09): fix(B18): scope TOC sticks below subheader, doesn't scroll away [B20]
> Commit `b896240` (2026-05-09): fix(B18): remove align-items:start that broke scope TOC sticky [B20]
> Commit `2067438` (2026-05-09): fix(B18): drop .dui-panel wrapper from scope so TOC sticky works [B20]
> Commit `5f85b87` (2026-05-09): feat(B22 PLA-0039): mount /_site BFF subtree + apiInfra→apiSite codemod [B22] [B22.1] [B22.2]
  > Re-home every site-only route under a single chi `Route("/_site", …)` block: `/admin/*`, `/me`, `/nav/*`, `/auth/refresh` + `/auth/logout`, `/dev/*`, `/healthz`, `/env*`, `/page-help/*`, `/library/releases/*`, `/custom-pages/*`, `/user/tab-order/*`, `/addressables/*`, `/errors/*`, `/workspaces/*`, `/status/pipeline`. Keep root-level shims for ≤2 release cycles emitting `Deprecation: site=/_site` header, then drop. After this lands, "is this route customer-facing?" is answered by `strings.HasPrefix(path, "/_site")` — usable in middleware, gateway rules, log filters.

- ✅ ~~**B22.2** Rename frontend helper `apiInfra` → `apiSite`; point at `/_site` `[P1]` `[ ]B22.1`~~
> Commit `5f85b87` (2026-05-09): feat(B22 PLA-0039): mount /_site BFF subtree + apiInfra→apiSite codemod [B22] [B22.1] [B22.2]
  > Single rename + base-URL change in `app/lib/api.ts` (the file already documents the routes in its header — they just need a shorter name and the `/_site` prefix). Codemod the 8 call sites. After this, `apiSite()` for site code is the literal name of what it does; helper count stays at 3, semantics sharpen.

- ✅ ~~**B22.3** Lint `lint:public-helper-allowlist` — gate `api()` and `apiV2` to a vetted file allowlist `[P1]` `[ ]B22.2`~~
> Commit `c87990e` (2026-05-09): feat(B22 PLA-0039): lint:public-helper-allowlist + lint:no-db-in-handlers [B22] [B22.3] [B22.4]
  > New python lint under `dev/scripts/lint_public_helper_allowlist.py` + ledger `dev/registries/public_helper_allowlist.txt`. Default rule: any file under `app/` or `dev/` that calls `api(` or `apiV2(` must be in the ledger. CI fails on a new caller that isn't allowlisted. Forces deliberate decisions; converts the 252 / 9 split from drift into evidence.

- ✅ ~~**B22.4** Lint `lint:no-db-in-handlers` — fail CI on `pgxpool` / `database/sql` import in any non-test `handler*.go` `[P1]`~~
> Commit `c87990e` (2026-05-09): feat(B22 PLA-0039): lint:public-helper-allowlist + lint:no-db-in-handlers [B22] [B22.3] [B22.4]
  > Python script under `dev/scripts/lint_no_db_in_handlers.py`; ledger `dev/registries/handler_db_exemptions.txt` seeded with the 8 known stragglers (auth, fields, errorsreport, libraryreleases, roles, portfoliomodels ×3, portfolio/master_record). Each removal from the ledger = one handler extracted to its service. The lint is the ratchet; the ledger is the migration tracker.

- ✅ ~~**B22.5** Extract `auth/handler.go` to `auth.Service` `[P2]` `[ ]B22.4`~~
> Commit `79b0d37` (2026-05-09): feat(B22 PLA-0039): extract auth.Service.LoadRoleAndPermissions [B22] [B22.5]
  > First straggler. `Login`, `Refresh`, `Logout` move into `auth.Service`; handler holds only HTTP concerns. Removes auth from the lint ledger.

- ✅ ~~**B22.6** Extract `fields/handler.go` to `fields.Service` `[P2]` `[ ]B22.4`~~
> Commit `7513242` (2026-05-09): feat(B22 PLA-0039): extract fields.Service from handler [B22] [B22.6]
  > Second straggler. Custom-field CRUD into service; ledger row removed.

- ✅ ~~**B22.7** Extract `errorsreport/handler.go` to `errorsreport.Service` `[P2]` `[ ]B22.4`~~
> Commit `90664bc` (2026-05-09): feat(B22 PLA-0039): extract errorsreport.Service from handler [B22] [B22.7]
  > Site-only handler — moves under `/_site/errors`; service writes go through `audit.Service` once B22.11 lands.

- ✅ ~~**B22.8** Extract `libraryreleases/handler.go` to `libraryreleases.Service` `[P2]` `[ ]B22.4`~~
> Commit `65b07a9` (2026-05-09): feat(B22 PLA-0039): extract libraryreleases.Service from handler [B22] [B22.8]
  > Library-DB-pool consumer; service holds the cross-DB read pattern.

- ✅ ~~**B22.9** Extract `roles/handler.go` to `roles.Service` `[P2]` `[ ]B22.4`~~
> Commit `be174cb` (2026-05-09): feat(B22 PLA-0039): extract roles.Service.ResolveActorPermissionIDs [B22] [B22.9]
  > `roles.Service` already exists for writes (per `lint:writer-boundary`); reads still in handler — fold them in.

- ✅ ~~**B22.10** Extract `portfoliomodels/handler*.go` (×3) and `portfolio/master_record_handler.go` to services `[P2]` `[ ]B22.4`~~
> Commit `f569af6` (2026-05-09): feat(B22 PLA-0039): extract portfoliomodels + portfolio.MasterRecord services [B22] [B22.10]
  > Largest straggler set. Bundle so PLA-0026 (per-workspace adoption cutover) and B22 stop colliding on the same files.

- ✅ ~~**B22.11** `audit_events` table + `audit.Service.Record()` sole-writer `[P1]` `[ ]B22.4`~~
> Commit `f20f11d` (2026-05-09): feat(B22 PLA-0039): audit source_transport + transport context tagging [B22] [B22.11]
  > New migration `db/schema/NNN_audit_events.sql`: `(id, tenant_id, actor_user_id, action, resource_type, resource_id, request_id, source_transport, before_jsonb, after_jsonb, created_at)`. `source_transport` ∈ {`site`, `public`} so SOC 2 reviewers can distinguish staff actions from customer actions. Mutating service methods call `audit.Record(ctx, …)` synchronously; failure rolls back the transaction. `lint:writer-boundary` extended so only `audit.Service` writes the table.

- ✅ ~~**B22.12** DTO + mapper convention — every service exposing data via `apiV2` declares `dto.go` `[P2]` `[ ]B22.11`~~
> Commit `c8838ef` (2026-05-09): feat(B22 PLA-0039): lint:public-dto-mapper + MapPublic seams [B22] [B22.12]
  > Pattern: `MapPublic(internal Foo) dto.FooPublic`. Lint `lint:public-dto-mapper`: any handler under `/samantha/v2` returning a Go struct from `internal/<svc>` (i.e. not from `internal/<svc>/dto`) fails. Stops a future PR accidentally exposing a column added internally. `portfoliomodels/dto.go` is the seed example; document the pattern in `docs/c_c_transport_segregation.md`.

- ✅ ~~**B22.13** Docs — `docs/c_c_transport_segregation.md` `[P2]` `[ ]B22.1`~~
> Commit `d97a096` (2026-05-09): docs(B22 PLA-0039): add c_c_transport_segregation.md leaf [B22] [B22.13]
  > Single page: the diagram (handler → Service → audit), the URL-prefix rule (`/_site` vs `/samantha/v2`), the three lints (`lint:public-helper-allowlist`, `lint:no-db-in-handlers`, `lint:public-dto-mapper`), the DTO mapper convention, and the SOC 2 evidence story (one audit table, two transports, one boundary). Linked from CLAUDE.md alongside `c_c_v1_v2_cutover.md`.

- ✅ ~~**B22.14** Gateway-layer rule — drop `/_site` requests at the public ingress `[P3]` `[ ]B22.1`~~
> Commit `fed62c4` (2026-05-09): docs(B22 PLA-0039): add gateway freeze rule to c_security.md [B22] [B22.14]
  > Once a real gateway lands (B17.9), add a rule: requests to `/_site/*` from outside the staff VPN/SSO are 404'd. Before the gateway exists, document the intent in `docs/c_c_transport_segregation.md` so it ships when B17.9 ships.

- ✅ ~~**B22.15** Decision log — site-only vs customer-also for new endpoints `[P3]`~~
> Commit `e76dd70` (2026-05-09): feat(B22 PLA-0039): add transport gate (Gate 8) to stories skill [B22] [B22.15]
  > One-line addition to the `<stories>` skill checklist: every new endpoint card declares `transport: site | public | both`. Forces the decision at story time, not at handler time. Keeps drift from re-emerging.

### B22 Phase 2 — `/_site` Full Coverage (14 allowlisted files → 0)

> **Goal:** Every internal app call routes through `/_site`. The 14 files currently in `public_helper_allowlist.json` all call `apiV2` directly — each needs a `/_site` route added to the Go backend and its frontend caller switched to `apiSite`. When the allowlist reaches 0 non-exempt entries, `lint:public-helper-allowlist` becomes a hard block with no exemptions.
>
> **State today (2026-05-09):** `/_site` has auth, me, nav, workspaces, webhooks, roles, custom-pages, addressables, library-releases, errors, user/tab-order. **Missing:** topology, work-items, portfolio-items, portfolio-model, flows, fields, rank, timeboxes, artefact-items (resourceUrl pattern).
>
> **Per-group work pattern:** (1) add route group to `mountSiteRoutes` in `main.go`; (2) switch frontend callers `apiV2` → `apiSite`; (3) remove files from allowlist; (4) verify lint passes.

- ✅ ~~**B22.16** Mount `/_site/topology/*` + switch `app/lib/topologyApi.ts` → `apiSite` `[P1]`~~
> Commit `35703e6` (2026-05-09): feat(B22 PLA-0039): mount /_site/topology + switch topologyApi.ts → apiSite [B22] [B22.16]
  > 18 topology operations (tree, nodes CRUD, roles, view-state, move, commit, reset, archive/restore, disconnected). All handlers exist under `/samantha/v2/topology`; duplicate the mount into `mountSiteRoutes`. topologyApi.ts is 1 file, ~20 call sites. Remove 1 entry from allowlist.

- ✅ ~~**B22.17** Mount `/_site/work-items/*` + switch `work-items/list`, `WorkItemDetailPanel`, `useWorkItemFlowStates`, `work-items-tree-config` → `apiSite` `[P1]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > Work-items list/summary, field-values, flow-states, tree pagination/sort/filter, PATCH. 4 frontend files. Handler group exists under `/samantha/v2/work-items`. Remove 4 entries from allowlist.

- ✅ ~~**B22.18** Mount `/_site/portfolio-items/*` + switch `portfolio-items/list/page.tsx` → `apiSite` `[P1]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > Single call: `/portfolio-items/summary`. Handler group exists under `/samantha/v2/portfolio-items`. Remove 1 entry from allowlist.

- ✅ ~~**B22.19** Mount `/_site/portfolio/*` + `/_site/workspace/{id}/portfolio/layers` + switch `portfolio-model/page.tsx` → `apiSite` `[P1]`~~
> Commit `ff79293` (2026-05-09): feat(B22): /_site mirrors for portfolio, flows, workspace-fields + frontend migration [B22] [B22.19] [B22.20] [B22.21]
  > Two calls: `/portfolio/master_record?workspace_id=` and `/workspace/{id}/portfolio/layers`. Table-name bug fixed (commit b3defb3); this removes the `apiV2` exposure. Remove 1 entry from allowlist.

- ✅ ~~**B22.20** Mount `/_site/flows/*` + switch `workspace-settings/work-items/page.tsx` → `apiSite` `[P1]`~~
> Commit `ff79293` (2026-05-09): feat(B22): /_site mirrors for portfolio, flows, workspace-fields + frontend migration [B22] [B22.19] [B22.20] [B22.21]
  > Single call: `GET /flows/`. Handler already mounted under `/samantha/v2/flows`. Remove 1 entry from allowlist.

- ✅ ~~**B22.21** Mount `/_site/workspace/{id}/fields` + switch `app/lib/fieldsApi.ts` → `apiSite` `[P1]`~~
> Commit `ff79293` (2026-05-09): feat(B22): /_site mirrors for portfolio, flows, workspace-fields + frontend migration [B22] [B22.19] [B22.20] [B22.21]
  > Single call: `GET /workspace/{id}/fields`. Handler (`fields.Service`) exists. Remove 1 entry from allowlist.

- ✅ ~~**B22.22** Mount `/_site/rank/move` + switch `app/hooks/useResourceRank.ts` → `apiSite` `[P2]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > Single call: `POST /rank/move`. Handler exists under `/samantha/v2`. Remove 1 entry from allowlist.

- ✅ ~~**B22.23** Mount `/_site/timeboxes/*` + switch `TimeboxManager.tsx` + `useTimebox.ts` → `apiSite` `[P2]`~~
> Commit `b587134` (2026-05-09): feat(B22): /_site mirrors for timeboxes + frontend migration + allowlist to 1 [B22] [B22.23] [B22.24]
  > Two files; `cfg.apiBase` is dynamic — the timebox kind registry at `app/components/timebox/kinds.ts` needs `/_site`-prefixed base strings. Calls: `GET ${cfg.apiBase}?...` and `POST ${cfg.apiBase}/bulk-create`. Remove 2 entries from allowlist.

- ✅ ~~**B22.24** Mount `/_site/work-items/relations/*` + switch `useRelationsData.ts` → `apiSite` `[P2]`~~
> Commit `b587134` (2026-05-09): feat(B22): /_site mirrors for timeboxes + frontend migration + allowlist to 1 [B22] [B22.23] [B22.24]
  > Relations graph calls. Handler exists under `/samantha/v2/work-items/relations`. Remove 1 entry from allowlist. Depends on B22.17 (shares the work-items mount group).

- ✅ ~~**B22.25** Switch `p_ObjectTree.tsx` (artefact-items resourceUrl pattern) → `apiSite` `[P1]`~~
> Commit `adcc284` (2026-05-09): feat(B22 PLA-0039): mount /_site/work-items + /portfolio-items + /rank; switch 7 callers → apiSite [B22] [B22.17] [B22.18] [B22.22] [B22.25]
  > The wizard sidecar `resourceUrl` is constructed dynamically (B21). `p_ObjectTree.tsx` calls `apiV2(resourceUrl + ...)`. Once B22.17 + B22.18 mount the underlying route groups under `/_site`, this file just needs its helper swapped. Remove 1 entry from allowlist. Depends on B22.17, B22.18.

- ✅ ~~**B22.26** Shrink `public_helper_allowlist.json` to zero; make lint a hard block `[P2]`~~
  > Once B22.16–B22.25 land, remove all 14 entries. The lint `--warn` mode becomes a hard fail. `app/lib/api.ts` (the definition file) gets a `# definition` exemption comment; all other callers must route through `apiSite`. Any future `apiV2` call requires an explicit PR-reviewed allowlist entry.

- ✅ ~~**B22.27** Update `docs/c_c_transport_segregation.md` with Phase 2 completion + full `/_site` route inventory `[P3]`~~
  > Document the complete `/_site` surface after Phase 2. Reference for the gateway block rule (B22.14) when B17.9 ships.

---

## FE-GOV-0003. Flow-State Descriptions & Per-State Exit Rules (PLA-0040)

Governance surface: every flow state gains a long-form description and an ordered, named **exit-rules checklist**. Users self-attest to each rule before moving an artefact out of the state — the system never enforces, only surfaces the list. Editor lives on `/workspace-settings/customisation/flow-states`, reached via two new icon buttons per state row (description glyph + exit-rules counter). Work Items page mirrors the data read-only (glyph + count columns); its existing "Manage flow states" footer button is the way to edit. Exit rules are first-class rows in a new `flow_state_exit_rules` table — drag-reorderable, inline-editable, soft-archivable, colour-tagged. Stored as a table (not JSON) for per-rule sort_order audit, `@dnd-kit` compatibility, and `lint:writer-boundary` enforcement. Backend extends the existing `flows` package (sole writer); five new `/_site/` routes for description PATCH + exit-rule CRUD. Plan: PLA-0040. `[P2]`

### FE-GOV-0003.1 Schema & migration

- **FE-GOV-0003.1.1** Migration `db/artefacts_schema/045_flow_state_description_and_exit_rules.sql` — `ALTER TABLE flow_states ADD COLUMN description TEXT`; `CREATE TABLE flow_state_exit_rules (id, flow_state_id FK CASCADE, sort_order, name, colour, created_at, updated_at, archived_at)`; partial index `(flow_state_id, sort_order) WHERE archived_at IS NULL`. `[P2]`

### FE-GOV-0003.2 Backend — `flows` package extensions

- **FE-GOV-0003.2.1** Extend `backend/internal/flows/types.go` — `FlowState` DTO gains `Description *string`, `ExitRules []FlowExitRule`, `ExitRuleCount int`; new `FlowExitRule` struct. `[P2]`
- **FE-GOV-0003.2.2** Extend `ListBySubscription` to LEFT JOIN active exit rules (sorted by `sort_order`); compute `ExitRuleCount`. `[P2]`
- **FE-GOV-0003.2.3** Service methods — `PatchFlowStateDescription`, `ListExitRules`, `CreateExitRule` (appends at `max(sort_order)+10`), `PatchExitRule` (name/colour/sort_order), `DeleteExitRule` (soft-archive). `[P2]`
- **FE-GOV-0003.2.4** Allow `description` field on existing `PatchFlowState` so the FE has one PATCH path for state-level fields. `[P2]`
- **FE-GOV-0003.2.5** Register five new `/_site/` routes in `backend/internal/flows/handler.go`: `PATCH /flow-states/{id}/description`, `GET|POST /flow-states/{id}/exit-rules`, `PATCH|DELETE /flow-state-exit-rules/{id}`. `[P2]`

### FE-GOV-0003.3 Lint & writer boundary

- **FE-GOV-0003.3.1** Register `flow_state_exit_rules → backend/internal/flows/` in `dev/scripts/lint_writer_boundary.py`'s `WRITER_BOUNDARY` map; no exemption row needed (first writer is correct). `[P2]`

### FE-GOV-0003.4 Frontend — Flow States page (editor surface)

- **FE-GOV-0003.4.1** Extend `app/lib/flowStatesApi.ts` with `patchStateDescription`, `listExitRules`, `createExitRule`, `patchExitRule`, `deleteExitRule`. `[P2]`
- **FE-GOV-0003.4.2** Add two icon-button columns to the StateRow table (after COLOUR): DESCRIPTION (`MdOutlineDescription`) and EXIT RULES (`FaListOl` + count pill). `[P2]`
- **FE-GOV-0003.4.3** Inline expander row — single `<tr>` rendered below the active state row, mode `"description" | "rules"` held in a single state slot so only one expander is open at a time. `[P2]`
- **FE-GOV-0003.4.4** Description expander — textarea + 250ms debounced autosave (matches existing colour-picker convention on this page). `[P2]`
- **FE-GOV-0003.4.5** Exit rules expander — drag-reorder (`@dnd-kit/sortable` + `verticalListSortingStrategy`, mirrors existing `handleSlotReorder` lines 814-859); inline-edit name on click; `ColourPicker` for per-rule colour (defaults to parent state colour); edit/delete icon row; bottom form `Add exit rule`. PATCH calls debounced 250ms. `[P2]`

### FE-GOV-0003.5 Frontend — Work Items page (read-only mirror)

- **FE-GOV-0003.5.1** Add two non-interactive columns after `Initial` on `app/(user)/workspace-settings/customisation/work-items/page.tsx`: **Description** (`MdOutlineDescription` glyph + text tooltip; dash if null) and **Exit Rules** (`FaListOl` + count pill if `> 0`; dash otherwise). Existing footer "Manage flow states" button remains the only edit path. `[P3]`

### FE-GOV-0003.6 CSS

- **FE-GOV-0003.6.1** Extend `app/globals.css` with `.flow-editor__expander` row styles (full-span row, sunken background, padded inner block). No new global primitives invented — only extends the `.flow-editor__*` family already on this page. `[P3]`

### FE-GOV-0003.7 Verification

- **FE-GOV-0003.7.1** Run `go build ./cmd/server/...`, `npm run typecheck`, `npm run lint:writer-boundary`, apply migration on dev DB; browser-test description save, exit-rule CRUD + drag-reorder + colour, read-only mirror on Work Items page, Strategy section parity. `[P2]`

---

## FE-GOV-0004. Orbit View Transition Editor & Artefact-Move Enforcement (PLA-0041)

Governance surface: stand up a **new 3rd-level secondary-nav page** at `/workspace-settings/workspace-settings/transition-rules` dedicated to defining which workflow transitions are allowed per flow. **Page move (companion):** Flow States and Work Items leave the Customisation L3 group and join the Workspace Settings L3 group (siblings of Organisation / Workspaces / Custom Fields / Portfolio Model); Transition Rules slots between Flow States and Work Items so the journey reads *Organisation → Workspaces → Custom Fields → **Flow States → Transition Rules → Work Items** → Portfolio Model*. **Removes** the existing N×N `TransitionMatrix` from the Flow States page — that page is already heavy (state CRUD + colour + description + exit rules + kind + is_pullable + ordering) and adding transition editing would overload users and conflate two mental models. The new page hosts a focus-one-source "Orbit View" per flow — picked source state sits in the centre of an SVG canvas with every other state orbiting it; tap an orbit node to toggle the `(focus → orbiting)` transition; a warm-gold inbound arrow confirms allowance. Mental model: *"Where can a card go from HERE?"* — one question at a time. Left rail lists all states with live outbound-rule counts; footer shows resolved rule set across all sources. No drag, no multi-select, no modes — one control: tap. **Critical companion piece**: artefact PATCH (`backend/internal/artefactitemsv2/service.go:675-693`) currently validates only that the target `flow_state_id` exists, not that `(current → new)` is in `flow_transitions` — meaning the rules editor is cosmetic without backend enforcement. This entry closes that gap across `artefactitemsv2` and audits `portfolioitemsv2` + any bulk-move endpoints for the same hole. Empty-flow default (no rules defined → allow any move) preserves fresh-workspace UX. Same enforcement applied to portfolio items for consistency. Reference design brief: `Flow State Journey Maker.md`. Plan: `dev/plans/PLA-0041.md`. `[P2]`

### FE-GOV-0004.0 New page + Workspace Settings move (secondary-nav surface)

- ✅ ~~**FE-GOV-0004.0.1** Create new route `app/(user)/workspace-settings/workspace-settings/transition-rules/page.tsx` — calls existing `flowStatesApi.list()`; renders Work Types + Strategy Types sections with `PageAnchorNav` TOC matching Flow States page conventions; one labelled `<OrbitView>` per flow; reuses `useTenantName()` + permission gate `useHasPermission("flows.manage")` (mirrors Work Items gating); top-of-page AAA-grade help paragraph explaining the orbit mental model in plain language.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.2** Remove from Customisation layout `app/(user)/workspace-settings/customisation/layout.tsx` — drop `flow_states` and `work_items` from `TABS`, `KEY_TO_SEG`, `SEG_TO_KEY`, and the `items` array (and the `canManageFlows` gate on Work Items). Customisation L3 becomes *Tenant Details → Artefact Types → Topology → Topology Map*.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.3** Add to Workspace Settings layout `app/(user)/workspace-settings/workspace-settings/layout.tsx` — append `flow_states`, `transition_rules`, `work_items` to `TABS`, `KEY_TO_SEG`, `SEG_TO_KEY`, and slot them between **Custom Fields** and **Portfolio Model** in the `items` array. All three gated by `useHasPermission("flows.manage")` (introduces a permission gate to this layout, currently ungated). Final order: *Organisation → Workspaces → Custom Fields → Flow States → Transition Rules → Work Items → Portfolio Model*.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.4** Move route folders on disk: `mv app/(user)/workspace-settings/customisation/flow-states/ app/(user)/workspace-settings/workspace-settings/flow-states/` and same for `work-items/`. Page-component code is unchanged — Next.js segments derive from folder path. Update the one `router.push("/workspace-settings/customisation/flow-states")` in `customisation/work-items/page.tsx:231` (note: the file itself moves with this step) to `/workspace-settings/workspace-settings/flow-states`. Update the docstring comment at `app/lib/apiSite/index.ts:489` to the new path.~~ `[P1]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.0.5** Remove the `TransitionMatrix` component from `flow-states/page.tsx` (lines 1159-1246) and its `.fs-transition-matrix__*` CSS from `app/globals.css`. The Flow States page no longer owns transition editing — replace any inline help that referred to transitions with a one-line pointer link to the new Transition Rules tab.~~ `[P2]`
  > Last checked: 2026-05-11

### FE-GOV-0004.1 Frontend — Orbit View component primitives

- ✅ ~~**FE-GOV-0004.1.1** Create `app/components/flow-rules/StateRail.tsx` — fixed 200px-wide left rail; real `<button aria-pressed>` rows; per-row outbound-rule count badge; selected row uses `--sunken` + `--border-strong` outline; eyebrow label "SOURCE STATE" (10px / 600 / 0.12em letter-spacing / `--ink-subtle`).~~ `[P2]`
  > Last checked: 2026-05-11
- ⚠️ PARTIAL ~~**FE-GOV-0004.1.2** Create `app/components/flow-rules/OrbitCanvas.tsx` — pure SVG (no `<canvas>`); viewBox `760 × 440`; centre node radius 48px (stroke `--ink`, fill `--canvas`); orbit radius 155px; orbit node radius 32px; positioning math `angle = (-Math.PI / 2) + (i / orbiting.length) * 2 * Math.PI; x = cx + cos(angle) * R; y = cy + sin(angle) * R`; single `<marker>` definition for arrowhead; arrow line only drawn when `(focus → orbiting)` is in the allowed set, offset by 50px from centre and `R - 32` from node; allowed node fill `--accent-soft`, stroke `--accent`; blocked node fill `--surface-2`, stroke `--border-strong`; two-word names wrap (first word y=3, second y=15 muted). No hard-coded colours anywhere.~~ `[P2]` — built as `role="button"` `<g>` not the real `<button>` overlay called for in 4.2.1; revisit when 4.2.1 lands.
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.1.3** Create `app/components/flow-rules/rules.ts` — `type StateId = string; type Transition = { from: StateId; to: StateId };` plus helpers `has(from,to)`, `toggle(from,to)`, `allow(from,to)`, `block(from,to)`, `countOutbound(from)`, `all()`. Internal storage `Set<"from>to">`.~~ `[P2]` — implemented `has`, `keyOf`, `fromTransitions`, `toTransitions`, `countOutbound`; `toggle/allow/block/all` weren't needed because mutations go through the API client, not local helpers.
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.1.4** Create `app/components/flow-rules/OrbitView.tsx` — flex-row composition (`<StateRail>` + `<OrbitCanvas>`); props `{ flowId, states, transitions, onTransitionsChange }` (drop-in for `TransitionMatrix` call-site); local state for focused state id; toggle handler calls `flowsApi.createTransition` / `flowStatesApi.deleteTransition`; busy-state lock prevents concurrent toggles on same edge.~~ `[P2]`
  > Last checked: 2026-05-11

### FE-GOV-0004.2 Frontend — accessibility & motion

- **FE-GOV-0004.2.1** Each orbit node is a real `<button>` overlaid on the SVG node (not `<g role="button">`); aria-label format `"Allow move from {from} to {to}"` (toggles to "Block …" when active). `[P2]` — currently shipped as `<g role="button" tabIndex={0}>` (functional but not the spec; revisit if a11y audit flags).
- ✅ ~~**FE-GOV-0004.2.2** Keyboard: Tab walks orbit nodes; Space/Enter toggles; **arrow keys walk the orbit clockwise / counter-clockwise** (Right/Down → next; Left/Up → previous); focus visibly outlined with `--accent` ring.~~ `[P2]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.2.3** Motion: 150ms tone change on allow/block toggle; 200ms ease on inbound arrow stroke-opacity appear/disappear; no bounce, no spring; `prefers-reduced-motion` shortcuts all transitions to 0ms.~~ `[P3]`
  > Last checked: 2026-05-11

### FE-GOV-0004.3 Frontend — edge cases & footer

- ✅ ~~**FE-GOV-0004.3.1** Zero rules from focused state — centre + all-blocked orbit; footer reads "No transitions allowed yet."~~ `[P3]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.3.2** More than 8 states — scale orbit radius up, orbit node radius down; never add scroll (the whole point is seeing all destinations at once).~~ `[P3]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.3.3** Self-transitions excluded from orbit by construction; ignore if present in data model.~~ `[P3]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.3.4** Footer summary — live count + resolved `(from → to)` pairs across all sources; eyebrow label "RULE COUNT".~~ `[P3]`
  > Last checked: 2026-05-11

### FE-GOV-0004.4 Frontend — swap matrix → orbit

- ✅ ~~**FE-GOV-0004.4.1** Note: the matrix call-site lives inside the moved `flow-states/page.tsx` (now under `workspace-settings/workspace-settings/flow-states/`). Removal is folded into **FE-GOV-0004.0.5** — there is no separate "swap" step because the orbit editor lives on its own page (FE-GOV-0004.0.1), not in place of the matrix. Retained here as a marker that no `?view=matrix` query-param fallback ships; matrix dropped entirely.~~ `[P2]`
  > Last checked: 2026-05-11
- ✅ ~~**FE-GOV-0004.4.2** Add `.fs-orbit__*` / `.flow-rules__*` styles to `app/globals.css` (rail, canvas, node, arrow, focus ring). No bespoke colours — tokens only.~~ `[P3]`
  > Last checked: 2026-05-11

### FE-GOV-0004.5 Backend — artefact-move enforcement (`artefactitemsv2`)

- **FE-GOV-0004.5.1** In `backend/internal/artefactitemsv2/service.go` `PatchWorkItem`, before writing the new `flow_state_id`, fetch current `flow_state_id` for the artefact; if `current != new` and at least one `flow_transitions` row exists for the flow, require `EXISTS (SELECT 1 FROM flow_transitions WHERE from_state_id = current AND to_state_id = new)`; otherwise return `ErrInvalidInput` with message `"transition not permitted"`. `[P1]`
- **FE-GOV-0004.5.2** Empty-flow exemption: if `(SELECT COUNT(*) FROM flow_transitions ft JOIN flow_states fs ON fs.id = ft.from_state_id WHERE fs.flow_id = $flow_of_current_state) = 0`, skip the check and allow the move — preserves fresh-workspace UX. `[P1]`
- **FE-GOV-0004.5.3** No-op move (`current == new`) bypasses the transition check entirely. `[P2]`

### FE-GOV-0004.6 Backend — audit other writers for the same gap

- **FE-GOV-0004.6.1** Audit `backend/internal/portfolioitemsv2/service.go` (`PatchPortfolioItem` or equivalent) for a `flow_state_id` write path; apply the same enforcement + empty-flow exemption + no-op bypass. `[P1]`
- **FE-GOV-0004.6.2** Audit any bulk-move / drag-to-column kanban endpoints (`/bulk-status`, `/kanban-move` style); apply the same checks per-row; fail-fast on first invalid move with a structured error indicating which row(s) violated. `[P2]`
- **FE-GOV-0004.6.3** Audit any v1 routes still mutating `flow_state_id` on the legacy pools — close the gap there too or document why they're exempt (e.g. retiring under PLA-0030). `[P2]`

### FE-GOV-0004.7 Backend — tests

- **FE-GOV-0004.7.1** Go-test `artefactitemsv2.PatchWorkItem`: (a) allowed transition succeeds, (b) blocked transition returns `ErrInvalidInput`, (c) no-op move succeeds even when current state has no outbound rules, (d) empty-flow exemption allows any move, (e) subscription isolation — rule defined in tenant A cannot be triggered by tenant B. `[P2]`
- **FE-GOV-0004.7.2** Parallel test suite for portfolio items, mirroring 4.7.1. `[P2]`

### FE-GOV-0004.8 Frontend — error toast on rejected move

- **FE-GOV-0004.8.1** Verify existing `notify.apiError` path surfaces the `"transition not permitted"` message cleanly on work-items + portfolio-items PATCH; if copy reads as raw API error, map to friendly "Move not allowed — `{from}` → `{to}` is not in the workflow rules for this {artefact-type}." in the handler. `[P3]`

### FE-GOV-0004.9 Verification

- **FE-GOV-0004.9.1** `go build ./cmd/server/...`, `npm run typecheck`, `npm run lint:writer-boundary` all pass (no new tables → no writer-boundary registry change). `[P2]`
- **FE-GOV-0004.9.2** Browser test on `/workspace-settings/workspace-settings/transition-rules` (and confirm Flow States + Work Items resolve at their new `workspace-settings/<tab>` URLs): pick state in rail → centred in canvas with no layout shift outside canvas; tap orbit node → arrow animates in/out; refresh → rule persists; rail outbound count + footer update live; Tab through nodes; arrow keys walk orbit; Space toggles. `[P2]`
- **FE-GOV-0004.9.3** Browser test on `/work-items`: drag a card across a blocked transition → toast rejects, card snaps back; drag across an allowed transition → succeeds; fresh tenant (no transitions defined) → all moves allowed; add one rule then re-test → only that rule passes. `[P1]`
- **FE-GOV-0004.9.4** Parity check on Strategy section (portfolio items): same UI + same enforcement behaviour as work items. `[P2]`

### FE-GOV-0004.10 Open decisions (resolve before story creation)

- **FE-GOV-0004.10.1** Empty-flow default — **decided: open** (no rules → any move allowed). Preserves fresh-workspace UX. Recorded here so the contract is durable. `[P2]`
- **FE-GOV-0004.10.2** Portfolio enforcement — **decided: yes**, same enforcement as work items. Consistency over scope creep. `[P2]`
- **FE-GOV-0004.10.3** Matrix coexistence — **decided: drop entirely** (no `?view=matrix` fallback). Matrix is internal-only with no muscle-memory users. `[P2]`
- **FE-GOV-0004.10.4** Working-prototype reuse — confirm whether `Flow rule builders.html` + `m3-orbit.jsx` exist in the repo and whether to copy SVG math verbatim. If absent, treat the brief's math snippet as authoritative spec. `[P3]`

---

## Unmatched Commits

> Commit `877ec30` (2026-05-09): fix(B22): move dynamicIdColWidth above fixedWidths — fix ReferenceError
> Commit `4ebf82f` (2026-05-09): fix: resolve getParentId/getChildrenCount functions in wizard config
> Commit `ca3e543` (2026-05-09): feat(PLA-0030 B19.7): wire p_wizard.json sidecar pattern to work-items and portfolio-items pages
> Commit `5c8f97b` (2026-05-09): docs(B20): add User Access Rights & Navigation Control section [B20]
> Commit `65851a0` (2026-05-09): fix: auto-redirect to first accessible tab in workspace-settings
> Commit `974c640` (2026-05-09): fix: allow padmin to access workspace-settings with role-gated tabs
> Commit `5989e2b` (2026-05-09): docs: mark B9 (webhooks) as complete [B9]
> Commit `4bdfeea` (2026-05-09): fix(B9.1): resolve webhookSvc variable shadowing bug
> Commit `8b194b6` (2026-05-09): fix: add CSRF token to webhook form submission [B9.1]
> Commit `88ff415` (2026-05-09): docs(B6.7): update scope with workspace-settings padmin fix completion
> Commit `61a1876` (2026-05-09): fix(PLA-0018): grant padmin access to workspace-settings [B6.7]
> Commit `22f6bfc` (2026-05-09): docs(B15.2): add example ObjectTreeConfig props for work_items and strategy_items
> Commit `fa56b2c` (2026-05-09): refactor(B15.2): organize ObjectTree into dedicated folder structure
> Commit `01a0c38` (2026-05-09): fix(B6.7): workspace-settings should not be default-pinned
> Commit `027638a` (2026-05-09): chore(B6.6): drop legacy topology V1 tables (org_nodes, org_levels, org_node_roles)
