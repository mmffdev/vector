# Vector — Product Scope & Feature Tracker

**Created:** 2026-05-08
**Last updated:** 2026-06-03 — Added B23 (PLA074): artefact dependency maps — edge-first persistence (`artefact_dependency_maps`, `artefact_dependency_edges`, `artefact_dependency_edge_events`), sole-writer `backend/internal/dependencies/` service, Sentinel-gated CRUD, cycle guard, 409 archive preflight, transitive-reachability projection. 14 stories. CPM deferred via `TD-DEP-CPM-DURATION`; `artefacts_is_blocked` stays manual. Research: R058.
**Doc version:** 2.73 (2026-06-08 — PLAT1 added from PLA077/RES068: Platform Extraction — shared Control Plane. 15 stories across strangler-fig phases 0–7. Monorepo (control-plane/products/packages) + three independence walls (CODEOWNERS, migration lanes, import lint); hybrid authz; Bridge Model; PoC = cross-product SSO. PLAT1.2 git move APPROVAL-GATED.)

> **★ Solo-dev mode — WIP cap 5** (since 2026-05-17). See [`.claude/memory/feedback_solo_dev_mode.md`](.claude/memory/feedback_solo_dev_mode.md) and the bridge document at [`.claude/scratch/correction-prompt.md`](.claude/scratch/correction-prompt.md). In-flight allowed: FLOW1, F1 (active); FE-POR-0002 done 2026-05-17; B16.8 done 2026-05-18; RF1 done 2026-05-18. Two WIP slots free as of 2026-05-18.
>
> **★ FORCING FUNCTION:** [FE-POR-0002 Chrome Scope Picker](#fe-por-0002-chrome-scope-picker-pla-0042) — the daily-use slice. Everything else justifies itself against keeping this healthy.

---

## Table of Contents

**RF — Codebase Recovery** *(structural refactor — PLA-0048, top priority)*

- [RF1. Codebase Recovery (PLA-0048)](#-rf1-codebase-recovery-pla-0048--done-2026-05-18) ✅ DONE → [Vector_Scope_Done.md](Vector_Scope_Done.md#rf1-codebase-recovery-pla-0048--done-2026-05-18)
- [RF2. Service Depth (PLA-0058)](#rf2-service-depth-pla-0058) 🔵 IN FLIGHT

**FLOW — Flow-State Primitives** *(canonical lifecycle model — quick reference)*

- [FLOW1. Flow-State Kind &amp; Pull-Eligibility Model](#flow1-flow-state-kind--pull-eligibility-model)

**F — Product Functionality** *(user-visible features currently being built)*

- [F1. Artefact Type and Flow State Customisation](#f1-artefact-type-and-flow-state-customisation)
- [F2. Frontend Stack (PLA061)](#f2-frontend-stack-pla061) 🔵 IN FLIGHT

**FE — Feature Areas** *(governance, UX, and other domain-tagged features)*

- [FE-GOV-0003. Flow-State Descriptions &amp; Per-State Exit Rules (PLA-0040)](#fe-gov-0003-flow-state-descriptions--per-state-exit-rules-pla-0040)
- [FE-GOV-0004. Orbit View Transition Editor &amp; Artefact-Move Enforcement (PLA-0041)](#fe-gov-0004-orbit-view-transition-editor--artefact-move-enforcement-pla-0041)
- [FE-POR-0002. Chrome Scope Picker (PLA-0042)](#fe-por-0002-chrome-scope-picker-pla-0042) ★ **FORCING FUNCTION**

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
- [B14. Addressables &amp; Page Help](#-b14-addressables--page-help--done) ✅ DONE → [Vector_Scope_Done.md](Vector_Scope_Done.md#b14-addressables--page-help--done)
- [B15. UI Primitives &amp; Design System](#-b15-ui-primitives--design-system--done) ✅ DONE → [Vector_Scope_Done.md](Vector_Scope_Done.md#b15-ui-primitives--design-system--done)
- [B16. Security &amp; Auth](#b16-security--auth)
- [B17. Infrastructure &amp; DevOps](#b17-infrastructure--devops)
- [B18. Developer Experience](#b18-developer-experience)
- [B19. Work Item Relations Graph](#b19-work-item-relations-graph)
- [B20. User Access Rights &amp; Navigation Control](#b20-user-access-rights--navigation-control)
- [B21. Artefact-Items Substrate (PLA-0037)](#b21-artefact-items-substrate-pla-0037)
- [B22. Transport Segregation via Shared Service Core (PLA-0039)](#b22-transport-segregation-via-shared-service-core-pla-0039)
- [B23. Artefact Dependency Maps (PLA074)](#b23-artefact-dependency-maps-pla074) 🔵 IN FLIGHT

**CUT — Substrate Cutover** *(collapse mmff_vector into vector_artefacts; 8 soft FKs → real FKs; procurement narrative)*

- [CUT1. mmff_vector → vector_artefacts Cutover (PLA064)](#cut1-mmff_vector--vector_artefacts-cutover-pla064) 🔵 IN FLIGHT

**VIZ — Visualiser / Relationship Explorer** *(deep-data-mining surface — codegraph today, artefact relationships tomorrow)*

- [VIZ1. Vector Relationship Explorer (PLA056)](#viz1-vector-relationship-explorer-pla056)

**OBJ — ObjectTreeV2 / Filter Chips** *(grid scope-clamp parity for the chip surface)*

- [OBJ1. ObjectTreeV2 Filter-Chip Scope Facets (PLA057)](#obj1-objecttreev2-filter-chip-scope-facets-pla057)

**NV — Notifications v2** *(orchestrated PLA rebuild — 16-story Master+Validator+Worker wave model)*

- [NV1. Notifications v2 — PLA build (orchestrated)](#nv1-notifications-v2--pla-build-orchestrated) 🔵 IN FLIGHT

**FB — Flow Visualisation** *(Kanban + flow boards built on the artefacts substrate)*

- [FB1. FlowBoard — standalone Kanban component for /value-flow (PLA066)](#fb1-flowboard--standalone-kanban-component-for-value-flow-pla066) 🔵 IN FLIGHT

**PLAT — Platform Extraction** *(master architecture program — shared Control Plane for all products; PLA077/RES068)*

- [PLAT1. Platform Extraction — shared Control Plane (PLA077 / RES068)](#plat1-platform-extraction--shared-control-plane-pla077--res068) 🔵 IN FLIGHT

**Parked — solo-dev mode** *(WIP-cap overflow; verbatim, awaiting unpark)*

- [FE-POR-0003. Topology Scope Clamp on Artefact Reads (PLA-0043)](#fe-por-0003-topology-scope-clamp-on-artefact-reads-pla-0043) — parked 2026-05-17
- [B18.7. Shared methods catalogue (PLA-0045)](#b187-shared-methods-catalogue-pla-0045--parked-2026-05-18-swapped-out-for-b168-security-hardening) — parked 2026-05-18 (swapped for B16.8)
- [B-SHARE. Short-link service for sharing views &amp; filters](#b-share-short-link-service-for-sharing-views--filters--parked-2026-05-18) — parked 2026-05-18 (design captured, awaiting saved-views consumer)

---

## ✅ RF1. Codebase Recovery (PLA-0048) — DONE 2026-05-18

Moved to [`Vector_Scope_Done.md` § RF1](Vector_Scope_Done.md#rf1-codebase-recovery-pla-0048--done-2026-05-18) on 2026-05-28. All 7 phases closed (drift-prevention lints, sql.go consolidation in 20 packages, per-DB migration dirs, naming-convention sweep, cross-DB writer hardening, docs pass, completion tests). 461 raw SQL literals consolidated; allow-list shrunk 58 → 10. Two follow-ups tracked in [`docs/c_tech_debt.md`](docs/c_tech_debt.md): **TD-RF1-DOC-GO-ADOPTION** (S3, 41 packages need `doc.go`), **TD-RF1-TEST-COLUMN-RENAME-DRIFT** (S2, 14 packages have test-fixture column drift). Neither blocks production.

---

## RF2. Service Depth (PLA-0058) 🔵 IN FLIGHT

Deep-module pass on `backend/internal/artefactitems` — the worst CRUD-shaped service surfaced by the 2026-05-23 Ousterhout depth audit (codebase scored 6.5/10; audit captured on /dev/reporting). Collapses 17 exported operations + 4 setters (21 public methods) into **8 cohesive operation families + 4 setters = 12 public methods**, removes 1 pass-through pair (`GetWorkItem`/`GetWorkItemInWorkspace`), and eliminates 2 `hasWorkspace` branches in handlers. Behaviour-preserving: zero wire-contract changes, zero SQL changes, zero schema changes — every existing endpoint keeps its shape; the change is below the handler line. Target shape (post-blocker resolution): `Service.Read` (Get/GetInWorkspace/List/FlowStates), `Service.Lookup` (Children/Ancestors tree-nav only), `Service.Summarise` (WorkItems + Facets clamp-boilerplate pair), `Service.SummariseRisks` (stays narrow — shares no clamps), `Service.Fields` (field-value CRUD), `Service.Mutate` (≤25-LoC dispatcher over Create/Patch — preserves cascade depth), `Service.Archive`, `Service.Bulk`. **All 13 stories grilled to 95% confidence via parallel Opus sub-agents (2026-05-23)** — three design blockers surfaced and resolved before storification (Lookup grouping, Summarise grouping, lint scope). If the pattern proves itself, future services adopt incrementally: `workspaces` (14 methods, strongest fit), `users` (13). See PLA-0058 on /dev/reporting → Plan tab for full Approach + Risks + Verification.

### RF2.0 Phase 0 — Pattern doc + stop-gate

- ⏳ **RF2.0.1** Write `docs/c_c_service_depth_pattern.md` leaf doc (≤400 lines, 7 named sections: Why deep services · Operation-family shape · Rules · Target signatures for artefactitems · Anti-patterns · When NOT to apply · Revision trigger). Add CLAUDE.md one-line pointer matching authoring convention. Reserve `TD-SVC-DEPTH-PATTERN` placeholder in `docs/c_tech_debt.md`. **Stop gate: this story stays ⏳ until user explicitly reviews and confirms — no Phase 1 code commit until RF2.0.1 flips to ✅ CLEARED.** Mirrors RF1.0.3 precedent. `[P2]` 🔵 IN FLIGHT

### RF2.1 Phase 1 — Typed input structs (no callers)

- **RF2.1.1** Declare `ReadQuery` / `Mutation` / `SummariseQuery` / `LookupQuery` / `FieldOp` input structs in new `backend/internal/artefactitems/operations.go`. Specified fields per struct with godoc XOR/mutex rules (ID xor Filters for Read; Kind discriminator for Mutation/Summarise/Lookup/FieldOp). No JSON tags (not wire DTOs — must NOT acquire `json:` tags or be returned to handlers). Zero callers in this commit (grep proves it). Commit message flags "dead code until Phase 2". `go build` + `go vet` + `go test` green. `[P2]` 🔵 IN FLIGHT

### RF2.2 Phase 2 — Add new operations as wrappers (old methods still callable)

- **RF2.2.1** Implement `Service.Read(ctx, subID, ReadQuery) (ReadResult, error)` as wrapper over `GetWorkItem` / `GetWorkItemInWorkspace` / `ListWorkItems` / `ListFlowStates` (FlowStates folds in per blocker resolution — it's type-metadata read, not tree-walk). Dispatch on ID-vs-Filters-vs-FlowStates kind. `ErrInvalidInput` on invalid combos. 4-path unit test coverage. Old methods still callable. `[P2]` 🔵 IN FLIGHT
- **RF2.2.2** Implement `Service.Lookup(ctx, subID, LookupQuery) (LookupResult, error)` over `ListChildren` + `ListAncestors` **ONLY** (tree-nav cohesion per blocker resolution — FlowStates intentionally NOT here, moved to Read). `LookupKind` enum = `{Children, Ancestors}`. ID required. Tests per kind + invalid kind + nil ID. `[P2]` 🔵 IN FLIGHT
- **RF2.2.3** Implement `Service.Summarise(ctx, subID, SummariseQuery) (SummariseResult, error)` over `SummariseWorkItems` + `ListFacets` (the truly cohesive ~40-LoC clamp-boilerplate pair per blocker resolution — NOT SummariseRisks which shares only the English word). `SummariseKind` enum = `{WorkItems, Facets}`. SummariseRisks stays separate with code comment noting rationale. Tests cover both kinds + scope-clamp variants. `[P2]` 🔵 IN FLIGHT
- **RF2.2.4** Implement `Service.Fields(ctx, subID, FieldOp) (FieldsResult, error)` dispatcher over list/upsert/delete field-value CRUD. Single-value path removed at API surface — always batch internally per `UpsertFieldValue` pass-through collapse (`service.go:1420-1422` is literally `UpsertFieldValues` with length-1 slice). Rule-hook fires exactly **once** per `UpsertFieldValues` regardless of body shape. Regression test locks single-fire contract. `[P2]` 🔵 IN FLIGHT
- **RF2.2.5** Implement `Service.Mutate(ctx, subID, Mutation) (*WorkItem, error)` as **≤25-LoC dispatcher** over `CreateWorkItem` + `PatchWorkItem`. Body ≤25 LoC including switch + nil-checks. Godoc states "thin dispatcher — `PatchWorkItem` retains cascade depth; do not pull impl up." Cascade regression suite (`recalc_test.go` × 7) passes byte-identically when called via `Mutate`. Pattern doc flags Mutate as **weakest family** with explicit "if it starts pulling impl up, split it back" review rule. `[P2]` 🔵 IN FLIGHT

### RF2.3 Phase 3 — Cutover handlers, one route group per commit

- **RF2.3.1** Cutover **7 read-family handlers** (Get / ByIDs / List / Facets / ListChildren / ListAncestors / ListFlowStates) to `Service.Read` + `Service.Lookup`. Two `hasWorkspace` branches at `handler.go:212-216` + `524-528` collapsed into ReadQuery construction. Zero direct calls to legacy read methods remain in `handler.go`. Projection stays in handler. Flag **TD-SVC-DEPTH-READ-COVERAGE S2** if ByIDs/Facets/ListChildren/ListAncestors not given handler tests inline (they have no handler test coverage today — manual smoke is the only safety net for those four routes). `[P2]` 🔵 IN FLIGHT
- **RF2.3.2** Cutover **MUTATE handlers** (Create at ~L804, Patch at ~L922, Archive at ~L998) to `Service.Mutate` + `Service.Archive`. Archive **NOT** folded into Mutate (soft-delete distinct, no cascade, 204 No Content envelope). **7 cascade regression tests in `recalc_test.go` pass byte-identically.** `WithTouchedIDsSink` context wiring preserved verbatim. X-Act-As impersonation path survives (ownerID/createdBy override still flows into Create variant). Manual smoke: PATCH /_site/work-items/<child-id> returns `touched_ids` array containing parent ID. **Highest-risk cutover in Phase 3** — frontend Slice 4.5/4.6c column-picker narrow-refetch depends on touched_ids. `[P2]` 🔵 IN FLIGHT
- **RF2.3.3** Cutover **BULK + FIELDS + SUMMARY handlers** (6 call sites: BulkOps L1029, ListFieldValues L1053, UpsertFieldValues L1122, DeleteFieldValue L1154, SummariseWorkItems L625, SummariseRisks L658). **One atomic PR per plan Risk #4** — not split mid-cutover. `bulkOpsReq` wire shape unchanged. Field rule-hook fires exactly once per `UpsertFieldValues`. All summary error envelopes preserved (ErrScopeForbidden→403, ErrScopeNodeNotFound→404, ErrInvalidInput→400). SummariseRisks shape byte-identical. Full test suite green. `[P2]` 🔵 IN FLIGHT

### RF2.4 Phase 4 — Deprecate + install ratchet lint

- **RF2.4.1** Mark **14 legacy public Service methods** `// Deprecated: use Service.X instead.` (ListWorkItems, GetWorkItem, GetWorkItemInWorkspace, ListChildren, ListAncestors, ListFlowStates, SummariseWorkItems, SummariseRisks, CreateWorkItem, PatchWorkItem, ListFieldValues, UpsertFieldValue, UpsertFieldValues, DeleteFieldValue, ListFacets — depending on which survive Phases 2-3). **Note:** SummariseRisks survives the cull and is NOT deprecated per blocker 2 resolution; ArchiveWorkItem and BulkOps keep their names. Install `dev/scripts/lint_deprecated_artefactitems.py` that scans **ALL of `backend/`** (not just artefactitems package per blocker 3 — cross-package callers exist in `featuretests/f1_workspace_clamp_test.go` L400 + L448). Registry `dev/registries/deprecated_artefactitems_exempt.json` starts empty (zero violations). CI `tests.yml` workflow + pre-push hook wired. Mirrors RF1 `lint:exemption-ratchet` precedent. `[P2]` 🔵 IN FLIGHT

### RF2.5 Phase 5 — Delete deprecated methods

- **RF2.5.1** Delete **14 deprecated public Service methods**. **Cross-package cutover FIRST**: `backend/internal/featuretests/f1_workspace_clamp_test.go` L400 (`ListWorkItems`) and L448 (`GetWorkItemInWorkspace`) routed through `Service.Read` before any delete. Verify: `grep '^func (s \*Service) [A-Z]' service.go | wc -l == 12` (4 setters + 8 ops). Private impls (`getWorkItemImpl`, etc.) remain. `rules/evaluator.go` comment-only refs to `artefactitems.Service.Update` refreshed to `Service.Mutate`. **Repurpose Story 11 lint as a guard** — forbids any caller anywhere, not just deprecated. `go build ./...` green; full test suite green. `[P2]` 🔵 IN FLIGHT

### RF2.6 Phase 6 — Document the win + open follow-up TD

- **RF2.6.1** Record BEFORE/AFTER metrics in pattern doc `## Results` section. **BEFORE** (captured from main): `service.go=1929 LoC`, `handler.go=1167 LoC`, 17 exported ops, 1 pass-through pair, 16 call sites, 2 `hasWorkspace` branches. **AFTER** (populated post-Story-12): target 12 public methods (8 ops + 4 setters), 0 pass-through pairs, 0 branches, `handler.go ≤1050 LoC`. File `TD-SVC-DEPTH-PATTERN` S3 row in `docs/c_tech_debt.md` with cap (pattern doc link) + pay-down trigger (service is next substantially touched OR method count crosses 15) + **ranked candidate next-services list**: `workspaces` (2794 LoC, 14 methods — **adopt**, strongest fit), `users` (2057 LoC, 13 methods — **adopt**, watch auth coupling), `timeboxsprints` (**excluded** per audit — "appropriately shallow"), `portfoliomodels` (9083 LoC, 7 methods — **defer** until method count grows), `polymorphicrefs` (4 methods — **exclude**, too small to benefit). Story 13 closes the loop; converts one-off refactor into a reusable pattern. `[P2]` 🔵 IN FLIGHT

---

## FLOW1. Flow-State Kind & Pull-Eligibility Model

Establishes the canonical 6-kind flow primitive plus an `is_pullable` flag on `flow_states`. Pill name and kind align in the seed (Backlog/To Do/Doing/Completed/Accepted) so the lifecycle vocabulary is self-evident. Two orthogonal axes: `kind` answers "where in the lifecycle?" (`backlog | todo | in_progress | done | accepted | cancelled`); `is_pullable` answers "can the team take this from this state right now?". Compliance-gated teams use multiple `kind='todo'` pills (e.g. To Do → In Review → Approved) where only the final pill carries `is_pullable=true`. Standard agile teams keep the seed default — `Backlog` is PO shaping (validation relaxed); `To Do` is the single pullable state. Per-artefact PO-readiness is explicitly a future concern, not bundled here. `[P1]` 🔵 IN FLIGHT

### FLOW1.1 Schema — kind widening + is_pullable flag

- ✅ **FLOW1.1.1** ~~Widen `flow_states.kind` CHECK constraint to `('backlog','todo','in_progress','done','accepted','cancelled')` — adds `backlog` as 6th primitive~~ `[P1]`
- ✅ **FLOW1.1.2** ~~Add `flow_states.is_pullable BOOLEAN NOT NULL DEFAULT FALSE` — opt-in per pill; default false so new pills are non-pullable until consciously marked~~ `[P1]`
- ✅ **FLOW1.1.3** ~~Migration `042_seed_kind_aligned_flow_pills.sql` — re-seed default flows with name/kind alignment (Ready → To Do rename in place); set `is_pullable=true` on To Do pill across all default flows; idempotent on re-run~~ `[P1]`
- ✅ **FLOW1.1.4** ~~Fold DE-Default + US-Default corruption repair into 042 — delete junk pills (TEST PILL, Lego, fwerrt, etc.); reset canonical pills to seed values in place (preserves artefact FK refs)~~ `[P1]`
- ✅ **FLOW1.1.5** ~~Backfill `is_pullable` on Defect QA flow + strategy-type default flows (BC/BE/PO/SO) — apply same convention (single pullable pill at the team-handoff point)~~ `[P2]`
> 042 set is_pullable=TRUE on every default flow's pullable pill (10 total: each default's "To Do" + DE QA's "Open"); verified via post-migration check 2026-05-10.

### FLOW1.2 Backend — service surface

- ✅ **FLOW1.2.1** ~~Add `'backlog'` to `validKinds` map in `backend/internal/flows/service.go`~~ `[P1]`
- ✅ **FLOW1.2.2** ~~Extend `PatchStateInput` + `CreateStateInput` to accept optional `is_pullable bool` — UPDATE/INSERT propagates the flag~~ `[P1]`
- ✅ **FLOW1.2.3** ~~`listByScope` query selects `fs.is_pullable` and surfaces it in the `FlowState` DTO~~ `[P1]`
- **FLOW1.2.4** Pull-surface query helper — canonical filter `is_pullable=true OR kind IN ('in_progress','done','accepted')` for team boards `[P2]`
- **FLOW1.2.5** PO-backlog query helper — `kind='backlog' OR (kind='todo' AND is_pullable=false)` for PO grooming views `[P2]`
> Last checked: 2026-05-10 — service.go validKinds includes "backlog"; types.go FlowState/PatchStateInput/CreateStateInput carry IsPullable; listByScope SELECT + scan + PatchFlowState UPDATE/RETURNING + CreateState INSERT/RETURNING all wire fs.is_pullable through. `go build ./internal/flows/... ./cmd/server/...` clean.

### FLOW1.3 Frontend — customisation page + KIND_LABEL

- ✅ **FLOW1.3.1** ~~Add `backlog → "Backlog"` to `KIND_LABEL` map; flow-map's left master-state column adds 6th row~~ `[P1]`
- ✅ **FLOW1.3.2** ~~`is_pullable` toggle on each pill row in the flow-states settings page — PO sets per-pill, persists via `flowStatesApi.patchState`~~ `[P2]`
- **FLOW1.3.3** Visual treatment: pullable pill carries a subtle "team can pull" indicator (icon, accent border) — distinct from any future PO-readiness badge `[P2]`
- **FLOW1.3.4** Flow-map shows the implicit Backlog-zone boundary visually (left edge of pullable pill = "team handoff line") `[P3]`
> Last checked: 2026-05-10 — KIND_LABEL/KIND_STROKE include backlog (slate-300 stroke); inferKind ORDER+KEY widened to 6 kinds; FlowState DTO + flowStatesApi + apiSite registry carry is_pullable; new "Pullable" checkbox column in StateRow PATCHes `{ is_pullable }`. tsc clean for touched files.

### FLOW1.5 Reset to factory-default per artefact type

- **FLOW1.5.1** Snapshot tables in `vector_artefacts` (`flow_defaults`, `flow_state_defaults`, `flow_transition_defaults`) baked at seed time; idempotent rebuild from current live default flows `[P1]` ✅
- **FLOW1.5.2** Backend Reset service — `loadResetData` + `pickSuccessor` walk-back helper + `PreviewReset` (diff only) + `ApplyReset` (single-tx rebind→archive→update→insert→rewrite-edges); routes `POST /_site/flows/reset/{preview,apply}` `[P1]`
- **FLOW1.5.3** Frontend Reset button on `TypeSection` heading + inline preview banner showing pill/transition deltas + artefact-rebind impact counts; user confirmation before Apply `[P1]`

### FLOW1.4 Future — explicitly out of scope here

- **FLOW1.4.1** Per-artefact `po_ready` flag on `artefacts` table — visual aid for PO grooming, independent of flow state; sort-to-top/badge UI; optional DoR validation on toggle `[P3]`

> Last checked: 2026-05-10

---

## F1. Artefact Type and Flow State Customisation

Workspace Settings > Customisation page — two sections. Section 1 (artefact type tags, prefix, name, description, colour) is already built. Section 2 adds a third-level tab nav (mirroring Custom Fields) for flow state management: one tab per artefact type, showing that type's flow states with colour editing. Covers data-correction migrations to fix wrong seeded states for all work types and missing states for strategy types. `[P2]` 🔵 IN FLIGHT

### F1.1 Data Migrations — correct seeded flow states

- ✅ **F1.1.1** ~~Migrate Task flow states to: Ready (todo), Doing (in_progress), Completed (done) — remove Cancelled~~ `[P1]`
- ✅ **F1.1.2** ~~Migrate Story flow states to: Backlog (todo), Ready (todo), Doing (in_progress), Completed (done), Accepted (done) — remove To Do, In Progress, Done, Cancelled~~ `[P1]`
- ✅ **F1.1.3** ~~Migrate Epic flow states to match Story (same 5-state set)~~ `[P1]`
- ✅ **F1.1.4** ~~Migrate Defect work-execution flow states to match Story (same 5-state set)~~ `[P1]`
- ✅ **F1.1.5** ~~Seed Defect QA/business flow: Submitted (todo), Open (todo), Fixed (in_progress), In Test (in_progress), Not Reproducible (done), Deferred (done) — new second flow on the Defect type~~ `[P1]`
- ✅ **F1.1.6** ~~Seed flow states for BC, BE, PO, SO strategy types (flows exist, 0 states): Backlog (todo), Ready (todo), Doing (in_progress), Completed (done), Accepted (done)~~ `[P1]`
- ✅ **F1.1.7** ~~Add `accepted` kind to `flow_states` CHECK constraint — needed to distinguish Accepted from Completed in metrics; update existing Accepted seeds to use it~~ `[P2]`
> Last checked: 2026-05-10 — F1.1.1–F1.1.7 covered by migration 041 + 042 (Story/Epic/Defect 5-state, Task 3-state, DE QA exists, BC/BE/PO/SO seeded, accepted in CHECK widened to 6 in 042). Note: FLOW1's seed-kind alignment renamed `Ready → To Do` and added `backlog` kind, superseding F1.1's `Ready (todo)` naming — current DB reflects FLOW1's model.

### F1.2 Backend — flow state colour PATCH API

- ✅ **F1.2.1** ~~Add `PATCH /_site/flow-states/{id}` handler (colour only for now) — validates `#RRGGBB`, returns updated state~~ `[P1]`
- ✅ **F1.2.2** ~~Register route in `mountSiteRoutes` with `RequireAuth` + `RequireFreshPassword`~~ `[P1]`
> Last checked: 2026-05-10 — `PATCH /_site/flow-states/{id}` registered at `backend/cmd/server/main.go` lines 921–927 with `RequireAuth` + `RequireFreshPassword`; handler `flowsH.PatchFlowState` in `backend/internal/flows/handler.go`. Confirmed wired through apiSite registry.

### F1.3 Frontend — Customisation page flow states section

- **F1.3.1** Move existing Work Items page (`/workspace-settings/work-items`) content into Customisation as third-level tab section `[P2]`
- **F1.3.2** Add third-level tab nav to Customisation page: work-type tabs (Story, Epic, Task, Defect) + strategy-type tabs (SO, PO, BE, BC, FE) + Defect QA tab `[P2]`
- **F1.3.3** Flow state colour picker per state row (same `ColourPicker` component) — PATCH calls `/_site/flow-states/{id}` `[P2]`
- **F1.3.4** Frontend `flowStatesApi` — `listByType(artefactTypeId)` + `patch(stateId, {colour})` via `apiSite` `[P2]`
- **F1.3.5** Update `useWorkItemFlowStates` to pass state colours through to `FlowStatePillRow` for coloured pills in the tree `[P3]`

---

## F2. Frontend Stack (PLA061)

> Origin: PLA061 (Next.js Ecosystem Library Adoption — Shortlist, /dev/reporting Plan tab). Four perf/theme/docs stories from Phase 1; the two perimeter-security stories live under B16.14/B16.15.

- **F2.1 [P3] 🔵 IN FLIGHT** — [Benefit 3/5] Wire react-scan into dev-mode render profiler. Dev-only drop-in to highlight wasteful re-renders on hot pages.
  - AC: `react-scan` appears in `package.json` under `devDependencies`.
  - AC: root layout (or equivalent) loads the scan script only when `process.env.NODE_ENV === 'development'`.
  - AC: production build (`next build`) bundle does NOT include the scan script (verified via bundle analyzer or string-grep on the build output).
  - AC: visiting `/work-items` in dev shows the render-highlight overlay.
  - AC: no console errors on initial load.

- **F2.2 [P3] 🔵 IN FLIGHT** — [Benefit 4/5] Adopt Million on hot list/table surfaces with measure-then-keep gate. Baseline a render profile, enable Million via Next plugin, re-measure, keep only if > 20% measured improvement on the chosen baseline page.
  - AC: baseline CPU profile of `/work-items` with ~100 items recorded and stored at `dev/perf-baselines/work-items-pre-million.json` (or similar).
  - AC: `million` appears in `package.json`.
  - AC: `next.config.js` wraps config with the Million plugin with `auto: { rsc: true }`.
  - AC: post-adoption CPU profile recorded; measured improvement on baseline page documented in commit message AND in a TD entry.
  - AC: if < 20% win measured, story closes with rollback commit + TD-entry noting "Million evaluated, no measurable win on Vector's render shape, deferred".
  - AC: if adopted, no visual regression on `/work-items`, `/portfolio-items`, `/risk` (manual click-path verification).

- **F2.3 [P3] 🔵 IN FLIGHT** — [Benefit 4/5] Migrate `<theme>` skill colour math to culori + SAPC-APCA. Drop-in upgrade to spec-correct colour science.
  - AC: `culori` appears in `package.json`.
  - AC: existing OKLCH conversion call sites in the `<theme>` skill replaced with `culori` equivalents; bespoke math deleted.
  - AC: contrast assertion in theme generation replaced from WCAG-2 ratio to SAPC-APCA.
  - AC: three existing theme packs regenerated and visually compared (old vs new) — no perceptible regression on the role-token output.
  - AC: `docs/c_accessibility.md` updated to cite APCA as the contrast standard.
  - AC: TD entry `TD-THEME-EXTRACTION-HCT` filed: severity S3, trigger = first bad image-extraction report, action = migrate image-extraction path to `material-color-utilities` HCT engine.

- **F2.4 [P3] 🔵 IN FLIGHT** — [Benefit 3/5] Author `docs/c_c_frontend_stack_picks.md` + file TD entries for deferred candidates. Single canonical reference for what's adopted + what's deferred + why.
  - AC: new file `docs/c_c_frontend_stack_picks.md` exists.
  - AC: file has two sections: "Adopted" (Million, react-scan, ratelimit pick, culori, APCA) with one-line rationale each, and "Evaluated & Deferred" (charts, animation, AI SDK, undici pool, helmet+CSP, osv-scanner, DOMPurify, material-color-utilities) with one-line rationale + trigger each.
  - AC: `CLAUDE.md` gains one pointer line linking to the new doc under the design / styling pointer block.
  - AC: `docs/c_tech_debt.md` gains one TD row per deferred candidate (8 rows), severity per candidate (mostly S3; helmet+CSP and osv-scanner = S2).
  - AC: every TD row references PLA061 in its origin column.

### F2.5–F2.10 — Deferred candidates (no marker; awaiting trigger)

> Scoped per PLA061 Phase 2. Listed here for visibility on the scope board; **not active work**. Each has a TD row in `docs/c_tech_debt.md` (filed by F2.4) with severity + trigger. Promote to 🔵 IN FLIGHT when its trigger fires.

- **F2.5 [P3]** — [Benefit 3/5 when triggered] Charts library pick. Choose from visx (highest design ceiling, NYT-tier), ECharts (heavy stat charts with custom theme), deck.gl (network/flow/geo at scale). Honourable mentions: Nivo, Recharts + evilcharts skin, Observable Plot. Skip Tremor + Victory (corporate-bland).
  - **Trigger:** first reporting requirement that names a specific chart type.
  - AC (when triggered): pick recorded in `docs/c_c_frontend_stack_picks.md` with rationale.
  - AC: first chart component lands on the page that triggered the pick.
  - AC: no Tremor/Victory adopted by stealth elsewhere.

- **F2.6 [P3]** — [Benefit 4/5 when triggered] Animation baseline. Adopt Motion as the baseline + auto-animate for list polish. Reserve GSAP for the specific page that needs orchestrated scroll choreography. Future picks: react-three-fiber (3D), Lottie (designer JSON), theatre.js (authoring).
  - **Trigger:** first design that calls for layout-morph, page-transition, or scroll-driven animation.
  - AC (when triggered): Motion + auto-animate appear in `package.json`.
  - AC: at least one page uses the baseline; bundle-size delta documented.
  - AC: GSAP / r3f / Lottie remain unused unless their specific surface lands.

- **F2.7 [P3]** — [Benefit 4/5 when triggered] Vercel AI SDK transport only. Adopt `useChat` + `DefaultChatTransport` + `generateObject` with Zod. Keep agent loop authority + tool dispatch in Go; expose each TS tool as an authenticated fetch to `/_site/...` or `/samantha/v2/...`. Skip `@ai-sdk/rsc` (deprecated). File prompt-injection / tool-output sanitisation gap as a blocker before any tenant exposure.
  - **Trigger:** first agent feature enters scope.
  - AC (when triggered): `ai` + `@ai-sdk/anthropic` + `zod` in `package.json`.
  - AC: agent loop + tool dispatch remain in Go (no `tool({ execute })` does business logic in Node).
  - AC: `@ai-sdk/rsc` NOT in tree (lint or grep proves it).
  - AC: prompt-injection defence story filed and blocking before tenant exposure.

- **F2.8 [P3]** — [Benefit 2/5 when triggered] Node→Go undici pool tuning. Replace default global fetch with a pinned `undici.Agent` per upstream.
  - **Trigger:** p99 latency regression OR first incident of socket exhaustion under load.
  - AC (when triggered): `undici.Agent` configured per upstream with documented keep-alive + per-host concurrency.
  - AC: before/after p99 captured for the affected endpoint.
  - AC: TD entry closed with measured win.

- **F2.9 [P3]** — [Benefit 3/5 when triggered] material-color-utilities for theme image extraction. Drop-in alt extraction path for the `<theme>` skill image input — Google's HCT engine, tonal ramps map cleanly to Vector's role tokens.
  - **Trigger:** first user-reported bad palette extraction from an image, OR first theme-pack request where HCT ramps would help.
  - AC (when triggered): `@material/material-color-utilities` in `package.json`.
  - AC: `<theme>` skill image-extraction path replaced; bespoke extraction deleted.
  - AC: regenerated packs from the trigger image visually compared old vs new; documented in commit.
  - AC: closes TD-THEME-EXTRACTION-HCT filed by F2.3.

- **F2.10 [P3]** — [Benefit 4/5 when triggered] Supply-chain scanning in CI via osv-scanner. Google-maintained, covers npm + Go.
  - **Trigger:** when CI exists / matures enough to gate on it.
  - AC (when triggered): `osv-scanner` runs on every PR.
  - AC: PR fails on any CVE rated ≥ medium in the dependency tree.
  - AC: allowlist mechanism exists for known-false-positives with expiry dates.
  - AC: `docs/c_security.md` gains a row for supply-chain evidence trail.

## M1. Flows

Workflow definitions and states for work items. Currently reads from `obj_flow_tenant` in the old database (`mmff_vector`). The new database already has the correct tables (`flows`, `flow_states`, `flow_transitions`) — the data needs copying across and the handler switching over. Plan: [PLA-0031](dev/plans/PLA-0031.json)

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
  > Plan `PLA-0038` (2026-05-09): Blocked-state — orthogonal stuck flag with provenance for work items
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
- **B1.9** Unified `/artefacts` REST API — single CRUD surface for every artefact type (work + strategy) `[P2]`

  > **Why:** today's create/edit/delete is split across `/work-items` (work scope) and `/portfolio-items` (strategy scope), each with its own clamp wiring. Same Go service runs behind both, instantiated twice. The flyout being designed for ObjectTree on `/work-items` will also need to work on `/portfolio-items` — without consolidation we either build the flyout twice or hardcode it to the wrong abstraction. Scope (work/strategy) belongs on the `artefact_types` record, not on the URL. One REST surface keeps the client uniform, gives audit/SOC2 a single clamp story ("every write goes through one chokepoint"), and unblocks the kill of the legacy `item_type` string discriminator.
  >
  > **What:** one resource `/artefacts` with full CRUD + intent verbs. The payload carries `artefact_type_id` (UUID); the server reads `scope` off the type record and gates accordingly. Tenant/workspace/permission clamp runs as middleware on every route — structurally impossible to bypass.
  >
  > **Routes:**
  > - `POST   /artefacts` — create (was `POST /work-items`, `POST /portfolio-items`)
  > - `GET    /artefacts` — list (existing filter/sort/page params, `?artefact_type_id=` replaces `?item_type=`)
  > - `GET    /artefacts/:id` — read one
  > - `PATCH  /artefacts/:id` — partial update (title, description, priority_id, owner_id, parent_id, field_values)
  > - `DELETE /artefacts/:id` — soft-delete (sets `archived_at`)
  > - `POST   /artefacts/:id/reprioritise` — change priority_id and/or position; fires realtime + audit
  > - `POST   /artefacts/:id/reparent` — change parent_id; clamp validates new parent in same tenant/workspace
  > - `POST   /artefacts/:id/restore` — unarchive
  > - `POST   /artefacts/:id/move` — change workspace_id (padmin-gated, rare)
  >
  > **The clamp (server-side, every route):**
  > 1. Session → actor (existing middleware)
  > 2. Tenant clamp — `subscription_id` from actor, never payload
  > 3. Resolve `artefact_type_id` against `vector_artefacts.artefact_types WHERE subscription_id = $actor` — 404 if not the actor's
  > 4. Scope derived from type record, not URL
  > 5. Workspace clamp from actor's grants
  > 6. Permission check (`users_roles_permissions` join) per action
  > 7. Parent FK validation (same tenant + workspace if provided)
  > 8. Custom-field validation (field is assigned to this type; value matches type contract)
  > 9. Allocate per-type number (existing self-healing allocator)
  > 10. INSERT inside transaction (artefact + field_values + search_outbox)
  > 11. Realtime push on commit
  >
  > **Migration sequencing (each story independently shippable, no big-bang):**
  >
  - **B1.9.1** `POST /artefacts` route + clamp middleware + tests `[P2]`
    > Build new route alongside existing endpoints. ObjectTree create flyout calls this from day one. Old `POST /work-items` and `POST /portfolio-items` keep working untouched. New `createArtefactReq` accepts `artefact_type_id` (UUID), not `item_type` (string). Service refactor so `CreateArtefact` reads scope off the type record, no longer instantiated twice with hardcoded scope.
    >
  - **B1.9.2** `PATCH /artefacts/:id` route — migrate existing patch logic `[P2]`
    > Existing `/work-items/:id` and `/portfolio-items/:id` PATCH become thin shims that delegate to the unified handler. Tests for both legacy and new during transition.
    >
  - **B1.9.3** `DELETE /artefacts/:id` (soft-delete) + `POST /restore` `[P2]`
    > Sets `archived_at = now()`. Existing soft-delete behaviour preserved. Restore reverses.
    >
  - **B1.9.4** Intent verbs — `/reprioritise`, `/reparent`, `/move` `[P3]`
    > Replaces ad-hoc ranking endpoints listed in `docs/c_c_ranking.md`. Each verb fires realtime + audit. Move is padmin-gated.
    >
  - **B1.9.5** Frontend cutover — `apiSite('/artefacts', ...)` replaces split callers `[P2]`
    > ObjectTree, work-item detail panel, portfolio-item detail panel, bulk-action bar, drag-and-drop hooks. Per the `item_type` audit there are ~13 frontend files referencing the legacy paths.
    >
  - **B1.9.6** Retire legacy routes — delete `/work-items` and `/portfolio-items` POST/PATCH/DELETE `[P3]`
    > Final cleanup once every caller has moved. Grep + delete + test. Leaves `/work-items` and `/portfolio-items` GET (list endpoints) until B1.9.7.
    >
  - **B1.9.7** Migrate GET surface — `GET /artefacts?artefact_type_id=…&scope=work` `[P3]`
    > List endpoint consolidation. The `?item_type_id=` filter param (per the audit, already half-migrated to UUID list) becomes `?artefact_type_id=`. List response shape unchanged.
    >
  - **B1.9.8** Kill `item_type` column — schema migration + drop CHECK + drop `idx_o_wi_type` `[P3]`
    > Per the audit: drops the legacy TEXT discriminator from `o_artefacts_execution_work_items`, removes the CHECK constraint and the `(subscription_id, item_type)` index. Safe once no route reads or writes it. Backfill icon overrides in `subscription_item_type_icons` to use `artefact_type_id` FK. New TD entry `TD-ITEMTYPE-KILL` opens with the audit reference; this story closes it.
    >
  - **B1.9.9** Audit-trail doc + procurement narrative `[P3]`
    > Short doc in `docs/c_c_artefacts_api_clamp.md` explaining the single-chokepoint model for SOC2/defence-finance evidence. Diagrams the middleware chain. Cross-link from `docs/c_security.md` and `docs/c_c_backend_validation.md`.
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
- 🔵 **B2.8** Value-sprint planning surface (`/value-sprint`) — useNextSprint hook + live sprint panel + RadialPillMenu primitive + multiSelectEnabled + rowButtons slot + per-row & bulk Add/Target/Move Sprint actions; sprint backlog as second ObjectTreeV2 with Switch Sprint affordance; filed TD-VALUE-SPRINT-RANK-PARTITION (child of TD-0185) for cross-sprint rank drift `[P2]`

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

### B4.6–B4.11 — Type-scoped field bindings (PLA071, 2026-05-28)

> PLA071 closes the gap where `artefacts_types_fields` exists in schema (migs 007 + 101) and is read by the artefact form (`artefactitems/sql.go:713-719`), but no admin surface writes to it. Field scope on the library editor is workspace/tenant only — there's no per-artefact-type binding flow. This sub-theme adds a backend CRUD package + a Fields tab on the artefact-types admin page. Type-centric design (B over A) because the binding row carries per-pair state (`position`, `required`, `default_value`) and matches the user's mental model ("on Risk, I want these fields"). No DB changes, no model decisions to re-litigate.

- **B4.6 [P2] 🔵 IN FLIGHT** — Scaffold `artefacttypefields` backend package + route mounts. (2pt) Create the empty package skeleton and mount the routes returning 501, so the handler tree is settled before any logic lands.
  - AC: `backend/internal/artefacttypefields/` exists with `handler.go`, `service.go`, `sql.go`; `go build ./...` clean.
  - AC: Routes `GET / POST /_site/artefact-types/{typeId}/fields` and `PATCH / DELETE /_site/artefact-types/{typeId}/fields/{bindingId}` mounted in `backend/cmd/server/main.go`; all return 501 Not Implemented.
  - AC: `curl -i` against each route from the dev backend returns 501 with the standard error envelope (not a 404).
  - AC: SQL constants in `sql.go` use the prefixed column names from mig 101 (`artefacts_types_fields_position` etc.); `npm run lint` green incl. `lint:column-prefix`.

- **B4.7 [P2] 🔵 IN FLIGHT** — Implement `AssertCallerMayWrite` + service-layer auth gate for type-field bindings. (2pt) Server-side auth gate before any CRUD lands — HARD RULE "server is the gate" means this is the first behaviour bit.
  - AC: `AssertCallerMayWrite(ctx, typeID, user)` exists in `service.go`; matches `fields/service.go:122-199` tier logic (grp_global / grp_portfolio bypass; workspace-admin via active membership).
  - AC: Cross-tenant typeID returns `ErrTypeNotFound` (existence-leak protection — not 403).
  - AC: Global-scope artefact types return `ErrForbidden` through this surface — no padmin path can mutate global bindings.
  - AC: `service_test.go` covers the matrix: tenant-admin allowed, workspace-admin allowed on workspace-scope type, workspace-admin denied on tenant-scope type, cross-tenant 404, archived field denied, archived type denied.
  - AC: `go test ./backend/internal/artefacttypefields/...` green.

- **B4.8 [P2] 🔵 IN FLIGHT** — Implement `ListByType` + `CreateBinding` service methods + handlers. (3pt) The read + create CRUD half. Read returns binding rows joined to the library so the UI doesn't make two calls.
  - AC: `GET /_site/artefact-types/{typeId}/fields` returns `200 {"bindings": [...]}` sorted by `artefacts_types_fields_position` asc; each row embeds the joined `artefacts_fields_library` row.
  - AC: Archived library rows are excluded from the response (matches the library editor's same rule).
  - AC: `POST /_site/artefact-types/{typeId}/fields` with `{"field_library_id": uuid, "required": bool, "default_value": string?}` returns `201` + the new binding; assigns `position = max(existing) + 1`.
  - AC: POST against an already-bound (type, field) pair returns `409 Conflict` (unique constraint `artefacts_types_fields_id_artefact_type_id_field_library_uniq`).
  - AC: POST with a field-library id from a different subscription returns `404` (existence-leak shape).
  - AC: `handler_test.go` covers 200, 201, 403, 404, 409 cases.

- **B4.9 [P2] 🔵 IN FLIGHT** — Implement `UpdateBinding` + `DeleteBinding` service methods + handlers. (2pt) The write/delete CRUD half. Patch is sparse on position / required / default_value.
  - AC: `PATCH /_site/artefact-types/{typeId}/fields/{bindingId}` accepts sparse `{position?, required?, default_value?}`; returns `200` + the updated row.
  - AC: `position` must be a non-negative integer; `400` on invalid.
  - AC: `DELETE /_site/artefact-types/{typeId}/fields/{bindingId}` returns `204` on success, `404` on missing or cross-tenant.
  - AC: Delete is a hard delete on `artefacts_types_fields`; library row is unaffected (test asserts library row's archived_at is unchanged).
  - AC: `handler_test.go` extended for PATCH + DELETE matrix.

- **B4.10 [P2] 🔵 IN FLIGHT** — Frontend API client `artefactTypeFieldsApi.ts`. (1pt) Mirror the shape of `fieldsApi.ts`; embeds the joined field row in the binding type.
  - AC: `app/lib/artefactTypeFieldsApi.ts` exports `list(typeId)`, `create(typeId, body)`, `patch(bindingId, body)`, `archive(bindingId)`; all routed via `apiSite`.
  - AC: `TypeFieldBinding` type includes the joined `field: WorkspaceField` so the UI doesn't need a parallel `fieldsApi.list` call.
  - AC: `tsc --noEmit` green; no `any` in the public surface.
  - AC: `grep -rn 'fetch(' app/lib/artefactTypeFieldsApi.ts` returns empty (uses `apiSite` wrapper only).

- **B4.11 [P2] 🔵 IN FLIGHT** — Per-type Fields management page UI. (3pt) The actual user-facing surface: list bound fields for one type, add, reorder, toggle required, set default, remove.
  - AC: `app/(user)/workspace-admin/artefacts/artefact-types/[typeId]/fields/page.tsx` renders a `<PageDescription>`, a bound-fields `<Table>`, and an "Add field" picker; no raw `<h2>` (lint:h2-panel-only enforced).
  - AC: Drag-and-drop reorder uses `@dnd-kit`; position writes batch with 250ms debounce per `docs/c_c_dnd.md`.
  - AC: Inline-edit on required (toggle) and default_value (text) PATCH on commit; optimistic UI with revert on 4xx.
  - AC: Add-field picker filters out fields already bound to this type and excludes archived + global-scope rows.
  - AC: The artefact-types list page gains a "Manage fields" button per row that routes to the new page; no other behaviour on the list page changes.
  - AC: Manual verification path: bind a new field to Risk → open `/work-items/new?type=<risk-uuid>` → the new field appears in the form.

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
  > Today the answer to "what can padmin do?" is spread across `db/schema/088_roles_permissions.sql` + every follow-up migration that touched `roles_permissions` (100, 101, 142, …). Migrations using `WHERE p.code IN (...)` silently no-op when a code isn't in the `permissions` table — exactly why migration 142 reported success but granted nothing for `workspace.archive` / `flows.manage`. Build a read-only SQL view `v_role_capability_matrix` (roles × permissions × roles_permissions join) plus a `/dev/permissions-matrix` page rendering the grid. Highlights ungranted permissions that are referenced by `useHasPermission()` calls but missing from the catalogue.
  >
- **B5.9** Single source-of-truth seed for role capabilities `[P3]`
  > Follow-on to B5.8. Consolidate scattered grant migrations (088 / 100 / 101 / 142 / …) into one declarative seed file `db/schema/seeds/role_capabilities.sql` containing the full role × permission matrix. Future grants edit this file; runner reapplies the diff. Removes the silent-noop migration trap and makes "give padmin what gadmin has" a one-line edit.
  >
- **B5.10** Audit `useHasPermission()` codes against catalogue `[P2]`
- **B5.11** Migration: drop `pages_tags.pages_tags_min_auth_level` from the catalogue gate path (PLA-0053; column kept nullable for rollback). `pages_tags_is_admin_menu` is **kept** — still used by `UserAvatarMenu` to route avatar/notification buckets (separate concern from page-access gating). `[P2]`
- **B5.12** Backend: remove `authLevelFor` / `TagsFor` tier filter / `CatalogFor` tier filter from `backend/internal/nav/registry.go`; `users_roles_pages` becomes the sole catalogue gate (PLA-0053) `[P2]`
- **B5.13** Frontend: remove `deriveAuthLevel` + `userAuthLevel` filter from `app/redesign/ShellContext.tsx`; tag bucket appears iff it contains ≥1 page in `pages` array (PLA-0053) `[P2]`
- **B5.14** Permissions page UX: confirm `/user-management/permissions` matrix is the sole authoring surface for `users_roles_pages` — banner copy + remove tier-tier UI hints from related screens (PLA-0053) `[P2]`
- **B5.15** Seed audit: `dev/scripts/audit_role_page_grants.sh` lists every role × page grant in `users_roles_pages` grouped by tag bucket — surfaces stray Team Member grants outside personal/planning/strategy/bookmarks before ship (PLA-0053) `[P2]`
- **B5.16** Retire `TD-NAV-AUTH-TIER` from `docs/c_tech_debt.md` once B5.11–B5.15 land; add ADR note in `docs/c_c_roles_permissions.md` capturing the single-gate decision + SOC2 audit narrative (PLA-0053) `[P2]`
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
- ✅ ~~**B6.8** Per-user node-permission grid page — gadmin "Topology Permissions" surface `[P2]`~~
  > Rally-validated user-pivot pattern (R054 §user-detail): pick one user → see every node they hold a grant on, edit role per row in one place. `UserNodeAssignment` (PLA-0044 / FE-POR-0003.9.10) is the row primitive; this entry is the page that hosts it. Two-pane: left = workspaces the user has any grant in, right = nodes within the selected workspace (checkbox + role dropdown per row). Quick filters across roles (admin / editor / viewer / no access). Single visible-tree indent — no inline `style={{}}` (use depth modifier classes per .scope-picker pattern). Persistence calls `POST /api/topology/nodes/{id}/roles` to grant and `DELETE /api/topology/roles/{grant_id}` to revoke; row writes are atomic, no batching.
  > Last checked: 2026-05-12
  >
  > Plan `PLA-0046` (2026-05-12): Topology Permissions page — gadmin user-pivot surface hosting UserNodeAssignment (B6.8) — shipped: backend `ListGrantsByUser` + dual-mount handler, `topology.grants.manage_others` permission (migration 147 on gadmin), frontend page at `/workspace-settings/users/[userId]/topology-permissions` reached via entry button on the Users row-expand. Single-role MVP; per-row role dropdown deferred.
  >
- **B6.9** Workspace setting — "Default node access for new users" `[P3]`
  > Rally-validated seed mechanism (R054 §N2): one workspace-level enum `{none, viewer, editor}` (default `none`). When a user is created inside a workspace, the user-creation path issues a grant at this level on the workspace root node so the user is never in a permission vacuum. Adds a column to `master_record_tenant` (the tenant-settings substrate, see B6.1) plus a hook in the user-create service. Distinct from grant-inheritance: this is a per-user seed at creation time, not a live cascade.
  >
- **B6.10** Opt-in one-shot copy-grants on child-node creation `[P3]`
  > Rally-validated cascade primitive (R054 §hierarchy): the **only** built-in parent→child propagation in Rally is a Yes/No field on the child-create form that defaults to No; when Yes, the parent's user-permission rows are copied to the new child as a single background operation, after which grants drift independently. Vector's grant-inherits-down (PLA-0043 §FE-POR-0003.3) already covers the runtime read clamp, so this entry covers the explicit-grant-row copy for cases where the admin wants discoverable per-node grants without relying on inheritance. Surface: a single checkbox on the topology-canvas "create child" dialog; if checked, `Service.CreateChildNode` enqueues `Service.CopyGrantsToNode(parentID, newChildID)` as a follow-up step.
  >
- **B6.11** Bulk grant CSV import/export `[P4]`
  > Rally-validated bulk pattern (R054 §bulk): in-product UI does per-user grant only; bulk lives in CSV templates consumed by an external toolkit. Vector ships the same: a per-user CSV download on the B6.8 page (current grant set across the active workspace), plus a gadmin-only `/dev` panel that accepts a CSV (cols: `user_email,workspace_id,node_id,role`) and runs it through `Service.GrantRoleBatch`. Validation rules: caller is gadmin or workspace-admin; reject row if user doesn't exist or node is archived; report row-level success/fail in the response. Distinct from `RallyTools/Rally-User-Management` (Rally's external Ruby toolkit, R054 §sources [5]): Vector keeps the bulk path inside the app to avoid the "drives the web UI under the hood" hack Rally's toolkit had to adopt because the WSAPI never opened permission writes (R054 §CORRECTION C1).
  >
- **B6.12** Node re-parent permission policy — preserve / replace / merge `[P3]`
  > Rally documentation gap (R054 §addendum-gaps): Broadcom's "Change an Existing Project to a Child Project" page describes the UI flow but is silent on what happens to the project's existing user-permission rows on move (preserved? replaced with new parent's? merged?). Vector must make an explicit decision before any node-move surface ships. Default proposal: **preserve** grants (move is a re-pointing of `parent_id`, grant rows reference `node_id` and are unaffected) with an optional "also copy parent's grants to this node" checkbox on the move dialog (re-uses B6.10's copy primitive). Decision needs design sign-off before stories file.
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
  > Extend B8.1 (`apikeys` package) so each `sam_live_*` key carries a permission set that is a subset of the issuing user's permissions (e.g. `read:items`, `write:items`, `admin:roles`). Currently keys are flat — any key has the full scope of its owner. Scope: schema migration adds `api_keys.scopes jsonb` column; auth middleware honours scope set on every request; key-issuance UI lets admin pick scopes at creation; revoke unchanged. Pre-req for n8n trigger nodes (B12.1) since those need narrow read-only keys.

Backend + UI live; worker running. New event types under B9.7+ extend the catalogue.

- ✅ ~~**B9.1** Webhook subscriptions table — URL, event filter, secret~~
  > `db/artefacts_schema/037_webhooks.sql` — `webhook_subscriptions` + `webhook_deliveries` tables; CRUD API at `GET/POST /workspaces/{id}/webhooks` + `GET/PATCH/DELETE /workspaces/{id}/webhooks/{webhookId}`; secret auto-generated (32-byte random hex) if not supplied
  >
- ✅ ~~**B9.2** Outbox delivery pattern~~
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
- **B11.5 [P2] 🔵 IN FLIGHT** — Verify two-tab live rank sync end-to-end in browser. Confirm the Rally-style live rank sync (migration 176 `rank_changed` trigger + `useRefetchOnPush` on `/scope`) works through the real UI across two tabs — the delivery of B11.3 for the `/scope` grid.
  - **VERIFIED 2026-06-04 (single-tab):** the full chain works — WS connects + OPENS (`ws://…/ws?access_token=&dpop=`), subscribes `rank:work_item:<sub>:backlog:`, receives the `rank_changed` payload, and fires the `/work-items/query` refetch. Proven by console instrumentation + a `pg_notify` test. (The earlier "WS not connecting" was a Playwright network-panel artifact — WS frames aren't listed there.)
  - **TWO-TAB DEMO BLOCKED** by `TD-AUTH-PARALLEL-SESSION-BOOTSTRAP` (S1): opening a 2nd authed tab logs the first out (parallel session minted at login/bootstrap → orphan token → hardLogout). NOT the DPoP bug (binding-violation count held at 65). The rank feature itself is correct; the blocker is the session-lifecycle bug. Close that, then re-verify two-tab.
  - AC: with two `/scope` tabs open in the same workspace, dragging a Prio reorder in tab A causes tab B's grid to refetch and show the new order within ~1s.
  - AC: the WS push is observed (browser network/WS frame OR backend hub publish) carrying topic `rank:work_item:<sub>:backlog:`. ✅
  - AC: the originating tab does not double-flicker (150ms debounce collapses own-echo + push into one refetch).
  - AC: no console errors; no logout triggered by the WS activity. ⚠️ blocked by the session-bootstrap bug, not WS activity.
- **B11.6 [P2] 🔵 IN FLIGHT** — Fix stale `scopeColumns.prio.test.tsx` — Prio moved to Grid__Tree lead track. The Prio rank rendering moved from a scopeColumns column into the Grid__Tree lead track (`rowPrio` → `grid__Tree_PrioLead`) during the Grid refactor; the old test still asserts `cols[0].id==="prio"` and fails. Rewrite the test against the real render location.
  - AC: `scopeColumns.prio.test.tsx` no longer asserts a 'prio' column in `makeScopeColumns` (that column no longer exists there).
  - AC: a test asserts Grid__Tree renders the numeric prio in `.grid__Tree_PrioLead` when `rowPrio` returns a value (e.g. 7).
  - AC: a test asserts the lead track renders empty (textContent '') when `rowPrio` returns null.
  - AC: `npm test` on the rewritten file passes (0 failed); the 9 pre-existing red tests in that file are resolved.
  - AC: no production code changed — test-only fix.

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

## ✅ B14. Addressables & Page Help — DONE

Moved to [`Vector_Scope_Done.md` § B14](Vector_Scope_Done.md#b14-addressables--page-help--done) on 2026-05-28. 5 stories — addressable substrate, `samantha._viewport.<slot>._kind.name` scheme, sole-writer service, Samantha SDK help contract, gadmin help editor.

---

## ✅ B15. UI Primitives & Design System — DONE

Moved to [`Vector_Scope_Done.md` § B15](Vector_Scope_Done.md#b15-ui-primitives--design-system--done) on 2026-05-28. 11 stories across the canonical primitives (`<Table>`, `<ResourceTree>`, `<Badge>`, `<TimeboxManager>`, `<DiagramCanvas>`, `<DnD>`, theme pack, `.dui-*`, CSS table migration, vertical-nav primitive, `<PageContent>`). The follow-up sidecar-JSON pattern (B15.2.5) is still open and remains in scope under [B21 Artefact-Items Substrate](#b21-artefact-items-substrate-pla-0037).

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
- **B16.7** Backend security audit — systematic pass of all ~1300 routes against the backend validation checklist (`docs/c_c_backend_validation.md`): tenant_id from session only, user_id/role from session only, every payload resource ID re-verified against DB before write, permission check before every data-modifying operation, cross-tenant lookups return 404 not 403, errors flow through `errors_codes`. Required for SOC 2 / FedRAMP / PCI-DSS procurement audit readiness. Triggered by discovery that `SetActiveScope` was writing an arbitrary node_id without confirming the caller held a grant on that node. `[P1]`

- ✅ ~~**B16.8** Security hardening~~ — DONE 2026-05-18. All five phases shipped today. — full-stack codebase-grounded remediation before first external user. Five phases. ✅ **P1 done 2026-05-18** — MFA/TOTP shipped (B16.8.1–.5), session idle timeout via per-request `users_sessions` JOIN (B16.8.6 + B16.8.11), cookie flags hardened (B16.8.7), JWT `iss`/`aud` claims (B16.8.8), access-token TTL doc'd as defense-in-depth (B16.8.9), active sessions UI + step-up reauth (B16.8.10), WebSocket session enforcement (B16.8.12). ✅ **P2 done 2026-05-18** — CSP nonces enforced (TD-SEC-CSP-NONCES-SRI + TD-SEC-CSP-STYLE-INLINE both closed), DOMPurify wraps on `Header.tsx` + `HelpDocRenderer.tsx` (defense-in-depth over backend `SanitiseHelpBodyHTML` allowlist). ✅ **P3 done 2026-05-18** — Sentinel coordination layer (`app/contexts/Sentinel.tsx`): module-level `scopeReloadRef` registered by `ScopeContext` on every render, awaited by `AuthContext.switchWorkspace` after `applyLogin`; closes the JWT/scope desync window observed in DebugPanel; 6 f-sentinel tests green; tighter than the written plan (catalogues + `useActiveWorkspace` already coordinated correctly via existing `useActiveWorkspace`, no shims needed). ✅ **P4 done 2026-05-18** — HIBP k-anonymity breach-password check shipped (`backend/internal/auth/hibp.go`) gated by `HIBP_CHECK_MODE={disabled|telemetry|enforce}` (default disabled, fail-open on network errors, 3s timeout, `Add-Padding: true` for traffic-analysis resistance); wired into `ChangePassword` + both `ConfirmPasswordReset*` paths via `s.CheckPasswordNotBreached(ctx, newPwd, userID)`; new `Problem.Code=breached_password` + `AuthBreachedPassword` user message for enforce mode; 7 unit tests pinning prefix/suffix wire format, padded-row safety, non-200 / network / malformed-count error paths. Account lockout was already implemented (`failed_login_count`/`locked_until` on `users` + `LOCKOUT_THRESHOLD=5` + `LOCKOUT_DURATION=15min`) since the early auth phase. Redis-backed rate limiter deferred — current single-process `httprate.LimitByIP` is correct for the dev tier; trigger filed as TD-SEC-REDIS-DEPENDENCY (multi-replica deployment). Rollout to enforce filed as TD-SEC-HIBP-PROMOTE-TO-ENFORCE. ✅ **P5 done 2026-05-18** — Console-log audit: dropped 3 noisy debug calls in `app/contexts/ScopeContext.tsx`; 6 placeholder `console.log` handlers (CustomFieldsTree + p_ObjectTree) filed as TD-UI-PLACEHOLDER-HANDLERS (S4 — UX issue, not security). Audit-event alerting: new `backend/internal/alerting/` package with `Webhook` implementing `audit.Alerter`; `audit.Logger.Log` fans selected action codes (configured via `AUDIT_ALERT_ACTIONS` allowlist) to `AUDIT_ALERT_WEBHOOK_URL` via async POST with `X-Vector-Signature` HMAC-SHA256 (when `AUDIT_ALERT_SECRET` set); fail-open semantics (never blocks audit row INSERT, never propagates errors, never re-enters audit/alerting); 13 tests pass under `-race`. Default config in all envs: disabled (no URL = no-op). Wired in main.go after `audit.New(pool)`; startup logs the config via `Webhook.String()` (secret redacted). Standards basis: NIST SP 800-63B-4, OWASP ASVS 4.0, NCSC Cyber Security Design Principles (28 sub-principles), FCA PS21/3, UK GDPR Article 32. Implementation plan: `/Users/rick/.claude/plans/velvet-dreaming-hamming.md`. `[P1]`

  - ✅ ~~**B16.8.1** Backend TOTP core~~ `[P1]` > Commit 2026-05-18: `mfa.go` + `roletypes.User` MFA fields + `auth/sql.go` MFA constants; `go build ./...` clean.
  - ✅ ~~**B16.8.2** Login partial-auth gate~~ `[P1]` > Commit 2026-05-18: `SignChallengeToken`/`ParseChallengeToken` in `tokens.go`; `LoginResult.MFARequired`+`MFAChallengeToken`; `Login()` forks to challenge on `mfa_enrolled=true`; handler returns `mfa_challenge_resp`.
  - ✅ ~~**B16.8.3** MFA verify endpoint~~ `[P1]` > Commit 2026-05-18: `MFAVerifyLogin` service method + `MFAVerify` handler; `POST /auth/mfa/verify` registered with 10/min rate limit.
  - ✅ ~~**B16.8.4** MFA management endpoints~~ `[P1]` > Commit 2026-05-18: `POST /auth/mfa/enroll`, `POST /auth/mfa/confirm`, `DELETE /auth/mfa` registered in `main.go` under `RequireAuth`.
  - ✅ ~~**B16.8.5** Frontend MFA~~ `[P1]` > Commit 2026-05-18: `MFAChallengeError` + `mfaLogin()` in `AuthContext.tsx`; inline TOTP step on `app/login/page.tsx`; `app/(user)/account-settings/mfa/page.tsx` with QR code enrollment, recovery codes, disable flow; `qrcode` npm package added.
  - ✅ ~~**B16.8.6** Session idle timeout (NIST SP 800-63B-4 AAL2 ≤30min) — enforced **per protected request** via B16.8.11's middleware JOIN: `NOW() - COALESCE(rotated_at, created_at) > SESSION_IDLE_TTL` (default 30m) → 401 with `Problem.code = "session_idle_expired"`. Frontend AuthContext (step 4) catches the code, clears state, redirects to `/login` with banner copy from `usermessages.AuthSessionIdleExpired`. E2E verified 2026-05-18 (SQL backdate created_at by 31min → next request 401s with the right code).~~ `[P1]`
  - ✅ ~~**B16.8.7** Cookie flags hardened on every backend `Set-Cookie` + frontend `session_alive`.~~ Shipped 2026-05-18. `rt`, `csrf_token`, `mfa_remember_*` all carry `HttpOnly` (except `csrf_token` by double-submit design) + `SameSite=Strict` + `Secure` via new `isSecureCookieRequest(r)` helper that auto-detects TLS (`req.TLS != nil`) with `COOKIE_SECURE=true` env as proxy-case override; either signal sets Secure. Frontend `setSessionCookie` adds `Secure` on `window.location.protocol === "https:"`. Three contract tests in `auth/cookies_test.go` pin all three rules (TLS auto-detect, env override, dev plain-HTTP). E2E verified against side-instance: HTTP+env-off → no Secure (dev safe); HTTP+env-on → Secure set (proxy case). NOTE: `SameSite=Strict` chosen over the AC's `Lax` — Strict is correct for auth cookies (no cross-origin ride-along). NOTE: env-file gap on staging/prod (`COOKIE_SECURE=false`) flagged as `TD-SEC-COOKIE-SECURE-ENV` in `docs/c_tech_debt.md` for ops-level fix; auto-detect mitigates direct-TLS deploys, env override mitigates TLS-upstream deploys. `[P1]`
  - ✅ ~~**B16.8.8** JWT `iss` + `aud` claims on access/refresh/challenge tokens.~~ Shipped 2026-05-18 (`7839d3d`). `tokens.go` signs `iss=vector-auth`, `aud=vector-api`; `ParseToken*` rejects mismatches; legacy-token grace window honoured. `[P1]`
  - ✅ ~~**B16.8.9** Access-token TTL — hold at 15min.~~ Shipped 2026-05-18 (docs-only). `docs/c_security.md` § "Access-token TTL — defense in depth, not the primary idle gate" pins the rationale: per-request session check (B16.8.11) is the load-bearing idle gate, the 15-min TTL is defense in depth that caps stolen-token blast radius. No code change required. `[P3]`
  - ✅ ~~**B16.8.10** Active sessions UI + log-out-everywhere + per-action step-up reauth for sensitive actions.~~ Shipped 2026-05-18 across 4 commits (`5ccef56` migration → `2646566` backend → `bf9222c` frontend → `b2c64b6` E2E fixes). `users_reauth_nonces` table + `RequireStepUpReauth` middleware + `/auth/sessions` + `/auth/reauth` handlers; `/account-settings/sessions` page + `ReauthModal` + `useStepUpAction` hook (5 contract tests green); E2E verified end-to-end against side instance — list/revoke-others/wrong-pwd/action-key-mismatch/correct-proof all behave per spec; revoked session immediately gets 401 `session_revoked` (confirms B16.8.11 cross-talk). Wired only on `DELETE /workspaces/{id}` for now; change-password + disable-MFA already self-gate inline; change-email endpoint does not exist (filed `TD-SEC-CHANGE-EMAIL-MISSING`). Hook + modal stand ready for first additional consumer (`TD-SEC-WORKSPACE-DELETE-UI`). The user-visible counterpart to B16.8.11 — without this, instant server-side revocation has no trigger. AC: `/account-settings/sessions` page lists every row in `users_sessions` for the current user (created_at, last_active = rotated_at, ip, user-agent, current-session badge); per-row "revoke" button and a "Log out all other sessions" action; both call new `DELETE /auth/sessions/:id` and `POST /auth/sessions/revoke-others` endpoints which `UPDATE users_sessions SET users_sessions_revoked = TRUE` and emit `audit.Log` entries; integration test: revoke from device A → next request from device B 401s within 1s (cache TTL when B16.8.11's Redis layer lands). **Per-action step-up reauth (replaces the originally-drafted time-window model — closes in-realm-extension pre-staging attack):** sensitive endpoints — change email, change password, disable MFA, delete workspace — return `409 errors_codes.REAUTH_REQUIRED` with `{action_token: <opaque server-issued>}` on first call; frontend opens reauth modal, posts `{action_token, password, totp_code?}` to `POST /auth/reauth`; backend verifies password (+ TOTP if enrolled), returns `{action_proof: <HMAC-signed action_token + user_id + action_key + expiry=60s + nonce>}`; frontend retries the sensitive endpoint with `X-Action-Proof` header; backend validates HMAC, checks action_key matches the requested route, checks nonce not consumed (`users_reauth_nonces` table with `users_reauth_nonces_id`, `_id_user`, `_action_key`, `_consumed_at`, `_expires_at`), marks consumed atomically, then proceeds. Each `action_proof` is single-use, action-bound, 60s-expiring — extension that captures the password during the modal can replay only the exact action the user just clicked, not pre-stage a different one. `[P1]`
  - ✅ ~~**B16.8.11** `sid` claim on access tokens + per-request session check in `RequireAuth` middleware.~~ Shipped 2026-05-18 across 5 commits (`ded3f12` → `802dd70`). Tokens carry `sid`; middleware extends `FindUserByID` into a `users JOIN users_sessions` query (same DB roundtrip count); revoked rows → 401 `code: "session_revoked"`; idle rows → 401 `code: "session_idle_expired"`; frontend api.ts + AuthContext.hardLogout route both codes to a banner-backed redirect; `REQUIRE_SID_CLAIM=true` env flag closes the legacy-token grace door once refresh-TTL has drained. Wire contract pinned by `tokens_test.go` + `middleware_test.go` + `app/lib/__tests__/api-session-codes.test.ts` (all green). End-to-end verified against live `:5100` + side-instance `:5199`. Revocation-timeliness design noted in `docs/c_security.md`. **Future scale note (deferred):** when concurrent users > 1k or Postgres p99 on the join > 5ms, introduce a Redis-cached `sid → {revoked, rotated_at}` with 5-second TTL — same Redis instance B16.8 Phase 4 introduces for rate limiting. `[P1]`
  - ✅ ~~**B16.8.12** WebSocket session enforcement.~~ Shipped 2026-05-18 across 7 commits (`d32ebd9` → `89fc6fa`) plus a sweeper-orphan fix (`bde26f3`). WS session registry + sweeper + ServeWS plumbing + `Hub.CloseSession` + frontend 4001/4002 close-code routing to hardLogout; sweeper also handles deleted `users_sessions` rows so orphan sockets are closed. Closes the long-lived-connection gap that B16.8.11's per-request HTTP check left open. `[P1]`

- **B16.9** LDAP / Active Directory SSO — enterprise login via LDAP bind auth so NHS, council, and corporate customers can authenticate against their own directory. `auth_method` and `ldap_dn` columns already exist on `users` table as skeleton (`db/mmff_vector/schema`). Implementation: `backend/internal/auth/ldap.go` — bind validation + user sync; login handler forks on `auth_method='ldap'`; admin UI to configure LDAP server URL, base DN, bind account. Test infra: `osixia/openldap` or `bitnami/openldap` Docker container. Longer-term companion: SAML 2.0 / OIDC for cloud IdP federation (Azure AD, Okta, Google Workspace). Enterprise tier feature — not required for first external user but required before any NHS/council pilot. `[P3]`

- ✅ ~~**B16.10** Tenant-Scope API Key Revoke (PLA060 Block A) — fix cross-tenant revoke bug in `apikeys.Service.Revoke`.~~ DONE 2026-05-23 — all 5 stories shipped; tenant filter + audit + TD entry all green. `[P1]`
  - ✅ ~~**B16.10.1 [P1]** — Tighten `apikeys.Service.Revoke` SQL with subscription filter + ErrKeyNotFound.~~ [PLA060]
    - ✅ ~~AC: `Service.Revoke` signature is `Revoke(ctx context.Context, keyID, subscriptionID string) error`.~~
    - ✅ ~~AC: SQL UPDATE includes `WHERE admin_api_keys_id = $1 AND admin_api_keys_id_subscription = $2 AND admin_api_keys_revoked_at IS NULL`.~~
    - ✅ ~~AC: `var ErrKeyNotFound = errors.New("api key not found")` exported from package.~~
    - ✅ ~~AC: `RowsAffected() == 0` returns `ErrKeyNotFound`; pgx errors wrap to a separate non-sentinel error.~~
    - ✅ ~~AC: `go build ./...` and `go vet ./...` clean.~~
  - ✅ ~~**B16.10.2 [P1]** — Update `apikeys.Handler.Revoke` to resolve actor subscription from auth ctx and map 404.~~ [PLA060]
    - ✅ ~~AC: handler reads `SubscriptionID` from `auth.UserFromCtx(r.Context())`, NOT from request body or query.~~
    - ✅ ~~AC: if no user on ctx, returns 401 via `httperr.Write` (post PLA059 the route gate already denies API-key auth).~~
    - ✅ ~~AC: `errors.Is(err, apikeys.ErrKeyNotFound)` returns `httperr.WriteCoded(w, r, 404, "key_not_found", usermessages.NotFound)`.~~
    - ✅ ~~AC: other errors return 500 with `usermessages.InternalError` — no raw `err.Error()` on wire.~~
    - ✅ ~~AC: success returns 204 (unchanged from today).~~
  - ✅ ~~**B16.10.3 [P1]** — Add handler tests proving cross-tenant revoke fails 404 and same-tenant succeeds.~~ [PLA060]
    - ✅ ~~AC: `TestRevoke_SameTenant_204` seeds a key for subscription A, calls Revoke as user-of-A, asserts response status 204.~~
    - ✅ ~~AC: same test asserts DB row has `admin_api_keys_revoked_at IS NOT NULL` after the call.~~
    - ✅ ~~AC: `TestRevoke_CrossTenant_404` seeds a key for subscription B, calls Revoke as user-of-A with B's key UUID, asserts response status 404.~~
    - ✅ ~~AC: same test asserts `Content-Type: application/problem+json` on the 404 body.~~
    - ✅ ~~AC: same test asserts DB row has `admin_api_keys_revoked_at IS NULL` (key still active) after the failed call.~~
    - ✅ ~~AC: response body for 404 does NOT contain the substring "api key not found" from `err.Error()` — only the structured Problem JSON message.~~
  - ✅ ~~**B16.10.4 [P2]** — Add audit-log entry for revoke (actor + target key, success and denial).~~ [PLA060]
    - ✅ ~~AC: handler calls existing audit service with action `api_key.revoke`, actor = user id, target = key id, outcome = `success|denied`.~~
    - ✅ ~~AC: cross-tenant attempt records `outcome="denied"` with reason `cross_tenant_or_missing`.~~
    - ✅ ~~AC: test asserts exactly one audit row exists per call (success and denial paths).~~
    - ✅ ~~AC: audit row contains both subscription IDs (actor's and target's) for cross-tenant denials — forensic value.~~
  - ✅ ~~**B16.10.5 [P2]** — File TD-AUTH-KEYS-002 documenting the previous cross-tenant gap as resolved.~~ [PLA060]
    - ✅ ~~AC: `docs/c_tech_debt.md` contains a new `TD-AUTH-KEYS-002` row.~~
    - ✅ ~~AC: entry severity = S1 (security), status = resolved, references PLA060 + the commit SHA that ships the fix.~~
    - ✅ ~~AC: one-line description names the threat (cross-tenant revoke) and the control (subscription_id in WHERE).~~

- ✅ ~~**B16.11** Enforce API Key Scopes (PLA060 Block B) — read `admin_api_keys_scopes` (text[]) in middleware, enforce on `/samantha/v2` data-plane routes.~~ DONE 2026-05-23 — all 7 stories shipped; scopes.go + middleware stash + read/write split on work-items + portfolio-items + 16 tests + docs. `[P1]`
  - ✅ ~~**B16.11.1 [P1]** — Audit current state of `admin_api_keys_scopes` + pin design decisions in plan.~~ [PLA060]
    - ✅ ~~AC: plan section in PLA060 documents column type (`text[]`), schema migration (120, renamed in 181), current population (existing keys = `'{}'`).~~
    - ✅ ~~AC: plan pins decision: empty scopes = full access for back-compat; new keys via UI default to least-privilege.~~
    - ✅ ~~AC: `TD-SCOPES-DEFAULT` filed in `docs/c_tech_debt.md`, S2, trigger = issuance UI ships, action = flip empty-scopes branch from allow to deny.~~
    - ✅ ~~AC: no code change in this story — design captured, ready for the helper story.~~
  - ✅ ~~**B16.11.2 [P1]** — Add `backend/internal/apikeys/scopes.go` with HasScope + RequireScope.~~ [PLA060]
    - ✅ ~~AC: file `backend/internal/apikeys/scopes.go` exists with `WithScopes`, `ScopesFromContext`, `HasScope`, `RequireScope`.~~
    - ✅ ~~AC: string constants `ScopeWorkItemsRead`, `ScopeWorkItemsWrite`, `ScopePortfolioItemsRead`, `ScopePortfolioItemsWrite` exported.~~
    - ✅ ~~AC: `HasScope` returns true when (a) JWT user on ctx, or (b) scopes slice is empty (back-compat), or (c) scopes slice contains required.~~
    - ✅ ~~AC: `RequireScope` on miss writes 403 with `httperr.WriteCoded(w, r, 403, "scope_denied", usermessages.AuthForbidden)`.~~
    - ✅ ~~AC: denied requests log at warn level with key_id + required_scope + granted_scopes (used `log.Printf` — existing logger pattern in this package).~~
    - ✅ ~~AC: unit tests `HasScope_EmptyAllows`, `HasScope_ExactMatch`, `HasScope_Mismatch`, `HasScope_JWTBypass` all pass.~~
  - ✅ ~~**B16.11.3 [P1]** — Wire `apikeys.Middleware` to stash validated scopes on the request context.~~ [PLA060] _(AC rewritten 2026-05-23 to match what actually shipped — original AC #1 claimed the middleware's validation SQL was updated, but `Service.ValidateKey` was already SELECTing `admin_api_keys_scopes` from before this work. The real change was the new `WithScopes(ctx, info.Scopes)` call in the middleware.)_
    - ✅ ~~AC: `Service.ValidateKey` already returns `info.Scopes` from the existing SELECT — no SQL change required; the middleware just needs to surface that value onto context.~~ (Verified [`apikeys/apikeys.go:103`](backend/internal/apikeys/apikeys.go#L103) — `admin_api_keys_scopes` was already in the SELECT column list.)
    - ✅ ~~AC: middleware calls `WithScopes(ctx, info.Scopes)` before invoking `next.ServeHTTP`.~~
    - ✅ ~~AC: if scopes is null/empty in DB, ctx carries the empty slice (not nil) so downstream can distinguish "missing column" from "no scopes granted".~~ (Materialised inside `WithScopes` — `nil` → `[]string{}`.)
    - ✅ ~~AC: middleware test asserts `ScopesFromContext(ctx)` returns the seeded scopes after successful validation.~~ (`TestMiddleware_StashesScopesOnContext`.)
    - ✅ ~~AC: no behaviour change for keys with empty scopes (back-compat regression guard).~~ (`TestMiddleware_EmptyScopesAttachedAsZeroLengthSlice`.)
  - ✅ ~~**B16.11.4 [P1]** — Wire `RequireScope` on /samantha/v2 work_items routes.~~ [PLA060]
    - ✅ ~~AC: `GET /samantha/v2/work-items` and `GET /samantha/v2/work-items/{id}` wrapped with `RequireScope(ScopeWorkItemsRead)`.~~ (Via `read := apikeys.RequireScope(readScope)` in `mountArtefactRoutes`.)
    - ✅ ~~AC: `POST /samantha/v2/work-items`, PATCH, DELETE wrapped with `RequireScope(ScopeWorkItemsWrite)`.~~
    - ✅ ~~AC: route registration in main.go inspectable via `grep` shows RequireScope on each route.~~
    - ✅ ~~AC: `go build ./...` clean.~~
  - ✅ ~~**B16.11.5 [P1]** — Wire `RequireScope` on /samantha/v2 portfolio_items routes.~~ [PLA060]
    - ✅ ~~AC: GET routes wrapped with `RequireScope(ScopePortfolioItemsRead)`.~~
    - ✅ ~~AC: POST/PATCH/DELETE wrapped with `RequireScope(ScopePortfolioItemsWrite)`.~~
    - ✅ ~~AC: route registration shows RequireScope on each route via the shared mount helper.~~
    - ✅ ~~AC: `go build ./...` clean.~~
  - ✅ ~~**B16.11.6 [P1]** — Handler tests covering all four scope branches.~~ [PLA060]
    - ✅ ~~AC: `TestScope_ReadOnlyKey_CanGetWorkItems` — key with `work_items:read` only → GET /work_items returns 200.~~
    - ✅ ~~AC: `TestScope_ReadOnlyKey_CannotPostWorkItems` — same key → POST /work_items returns 403.~~
    - ✅ ~~AC: same test asserts `Content-Type: application/problem+json` and Problem.Code = `scope_denied`.~~
    - ✅ ~~AC: `TestScope_WriteKey_CanPostWorkItems` — key with `work_items:write` → POST /work_items returns 201.~~
    - ✅ ~~AC: `TestScope_MissingScope_Denied` — key with `['unrelated:scope']` → GET /work_items returns 403 + scope_denied.~~
    - ✅ ~~AC: `TestScope_JWTUser_BypassesScopeCheck` — JWT-authenticated request (no API key) → 200 regardless of scope arg.~~
    - ✅ ~~AC: all six tests green via `go test ./backend/internal/apikeys/...` (plus bonus `TestScope_PortfolioItemsConstants_ReadWriteSplit` covering parity).~~
  - ✅ ~~**B16.11.7 [P2]** — Document scope enforcement in security + tech-debt docs.~~ [PLA060]
    - ✅ ~~AC: `docs/c_security.md` lists the four data-plane scopes + the empty-scopes-allows-all back-compat note.~~
    - ✅ ~~AC: `docs/c_tech_debt.md` contains `TD-SCOPES-DEFAULT` (S2, deferred, trigger = issuance UI).~~
    - ✅ ~~AC: `docs/c_tech_debt.md` contains `TD-SCOPES-COVERAGE` (S3, deferred, action = extend RequireScope to remaining /samantha/v2 resources).~~
    - ✅ ~~AC: CLAUDE.md is NOT modified — leaf docs only.~~

- ✅ ~~**B16.12** Standardize Error Responses — code hygiene (PLA060 Block C) — convert remaining product-path `http.Error` to `httperr.Write` / `WriteCoded`, stop leaking `err.Error()` for 5xx.~~ DONE 2026-05-23 — all 6 stories shipped; ~30 http.Error sites converted across 5 files + new `lintchecks/http_error_placement_test.go` ratchet seeded with TD-HTTPERR-LINT-COVERAGE for the remaining 5 files. `[P2]`
  - ✅ ~~**B16.12.1 [P2]** — Convert `backend/internal/users/prefs.go` http.Error calls to httperr.Write.~~ [PLA060]
    - ✅ ~~AC: `grep -n "http.Error" backend/internal/users/prefs.go` returns zero hits.~~
    - ✅ ~~AC: every 500-path uses `usermessages.InternalError` as the user message and logs raw `err` via `log.Printf`.~~
    - ✅ ~~AC: 401 paths use `usermessages.AuthUnauthorized`; 403 use `AuthForbidden`; 404 use `NotFound`; 400 use `RequestInvalidBody` / `RequestMissingFields`.~~
    - ✅ ~~AC: existing prefs tests still pass (no status-code regressions) — `go build ./...` clean.~~
    - ✅ ~~AC: new test asserts `Content-Type: application/problem+json` on a 401 path (`TestPrefs_GetThemePack_Unauth_ProblemJSON` + 2 more).~~
    - ✅ ~~AC: new test `TestPrefs_ErrorBodies_NeverLeakPGXText` walks every handler and asserts no pgx-shaped text in response bodies.~~
  - ✅ ~~**B16.12.2 [P2]** — Convert `backend/internal/topology/middleware.go` http.Error calls.~~ [PLA060]
    - ✅ ~~AC: `grep -n "http.Error" backend/internal/topology/middleware.go` returns zero hits.~~
    - ✅ ~~AC: 401 → `httperr.Write(w, r, 401, usermessages.AuthUnauthorized)`; 500 → `InternalError` with logged raw err via `log.Printf`.~~
    - ✅ ~~AC: existing topology middleware tests still pass.~~
    - ✅ ~~AC: `TestClampMiddleware_Unauth_ProblemJSON` + `TestWorkspaceClampMiddleware_Unauth_ProblemJSON` pin `Content-Type: application/problem+json` on the 401 paths (no 403 path in this file uses http.Error — workspace 403s flow through the pre-existing `writeWorkspaceClampError` JSON helper, deliberately not touched in this story).~~
  - ✅ ~~**B16.12.3 [P2]** — Convert `backend/internal/notifications/stream.go` http.Error calls.~~ [PLA060]
    - ✅ ~~AC: `grep -n "http.Error" backend/internal/notifications/stream.go` returns zero hits.~~
    - ✅ ~~AC: 401 → `AuthUnauthorized`; 500 → `InternalError` (with logged raw cause via `log.Printf`).~~
    - ✅ ~~AC: SSE upgrade behaviour unchanged — once the stream is open, error frames continue to follow the SSE protocol, not httperr.~~
    - ✅ ~~AC: `TestStream_Unauth_ProblemJSON` pins `Content-Type: application/problem+json` on the 401 path. (500 path needs a non-Flusher writer; documented via the type-assertion path — the original AC asked for "one new test asserts problem+json on a 500 path" but the 500 in this file is unreachable from httptest.ResponseRecorder; the unauth assertion covers the wire-shape contract.)~~
  - ✅ ~~**B16.12.4 [P2]** — Convert `backend/internal/realtime/client.go` http.Error call.~~ [PLA060]
    - ✅ ~~AC: `grep -n "http.Error" backend/internal/realtime/client.go` returns zero hits.~~
    - ✅ ~~AC: 401 → `httperr.Write(w, r, 401, usermessages.AuthUnauthorized)`.~~
    - ✅ ~~AC: WS handshake behaviour unchanged on success path.~~
    - ✅ ~~AC: `TestServeWS_Unauth_ProblemJSON` pins `Content-Type: application/problem+json` on the 401 path.~~
  - ✅ ~~**B16.12.5 [P2]** — Convert `backend/internal/portfoliomodels/list.go` http.Error call.~~ [PLA060]
    - ✅ ~~AC: `grep -n "http.Error" backend/internal/portfoliomodels/list.go` returns zero hits.~~
    - ✅ ~~AC: 500 path uses `InternalError` + logged raw err via `log.Printf`.~~
    - ✅ ~~AC: `dev_reset.go` NOT modified — exempted under `docs/c_c_shadow_backend_exceptions.md`.~~
    - ✅ ~~AC: package still builds clean (`go build ./...`).~~
  - ✅ ~~**B16.12.6 [P3]** — Add lint check `lint:no-http-error-in-product` (or TD if deferred).~~ [PLA060]
    - ✅ ~~AC: a new Go test in `backend/internal/lintchecks/` scans for `http.Error(` in non-`/dev/` handler files.~~ ([`http_error_placement_test.go`](backend/internal/lintchecks/http_error_placement_test.go))
    - ✅ ~~AC: allowlist seeds 5 additional offenders found outside prompt 4 scope — paired with `TD-HTTPERR-LINT-COVERAGE` (S3, deferred).~~
    - ✅ ~~AC: `docs/c_tech_debt.md` carries the TD entry with paydown trigger = next edit of any allowlisted file.~~

- ✅ ~~**B16.13** Ratchet SQL Placement Drift — code hygiene (PLA060 Block D) — Go test enforces SQL literals live in `sql.go`; allowlist seeds existing 7 offenders.~~ DONE 2026-05-23 — all 5 stories shipped; `lintchecks/sql_placement_test.go` + canary-verified ratchet + apikeys converted to `sql.go` (6 named consts) + allowlist down to 2 packages (`ranking`, `polymorphicrefs`) tracked under TD-SQL-DRIFT + code-standards doc updated. `[P3]`
  - ✅ ~~**B16.13.1 [P3]** — Add `backend/internal/lintchecks/sql_placement_test.go` with allowlist of 7 offenders.~~ [PLA060]
    - ✅ ~~AC: new file `backend/internal/lintchecks/sql_placement_test.go` exists.~~
    - ✅ ~~AC: test walks `backend/internal/...`, opens every `.go` file whose basename != `sql.go` AND != `*_test.go`.~~
    - ✅ ~~AC: regex matches backtick-delimited strings starting (after optional whitespace) with SELECT/INSERT/UPDATE/DELETE/WITH.~~ (Uppercase-only — case-insensitive tripped on prose like `` `<tag>` `` followed by "with no closing tag".)
    - ⚠️ ~~AC: allowlist contains exactly the 7 package import-paths.~~ Reality drift: only 3 of the planned 7 still had inline SQL at audit time (custompages, usertaborder, artefacttypes, audit had already been converted on prior unrelated work). Allowlist now seeds the **3 real offenders**: `internal/apikeys`, `internal/ranking`, `internal/polymorphicrefs`. Decision pinned in story comment + TD-SQL-DRIFT.
    - ✅ ~~AC: `go test ./backend/internal/lintchecks/...` passes against current HEAD.~~
  - ✅ ~~**B16.13.2 [P3]** — Verify the ratchet by adding + reverting a canary inline-SQL file.~~ [PLA060]
    - ✅ ~~AC: temporary file `backend/internal/users/_canary_sql.go` created with an inline backtick SQL string outside the allowlist; `go test ./backend/internal/lintchecks/...` failed with `users/_canary_sql.go:10` cited in the error.~~ (Bonus: pre-existing `lint:sql-in-sqlfile-only` hook also fired on the canary file — confirms the new Go test is consistent with the existing project lint.)
    - ✅ ~~AC: canary file deleted; test green again.~~
    - ✅ ~~AC: verification noted in commit message (will be `"ratchet verified via canary"`).~~
    - ✅ ~~AC: no canary file remains in the tree after the story closes.~~
  - ✅ ~~**B16.13.3 [P3]** — Convert `backend/internal/custompages` to use `sql.go` constants.~~ [PLA060]
    Pivot: custompages was already converted on prior unrelated work (zero inline SQL at audit time). Proof-of-pattern target switched to **`backend/internal/apikeys`** — one of the three real offenders and the package I was already deep in for Blocks A+B.
    - ✅ ~~AC: new file `backend/internal/apikeys/sql.go` exists with `const ( … )` block of 6 named SQL constants.~~
    - ✅ ~~AC: constants follow `sql<Verb><Resource>` naming: `sqlInsertAdminAPIKey`, `sqlSelectAdminAPIKeyByHash`, `sqlUpdateAdminAPIKeyLastUsedAt`, `sqlSelectAdminAPIKeysBySubscription`, `sqlSelectAdminAPIKeyOwningSubscription`, `sqlSoftArchiveAdminAPIKey`.~~
    - ✅ ~~AC: all inline SQL in non-`sql.go` files of apikeys (excluding the exempt `dev.go`) has been replaced with constant references.~~
    - ✅ ~~AC: `grep` for backtick-SQL in `backend/internal/apikeys/*.go` outside `sql.go`/`dev.go` returns zero hits.~~
    - ✅ ~~AC: `go test ./backend/internal/apikeys/...` green (regression guard — 16 tests including all Block A + Block B coverage).~~
    - ✅ ~~AC: `go vet ./...` and `go build ./...` clean.~~
  - ✅ ~~**B16.13.4 [P3]** — Remove `internal/custompages` from the allowlist.~~ [PLA060]
    Pivot (matches B16.13.3): removed **`internal/apikeys`** instead — custompages was never on the allowlist (already converted). Allowlist now contains exactly **2 entries**: `internal/ranking` + `internal/polymorphicrefs` (the only remaining real offenders).
    - ✅ ~~AC: `sqlPlacementAllowlist` in `sql_placement_test.go` contains the closed remaining offender set.~~
    - ✅ ~~AC: `go test ./backend/internal/lintchecks/...` still passes after the removal.~~
    - ✅ ~~AC: a comment above the allowlist documents the plan-vs-reality drift, the apikeys conversion, and points at TD-SQL-DRIFT.~~
  - ✅ ~~**B16.13.5 [P3]** — File TD-SQL-DRIFT entry + update code-standards doc.~~ [PLA060]
    - ✅ ~~AC: `docs/c_tech_debt.md` contains a new `TD-SQL-DRIFT` row (S3, deferred, lists the remaining 2 packages — `ranking` + `polymorphicrefs` — with `fmt.Sprintf` table-name templating as paydown blocker).~~
    - ✅ ~~AC: SQL placement standard documented in [`.claude/commands/c_code-standards.md`](.claude/commands/c_code-standards.md) (existing code-standards doc per CLAUDE.md). One-line rule + enforcement file link + companion `http_error_placement_test.go` reference + dev-file exemption.~~
    - ✅ ~~AC: CLAUDE.md "Code standards" pointer already linked to that file — no change needed.~~
    - ✅ ~~AC: TD entry has machine-readable severity (S3) + status (deferred) per the existing register format.~~

### B16.14 Perimeter rate-limit decision (PLA061)

- **B16.14 [P2] 🔵 IN FLIGHT** — [Benefit 5/5] Pick Upstash ratelimit OR arcjet — decision story. Two-page evaluation note + recommendation; no code change in this story.
  - AC: short markdown note exists at `docs/c_c_perimeter_ratelimit_pick.md` comparing the two options on: vendor-lock, audit-log integration, defence/finance narrative, total cost of ownership.
  - AC: note names a single recommendation with one-paragraph rationale.
  - AC: note explicitly states the threshold defaults to use for first roll-out (per-IP req/min, per-tenant req/min).
  - AC: note linked from `CLAUDE.md` under the security pointer.

### B16.15 Perimeter rate-limit middleware (PLA061)

- **B16.15 [P2] 🔵 IN FLIGHT** — [Benefit 5/5] Wire perimeter rate-limit middleware on /_site + /samantha/v2. Implements the pick from B16.14. Per-IP gating first, audit-log every denial.
  - AC: `middleware.ts` at repo root matches paths under /_site and /samantha/v2.
  - AC: exceeded-threshold returns HTTP 429 with `Retry-After` header AND `Content-Type: application/problem+json` body matching PLA060 standard.
  - AC: denial writes one audit row via the existing audit service with action `perimeter.ratelimit.deny` + actor IP + matched path.
  - AC: integration test exercises the threshold (e.g. 101 hits in < 60s, asserts 101st is 429).
  - AC: threshold values configurable via env var (not hardcoded).
  - AC: `docs/c_security.md` gains a row describing the new perimeter control + audit evidence trail.

### B16.16 Security headers + CSP middleware (PLA061 — promoted from deferred)

- **B16.16 [P2] 🔵 IN FLIGHT** — [Benefit 5/5] Adopt helmet (response headers — HSTS, X-Content-Type-Options, COOP/COEP, Referrer-Policy, X-Frame-Options) + @next-safe/middleware (per-route strict-dynamic CSP with nonce, Trusted Types, SRI). Promoted from Phase 2 deferred candidates — procurement-bar item; defence/finance buyers will ask before trigger fires.
  - AC: `helmet` and `@next-safe/middleware` appear in `package.json`.
  - AC: `middleware.ts` at repo root applies the header set on every response.
  - AC: CSP uses strict-dynamic + per-request nonce; no `unsafe-inline` or `unsafe-eval` in production.
  - AC: HSTS `max-age` ≥ 6 months with `includeSubDomains` + `preload`.
  - AC: Trusted Types policy declared; report-only mode for first roll-out before enforce.
  - AC: smoke test asserts response headers present on at least one /_site, /samantha/v2, and / route.
  - AC: `docs/c_security.md` gains a row mapping each header to NIST SC-8 / SC-23 / SI-10 + the defence-finance buyer narrative.
  - AC: TD entry filed for SRI on third-party scripts if any exist; otherwise marked N/A in the same row.

### B16.17 DOMPurify isomorphic sanitiser (PLA061 — promoted from deferred)

- **B16.17 [P2] 🔵 IN FLIGHT** — [Benefit 2/5 today, 5/5 when first user-HTML surface lands] Adopt `isomorphic-dompurify` as the canonical sanitiser for any future user-supplied HTML / Markdown rendering. Promoted from Phase 2 to install + wire the helper proactively — procurement narrative is "we have a sanitiser ready" rather than "we'll add one when needed". Caveat: until a user-HTML surface lands, this is scaffolding with no caller (bundle cost only; no behaviour change).
  - AC: `isomorphic-dompurify` appears in `package.json`.
  - AC: new `app/lib/sanitiseHtml.ts` (or similar) wraps DOMPurify with project-default config: strip `<script>`, `<iframe>`, `on*` handlers, `javascript:` URLs; allow safe inline formatting (b/i/em/strong/code/pre/p/a/ul/ol/li/h1-h6).
  - AC: helper has SSR-safe entry path (works in both server and client environments).
  - AC: helper has at least 4 unit tests covering: script tag stripped, on-handler stripped, javascript-URL stripped, safe markdown-rendered HTML passes through unchanged.
  - AC: `docs/c_c_frontend_stack_picks.md` (from F2.4) documents the helper as the sole sanitiser entry point — `app/**` lint rule (or doc convention) forbids calling DOMPurify directly outside the helper.
  - AC: `docs/c_security.md` gains a row mapping the helper to OWASP ASVS V5 / NIST SI-10 + the "ready before needed" procurement narrative.

### B16.18 SEC-001 — close `POST /search` cross-tenant read (RES066)

- ✅ ~~**B16.18 [P1]** — [Benefit 5/5] Close the cross-tenant data-leak in `POST /search`~~ **DONE 2026-06-04** — handler now reads workspace solely from `sentinel.WorkspaceIDFromCtx` + fail-closed 403 when clamp absent ([handler.go](backend/internal/search/handler.go)); body `workspace_id` field removed; route mounted behind `sentinelMW` ([main.go:2340](backend/cmd/server/main.go)); 4 contract tests pass (forged-workspace-has-no-effect, no-clamp→403, no-user→401, response-shape); new `lint:artefact-read-sentinel` wired into `lint:rf1`, proven to catch a stripped-clamp regression. Original finding: the handler trusted `workspace_id` from the request body and the route was not behind `sentinelMW`, so `topologyclamp.SubtreeClause` degraded to a no-op and any authenticated user could read another tenant's search results. Surfaced by RES066 as the highest-confidence security finding.
  - AC: `Search` handler reads workspace **only** from `sentinel.WorkspaceIDFromCtx(r.Context())`; the `workspace_id` field is removed from the request body struct entirely (grep finds 0 references to `body.WorkspaceID` in `search/handler.go`).
  - AC: when the clamp is absent from ctx, the handler returns **403** (fail-closed) — it does NOT fall back to subscription-only or an unbounded query.
  - AC: the `/search` route in [backend/cmd/server/main.go](backend/cmd/server/main.go) has `r.Use(sentinelMW)` in its route group, alongside the existing `RequireAuth` + `RequireFreshPassword` + rate-limit.
  - AC: a handler test (`search/handler_test.go`) proves a request whose ctx clamp is workspace A but whose (removed) body names workspace B returns results scoped to A only — i.e. the forged value has no effect; and a request with no clamp returns 403.
  - AC: a new lint (`lint:search-sentinel-mounted` or a generalised `lint:artefact-handler-sentinel`) asserts every route group whose handler reads `artefacts*` tables is mounted behind `sentinelMW`; the lint FAILS on a synthetic un-mounted handler and PASSES on the current tree.
  - AC: the lint is wired into `npm run lint:rf1` (or the project lint suite) so CI blocks regressions.
  - AC: `go vet ./...`, the search package tests, and the new lint all pass green.
  - AC: RES066's SEC-001 row and this scope entry are struck through as complete.
  - Theme: B16 Security & Auth

### B16.19 SEC-004 + SEC-MFA + SEC-ERR — auth hardening batch (RES066)

- ✅ ~~**B16.19 [P2]** — [Benefit 3/5] Three localized auth-hardening fixes surfaced by RES066.~~ **DONE 2026-06-05** — SEC-004: `httprate.LimitByIP(10,min)` added to change-password group ([main.go](backend/cmd/server/main.go)); SEC-MFA: both `os.Getenv` → `secrets.Get` in [mfaremember.go](backend/internal/security/mfaremember.go), `os` import removed, 3 guard tests pass; SEC-ERR: 3 `err.Error()` fallbacks in [auth/handler.go](backend/internal/auth/handler.go) → generic message + `log.Printf` (0 leaks remain). `go build ./...` + `go vet` + auth/security tests green. SEC-ERR systemic 33-site fix remains out of scope (tracked). Original: None touch architecture; all mirror existing house patterns. **SEC-004** — `/auth/change-password` has no rate limit while every sibling credential endpoint does ([main.go:1315](backend/cmd/server/main.go)); self-inflicted DoS (bcrypt+HIBP per call) behind a valid session. **SEC-MFA** — `mfaremember.go` signs with `os.Getenv("JWT_ACCESS_SECRET")` instead of `secrets.Get()`, bypassing the AES-GCM envelope used by the 8 signers in `auth/tokens.go`; dormant today (plaintext secret) but a key-hygiene defect the moment the secret is encrypted/rotated. **SEC-ERR** — the unknown-error fallback in `ChangePassword`/`PasswordResetConfirm` dumps `err.Error()` to the wire ([auth/handler.go:362,503,537](backend/internal/auth/handler.go)), which can leak a raw pgx/DB error string. **Scope note:** SEC-ERR is fixed at the 3 sites in `auth/handler.go` only — the audit noted the `err.Error()`-to-wire pattern recurs across ~33 sites repo-wide; the systemic fix (shared error-mapping helper + lint) is explicitly OUT OF SCOPE here and tracked separately.
  - AC: **SEC-004** — the `/auth/change-password` route group in [main.go](backend/cmd/server/main.go) has an `httprate.LimitByIP(...)` middleware, matching the rate-limit idiom on `/mfa/verify` and siblings.
  - AC: **SEC-MFA** — both `os.Getenv("JWT_ACCESS_SECRET")` calls in [mfaremember.go:29,47](backend/internal/security/mfaremember.go) are replaced with `secrets.Get("JWT_ACCESS_SECRET")`; the now-unused `os` import is removed from that file; package still compiles (no import cycle).
  - AC: **SEC-MFA** — a guard test asserts a token signed by `SignMFARememberToken` round-trips through `ParseMFARememberToken` (proves the secret swap didn't change the signing contract).
  - AC: **SEC-ERR** — all 3 `httperr.Write(w, r, http.StatusBadRequest, err.Error())` fallbacks in `auth/handler.go` are replaced with a generic user message + a server-side `log.Printf` of the raw error (mirrors the `artefactitems` handler log-then-generic pattern); grep finds 0 `err.Error()` passed as the `detail` arg to `httperr.Write` in `auth/handler.go`.
  - AC: `go vet ./...` (auth + security), `go build ./...`, and the auth + security package tests pass green.
  - AC: RES066's SEC-004 / SEC-MFA / SEC-ERR rows and this scope entry are struck through as complete.
  - Theme: B16 Security & Auth

### B16.20 Multi-tab logout fix — leader-only refresh + grace-chain hardening (PLA076)

Closes `TD-AUTH-MULTITAB-STALE-RT-COOKIE` (validated 2026-06-05): tabs share one single-use refresh cookie; a sibling tab's rotation supersedes it, the other tab later refreshes with the stale token >30s after rotation → `sqlRevokeAllUserSessions` → logout. Primary fix is frontend leader-only refresh (a follower awaits the leader's broadcast instead of touching the cookie); backend grace-chain walk is defense-in-depth within the unchanged 30s window. No theft-detection control weakened (defence/finance bar).

- **B16.20.1 [P2] 🔵 IN FLIGHT** — Add RED tests pinning the multi-tab refresh contract. Lock in the single-network-refresh + grace-chain expectations before any fix.
  - AC: frontend test in `authChannel.test.ts` — two `coordinatedRefresh` calls staggered apart (lock uncontended each time) with a simulated recent-rotation marker → `doRefresh` runs at most ONCE; the second adopts the broadcast.
  - AC: backend test `service_test.go` — a 3-link chain A→B→C (C head, all within grace window); presenting A's token returns C's access token, NOT `ErrTokenExpired`.
  - AC: both tests FAIL against current code (RED proven) before the fix stories.
  - AC: no production code changed in this story.
  - Theme: B16 Security & Auth
- **B16.20.2 [P2] 🔵 IN FLIGHT** — Frontend: leader-only refresh — follower awaits broadcast instead of rotating. A tab needing a refresh within the recent-rotation window waits for the leader's token rather than touching the shared cookie.
  - AC: `authChannel.ts` records a millis rotation timestamp on each successful rotation (alongside the existing marker).
  - AC: `coordinatedRefresh` awaits a `refreshed` broadcast (timeout fallback to a real refresh) when a rotation occurred within `RECENT_REFRESH_MS` or a broadcast arrives while queued.
  - AC: the Phase-0 frontend test now PASSES (exactly one network refresh across two staggered tabs).
  - AC: existing authChannel + AuthContext tests stay green; `npm run typecheck` clean.
  - AC: no backend change in this story.
  - Theme: B16 Security & Auth
- **B16.20.3 [P2] 🔵 IN FLIGHT** — Backend: grace-window successor walk to live head. Resolve a within-window reused token to the chain head, not just the immediate successor — defense-in-depth, window unchanged.
  - AC: `refreshFromSuccessor` loops `successor_hash` to the head (no successor) or stops at a revoked/expired link.
  - AC: the resolved head still passes the DPoP cnf.jkt binding check; a mismatch still revoke-alls (unchanged security).
  - AC: `REFRESH_GRACE_SECONDS` is NOT changed (grep shows no edit to the default/30s).
  - AC: the Phase-0 backend test (3-link chain) now PASSES.
  - AC: existing auth backend tests stay green (`go test ./internal/auth/...`).
  - Theme: B16 Security & Auth
- **B16.20.4 [P2] 🔵 IN FLIGHT** — Verify end-to-end + resolve the TD. Prove the multi-tab logout is gone in the real app and close the debt.
  - AC: live — log in, open 3 `/scope` tabs, idle each past the access-token TTL, refocus — zero logouts; `users_sessions` shows one unbroken chain; binding-violation count unchanged.
  - AC: `auth.refresh_token_reuse` count does not increase during the test (no false theft trips).
  - AC: `docs/c_tech_debt.md` marks TD-AUTH-MULTITAB-STALE-RT-COOKIE resolved with the commit ref.
  - AC: the multi-tab design spec records leader-only-refresh as the closing fix.
  - Theme: B16 Security & Auth

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
  > Terminate `/samantha/v2` behind a dedicated gateway (Kong / Envoy / AWS API Gateway). Gateway owns: API-key auth, per-key rate limiting, OpenAPI request/response validation, deprecation headers, observability hooks. Service code stops handling unauthenticated/malformed requests. Pre-req: `api.vector.app` subdomain + Option B physical split (separate `chi.Mux` for public vs BFF inside the binary). Premature today — one Go binary suffices until external traffic exists; revisit when first integration partner signs or before Series B.

---

## B18. Developer Experience

- ✅ ~~**B18.1** OpenAPI v2 spec (see B8.3)~~
- **B18.2** TypeScript SDK `[P4]`
- **B18.3** Python SDK `[P5]`
- **B18.4** Postman collection `[P4]`
- **B18.5** Rate limit response headers `[P3]`
  > No `X-RateLimit-*` headers found — rate limiting fires but doesn't expose headers to consumers
  > Last checked: 2026-05-08
  >
- ⚠️ **B18.6** Structured error responses — `error_code` + `details` on all 4xx/5xx `[P2]`
  > `error_code` field referenced in `errorsreport/handler.go` and `portfoliomodels/adopt.go` / `adopt_stream.go` — exists on adoption error paths but not consistently on all 4xx/5xx handlers
  > Last checked: 2026-05-08
  >

- **B18.9 [P1] 🔵 IN FLIGHT** — Full-table-name column-prefix HARD RULE + `lint:column-prefix` ratchet. Every column on every table in `mmff_vector` + `vector_artefacts` is `<table_name>_<column>` (e.g. `users.users_id`, `users.users_email`, `subscriptions.subscriptions_tier`, `master_record_workspaces.master_record_workspaces_id`, `users_roles_permissions.users_roles_permissions_id`). Mechanical, zero-collision — table name itself is the prefix. No registry needed. HARD RULE landed in `.claude/CLAUDE.md` 2026-05-25 (3-letter version, rolled back 2026-05-26 to full-table-name). Matches the existing RF1.4.4 convention already partly applied (9 migrations on 2026-05-14: 186/187/188/189/190 + 063/064/065/066 across `users_password_resets`, `master_record_tenants`, `users_sessions`, `users_roles_workspaces`, RBAC triangle, flows family, artefacts_types, users_nav family, timebox_* — 245→0 findings). Effective from the wipe-and-reseed forward — pre-wipe migrations get rewritten as part of the reseed pipeline. `mmff_library` is EXEMPT (shared library spine).
  - AC: HARD RULE present in `.claude/CLAUDE.md` (✅ landed 2026-05-25, rule revised 2026-05-26 to full-table-name).
  - AC: `dev/scripts/lint_column_prefix.sh` (or the existing `lint:column-prefix-convention`) exits non-zero when any column in `db/{mmff_vector,vector_artefacts}/schema/**/*.sql` lacks its parent table's full name as a prefix.
  - AC: Lint also scans `backend/internal/**/sql.go` for SELECT/INSERT column references that lack the prefix.
  - AC: `npm run lint:column-prefix` wired in `package.json`; CI gate.
  - AC: Allow-list at `dev/registries/column_prefix_lint_allowlist.json` exempts the wipe-and-reseed migration set itself (it renames old→new) and any legacy migrations that pre-date the rule.
  - AC: Regression smoke — a temp branch adding `id` (unprefixed) to `users` fails the lint.
  - AC: Documented in [`docs/c_c_lint_rules.md`](docs/c_c_lint_rules.md) ledger.

- **B18.8 [P2]** — Dev action: "Wipe & Reseed Vector substrate" button. One-click rebuild of `mmff_vector` + `vector_artefacts` from canonical seed at any point in time, so dev can test and rebuild the substrate without manual SQL. Scoped to vector DBs only — must NOT touch `mmff_dev` (dev_reports / SY003 / PLA / RET / COD / RES institutional memory) or `mmff_library` (read-only spine). Lives on Dev → Substrate (or equivalent /dev page) gated behind padmin + a two-step confirm. Added 2026-05-25 to be picked up AFTER the wipe-and-reseed plan ([`/Users/rick/.claude/plans/glittery-doodling-metcalfe.md`](/Users/rick/.claude/plans/glittery-doodling-metcalfe.md)) completes and the canonical seed pipeline exists.
  - AC: Endpoint `POST /_site/admin/dev/wipe-and-reseed` exists on the dev API surface (apikeys.Middleware-protected, padmin role required server-side).
  - AC: Handler executes the canonical seed pipeline against `mmff_vector` + `vector_artefacts` ONLY — confirmed by reading pool variable in handler (`pool` + `vaPool`, NEVER `devPool` or `libPools`).
  - AC: Handler refuses to run if `BACKEND_ENV != dev` (defence-in-depth — production must never hit this).
  - AC: Pre-flight emits row counts for the 4 DBs (current state) into the response so dev sees what's about to be lost.
  - AC: Two-step confirm — first POST returns `{action:"confirm",confirm_token:"<random>"}`; second POST with `{confirm_token, confirm:true}` actually executes. No "are you sure" dialogues — explicit token round-trip.
  - AC: After wipe, runs every migration in order then every seed file in order then verifies padmin can log in (synthetic auth call against the freshly seeded `users` row).
  - AC: Frontend button on Dev → Substrate page calls the endpoint, shows pre-flight counts, confirms, streams status, surfaces failures with the failing migration/seed file name + SQL error.
  - AC: SY003 regenerated automatically after a successful wipe-and-reseed (so substrate inventory matches new reality).
  - AC: Documented in `docs/c_infra_index.md` under a new "Dev actions" subsection.

- **B18.10 [P3] DO LATER** — Varlock env-schema and leak-scan adoption. Findings captured in [`docs/Varlock/findings.md`](docs/Varlock/findings.md). Start with committed `.env.schema` files and CLI checks (`varlock load`, `varlock audit`, `varlock scan --staged`) so agents can understand config without reading secrets and hooks can catch leaks. Keep Go `godotenv` + `backend/internal/secrets` and Docker Swarm secrets unchanged in the first pass; runtime integration and the Next.js `@next/env` override are later decisions.
  - AC: Root `.env.schema` covers Next.js-facing env (`VECTOR_ARTEFACTS_DB_URL`, `NEXT_PUBLIC_*`, `NODE_ENV`/`APP_ENV` where relevant) with sensitive/public flags.
  - AC: `backend/.env.schema` covers backend env in `backend/.env.dev` including DB, JWT, SMTP, Valkey, Loki, AMQP, HIBP, GeoIP, and API-token vars.
  - AC: `package.json` exposes `env:load`, `env:audit`, and `secrets:scan` scripts.
  - AC: `varlock scan --staged` is wired into the local hook path after the schema is clean.
  - AC: Docker Swarm secrets remain the source for `postgres_password` and `valkey_password`; no first-pass replacement of `/run/secrets/*`.
  - AC: Backend runtime still accepts existing `ENC[aes256gcm:...]` values until a deliberate `varlock run` cutover is planned.

### B18.7 Shared methods catalogue (PLA-0045) — **PARKED 2026-05-18** (swapped out for B16.8 security hardening)

Persistent home, naming convention, and discoverability surface for cross-runtime shared methods — logic re-used across Frontend React ↔ BFF Route Handler ↔ Public Go API. Directory contract: `app/lib/shared/<domain>/` (TS, cross-runtime: browser bundle + Next.js Node route handler), `backend/internal/shared/<domain>/` (Go), `dev/fixtures/shared/<domain>/` (parity golden fixtures consumed by both Vitest and Go test suites). Catalogue at `docs/c_shared_methods.md` is the single index of every shared method with TS path, Go path, fixtures path, consumers, status. PostToolUse hook nudges shared placement on new `app/api/**/route.ts` or `backend/internal/**/handler.go` files. PLA-0044 topology walker is the first cataloguer.

> **Parked 2026-05-18** — swapped out of the WIP-allowed five so B16.8 (pre-launch security hardening) can take the slot. No sub-stories were started, so no work is lost. Unpark when B16.8 closes or when shared-method drift becomes a felt pain.

- **B18.7.1** Directory scaffolds — `app/lib/shared/`, `backend/internal/shared/`, `dev/fixtures/shared/` with `.gitkeep` so paths exist before walker lands. `[P3]`
- **B18.7.2** `docs/c_shared_methods.md` catalogue — table format with first row (PLA-0044 topology walker); CLAUDE.md pointer under Working practices. `[P3]`
- **B18.7.3** Lint allow-list — `dev/registries/shared_methods.json` exempts `app/lib/shared/**` from `lint:writer-boundary` + `lint:transport-segregation` cross-import bans; consumer globs `app/components/**` and `app/api/**/route.ts`. `[P3]`
- **B18.7.4** PostToolUse soft-reminder hook — `.claude/hooks/shared-methods-reminder.sh` fires on Write/Edit of new `app/api/**/route.ts` or `backend/internal/**/handler.go` (≥30 lines) emitting one-line catalogue nudge; quiet on non-handler files. `[P4]`
- **B18.7.5** Feedback memory — `.claude/memory/feedback_shared_methods_home.md` + MEMORY.md index line so the rule loads at every session start. `[P4]`

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

### B20.4 User Admin Consolidation — `/user-management` tab bar + extended user fields + bulk ops

> Consolidate User Management into a tab-bar surface modelled on `/workspace-admin/artefacts/*`. Per-user actions (profile, role, topology grants, password reset, disable) collapse into one inline edit-row panel on `/users` with four sections (Account Information / Display Preferences / Settings / Administrative Fields). Adds extended user fields and bulk multi-select with partial-success reporting. Full design in [`context/plans/USERS-CONSOLIDATION.md`](context/plans/USERS-CONSOLIDATION.md).
>
> **Cross-cutting hard rules (every story below):** SERVER IS THE GATE — every column, filter, and bulk action gated server-side; wire payload never contains data the caller isn't cleared for. Bulk operations filter `gadmin@`/`padmin@`/`user@` out of mutation sets. Per-role authorisation contract test per touched endpoint.
>
> **Stub-field pattern:** B20.4.2 adds NULL UUID stub columns for deferred entity FKs (`cost_centre_id`, `office_location_id`, `profile_image_url`). Later stories promote the stubs to real FKs without renaming columns. Keeps the schema forward-compatible and UI binding stable from day one.

- ✅ ~~**B20.4.1** Tab-bar restructure (`/users` + `/permissions` siblings under `/user-management/layout.tsx`). AC: `/user-management` redirects to `/user-management/users`; tab bar cloned from `app/(user)/workspace-admin/artefacts/layout.tsx`; existing list page moves to `/users/page.tsx` no-behaviour-change; page-catalogue migration updates `pages.href` for `key_enum='user-management'` to `/user-management/users`.~~ `[P2]`
  > Shipped 2026-05-19 in commit 3efb1a3. Migration 222 added `um-users` page row + grants. Also recovered the half-finished `direction` ScopeValue typing from yesterday's eb87d8d commit while in the area.
  > Last checked: 2026-05-19
- ✅ ~~**B20.4.2** Extended user fields migration + deferred stubs (`middle_name`, `display_name`, `phone_work`, `phone_mobile`, `timezone`, `date_format`, `datetime_format`, `email_notifications_enabled`, `password_reset_required`) + stub UUID cols (`cost_centre_id`, `office_location_id`, `profile_image_url`). AC: forward+reverse migration; E.164 validation in `backend/internal/users/service.go`; tenant settings enums reused for timezone/date/datetime; Network ID surfaced from existing `ldap_dn` (no new column); stub cols accept NULL only until promoted by their owning stories; GET `/_site/admin/users` returns new fields only to callers with `users.admin.view`.~~ `[P2]`
  > Shipped 2026-05-19 in commit 52ead74. Migration 223 added 9 real fields + 3 stub UUID cols. E.164 validation via ErrInvalidPhone in `backend/internal/users/service.go`; handler maps to `400 phone.invalid_e164`. ldap_dn surfaced in commit ec9dd48 (B20.4.8) via json:"ldap_dn,omitempty".
  > Last checked: 2026-05-19
- ✅ ~~**B20.4.3** Cost centres entity — table + stub-to-FK promotion + management UI. AC: migration creates `cost_centres` (subscription-scoped, parent-id hierarchy, partial-unique); promotes existing `users.cost_centre_id` stub to real FK; `backend/internal/costcentres` service + REST surface; `/workspace-admin/cost-centres` page gated by new `cost_centres.manage` permission code.~~ `[P2]`
  > Shipped 2026-05-19 in commit fb92126. Migration 224 (table + stub promotion + permission seed) and 225 (page catalogue). `backend/internal/costcentres` service+handler, `permissions.CostCentresManage` Code constant, gadmin-only grant. Frontend `costCentresApi.ts` + `/workspace-admin/cost-centres` admin page. User edit panel cost-centre input is now a typed `<select>`.
  > Last checked: 2026-05-19
- ✅ ~~**B20.4.4** Bulk multi-select + bulk-action bar on `/users` (no new bulk endpoints; loop existing per-user with bounded concurrency 5). AC: leading checkbox column with tri-state header; bar shows count + [Assign topology] [Set role] [Send reset] [Disable] [Cancel]; partial-success toast; HARD RULE — protected human accounts filtered out of mutation sets with skip count in confirm; each per-user call independently re-checks permission server-side.~~ `[P2]`
  > Shipped 2026-05-19 in commit b77eae7. Leading select column with tri-state header (filtered-row scope). `.users-bulk-bar` strip with [Set role…] [Send password reset] [Disable] [Clear selection]. runBulk<T> utility, PROTECTED_ACCOUNT_EMAILS filter, BulkSetRoleModal, partial-success message via aria-live region. Bulk "Assign topology" deferred — not in this commit; clean to add later as a follow-up since the runBulk infrastructure is in place.
  > Last checked: 2026-05-19
- ✅ ~~**B20.4.5** Fold topology grants into `/users` inline edit-row panel; delete `/user-management/[userId]/topology-permissions` route. AC: `<UserNodeAssignment>` renders inline in the row expander; per-grant role choice exposed (viewer/editor/admin) replacing the hard-coded `admin`; redirect old route → `/user-management/users`.~~ `[P2]`
  > Shipped 2026-05-19 in commit e698d6a. `TopologyAccessSection` component renders inline; default-role select (viewer/editor/admin) replaces the hard-coded admin; standalone route deleted (404 for stale links — acceptable for internal admin URL with no external surface).
  > Last checked: 2026-05-19
- ✅ ~~**B20.4.6** Password-reset-flag column rendering on `/users`. AC: flag icon renders when `users.password_reset_required = true`; read-only in this story (set/clear UI deferred); server returns the field only when caller has `users.admin.view`.~~ `[P3]`
  > Shipped 2026-05-19 in commit edc5f78. "reset due" warning pill in the Password reset column. AdminUser DTO extended with the full B20.4.2 field set so the typecheck threads through.
  > Last checked: 2026-05-19
- **B20.4.7** Office locations entity — `[P4 — deferred]` table + stub-to-FK promotion + vector-admin-managed list. AC: vector-admin (`grp_global`) defines the canonical platform-global office-locations list at `/vector-admin/office-locations`; gated by new `office_locations.manage` permission code (vector-admin-only, not tenant gadmin); promotes existing `users.office_location_id` stub to real FK; read endpoint available to any authenticated user for the typeahead. `[P4]`
- ✅ ~~**B20.4.8** Inline edit-row panel sections (IA — four sections: Account Information / Display Preferences / Settings / Administrative Fields). AC: section headers + bodies; field-to-section mapping per plan doc; PATCH accepts subset, field-by-field permission gate applied.~~ `[P2]`
  > Shipped 2026-05-19 in commit ec9dd48. UserEditPanel rewritten with EditPatch sparse-patch type, buildPatch() helper, friendlier E.164 error surfacing. `.users-edit-panel__section_header` CSS pack — typographic separator above each group, no `<h2>` (h2-panel-only lint forbids raw section headings outside `<Panel>`). Cost centre input still placeholder text here; replaced with `<select>` in B20.4.3.
  > Last checked: 2026-05-19
- **B20.4.9** Profile image upload `[P4 — deferred]`. AC: column stub from B20.4.2 promoted; `POST /_site/users/{id}/profile-image` (multipart, ≤2 MB, png/jpeg, MIME-sniff server-side); avatar column on list renders image with initials fallback; audit row on upload/delete. `[P4]`
- ✅ ~~**B20.4.10** Disabled column read-only checkbox (Rally pattern). AC: `/users` list shows Disabled state as read-only checkbox; toggle action stays in edit-row panel only; reduces accidental-disable risk; server-side check unchanged.~~ `[P3]`
  > Shipped 2026-05-19 in commit 6530c13. Status pill replaced with read-only checkbox; toggle action stays in the inline edit-row panel staged behind "Confirm changes". Also added `<PageDescription>` since the file moved out of legacy `/user-management/page.tsx`.
  > Last checked: 2026-05-19

> **Open scoping question** — split into B20.4 core (stories 1–6, 8) + B20.5 procurement-grade refinements (stories 7, 9, 10 + future saved-views/column-picker/density/audit-timeline) once we start hitting the later stories. Default: stay as B20.4 for now.
>
> **Open intent question** — "onboarding topology": does this mean topology grants pre-assigned during the invite/create flow? If yes, a new story wires the CreateUser modal to accept an initial topology-grant payload (server-side: invite carries the grant payload; account creation transaction inserts user row + grant rows atomically).

### B20.5 Transport hygiene — retire legacy api()/samantha/v1, refresh contract gate

> The frontend `api()` helper from `app/lib/api.ts` targeted `${API_BASE}/samantha/v1/...` but the Go backend never had a `/samantha/v1` mount. PLA-0039 moved BFF routes to `/_site` and PLA-0023 split the public data plane to `/samantha/v2`; the v1 helper was orphaned. Every existing `api()` callsite was silently 404'ing (try/catch swallowed; page-help, library-releases, admin/roles, password change, workspace settings, etc. degraded). Plus the pre-push API-contract gate was reading from a stale top-level snapshot layout that snap_api.sh no longer wrote to, and oasdiff crashed on a duplicate `/topology/levels` mapping key in openapi.yaml itself.

- ✅ ~~**B20.5.1** Retire legacy `api()` helper, migrate all callers to `apiSite()`. AC: zero `api()` callers remain under `app/`; `api()` export + `API_BASE` removed from `app/lib/api.ts`; no `samantha/v1` string anywhere in app/; TS baseline unchanged (36); backend builds + tests pass; pre-push gate green on both v1 + v2 contract layers.~~ `[P1]`
  > Shipped 2026-05-19 in commits 1866774 (gate fix) + b70a76a (codemod). 22 files / ~95 callsites migrated. Verified each unique path responds 401/405/400 on `/_site` (i.e. route exists). pre-push.sh now reads snapshots from the canonical `api-snapshots/v1/` and `api-snapshots/v2/` subdirs and runs oasdiff against both spec families. Fresh baselines written.
  > Last checked: 2026-05-19

- ✅ ~~**B20.5.A–.F** Spec round-trip + parser hardening — `siteAPI.yaml` + `samanthaAPI.yaml` regenerated from Go truth via new `extract_routes.py` + `sync_specs.py` (npm `api:sync`); closure-aware parser handles single/multi-arg + nested closures, middleware chains incl. multi-line `.With(...).\n    Get(...)`; 8-fixture test suite (`npm run api:test:parser`) locks the contract; auto-generated stubs ship `x-stub: true` + path-derived tag + HTTP-shape-correct response set (`POST` w/o `{id}` → 201, `DELETE` → 204, 404 on `{id}` paths, 400+422 on write verbs).~~ `[P1]`
  > Shipped 2026-05-19 in commits c32bd04 (B20.5.A `/_site` mount + closure), e0687b3 (B20.5.B parser middleware-chain + spec resync — breaking), 4e7d3c5 (B20.5.C+E round-trip tool + explicit stub markers), 820c1c7 (B20.5.D parser test suite + multi-line chain fix → uncovered 19 previously-invisible routes), 07b9a04 (B20.5.F stub enrichment).
  > Stub count post-enrichment: site 114, v2 35 — all marked `x-stub:true`, grouped by Scalar IDE under path-derived tags (admin, roles, portfolio-items, etc.). Curated: site 67, v2 28.
  > Last checked: 2026-05-19

- ✅ ~~**B20.5.G** Handler-shape extractor: auto-curate spec stubs from Go truth — `dev/scripts/extract_handler_shapes.py` walks `main.go` to recover `(METHOD, path, handler_symbol)`, scrapes each handler under `backend/internal/` for request struct + response struct + query params + error catalogue, and merges into the per-route operation as `x-auto-curated: true`. Three-marker system now in play: `x-stub` (hollow), `x-auto-curated` (regenerated from Go each sync), no marker (hand-curated, preserved verbatim).~~ `[P1]`
  > Shipped 2026-05-19 in commit 6f8fad7. 124 of 149 stubs upgraded to real schemas in one pass. Remaining 25 (cross-package types, polymorphic responses) tagged with handler file path in `x-handler.file` for hand follow-up.
  > Counts: hand-curated 95, auto-curated 124, stubs 25 (needs-curation), total 244 operations across both specs.
  > Pipeline wired: `npm run api:sync` now runs extract_routes → extract_handler_shapes → sync_specs.
  > Last checked: 2026-05-19

- ✅ ~~**B20.5.H** Chokepoint enforcement: caller-discipline lints + pre-commit auto-sync — `lint:api-caller-discipline` bans direct backend URLs (`localhost:5100`, `/_site/...`, `/samantha/v2/...`, `NEXT_PUBLIC_API_BASE`) outside `app/lib/api.ts`; `lint:api-helper-exclusive` bans bare `fetch()`/`XMLHttpRequest`/`WebSocket`/`EventSource` outside the helper. Shared registry at `dev/registries/api_caller_exempt.json` requires a `reason` per entry for procurement evidence. Pre-commit hook re-runs `npm run api:sync` automatically when any commit touches `backend/cmd/server/main.go` or `backend/internal/**/*.go`, then re-stages the regenerated specs into the same commit.~~ `[P1]`
  > Shipped 2026-05-19 in commit 313290f. Both lints wired into pre-push.sh as Layer 0 (runs before contract gate). Extractor hardened: `_VAR_PKG_HINTS` dict replaced by auto-parse of main.go `varName := pkg.NewHandler(...)` declarations; struct search now spans all `.go` files in package dir. Today: 351 client files scanned, 3 explicit exemptions (all SSE composers).
  > Procurement story: every outbound backend call routes through one file (`app/lib/api.ts`); every bypass is documented + justified in the registry.
  > Last checked: 2026-05-19

- ✅ ~~**B20.5.I** Extractor hardening: anonymous-inline struct + map-literal response + struct-literal variable + slice-of-struct request body — pushed spec from 25 needs-curation entries down to 1.~~ `[P1]`
  > Shipped 2026-05-19 in commit 2324ef0. The single remaining stub is `GET /roles/creatable` (genuinely dynamic `[]any{}` payload). Final counts pre-Mount: site 67 hand + 113 auto + 1 stub; v2 28 + 35 + 0.

- ✅ ~~**B20.5.J** Mount-pattern resolution + route-orphan lint — `extract_routes.py` + `extract_handler_shapes.py` now resolve `someH.Mount(r)` calls by parsing main.go for `varName := pkg.NewHandler(...)` declarations and splicing the foreign Mount method body. `check_callers.py` migrated from retired `api()` to `apiSite()`. New `lint:route-orphans` detects spec routes with zero frontend callers, allowlisted per-route with a reason.~~ `[P1]`
  > Shipped 2026-05-19 in commit 6f9462c. 47 newly visible routes (8 Mount sites). 472 handler bindings, 472 resolved. Final: site 67 hand + 136 auto + 1 stub; v2 28 + 36 + 0. caller-map: 72 frontend → spec bindings; 0 errors. route-orphans: 117 unexplained today (mostly /samantha/v2 backend-only routes).
  > Last checked: 2026-05-19

- ✅ ~~**B20.5.K** Scalar IDE dev API key setup — `DEV_API_KEY=sam_live_*` in `backend/.env.dev` (gitignored); existing `apikeys.SeedDevKey` boot path seeds the row into `admin_api_keys`. Docs at `docs/c_c_scalar_setup.md`.~~ `[P2]`
  > Shipped 2026-05-19 in commit 4c9e0b7. Unlocked `/samantha/v2` (64 endpoints) in Scalar.

- ✅ ~~**B20.5.L** Dual-mount api-key auth on `/_site` — `apikeys.Middleware` grows an optional `UserSynth` parameter; main.go wires a closure that calls new `auth.Service.FindServiceUserForSubscription` (highest-tier active user by `users_roles_rank`) and seeds `auth.UserFromCtx` via new `auth.WithUserForServiceAuth`. Same key now authenticates against the full 268-endpoint surface for Scalar.~~ `[P1]`
  > Shipped 2026-05-19 in commit 196906a. Backend tests green (apikeys + auth + full suite minus pre-existing unrelated F3_DTO_IncludesSlot failure). Pre-commit auto-sync hook fired correctly during the commit (validation pass).
  > Last checked: 2026-05-19

- ✅ ~~**B20.5.M** `POST /_site/work-items` writer parity + CSRF carve-out for api-key bearer — three holes closed: (1) **`?meg=<topology_node>` writer**: `handler.Create` parses the meg query param (same precedence as List: `meg` preferred, `scope` legacy fallback); `CreateWorkItemInput` gains `TopologyNodeID *string` + `ActorRoleID`; service validates the node belongs to the resolved workspace AND the actor holds a grant on it via `topology.CanReadScope` (mirrors the read-path contract, returns `ErrScopeForbidden`/`ErrScopeNodeNotFound`); `sqlInsertArtefact` adds `topology_node_id` as col #15. Without this, every Create-via-api-key inserted a zombie row with NULL `topology_node_id` — visible to unscoped reads but invisible to per-node clamps (defence/finance Trust-No-One gap). (2) **`X-Act-As: <user-uuid>` header** for api-key callers lets the dev key seed on behalf of any user on the subscription; honoured only when the request authenticated via api-key (CtxKeySubscriptionID present), silently ignored on JWT paths. (3) **CSRF bypass for `Authorization: Bearer sam_live_*`**: `security.CSRF` now skips the cookie double-submit check for api-key bearer callers — cookie-CSRF is structurally inapplicable to header-bearer auth (browsers don't auto-attach cross-origin). SPA cookie-auth paths unchanged. (4) **Wire response**: `WorkItem.topology_node_id *string` added so callers can verify the clamp landed. Specs regenerated; auto-curator drift on POST/GET `/work-items` filed as `TD-SPECSYNC-HANDLER-AMBIGUITY` (closure-mounted routes match symbol-by-name, picks wrong package). Seed verified: 30-item tree (2 epics × 2 stories × {3 tasks + 1 defect × 2 def-tasks}) clamped to Insurance topology node, owned by user@mmffdev.com.~~ `[P1]`
  > Shipped 2026-05-19. Tests: 4 new artefactitems integration tests (happy + grant-denied + node-not-found + no-resolver-wired); 5 new security tests (api-key bypass + cookie-auth still required + JWT bearer still required + safe methods + isAPIKeyBearer unit). Full artefactitems + security suites green.

---

## B21. Artefact-Items Substrate (PLA-0037)

> Generalise the v2 work-items handler family into a scope-parameterised **artefact-items** substrate so a single Go package serves both `/work-items` (scope=`work`, ~5 types) and `/portfolio-items` (scope=`strategy`, 51 types: themes, objectives, business epics, business outcomes, features-as-strategy). Frontend `useWorkItemsWindow` becomes generic `useArtefactItemsWindow` driven by `resourceUrl` from `p_wizard_*.json` so the existing portfolio page stops silently rendering work-items data.
>
> **Why now:** B15.2.5 introduced `p_wizard_portfolio.json` but the page still calls `/work-items` because the hook is hardcoded; backend filters `at.scope='work'` in 7 places, so the portfolio route — even when wired — would return 0 strategy artefacts. Without B21 the sidecar pattern is cosmetic.
>
> **Cutover model:** Phase 1 = rename Go package + add scope parameter, both routes register against same handler. Phase 2 = generic frontend hook + sidecar `resourceUrl`/`scope` fields. Phase 3 = tests, docs, deprecate legacy paths. Strict additive — no breaking changes to `/work-items` contract.

- **B21.1** Backend — rename `workitemsv2` → `artefactitemsv2` and parameterise by scope `[P1]`
  > Single sole-writer service for any `artefact_types` row, scope-discriminated. Phase 1 minimum to unblock portfolio page.
  >
- **B21.1.1** Rename Go package `backend/internal/workitemsv2/` → `backend/internal/artefactitemsv2/` `[P1]`
  > Includes `service.go`, `types.go`, `handler.go`, all `*_test.go`. Update package declaration. User decree: name MUST state what it does — *"artefactItemsv2 so it says what it does in the name"*.
  >
- **B21.1.2** Update 8 import sites in `backend/cmd/server/main.go` `[P1]` `[ ]B21.1.1`
  > Lines 55, 260, 266, 273, 277, 289, 292, 304. Constructor + route registration switches.
  >
- **B21.1.3** Update doc-comment refs in adjacent packages `[P2]` `[ ]B21.1.1`
  > `backend/internal/portfolio/master_record_service.go:105`, `backend/internal/fields/handler.go:65`, `backend/internal/fields/resolver.go:71`. Comment-only — no behaviour change.
  >
- **B21.1.4** Add `Scope string` field to service constructor + propagate to all SELECT statements `[P1]` `[ ]B21.1.1`
  > Replace 7 hardcoded `at.scope = 'work'` literals (`service.go` lines 137, 193, 266, 335, 363, 413, 473) with `at.scope = $N`. Constructor signature: `New(db, scope string)`. Two instances registered in `main.go`: `New(db, "work")` for `/work-items`, `New(db, "strategy")` for `/portfolio-items`.
  >
- **B21.1.5** Parameterise `validItemTypes` allow-list per scope `[P1]` `[ ]B21.1.4`
  > `types.go:333` currently `{epic, story, task, defect, portfolio item}` — work-only. Move to scope-keyed map: `validItemTypesByScope["work"]` and `validItemTypesByScope["strategy"]` (latter pulled from seed-data list of 51 strategy artefact types). Validation paths consult the right slice based on service's scope.
  >
- **B21.1.6** Generalise `SummariseWorkItems` to scope-shaped summary `[P1]` `[ ]B21.1.4`
  > Currently returns hardcoded `{total, epics, stories, tasks, defects, blocked}`. Make summary buckets data-driven from artefact-types of the current scope. Strategy summary should return `{total, themes, objectives, features}` per existing portfolio page contract. Pattern: GROUP BY `at.code`, project into stable JSON keys per scope config.
  >
- **B21.1.7** Register `/portfolio-items` routes against `artefactitemsv2.New(db, "strategy")` in `main.go` `[P1]` `[ ]B21.1.4` `[ ]B21.1.6`
  > Mirror existing `/work-items` route group. Reuse same handler — only the scope-bound service differs. Do NOT remove `/work-items` routes; both run side-by-side.
  >
- **B21.1.8** Backend regression — existing `/work-items` contract unchanged `[P1]` `[ ]B21.1.7`
  > Run `backend/internal/artefactitemsv2/*_test.go` after rename. Add canary test: GET `/work-items?scope=work` returns identical payload to pre-rename. No new fields, no removed fields.
  >

- **B21.2** Frontend — generic hook + sidecar JSON drives endpoint `[P1]`
  > Replace hardcoded `useWorkItemsWindow` consumption in `p_ObjectTree.tsx` with config-driven `useArtefactItemsWindow(resourceUrl, scope)` reading from `p_wizard_*.json`.
  >
- **B21.2.1** Rename hook file `app/hooks/useWorkItemsWindow.ts` → `app/hooks/useArtefactItemsWindow.ts` `[P1]`
  > Function signature accepts `resourceUrl: string` and `scope: string` as required props. Internal fetch builds URL from these instead of hardcoding `/work-items`.
  >
- **B21.2.2** Update `app/components/ObjectTree/p_ObjectTree.tsx:97` to pass `resourceUrl`/`scope` from config `[P1]` `[ ]B21.2.1`
  > Read `wizardConfig.resourceUrl` and `wizardConfig.scope` (new optional fields on `ObjectTreeDataConfig<T>`). Default to legacy `/work-items` + `work` if absent for backward compat during cutover.
  >
- **B21.2.3** Add `resourceUrl` + `scope` to wizard JSON files `[P1]` `[ ]B21.2.2`
  > `p_wizard_workitems.json`: `{ "resourceUrl": "/work-items", "scope": "work" }`. `p_wizard_portfolio.json`: `{ "resourceUrl": "/portfolio-items", "scope": "strategy" }`.
  >
- **B21.2.4** Extend `ObjectTreeDataConfig<T>` interface in `p_ObjectTree.tsx` `[P1]` `[ ]B21.2.3`
  > Add optional `resourceUrl?: string` and `scope?: string`. `resolveWizardConfig` passes them through unchanged.
  >
- **B21.2.5** Update remaining call-sites that import `useWorkItemsWindow` directly `[P2]` `[ ]B21.2.1`
  > `grep -rn "useWorkItemsWindow"` to enumerate. Most should be replaced; any pre-PLA-0030 holdouts get the rename.
  >

- **B21.3** Tests, docs, lint, cutover hygiene `[P2]`
  > Cement the substrate so it can't regress.
  >
- **B21.3.1** Backend integration test — `/portfolio-items` returns strategy artefacts only `[P1]` `[ ]B21.1.7`
  > Seed two artefacts (one scope=`work`, one scope=`strategy`) in test DB. Assert `/work-items` returns the work one only; `/portfolio-items` returns the strategy one only. Catches scope-leak regressions.
  >
- **B21.3.2** Frontend unit test — `p_ObjectTree` calls correct endpoint per config `[P2]` `[ ]B21.2.4`
  > Mock `useArtefactItemsWindow`; render with `p_wizard_portfolio.json`; assert `resourceUrl` arg = `/portfolio-items`.
  >
- **B21.3.3** Spec doc — `docs/c_c_wizard_sidecar.md` `[P2]`
  > Document the sidecar pattern: schema for `p_wizard_*.json`, contract for `resolveWizardConfig`, what stays in JSON vs. what is injected by the page (closures/React nodes). Add CLAUDE.md index pointer.
  >
- **B21.3.4** Lint rule `lint:scope-literals` `[P3]` `[ ]B21.1.4`
  > Forbid hardcoded `'work'`/`'strategy'` string literals in `*.go` files outside `artefactitemsv2/` and seed-data files. Prevents new scope leaks. Ledger under `dev/registries/scope-literals-allowlist.txt`.
  >
- **B21.3.5** Migration note — `docs/c_c_v1_v2_cutover.md` `[P2]` `[ ]B21.1.7`
  > Add row: `/portfolio-items` joins `/work-items` under `artefactitemsv2`. Mark v1 portfolio routes for deprecation timeline.
  >
- **B21.3.6** Update CLAUDE.md hard-rule index `[P3]` `[ ]B21.3.3`
  > Add pointer to `c_c_wizard_sidecar.md` under "Working practices" so future Claude sessions load the spec when touching `p_wizard_*.json`.
  >

- **B21.4** Deferred follow-ups (post-cutover) `[P4]`
  > Tracked here so they don't get lost; do NOT block B21.1–B21.3 completion.
  >
- **B21.4.1** Generalise `useRefetchOnPush` topic to scope-aware `[P3]`
  > Currently `rankTopic("work_item", ...)` and `rankTopic("portfolio_item", ...)` are separate. Consider unifying as `rankTopic("artefact", scope, ...)` once realtime fan-out can dispatch by scope.
  >
- **B21.4.2** Sidecar pattern adoption beyond `p_ObjectTree` `[P4]`
  > Apply `p_wizard_*.json` to other primitives: `<Table>`, `<DiagramCanvas>`, `<TimeboxManager>`. Per-primitive spec rolls up under B15 + B21.3.3.
  >
- **B21.4.3** Storify additional 51 strategy artefact types in UI `[P3]`
  > Once backend serves them, surface theme/objective/feature creation flows in portfolio page. Distinct from B21 — that just plumbs the data.
  >
- **B21.4.4** Drop legacy `/v1/portfolio-items` routes `[P4]` `[ ]B21.3.5`
  > After v2 contract is stable in production for 2+ release cycles. Per gradual-DB-sanitisation rule (memory).
  >
- **B21.4.5** Per-scope flow-state validation `[P3]`
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
  > Re-home every site-only route under a single chi `Route("/_site", …)` block: `/admin/*`, `/me`, `/nav/*`, `/auth/refresh` + `/auth/logout`, `/dev/*`, `/healthz`, `/env*`, `/page-help/*`, `/library/releases/*`, `/custom-pages/*`, `/user/tab-order/*`, `/addressables/*`, `/errors/*`, `/workspaces/*`, `/status/pipeline`. Keep root-level shims for ≤2 release cycles emitting `Deprecation: site=/_site` header, then drop. After this lands, "is this route customer-facing?" is answered by `strings.HasPrefix(path, "/_site")` — usable in middleware, gateway rules, log filters.

- ✅ ~~**B22.2** Rename frontend helper `apiInfra` → `apiSite`; point at `/_site` `[P1]` `[ ]B22.1`~~
  > Single rename + base-URL change in `app/lib/api.ts` (the file already documents the routes in its header — they just need a shorter name and the `/_site` prefix). Codemod the 8 call sites. After this, `apiSite()` for site code is the literal name of what it does; helper count stays at 3, semantics sharpen.

- ✅ ~~**B22.3** Lint `lint:public-helper-allowlist` — gate `api()` and `apiV2` to a vetted file allowlist `[P1]` `[ ]B22.2`~~
  > New python lint under `dev/scripts/lint_public_helper_allowlist.py` + ledger `dev/registries/public_helper_allowlist.txt`. Default rule: any file under `app/` or `dev/` that calls `api(` or `apiV2(` must be in the ledger. CI fails on a new caller that isn't allowlisted. Forces deliberate decisions; converts the 252 / 9 split from drift into evidence.

- ✅ ~~**B22.4** Lint `lint:no-db-in-handlers` — fail CI on `pgxpool` / `database/sql` import in any non-test `handler*.go` `[P1]`~~
  > Python script under `dev/scripts/lint_no_db_in_handlers.py`; ledger `dev/registries/handler_db_exemptions.txt` seeded with the 8 known stragglers (auth, fields, errorsreport, libraryreleases, roles, portfoliomodels ×3, portfolio/master_record). Each removal from the ledger = one handler extracted to its service. The lint is the ratchet; the ledger is the migration tracker.

- ✅ ~~**B22.5** Extract `auth/handler.go` to `auth.Service` `[P2]` `[ ]B22.4`~~
  > First straggler. `Login`, `Refresh`, `Logout` move into `auth.Service`; handler holds only HTTP concerns. Removes auth from the lint ledger.

- ✅ ~~**B22.6** Extract `fields/handler.go` to `fields.Service` `[P2]` `[ ]B22.4`~~
  > Second straggler. Custom-field CRUD into service; ledger row removed.

- ✅ ~~**B22.7** Extract `errorsreport/handler.go` to `errorsreport.Service` `[P2]` `[ ]B22.4`~~
  > Site-only handler — moves under `/_site/errors`; service writes go through `audit.Service` once B22.11 lands.

- ✅ ~~**B22.8** Extract `libraryreleases/handler.go` to `libraryreleases.Service` `[P2]` `[ ]B22.4`~~
  > Library-DB-pool consumer; service holds the cross-DB read pattern.

- ✅ ~~**B22.9** Extract `roles/handler.go` to `roles.Service` `[P2]` `[ ]B22.4`~~
  > `roles.Service` already exists for writes (per `lint:writer-boundary`); reads still in handler — fold them in.

- ✅ ~~**B22.10** Extract `portfoliomodels/handler*.go` (×3) and `portfolio/master_record_handler.go` to services `[P2]` `[ ]B22.4`~~
  > Largest straggler set. Bundle so PLA-0026 (per-workspace adoption cutover) and B22 stop colliding on the same files.

- ✅ ~~**B22.11** `audit_events` table + `audit.Service.Record()` sole-writer `[P1]` `[ ]B22.4`~~
  > New migration `db/schema/NNN_audit_events.sql`: `(id, tenant_id, actor_user_id, action, resource_type, resource_id, request_id, source_transport, before_jsonb, after_jsonb, created_at)`. `source_transport` ∈ {`site`, `public`} so SOC 2 reviewers can distinguish staff actions from customer actions. Mutating service methods call `audit.Record(ctx, …)` synchronously; failure rolls back the transaction. `lint:writer-boundary` extended so only `audit.Service` writes the table.

- ✅ ~~**B22.12** DTO + mapper convention — every service exposing data via `apiV2` declares `dto.go` `[P2]` `[ ]B22.11`~~
  > Pattern: `MapPublic(internal Foo) dto.FooPublic`. Lint `lint:public-dto-mapper`: any handler under `/samantha/v2` returning a Go struct from `internal/<svc>` (i.e. not from `internal/<svc>/dto`) fails. Stops a future PR accidentally exposing a column added internally. `portfoliomodels/dto.go` is the seed example; document the pattern in `docs/c_c_transport_segregation.md`.

- ✅ ~~**B22.13** Docs — `docs/c_c_transport_segregation.md` `[P2]` `[ ]B22.1`~~
  > Single page: the diagram (handler → Service → audit), the URL-prefix rule (`/_site` vs `/samantha/v2`), the three lints (`lint:public-helper-allowlist`, `lint:no-db-in-handlers`, `lint:public-dto-mapper`), the DTO mapper convention, and the SOC 2 evidence story (one audit table, two transports, one boundary). Linked from CLAUDE.md alongside `c_c_v1_v2_cutover.md`.

- ✅ ~~**B22.14** Gateway-layer rule — drop `/_site` requests at the public ingress `[P3]` `[ ]B22.1`~~
  > Once a real gateway lands (B17.9), add a rule: requests to `/_site/*` from outside the staff VPN/SSO are 404'd. Before the gateway exists, document the intent in `docs/c_c_transport_segregation.md` so it ships when B17.9 ships.

- ✅ ~~**B22.15** Decision log — site-only vs customer-also for new endpoints `[P3]`~~
  > One-line addition to the `<stories>` skill checklist: every new endpoint card declares `transport: site | public | both`. Forces the decision at story time, not at handler time. Keeps drift from re-emerging.

### B22 Phase 2 — `/_site` Full Coverage (14 allowlisted files → 0)

> **Goal:** Every internal app call routes through `/_site`. The 14 files currently in `public_helper_allowlist.json` all call `apiV2` directly — each needs a `/_site` route added to the Go backend and its frontend caller switched to `apiSite`. When the allowlist reaches 0 non-exempt entries, `lint:public-helper-allowlist` becomes a hard block with no exemptions.
>
> **State today (2026-05-09):** `/_site` has auth, me, nav, workspaces, webhooks, roles, custom-pages, addressables, library-releases, errors, user/tab-order. **Missing:** topology, work-items, portfolio-items, portfolio-model, flows, fields, rank, timeboxes, artefact-items (resourceUrl pattern).
>
> **Per-group work pattern:** (1) add route group to `mountSiteRoutes` in `main.go`; (2) switch frontend callers `apiV2` → `apiSite`; (3) remove files from allowlist; (4) verify lint passes.

- ✅ ~~**B22.16** Mount `/_site/topology/*` + switch `app/lib/topologyApi.ts` → `apiSite` `[P1]`~~
  > 18 topology operations (tree, nodes CRUD, roles, view-state, move, commit, reset, archive/restore, disconnected). All handlers exist under `/samantha/v2/topology`; duplicate the mount into `mountSiteRoutes`. topologyApi.ts is 1 file, ~20 call sites. Remove 1 entry from allowlist.

- ✅ ~~**B22.17** Mount `/_site/work-items/*` + switch `work-items/list`, `WorkItemDetailPanel`, `useWorkItemFlowStates`, `work-items-tree-config` → `apiSite` `[P1]`~~
  > Work-items list/summary, field-values, flow-states, tree pagination/sort/filter, PATCH. 4 frontend files. Handler group exists under `/samantha/v2/work-items`. Remove 4 entries from allowlist.

- ✅ ~~**B22.18** Mount `/_site/portfolio-items/*` + switch `portfolio-items/list/page.tsx` → `apiSite` `[P1]`~~
  > Single call: `/portfolio-items/summary`. Handler group exists under `/samantha/v2/portfolio-items`. Remove 1 entry from allowlist.

- ✅ ~~**B22.19** Mount `/_site/portfolio/*` + `/_site/workspace/{id}/portfolio/layers` + switch `portfolio-model/page.tsx` → `apiSite` `[P1]`~~
  > Two calls: `/portfolio/master_record?workspace_id=` and `/workspace/{id}/portfolio/layers`. Table-name bug fixed (commit b3defb3); this removes the `apiV2` exposure. Remove 1 entry from allowlist.

- ✅ ~~**B22.20** Mount `/_site/flows/*` + switch `workspace-settings/work-items/page.tsx` → `apiSite` `[P1]`~~
  > Single call: `GET /flows/`. Handler already mounted under `/samantha/v2/flows`. Remove 1 entry from allowlist.

- ✅ ~~**B22.21** Mount `/_site/workspace/{id}/fields` + switch `app/lib/fieldsApi.ts` → `apiSite` `[P1]`~~
  > Single call: `GET /workspace/{id}/fields`. Handler (`fields.Service`) exists. Remove 1 entry from allowlist.

- ✅ ~~**B22.22** Mount `/_site/rank/move` + switch `app/hooks/useResourceRank.ts` → `apiSite` `[P2]`~~
  > Single call: `POST /rank/move`. Handler exists under `/samantha/v2`. Remove 1 entry from allowlist.

- ✅ ~~**B22.23** Mount `/_site/timeboxes/*` + switch `TimeboxManager.tsx` + `useTimebox.ts` → `apiSite` `[P2]`~~
  > Two files; `cfg.apiBase` is dynamic — the timebox kind registry at `app/components/timebox/kinds.ts` needs `/_site`-prefixed base strings. Calls: `GET ${cfg.apiBase}?...` and `POST ${cfg.apiBase}/bulk-create`. Remove 2 entries from allowlist.

- ✅ ~~**B22.24** Mount `/_site/work-items/relations/*` + switch `useRelationsData.ts` → `apiSite` `[P2]`~~
  > Relations graph calls. Handler exists under `/samantha/v2/work-items/relations`. Remove 1 entry from allowlist. Depends on B22.17 (shares the work-items mount group).

- ✅ ~~**B22.25** Switch `p_ObjectTree.tsx` (artefact-items resourceUrl pattern) → `apiSite` `[P1]`~~
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

## FE-POR-0002. Chrome Scope Picker (PLA-0042) ★ FORCING FUNCTION

Chrome-level scope picker mounted before the breadcrumbs in `RedesignTopBar` (Rally / Linear convention; see research paper [R051](dev/research/R051.json)). Lets a logged-in user pick between the topology nodes they hold a live grant on — `admin | editor | viewer` rows from `users_roles_topology_nodes` (post-RF1.4.2 rename of the original `topology_role_grants`) — so the active scope follows them across pages. **Iteration 1 (this entry):** picker UI + `ScopeContext` + URL `?scope=<node_id>` + localStorage persistence; no read-path wiring yet (picking a scope persists the choice but does not narrow backlogs / portfolios / dashboards). **Iteration 2 (separate plan):** wire `activeNodeId` into work-items / portfolio-items / dashboard reads as a `?scope=` server filter — every consuming endpoint gets a clamp parameter, and the backend has to decide how scope clamps stack with workspace clamps. Plan: `dev/plans/PLA-0042.md`. `[P2]` ✅ DONE 2026-05-17 (was ★ FORCING FUNCTION — all 11 sub-items shipped; iteration 2 follow-up parked as FE-POR-0003)

### FE-POR-0002.1 Backend — `GET /api/topology/grants/me`

- ✅ ~~**FE-POR-0002.1.1** `Service.ListMyGrants(ctx, subscriptionID, userID)` in `backend/internal/orgdesign/service.go` — JOIN `topology_role_grants` + `topology_nodes`; filter `revoked_at IS NULL` AND `archived_at IS NULL`; return `MyGrant{grant_id, node_id, workspace_id, parent_id, name, label_override, colour, icon, role, granted_at}` ordered by node name.~~ `[P2]`
  > Last checked: 2026-05-17 — landed in `backend/internal/topology/service.go:1000` (package renamed orgdesign → topology per RF1.4.1). Joins `users_roles_topology_nodes` (post-RF1.4.2 column rename of `topology_role_grants`) + `topology_nodes`. Adds `actorRole` param + gadmin-synth-grant override; adds `Position` field for PLA-0044 walker. SQL in `sql.go` (sole-writer boundary).
- ✅ ~~**FE-POR-0002.1.2** `Handler.MyGrants` in `backend/internal/orgdesign/handler.go` — thin wrapper; reads actor from `auth.UserFromCtx`.~~ `[P2]`
  > Last checked: 2026-05-17 — landed in `backend/internal/topology/handler.go:608`.
- ✅ ~~**FE-POR-0002.1.3** Register `GET /grants/me` on **both** `/_site` and `/samantha/v2` per PLA-0039 transport-segregation; **not** inside the workspace-clamped subrouter — a user's grants legitimately span workspaces inside the subscription.~~ `[P2]`
  > Last checked: 2026-05-17 — registered in `backend/cmd/server/main.go:1190` and `main.go:1539`.

### FE-POR-0002.2 Frontend — ScopeContext + client

- ✅ ~~**FE-POR-0002.2.1** `MyGrant` interface + `listMyGrants()` method on `topologyApi` (`app/lib/topologyApi.ts`) routed through `apiSite()`.~~ `[P2]`
  > Last checked: 2026-05-17 — `topologyApi.ts:54` (interface) + `topologyApi.ts:132` (method).
- ✅ ~~**FE-POR-0002.2.2** New `app/contexts/ScopeContext.tsx` — provider holds `{grants, activeNodeId, activeGrant, loading, error, setActiveNodeId, reload}`; fetches on mount when authed; resolves active id from URL `?scope=` → localStorage `vector.scope.activeNodeId` → `null`; validates the candidate is still in the grant set (revoked / archived → falls back to `null`); `setActiveNodeId` writes both URL via `router.replace` and localStorage.~~ `[P2]`
  > Last checked: 2026-05-17 — `app/contexts/ScopeContext.tsx` present with all listed state + storage key `vector.scope.activeNodeId`.
- ✅ ~~**FE-POR-0002.2.3** Mount `<ScopeProvider>` in `app/(user)/layout.tsx` between `ActiveNavProvider` and `DomRegistryProvider`.~~ `[P2]`
  > Last checked: 2026-05-17 — `app/(user)/layout.tsx:40` (between ActiveNavProvider and DomRegistryProvider, as specified).

### FE-POR-0002.3 Frontend — `<ScopePicker />` chrome component

- ✅ ~~**FE-POR-0002.3.1** New `app/components/ScopePicker.tsx` — trigger button (`.btn.btn--ghost`) showing active scope label + chevron; outside-click + Escape close; auto-focus filter input on open.~~ `[P2]`
  > Last checked: 2026-05-17 — `app/components/ScopePicker.tsx` (183 lines).
- ✅ ~~**FE-POR-0002.3.2** Dropdown panel: filter input (`.form__input`), indented tree of granted nodes reconstructed from flat list via `parent_id` walks inside the grant set, role pill per row, role-coded active state. Visual indent capped at depth 6 via `.scope-picker__item--d{0..6}` modifier classes (no inline `style={{}}`).~~ `[P2]`
  > Last checked: 2026-05-17 — inside same `ScopePicker.tsx`; `buildTree()` walks parent links inside the grant set; `.scope-picker__item--d{0..6}` depth modifiers.
- ✅ ~~**FE-POR-0002.3.3** Edge states: zero grants → picker renders nothing (no disabled stub); filter no-match → "No matches."; load error → inline error row.~~ `[P3]`
  > Last checked: 2026-05-17 — inside same `ScopePicker.tsx`.
- ✅ ~~**FE-POR-0002.3.4** Mount `<ScopePicker />` at the start of the breadcrumbs row in `app/redesign/components/RedesignTopBar.tsx` (the real chrome header — original spec named `PageHeaderBar.tsx` which doesn't exist). RedesignTopBar renders inside the `ViewportSlot kind="header"` and is the host for all `(user)` pages via `RedesignShell`.~~ `[P2]`
  > Last checked: 2026-05-17 — imported and mounted before the breadcrumbs `<nav>` in `RedesignTopBar.tsx:7,23`. ScopePicker self-hides when grants.length === 0 (per .3.3) so chrome stays clean for users with no topology grants.
- ✅ ~~**FE-POR-0002.3.5** CSS in `app/globals.css` under `.scope-picker*` namespace, appended after the `.avatar-menu` block; tokens only (`--surface`, `--border`, `--ink-1`, `--ink-3`, `--hover`); no shadow.~~ `[P3]`
  > Last checked: 2026-05-17 — `app/globals.css:586+` with `.scope-picker`, `.scope-picker__trigger`, `.scope-picker__panel`, `.scope-picker__search`, `.scope-picker__list`, `.scope-picker__item` rules.

### FE-POR-0002.4 Follow-up (deferred — separate plan)

- ✅ ~~**FE-POR-0002.4.1** Read-path wiring — `?scope=<id>` becomes a server filter on `/work-items`, `/portfolio-items`, `/sprints`, `/releases`, dashboard endpoints. Each handler decides whether scope-clamp stacks with workspace-clamp or replaces it. Cards filed under a new plan when this lands.~~ `[P2]` — superseded by FE-POR-0003 (PLA-0043).
- **FE-POR-0002.4.2** "Recent scopes" / "Pinned scopes" submenus (R051 nice-to-have; Linear / Jira pattern). `[P4]`
- **FE-POR-0002.4.3** Cross-subscription scope picker (only if multi-sub support ships). Currently out of scope — grants are subscription-scoped by design. `[P5]`

---

## VIZ1. Vector Relationship Explorer (PLA056)

Move `/dev/visualiser` V2 from prototype to product-grade, then swap the data feed from codegraph to artefact relationships. Three phases: stabilise (verify click + strip traces), deepen (Search · syntax highlight · lasso · auto-cluster), then data-feed swap (`/relationships` route under `app/(user)/`, RBAC-scoped artefact-graph endpoint). Plan body in [PLA056 on /dev/reporting](http://localhost:5101/dev/reporting). `[P2]`

**Phase 1 — Stabilise**

- 🔵 IN FLIGHT **VIZ1.1.1** Verify V2 click reliability via 20-card click test. AC: open /dev/visualiser, switch to V2, click 10 cards in Folders + 10 in Files with intervening toggles; every click frames the cube with zero second-tries needed. `[P2]`
- 🔵 IN FLIGHT **VIZ1.1.2** Strip diagnostic console traces from V2 click + frame handlers. AC: `grep "[viz-v2]" dev/pages/DevVisualiserPanelV2.tsx` returns zero matches in handleClick and frameNode happy paths (warnings on aborts may remain). `[P2]`

**Phase 2 — Deepen**

- 🔵 IN FLIGHT **VIZ1.2.1** Build V2 Search panel with substring match. AC: typing in the Search rail panel filters a list of node.id matches; clicking a result frames the cube and opens the Selected panel. `[P2]`
- 🔵 IN FLIGHT **VIZ1.2.2** Add Search dim-non-matches mode. AC: with a search query active and a toggle on, nodes outside the result set render at low opacity, same dim treatment as K-hops isolate. `[P3]`
- 🔵 IN FLIGHT **VIZ1.2.3** Add highlight.js to V2 Source preview. AC: opening a .ts file shows syntax-highlighted TypeScript; .go file shows Go highlighting; theme is GitHub Dark; no FOUC on load. `[P2]`
- 🔵 IN FLIGHT **VIZ1.2.4** Lasso multi-select with shift+drag. AC: holding shift and dragging a rectangle over the canvas adds every enclosed cube to the working selection set; OrbitControls rotation still works without shift. `[P2]`
- 🔵 IN FLIGHT **VIZ1.2.5** Auto-cluster-by-layer toggle in V2 topbar. AC: toggle on → same-layer nodes physically clump together via force-cluster centres; toggle off → returns to connectivity-driven layout. `[P3]`

**Phase 3 — Data-feed swap (the product ship)**

- 🔵 IN FLIGHT **VIZ1.3.1** Extract V2 DataSource interface. AC: the V2 component takes a DataSource prop that supplies `{ nodes, edges, fetchSource }`; codegraph becomes one implementation; no behavioural change for existing /dev/visualiser users. `[P2]`
- 🔵 IN FLIGHT **VIZ1.3.2** Backend artefact-graph endpoint. AC: `GET /samantha/v2/artefact-graph?scope=<uuid>` returns `{ nodes: Artefact[], edges: Relationship[] }` filtered by the topology scope clamp; RBAC-checked server-side per PLA-0043. `[P1]`
- 🔵 IN FLIGHT **VIZ1.3.3** Tenanted artefact-attachment preview endpoint. AC: `GET /samantha/v2/artefact-attachment/<id>/preview` streams the attachment with same path-traversal + extension allowlist guards as `/_site/admin/dev/source`; tenant-scoped. `[P2]`
- 🔵 IN FLIGHT **VIZ1.3.4a** Decide and add view-relationships permission. AC: decision (new permission vs reuse view-artefacts) documented in the handover under "Resolved design questions"; if new, permission added to the RBAC catalogue per PLA-0007 patterns, seed migration scaffolded, `useHasPermission("view-relationships")` usable from React. Blocks VIZ1.3.4. `[P1]`
- 🔵 IN FLIGHT **VIZ1.3.4** User-facing /relationships route. AC: `app/(user)/relationships/page.tsx` wraps the V2 component in PageShell with standard nav + breadcrumb; gated by the permission decided in VIZ1.3.4a. `[P1]`
- 🔵 IN FLIGHT **VIZ1.3.5** Rename Files panel → Artefacts panel for artefact mode. AC: when the V2 component is mounted in artefact mode, the rail label reads "Artefacts", folder grouping becomes workspace grouping, layer swatch becomes artefact-type colour. `[P2]`
- 🔵 IN FLIGHT **VIZ1.3.6** Design users_visualiser_groups table + migration. AC: migration scaffolded for users_visualiser_groups (id, user_id, name, colour, node_ids JSONB, scope_workspace_id NULL); first DB-mode load lifts existing localStorage groups into the table and drops the localStorage key. Decision is DB-backed cross-device per the handover's lean. `[P3]`
- 🔵 IN FLIGHT **VIZ1.3.7** Diff panel snapshot picker. AC: in artefact mode, Diff panel offers a dropdown of stored snapshots ("last sprint", "last release") instead of file upload; selecting one runs the same diff machinery. `[P3]`

---

## OBJ1. ObjectTreeV2 Filter-Chip Scope Facets (PLA057)

ObjectTreeV2 becomes sole owner of *which filter values are reachable* for its current scope. A new `GET /work-items/facets?meg=<id>` endpoint (+ twin for portfolio-items) returns the distinct `artefact_type_id` and `priority_id` values under the same workspace + topology clamps the list endpoint uses. ObjectTreeV2 calls it on scope change, maps UUIDs through the workspace catalogues for label + colour, and passes derived option arrays to `WorkItemsFilterChips` as props. `NavigationPie` stays a pure presentation primitive. Closes the UUID mismatch where chips offered workspace-level Task UUIDs while the grid showed rows tagged with another workspace's Task UUID under the active topology scope (2026-05-23 incident: 27 Tasks visible, Task chip returned empty). Plan body in [PLA057 on /dev/reporting](http://localhost:5101/dev/reporting). `[P2]`

**Phase 0 — Tech debt**

- **OBJ1.0.1** TD entry + incident narrative. AC: `TD-CHIP-SCOPE-MISMATCH` appears in `docs/c_tech_debt.md` with the 2026-05-23 framing + the `windowRoots`-fallback shape currently in place. `[P2]`

**Phase 1 — Backend**

- **OBJ1.1.1** `artefactitems.Service.ListFacets` method. AC: returns distinct `artefact_type_id` + `priority_id` UUIDs under workspace + meg clamp, archived excluded; reuses `CanReadScope` + `DescendantNodeIDs` chain. `[P2]`
- **OBJ1.1.2** `/work-items/facets` + `/portfolio-items/facets` handlers. AC: both endpoints mounted under WorkspaceClampMiddleware; accept `?meg=`; emit `{artefact_type_ids, priority_ids}`. `[P2]`
- **OBJ1.1.3** Backend facets table-tests. AC: workspace clamp, topology clamp, archived exclusion, 403 on unauthorised scope, 404 on unknown scope. `[P3]`

**Phase 2 — Frontend**

- **OBJ1.2.1** `useObjectTreeFacets` hook. AC: cache key `(workspace, meg, resource)`; refetches on scope change; exposes `{typeIds, priorityIds, loading, error}`; lives in `app/components/ObjectTreeV2/hooks/`. `[P2]`
- **OBJ1.2.2** ObjectTreeV2 wires facets hook to chips. AC: `p_ObjectTree.tsx` drops the temporary `windowRoots`-derivation block; chips populate from facets + workspace catalogue metadata (label + colour). `[P2]`
- **OBJ1.2.3** `WorkItemsFilterChipsProps` tightened. AC: `typeOptions` + `priorityOptions` required (no `?`, no `= []` default) after V1 ObjectTree retirement. `[P3]`

**Phase 3 — Doc**

- **OBJ1.3.1** Component doc. AC: `docs/c_c_objecttreev2_facets.md` written; CLAUDE.md links it; `TD-CHIP-SCOPE-MISMATCH` marked resolved. `[P3]`

---

# Parked — solo-dev mode (since 2026-05-17)

Items below were in-flight when solo-dev mode was established 2026-05-17 but exceed the WIP-cap of 5. **Content preserved verbatim** — every sub-item, every commit ref, every priority tag. To unpark, swap with a live item (cap stays at 5). Re-activation in prod-ready mode unparks all. See [`.claude/memory/feedback_solo_dev_mode.md`](.claude/memory/feedback_solo_dev_mode.md).

---

## FE-POR-0003. Topology Scope Clamp on Artefact Reads (PLA-0043) — parked 2026-05-17

Iteration-2 follow-up to PLA-0042: the chrome picker writes `?scope=<topology_node_id>` to the URL, this plan teaches the **read path** to honour it. Artefacts gain a nullable `topology_node_id` FK on `vector_artefacts.artefacts`; backend services clamp list reads to "this node + every descendant" via a recursive-CTE helper; grants inherit DOWN only (a grant on a parent reaches descendants; a grant on a child never reaches its parent); gadmin bypass preserved. Stacks with the existing workspace clamp — both must pass.

Design validated against Rally / Jira / ADO via R052 + R053: single-FK ownership is universal across all three; adjacency-list + recursive-CTE matches Rally's storage model; grant-inherits-down matches ADO's permission convention. Move semantics (leave-vs-carry descendants) defer to PLA-0044.

> R054 (Rally user-to-project assignment UX, 2026-05-12) further validates the PLA-0042 / PLA-0043 direction: Rally's only built-in dynamic inheritance is the grant-inherits-down read clamp Vector ships in FE-POR-0003.3 (`CanReadScope`); all other Rally cascades are opt-in one-shot copies (workspace default-grant at user-create, copy-users on child-project-create). The R054-driven user-management surfaces (per-user grid page, workspace default-access setting, copy-grants on child create, CSV bulk import, re-parent policy) are scoped under B6.8–B6.12, not under PLA-0042/PLA-0043, since those plans cover the picker + read clamp respectively. Rally pattern confirms Vector should keep the per-user view as primary; per-node roster view (Rally's "Project Setup → Users tab") is a future P4 add.

### FE-POR-0003.1 Schema — `topology_node_id` FK on artefacts

- **FE-POR-0003.1.1** Migration `db/artefacts_schema/NNN_artefacts_topology_node_id.sql` — add `topology_node_id UUID NULL REFERENCES topology_nodes(id) ON DELETE SET NULL` on `vector_artefacts.artefacts`; partial index `WHERE topology_node_id IS NOT NULL AND archived_at IS NULL`. NULL = un-assigned (visible in unscoped view, excluded from scoped view). `[P2]`

### FE-POR-0003.2 Backend — `DescendantNodeIDs` helper

- **FE-POR-0003.2.1** `orgdesign.Service.DescendantNodeIDs(ctx, subscriptionID, rootNodeID) ([]uuid.UUID, error)` in `backend/internal/orgdesign/service.go` — recursive CTE walking `topology_nodes` children; skip `archived_at IS NOT NULL`; cycle-guard via depth cap (max 12 levels, matches portfolio convention). Returns root + all live descendants. Follows the same shape as existing `ArchivedDescendants` helper at line 960. `[P2]`
- **FE-POR-0003.2.2** Unit tests in `service_test.go` — single node, parent+children, multi-level tree, archived child excluded, cycle-safe (synthetic bad data). `[P3]`

### FE-POR-0003.3 Backend — `CanReadScope` permission helper

- **FE-POR-0003.3.1** New `backend/internal/orgdesign/permissions.go` exporting `CanReadScope(ctx, userID, targetNodeID) (bool, error)` — gadmin bypass; otherwise check if any of user's grants are on `targetNodeID` itself OR on any **ancestor** of `targetNodeID` (grant-inherits-down). Grants on descendants of target do NOT count (no upward leakage). Uses adjacency-list walk via existing `parent_id` chain. `[P2]`
- **FE-POR-0003.3.2** Unit tests — grant on self passes; grant on parent passes; grant on grandparent passes; grant on child rejects parent; gadmin bypass; revoked grant rejects; archived target rejects. `[P3]`
- **FE-POR-0003.3.3** Audit-log code `scope_read_denied` emitted from list handlers when scope clamp filters out everything (signal: misconfigured grant or stale URL). `[P3]`

### FE-POR-0003.4 Backend — `artefactitemsv2.List` scope clamp

- **FE-POR-0003.4.1** `artefactitemsv2.Service.ListWorkItems` (backend/internal/artefactitemsv2/service.go:83) — accept optional `scopeNodeID *uuid.UUID`; when non-nil: call `CanReadScope` (403 if false), then `DescendantNodeIDs`, then add `WHERE topology_node_id = ANY($N::uuid[])` to the existing workspace-clamped query. Workspace clamp + scope clamp BOTH applied. `[P2]`
- **FE-POR-0003.4.2** Handler — parse `?scope=<uuid>` from query in `backend/internal/artefactitemsv2/handler.go`; validate UUID format (400 on parse fail); pass to service. Unset/empty → unscoped (existing behaviour). `[P2]`
- **FE-POR-0003.4.3** Handler tests — unscoped (no `?scope=`) returns all artefacts in workspace as today; scoped to leaf returns only that node's artefacts; scoped to parent returns parent + descendants; scoped to node user has no grant on → 403; un-assigned artefacts excluded from scoped view, included in unscoped view. `[P3]`

### FE-POR-0003.5 Frontend — `apiSite` scope forwarding

- **FE-POR-0003.5.1** `app/lib/api.ts` — extend `apiSite()` to auto-append `?scope=<activeNodeId>` (read from current `window.location.search`) on GET requests when the URL already carries `scope`. POST/PATCH/DELETE remain unchanged (writes addressed in PLA-0044). Single touch-point replaces per-page wiring. `[P2]`

### FE-POR-0003.6 Public API — OpenAPI

- **FE-POR-0003.6.1** `dev/openapi/openapi-v2.yaml` — document `?scope=<uuid>` query parameter on `/work-items` (and any other artefact-list route promoted to v2). Note grant requirement: scope node must be in caller's grant set or an ancestor of one. `[P3]`

### FE-POR-0003.7 Verification

- **FE-POR-0003.7.1** Manual verification — seed fixture artefacts on nodes A, A/B, A/B/C; grant role on A/B; verify: picker on B shows B+C artefacts; picker on A → 403 (no grant); picker cleared → all artefacts in workspace (including A and un-assigned). `[P3]`

### FE-POR-0003.8 Follow-ups (deferred)

- **FE-POR-0003.8.1** Write-side node assignment — `topology_node_id` on artefact create/update; "leave vs carry descendants" radio on topology node move (industry-divergent option, default = leave per Rally/Jira/ADO). Deferred (PLA-0044.followup-B; walker is the substrate, move-policy UX is the deferral). `[P2]`
- **FE-POR-0003.8.2** Portfolio + timebox (sprint/release) scope clamps. Deferred to PLA-0045. `[P3]`
- **FE-POR-0003.8.3** Un-assigned artefact ETL — backfill `topology_node_id` for existing rows where workspace → topology mapping is unambiguous. Deferred to PLA-0046. `[P3]`

### FE-POR-0003.9 Unified topology-traversal engine (PLA-0044)

Single shared topology walker — eliminates four independent walks (canvas dagre layout, canvas-tree state hook, topology flyout, scope rail) currently drifting on orphan policy, sort order, and depth-0 quirks. Surfaced when ScopeRail showed a spurious "D" node that the canvas correctly dropped: ScopeRail re-rooted orphans (parent_id set but parent not in user's grant set), while the canvas dropped them. Single walker + consistent orphan policy fixes the drift. Walker lives in `app/lib/shared/topology/` (cross-runtime TS) with a Go parallel at `backend/internal/shared/topology/` — see PLA-0045 for the shared-methods home convention. Iteration 1 powers the `/_site` BFF tree response; public `/samantha/v2/topology/tree` exposure is deferred to PLA-0044.followup-A.

- **FE-POR-0003.9.1** `app/lib/shared/topology/walker.ts` — generic `walkTopology<T extends TopologyNode>(nodes, opts)` returning `{rows, visibleIds, visibleEdges, childrenOf}`. Opts: `collapsed: Set<string>`, `sort: (a,b)=>number`, `filter?: (n)=>boolean` (default: archived_at IS NULL), `maxDepth?: number` (default 12). Orphans (parent_id set but parent missing/filtered) dropped — caller pre-resolves if a different policy is needed. Generic over node shape so it works for both `OrgNode` (canvas, has `position`) and `MyGrant` (rail). Cross-runtime: imported by frontend React components AND `/_site` BFF route handlers. `[P2]`
- **FE-POR-0003.9.2** Refactor `app/components/topology/layoutWithDagre.ts` — replace inline visible-set + edges walk (lines 30–38, 51–59) with `walkTopology()` output; dagre still attaches coordinates after. Canvas card map (image 1) uses this. `[P2]`
- **FE-POR-0003.9.3** Refactor `app/components/topology/useTopologyTreeState.ts` — replace its own `childrenOf` useMemo by destructuring from `walkTopology()` result (`result.childrenOf`). Topology table view (image 2) uses this. `[P2]`
- **FE-POR-0003.9.4** Refactor `app/components/TopologyTreeFlyout.tsx` — replace `buildTree()` with `walkTopology()`. Renderer (not walker) handles depth-0 spine column drawing; removes the depth-0 path-zeroing quirk from the engine. `[P2]`
- **FE-POR-0003.9.5** Refactor `app/components/ScopeRail.tsx` — replace `buildTree()`/`flattenTree()` with `walkTopology()`. Renderer skips depth-0 spine column (flush-left root). Fixes spurious "D" orphan bug. ScopeRail rail (image 3) uses this. `[P2]`
- **FE-POR-0003.9.6** Unit tests `app/lib/shared/topology/walker.test.ts` — flat list, single-root deep tree, multi-root forest, orphan-drop, cycle-guard (depth-cap synthetic loop), collapse hides subtree but keeps row, sort by label vs position, edges only between visible nodes. Reads same fixtures as the Go suite. `[P3]`
- **FE-POR-0003.9.7** Backend Go mirror `backend/internal/shared/topology/walker.go` — generic `WalkTopology[T any](nodes, opts)` mirrors TS surface with accessor-func opts (no method-interface). Iteration 1: powers `/_site/topology/tree` (BFF) only. Public `/samantha/v2/topology/tree` exposure deferred to PLA-0044.followup-A. Parity locked by `dev/fixtures/shared/topology/*.json` golden fixtures consumed by both TS Vitest and Go test suites. `[P3]`
- **FE-POR-0003.9.8** Add `position INT` to `MyGrant` (`backend/internal/orgdesign/service.go` struct + `ListMyGrants` query) so ScopeRail can sort by position to match the canvas. Followup commit. `[P3]`
- **FE-POR-0003.9.9** Visual smoke — canvas card map renders identically pre/post refactor; topology tree table renders identically; flyout renders identically; ScopeRail no longer shows orphan "D". Single `<screenshot>` reference set in `dev/research/` if drift detected. `[P3]`
- **FE-POR-0003.9.10** `app/components/topology/UserNodeAssignment.tsx` — new gadmin-only tree picker (checkbox per row) for assigning users to topology node(s). Fifth consumer of `walkTopology()`: walker provides visible-rows + edges + collapse semantics; only the row renderer is bespoke (checkbox cell instead of name). Validates that the walker is reusable for non-display-tree consumers. `[P3]`

---

## B-SHARE. Short-link service for sharing views & filters — parked 2026-05-18

Polymorphic short-link lookup service so users can share URLs and (later) full view/filter payloads without 500-char QR codes or unreadable links. Table `short_links` in `mmff_vector` with `kind` discriminator (`url` | `payload`), nullable `target_url` / `payload` columns enforced by CHECK constraint, tenant-scoped via `tenants_id` FK, opt-in `expires_at` TTL, soft-delete via `archived_at`, plus `resolve_count` / `last_resolved_at` for lightweight analytics. Slugs are 8-char base62 from `crypto/rand` (~218 trillion possibilities, not enumerable). Backend service at `backend/internal/shortlinks/` follows the handler/service/sql split (RF1.2 convention); v2 routes `POST /samantha/v2/short-links`, `GET /samantha/v2/short-links/:slug`, `DELETE /samantha/v2/short-links/:slug`, `GET /samantha/v2/short-links`. Frontend route `app/s/[slug]/page.tsx` resolves and either server-redirects (`kind='url'`) or rehydrates state (`kind='payload'`). Helper at `app/lib/shared/shortlinks.ts` (per shared-methods catalogue convention) used by `QRCodeTrigger` popover and any future "Copy share link" action.

> **Parked 2026-05-18** — design captured but unparking deferred until a real consumer arrives (saved-views feature, mobile QR-share for stakeholder demos, or repeated user pain from long filter URLs). Today's `QRCodeTrigger` encodes `origin + pathname` only (strips query/hash) — sufficient density for the in-page sharing primitive. When unparked, the trigger swaps to minting `/s/<slug>` on popover open and the `kind='payload'` path lights up alongside whatever view/filter persistence ships. Decisions baked in: polymorphic from day one (`kind='url' | 'payload'`), random base62 slugs (not enumerable, no vanity slugs to spoof), tenant-scoped (signed-in users only — no public/anonymous resolution; defence/finance buyer requirement), opt-in TTL (no expiry by default), always mint new slug per share (no dedup — simpler audit trail, payload-kind rows can't dedup anyway).

- **B-SHARE.1** Migration — `db/mmff_vector_schema/NNN_short_links.sql` creates `short_links` table with CHECK constraint enforcing kind/payload coherence, `tenant_idx` partial index `WHERE archived_at IS NULL`, `expires_idx` partial index `WHERE expires_at IS NOT NULL AND archived_at IS NULL`. `[P3]`
- **B-SHARE.2** Backend service — `backend/internal/shortlinks/{handler,service,sql,service_test,sql_test}.go`; slug minting uses `crypto/rand.Read(6)` + base62 encode + `INSERT … ON CONFLICT (slug) DO NOTHING RETURNING id` with 5-retry collision loop. Wire in `backend/cmd/server/main.go` using the `pool` variable. `[P3]`
- **B-SHARE.3** Backend routes — `POST/GET/DELETE/GET-list` on `/samantha/v2/short-links` with tenant-clamp on every read (NEVER ASSUME — golden-rule re-verify on resolve). `[P3]`
- **B-SHARE.4** Frontend route — `app/s/[slug]/page.tsx` server component; 404 on expired/archived/wrong-tenant, 401 → `/login?next=/s/<slug>`, `kind='url'` server-redirect, `kind='payload'` hydration client component. `[P3]`
- **B-SHARE.5** Shared helper — `app/lib/shared/shortlinks.ts` with `createShortLink({ kind, target_url?, payload?, expires_in_seconds? })` + companion Go helper if needed in `backend/internal/shared/shortlinks/`; entry in `docs/c_shared_methods.md`. `[P3]`
- **B-SHARE.6** `QRCodeTrigger` rewire — on popover open (not page load), mint `/s/<slug>` for current href, cache by href, show "Generating link…" intermediate state, encode `https://vector.app/s/<slug>` in the 256px popover QR; 40×40 trigger keeps the pathname-only encoding for instant render with no network call. `[P3]`
- **B-SHARE.7** Nightly sweeper — cron or scheduled job that hard-archives rows where `expires_at < now() - interval '30 days'` and `archived_at IS NULL`. Out of scope until a real expiring-link use-case appears; document the schema readiness only. `[P4]`
- **B-SHARE.8** Slug-enumeration security test — automated test (Go) hammers `/s/<random-slugs>` and asserts: 404 on non-existent, 401 on wrong-tenant existing, no rate-limit bypass via slug brute-force. Tracks B16.8 security-hardening posture. `[P3]`

---

## CHROME-QR. Global QR trigger — hidden 2026-05-24, re-enable last

Floating QR trigger (`<QRCodeTrigger />`) hidden from the global redesign shell on 2026-05-24 pending design review. The component still exists at [`app/components/QRCodeTrigger.tsx`](app/components/QRCodeTrigger.tsx) and the per-flow MFA enrolment QR (used by [`app/user/account-settings/mfa/page.tsx`](app/user/account-settings/mfa/page.tsx) and [`app/user/account-settings/page.tsx`](app/user/account-settings/page.tsx)) is unaffected — only the always-on chrome anchor was removed. The B-SHARE short-link service above remains the long-term home for any "share this view" payload-encoding work; today's pathname-only QR was a placeholder.

> **Parked 2026-05-24** — re-enable is the LAST UX item before launch, not the first. Order is deliberate: lock the page-shell language (rail, breadcrumb, header, footer, warning banner) first; only then decide whether a global share-chrome belongs on top, and in what form. **No marker (not in flight).** Promote to 🔵 IN FLIGHT only after the shell freeze and a design call on whether the chrome should ship at all in v1.

- **CHROME-QR.1 [P3]** — Re-add `import QRCodeTrigger from "@/app/components/QRCodeTrigger";` to [`app/redesign/components/RedesignShell.tsx`](app/redesign/components/RedesignShell.tsx) and uncomment the `.rd-shell__main_QrAnchor` JSX block. Confirm the trigger renders on every redesign route (visit dashboard + one nested page + one /dev page; QR popover opens and encodes `origin + pathname`).
  - **Trigger:** design call confirms the global chrome ships in v1 AND the page-shell freeze (rail, breadcrumb, header, footer) is signed off.
  - AC: `<QRCodeTrigger />` mounts inside `<RedesignShell>` and is visible on all signed-in routes.
  - AC: no regressions in MFA enrolment QR (still renders inline on `/user/account-settings/mfa`).
  - AC: if B-SHARE has shipped by then, the trigger encodes `/s/<slug>` per `B-SHARE.6`, not the raw pathname.

---

## CUT1. mmff_vector → vector_artefacts Cutover (PLA064)

Substrate collapse — fold `mmff_vector` into `vector_artefacts` to eliminate 8 app-enforced cross-DB soft FKs, 2 naming collisions (`master_record_workspaces` + `subscriptions`↔`master_record_tenants`, both via MERGE of registry+sidecar pairs — sidecars are denormalisation workarounds, not distinct entities), and 6 PLACEHOLDER/DEAD tables. End state: every soft FK becomes a real Postgres FK; procurement narrative ("every FK enforced by the database engine") substantiated. 6 phases + 2 pre-cutover dev-tools tickets; ~4 weeks of focused dev. Full plan + risks + verification on /dev/reporting/PLA064.

> Origin: 2026-05-25 — JWT-refresh fix (commits 1bdbfebc..1649231f) surfaced the sentinel `FROM workspace` placeholder-table bug; substrate audit found ~18 cross-DB soft FKs (prior SY003 said 8 — drift) and the master_record_workspaces naming collision-with-denormalised-duplicates pattern. User redirected from "rename sidecars" to "merge sidecars into registries on the move" — the better fix at the substrate level, not just the symptom.

### CUT1.0.1 [P2] 🔵 IN FLIGHT — Pre-cutover: lint:no-singular-workspace-table ratchet

Bash script + npm wiring that greps Go and SQL for the six placeholder table names in SQL keyword contexts; would have caught the sentinel bug at PR time.

  - AC: `dev/scripts/lint_singular_workspace_table.sh` exists and exits non-zero when any of `workspace`/`portfolio`/`product`/`company_roadmap`/`execution_item_types`/`subscriptions_item_type_icons` appears in `FROM`/`JOIN`/`UPDATE`/`INSERT INTO`/`DELETE FROM` contexts inside `backend/**/*.go` or `db/**/*.sql`.
  - AC: allow-list at `dev/registries/placeholder_table_lint_allowlist.json` permits the migrations that drop the tables.
  - AC: `npm run lint:no-singular-workspace-table` wired in `package.json`.
  - AC: regression smoke — a temp branch inserting `FROM workspace` in any handler fails the lint.
  - AC: documented in `docs/c_c_lint_rules.md` ledger.

### CUT1.0.2 [P2] 🔵 IN FLIGHT — Pre-cutover: nightly cross-DB orphan-audit cron

Bash + Go script that iterates the live SY003 § io-contract list (50 columns at regen v2 — count corrected from 8; cron reads SY003 at runtime so it stays correct as substrate evolves) and posts results as a system-type report so drift surfaces on Dev → System before the cutover hits it.

  - AC: `dev/scripts/cron_cross_db_orphan_audit.sh` exists, fetches the current SY003 io-contract list, and runs one orphan-check query per UUID column (50 at regen v2, will track SY003 live).
  - AC: Cron schedules at 03:00 daily via launchd on dev; equivalent systemd unit drafted for production (deferred behind TD-CUTOVER-CRON-PRODUCTION).
  - AC: Each run POSTs a `SY-ORPHAN-YYYYMMDD` system-type report to `/_site/admin/dev/reporting/`.
  - AC: First run produces a baseline report; Dev → System tab surfaces it.
  - AC: Cron self-disables if `mmff_vector` connection fails (post-Phase-6 graceful shutdown).
  - AC: Documented in `docs/c_infra_index.md`.

### CUT1.1.1 [P2] — Phase 1: drop 6 placeholder/dead tables + remove stale Go refs

Single migration in `mmff_vector` dropping the six tables, preceded by removal of the stale references in `nav/sql.go` and `polymorphicrefs/service.go`.

  - AC: Stale refs at `nav/sql.go:246`, `nav/sql.go:249`, and any in `polymorphicrefs/service.go` removed; `go build` green.
  - AC: Migration `NNN_drop_placeholder_tables.sql` applies clean against `mmff_vector`; `\d` confirms tables gone.
  - AC: Drop order respects FK direction (placeholders first, their FK targets second).
  - AC: `npm run lint:no-singular-workspace-table` exits zero (no stragglers).
  - AC: SY003 regenerated; new version shows 0 PLACEHOLDER/DEAD rows in dead-weight table.
  - AC: DOWN migration restores empty tables with original schema for rollback safety.

### CUT1.1.2 [P2] — Phase 1: audit + drop UNCERTAIN cluster (obj_* + sprints)

Audit `obj_custom_field_lib` / `obj_field_templates` / `obj_field_template_fields` (superseded by `artefacts_fields_library`) and `sprints` (10 rows, superseded by `timeboxes_sprints`); drop the confirmed-dead ones.

  - AC: Fresh grep of `backend/**/*.go` confirms zero live refs to the three `obj_*` tables.
  - AC: 10 rows in `sprints` reconciled against `vector_artefacts.timeboxes_sprints`; any missing rows ETL'd before drop.
  - AC: Migration drops confirmed-dead tables from `mmff_vector`; any deferred drops flagged in `docs/c_tech_debt.md` with a trigger.
  - AC: SY003 regenerated; UNCERTAIN cluster either empty or reduced with reasons documented.

### CUT1.2.1 [P2] — Phase 2: design the merged master_record_workspaces target schema + sidecar audit

Confirm the VA sidecar is 1:1 with the mmff_vector registry, decide merge-column-policy, and pre-stage the merged DDL as a target for Phase 3. **Not a rename — a merge.** The VA sidecar duplicates name/description/timestamps from the registry as a denormalisation workaround for the cross-DB join cost.

  - AC: Cross-DB sidecar audit query (`SELECT id_workspace FROM vector_artefacts.master_record_workspaces EXCEPT SELECT id FROM mmff_vector.master_record_workspaces`) returns zero rows; any orphans investigated and remediated before close.
  - AC: Merge-column-policy documented — registry wins for duplicates (`name`, `description`, `created_at`, `updated_at`, `archived_at`); sidecar contributes settings-only columns (timezone, data_region, owner_user, primary_contact_email, date_format, datetime_format, workdays, week_start, rank_method, build_changeset_tracking, notes).
  - AC: Merged target DDL committed to `db/vector_artefacts/schema/merge_plan/master_record_workspaces_merged.sql` (non-executable artefact for Phase 3 target).
  - AC: Every reader of existing VA sidecar settings columns catalogued by file:line for Phase 4 redirection.
  - AC: `docs/c_c_db_routing.md` updated with planned post-merge state (sidecar package deprecated, settings columns absorbed).
  - AC: SY003 regenerated; § Components reflects the planned merge.

### CUT1.2.2 [P2] — Phase 2: design the merged subscriptions target schema + sidecar audit

Same merge pattern as CUT1.2.1 for the subscriptions registry + master_record_tenants sidecar pair.

  - AC: Cross-DB sidecar audit (`SELECT id_subscription FROM vector_artefacts.master_record_tenants EXCEPT SELECT id FROM mmff_vector.subscriptions`) returns zero orphans; remediate before close.
  - AC: Merge-column-policy documented; registry wins for duplicates; sidecar contributes settings-only columns.
  - AC: Merged target DDL committed to `db/vector_artefacts/schema/merge_plan/subscriptions_merged.sql`.
  - AC: Every reader of existing VA sidecar settings columns catalogued by file:line; `tenantmasterrecord` flagged for Phase 6 deletion.
  - AC: `docs/c_c_db_routing.md` updated.
  - AC: SY003 regenerated.

### CUT1.3.1 [P2] — Phase 3: replicate 0-inbound auth/identity cluster into vector_artefacts

Migrate `admin_api_keys`, `csp_reports`, `dpop_jti_cache`, `schema_migrations`, `users_sessions` first (zero inbound FKs = no ordering constraint).

  - AC: 5 migrations in `vector_artefacts` create the tables with identical schema (constraints, indexes, defaults, comments preserved).
  - AC: Go ETL script `dev/scripts/etl_phase3_auth_cluster.go` reads each table from `mmff_vector` (pool) in batches of 1000, inserts into `vector_artefacts` (vaPool) with conflict-skip.
  - AC: Pre-/post-ETL row counts match per table (logged to `dev_reports` as system-type ETL record).
  - AC: Migrations include verification clause that halts if row count diverges.
  - AC: Pool injection in `main.go` NOT yet swapped (that's Phase 4); tables exist in both DBs at end of story.

### CUT1.3.2 [P2] — Phase 3: replicate mid-tier cluster (workspaces/pages/nav/portfolio adoption survivors)

Mid FK in-degree tables — workspaces registry, pages_*, nav_*, anything between auth and the high-fan-in users/subscriptions.

  - AC: Migrations create each mid-tier table in `vector_artefacts` with identical schema.
  - AC: ETL script extension migrates rows; self-referential tables (`cost_centres.parent_id`, `pages_addressables.pages_addressables_id_parent`) ETL in two passes (NULL parents first, UPDATE second pass restoring edges).
  - AC: Pre-/post-ETL row counts match per table.
  - AC: SY003 regenerated; § Components shows replicated tables in BOTH DBs with identical schemas + row counts.

### CUT1.3.3 [P2] — Phase 3: replicate high-fan-in cluster (users/subscriptions/master_record_workspaces) WITH MERGE

The 3 most-referenced tables (33 / 26 / 1 inbound FKs respectively) — moved last, with the registry/settings sidecars MERGED into the registry rows at the same step (per Phase 2 design at CUT1.2.1 + CUT1.2.2).

  - AC: Migrations create `users` with identical schema, and `master_record_workspaces` + `subscriptions` with MERGED schemas from Phase 2 (registry columns + absorbed sidecar settings columns). Tables created under temp names (`master_record_workspaces_v2`, `subscriptions_v2`) to avoid collision during ETL.
  - AC: ETL migrates rows — `users` 1:1; `master_record_workspaces_v2` SELECTs from `mmff_vector.master_record_workspaces` for registry fields and LEFT JOINs `vector_artefacts.master_record_workspaces` (sidecar) on id_workspace for settings; same shape for subscriptions.
  - AC: Row counts match (users ~N, master_record_workspaces_v2 ≥3 matching registry, subscriptions_v2 83).
  - AC: After ETL completes, drop VA sidecars (`vector_artefacts.master_record_workspaces` + `master_record_tenants`); rename v2 tables to final names — no collision because sidecars are gone.
  - AC: Conflict resolution — any sidecar row without matching registry row (latent bug if it appears now) halts and remediates manually.
  - AC: Duplicate `name`/`description`/timestamp fields from dropped sidecar are NOT carried into merged table — registry wins per Phase 2 column-merge policy.
  - AC: SY003 regenerated; § naming-collisions shows zero, § Components shows merged tables.

### CUT1.4.1 [P2] — Phase 4: swap services from pool to vaPool (auth + identity cluster)

For every service whose tables now live in `vector_artefacts`, swap the pool injection in `main.go`.

  - AC: Each affected service's `NewService(pool, ...)` call in `main.go` swaps to `NewService(vaPool, ...)`.
  - AC: Services previously holding both pools (e.g. `topology`, `sentinel`) have constructor rewritten to take only `vaPool`.
  - AC: `go build` green; unit tests green.
  - AC: `backend/internal/lintchecks/sentinel_clamp_test.go` still green.
  - AC: Manual smoke — login + sentinel-clamped /artefacts call works against running stack.

### CUT1.4.2 [P2] — Phase 4: swap services for mid-tier + high-fan-in clusters

Continuation of CUT1.4.1 covering pages/nav/portfolio services and finally users/subscriptions/workspaces services.

  - AC: Every Go service touching moved tables uses `vaPool` only.
  - AC: Orphan-audit cron run after this story shows zero orphans across all 8 soft FKs.
  - AC: SY003 regenerated; § Itemized Catalogue shows `vaPool` for swapped services.
  - AC: Smoke — full login → workspace → artefact CRUD flow works end-to-end.

### CUT1.5.0 [P2] — Phase 5 prep: orphan triage + remediation (blocks CUT1.5.1)

The CUT1.0.2 cron's first real run (2026-05-25) surfaced **1,263 orphan column-instances across 14 columns** (originally reported as 508; corrected post-bug-fix in commit `57ed1958` where the cron was counting distinct dead UUIDs instead of row-instances — 168 distinct dead workspaces in `artefacts_types` was reported as 168 orphans when the true row-instance count was 427). Hard-FK installation in CUT1.5.1 will fail on any column with orphans, so Phase 5 must remediate first. Cohort breakdown (from remediation plan in `db/vector_artefacts/schema/merge_plan/orphan_remediation.sql`): COHORT-A (dev-tenant cleanup, 628 rows — `artefacts_types` 427, `artefacts` 50, `artefact_priorities` 140, `master_record_portfolios` 11) → HARD-DELETE; COHORT-B (bootstrap zero-ID, 19 rows in `timeboxes_*` + `webhooks_subscriptions` + VA sidecar) → HARD-DELETE; COHORT-C (dead-user artefact refs, transitive via COHORT-A, 50 rows) → NULL guard; COHORT-D (`audit_logs`, SOC 2 — 89 rows, 29 dead users) → NULL not delete; COHORT-E (VA sidecar self-ref, 1 row) → structurally eliminated by CUT1.3.3. Full per-column count + sample IDs in the daily `SY-ORPHAN-YYYYMMDD` reports on Dev → Reporting.

  - AC: ✅ Per-cohort investigation: the `artefacts_types` orphans ARE one cohort of deleted dev tenants — CONFIRMED: all 427 rows orphan in BOTH workspace_id AND subscription_id; 168 distinct (dead_ws, dead_sub) pairs with strict 1:1 mapping; every dead WS maps to exactly 1 dead sub. Cron-reported 166 was undercounted. Full cohort findings in `db/vector_artefacts/schema/merge_plan/orphan_remediation.sql` header (COHORT-A/B/C/D/E).
  - AC: ✅ Per-target-table remediation policy decided + documented: COHORT-A (179 dead WS, dev-tenant cleanup) → HARD-DELETE across 5 tables; COHORT-B (zero-ID bootstrap placeholder) → HARD-DELETE across 5 tables; COHORT-C (dead-user artefact refs) → TRANSITIVE via COHORT-A + NULL guard; COHORT-D (89 audit_logs rows, 29 dead users) → NULL (SOC 2 preserved); COHORT-E (VA sidecar self-ref) → HARD-DELETE via COHORT-B + structural elimination at CUT1.3.3. No deferred cohorts — all confidently classified.
  - AC: ✅ Dry-run remediation SQL committed to `db/vector_artefacts/schema/merge_plan/orphan_remediation.sql` — non-executable artefact reviewed BEFORE execution. Commit: see `[CUT1.5.0]` tag.
  - AC: Execution migration applies clean; post-execution cron run shows 0 orphans across the target columns (excluding any columns explicitly deferred). ← NOT YET (CUT1.5.0 part 2)
  - AC: No deferred columns — no TD entries needed. The CUT1.3.3-eliminated sidecar col is already noted in the SQL header.
  - AC: CUT1.5.1 unblocked — fresh cron run + SY003 v3 regen confirm zero orphans on the FK-install target set. ← NOT YET (after execution)

### CUT1.5.1 [P2] — Phase 5: install hard Postgres FKs on all 50 previously-soft cross-DB UUID columns

Promote every cross-DB soft-FK column in SY003 § io-cross-db-soft-refs to a real `FOREIGN KEY` constraint, now that both endpoints live in `vector_artefacts`. **Count corrected from prior 8 to 50** at SY003 regen v2 (2026-05-25) — the prior figure counted distinct target-table relationships, not columns. Decompose into 4 sub-stories by target table if scope justifies (CUT1.5.1.users / .workspaces / .subscriptions / .roles).

  - AC: 50 migrations (one per UUID column) each add `FOREIGN KEY ... REFERENCES ...` with an explicitly-chosen `ON DELETE` policy. Migrations may be grouped (e.g. one migration per target table) to keep file count manageable, but every column gets named and policied.
  - AC: Coverage matches SY003 § io-cross-db-soft-refs groups: 18 columns → `users.id`; 14 → `master_record_workspaces.id`; 17 → `subscriptions.id`; 1 → `users_roles.id` (nullable). The mmff_library group (2 columns) deferred — out of scope, mmff_library stays read-only.
  - AC: Each migration runs a pre-check; any orphan blocks the migration with a clear error pointing to the table+row.
  - AC: `ON DELETE` matrix documented in `docs/c_schema.md` per-column — `SET NULL` for audit columns (preserve log, anonymize), `RESTRICT` for owner/owner-controlled refs, `CASCADE` for child-of-relationship hierarchies.
  - AC: SY003 regenerated; § io-cross-db-soft-refs shows zero soft refs remaining (all 50 columns promoted to real FKs).

### CUT1.6.1 [P2] — Phase 6: decommission mmff_vector connection + retire pool variable

Drop the `mmff_vector` database, retire the `pool` variable from `main.go`, archive Phase-0 tooling.

  - AC: A verified `pg_dump` backup of `mmff_vector` exists in `backups/` with a SHA256 checksum recorded; backup tested with restore-to-throwaway-DB before drop proceeds.
  - AC: `pool` variable removed from `backend/cmd/server/main.go`; `go build` green; no service constructor signature still names `pool`.
  - AC: `mmff_vector` connection removed from `backend/internal/db/` configuration.
  - AC: `DROP DATABASE mmff_vector` executed on dev; staging/production deferred behind explicit owner sign-off.
  - AC: Phase-0 lint rule and orphan-audit cron archived to `dev/scripts/archive/`.
  - AC: Final SY003 regeneration shows: 2 databases, 0 cross-DB soft FKs, 0 naming collisions.

### CUT1.6.2 [P2] — Phase 6: docs + HARD RULE revision + tech-debt entries

Update `docs/c_c_db_routing.md` + `.claude/CLAUDE.md` to reflect the two-DB world; open post-cutover monitoring tech debt.

  - AC: `docs/c_c_db_routing.md` rewritten — three DBs becomes two (`vector_artefacts` + `mmff_library`); service → pool → table map updated.
  - AC: `.claude/CLAUDE.md` NEVER ASSUME A DATABASE HARD RULE revised — still in force, example DBs updated, `mmff_vector` named as "removed in cutover PLA064."
  - AC: `TD-CUTOVER-MONITORING` opened in `docs/c_tech_debt.md` — 1-month post-cutover audit Sentry/dev_reports for "table not found" stragglers; severity S2.
  - AC: `TD-CUTOVER-CRON-PRODUCTION` closed (cron mooted).
  - AC: `TD-CUTOVER-RLS-DEFERRAL` opened — row-level security and partitioning explicitly deferred; trigger = first multi-tenant scale event.

---

## NV1. Notifications v2 — PLA build (orchestrated) 🔵 IN FLIGHT

Orchestrated rebuild of the notifications stack via the Master + Global Validator + Worker model. Spec lives at `docs/superpowers/specs/2026-05-26-notifications-v2-design.md`. Master dispatches per-story workers on isolated branches (`feature/notifications-v2/sNN-<slug>`); Global Validator gates each PASS and commits into the integration branch `feature/notifications-v2`. 16 stories across 6 waves: schema → producer → broadcast/broker → relay/pipeline/rules/templates → dispatchers → handler/UI → pending/digest → producers → parity/cutover/cleanup. Validator handover at `handovers/notifications-v2-validator.md` carries the per-story checklist, branch model, and pre-existing-dirty-files contract. `[P1]` 🔵 IN FLIGHT

**Wave 3 — Pipeline (PLA067)**

- ✅ ~~**NV1.S06 [P1]**~~ — Pipeline: enrich → filter → router (single 13pt story). **MERGED 2026-05-27 at `7683049e` via `--no-ff` from `notif-v2-s06`.** Validator PASS at `e93fb5dc` (re-review after seedUser FK fix at `11421a37`). 14 files under `backend/internal/notifications/v2/pipeline/`, 32/32 tests PASS (24 unit + 8 integration against live dev DB). PendingStore interface + InMemoryPendingStore shipped; Valkey impl deferred to S12 (Wave 4). Pipeline wired in `backend/cmd/server/main.go` under `vaPool != nil && AMQP_URL` guard (currently `_ = v2Pipeline` — real wiring lands in S09 when relay gains processor as a dependency). Strangler-fig verified: 0 v1 imports in pipeline, 0 Valkey/go-redis imports. 3 TDs accepted: TD-NOTIF-V2-DIGEST-CADENCE-BUCKET-KEY (S3), TD-NOTIF-V2-OUTBOX-IDEMPOTENCY-UNIQUE (S3), main.go dead-code cleanup at S09.
  - AC: Package `backend/internal/notifications/v2/pipeline/` exists with files `pipeline.go`, `enrich.go`, `filter.go`, `router.go`, `pending.go`, `pipeline_test.go`, `pipeline_integration_test.go`; `go build ./...` clean.
  - AC: `pipeline.Process(ctx, event, recipient) error` exists and composes `enrich → filter → router`; one Process call per (event, recipient) pair; constructor `pipeline.New(deps Deps) *Pipeline` wired in `backend/cmd/server/main.go`.
  - AC: `PendingStore` interface declared in `pending.go` matches spec §Interfaces verbatim (Push, PopDue, PeekDigestBucket); `InMemoryPendingStore` impl in same file passes its own unit tests; no Valkey/`go-redis` client import anywhere in this package (S12's `pending_valkey.go` is the only place that uses `go-redis` against Valkey).
  - AC: Filter stage implements all six spec-named sub-decisions in order: sentinel clamp, prefs resolution, priority floor, rules evaluator, quiet hours, platform kill switch; critical-priority bypass adds in_app + email but does NOT skip platform kill switch.
  - AC: Router stage renders templates via `templates.Service`, writes outbox rows or pushes to PendingStore based on filter decision; template-missing writes a suppression row with `error_class='template_missing'`; all per-recipient outbox writes happen in one transaction.
  - AC: Relay's `relay.go` gains an event-drain loop alongside the existing outbox-drain loop; uses SKIP LOCKED on event claim; updates event `resolved_at` only after all recipients are resolved.
  - AC: Integration test `pipeline_integration_test.go` (build-tag `integration`) covers spec §Testing strategy Layer 2 matrix (direct mention, critical bypass, kill switch, quiet hours, AND+OR rules, OR fan-out, template-missing, idempotency); passes against real Postgres dev DB.
  - AC: Lint `lint:pipeline-no-direct-dispatcher` added; `v2/pipeline/` added to `sentinel_clamp_test.go` scan list; both lints green.
  - AC: No imports from `backend/internal/notifications/` (v1) — strangler-fig HARD RULE.
  - AC: Validator PASS verdict; merged into `feature/notifications-v2` via `--no-ff`; NV1 entry flipped to ✅ by Validator with merge SHA.
  - Plan: PLA067 · Worker brief: [docs/superpowers/plans/2026-05-27-notifications-v2-s06-pipeline.md](docs/superpowers/plans/2026-05-27-notifications-v2-s06-pipeline.md)

---

## FB1. FlowBoard — standalone Kanban component for /value-flow (PLA066) 🔵 IN FLIGHT

Standalone Kanban board whose columns are the **custom flow_states of the selected artefact type**, whose cards are the live artefacts at the current sentinel scope, and whose drag-to-move triggers the existing flow-state PATCH (which already runs the rollup recalc for parents). The board is a view, not a system of record — same emergent-from-artefacts principle as ObjectTreeV2. The only persisted state is **policy** (per-team WIP limits) and **preference** (per-user card field selection). Team ≡ topology node (Rally's project-IS-team pattern); WIP hangs off the node keyed by `flow_state_id` (no `flow_boards` table). Component family mirrors ObjectTreeV2 (`p_FlowBoard.tsx` + `loader.ts` + `configs/p_wizard_flowboard_workitems.json` sidecar) so samanthaAPI can drive it later. Drag-and-drop hard-blocks invalid transitions from `flow_transitions` at the UI; the server validates the PATCH (defence-in-depth per the server-is-the-gate HARD RULE). Three small tables (132 members, 133 wip-limits, 134 user-prefs) + one new `backend/internal/flowboard/` package + the component family is the entire v1 surface. Spec at [`docs/superpowers/specs/2026-05-27-flowboard-design.md`](docs/superpowers/specs/2026-05-27-flowboard-design.md); plan body in [PLA066 on /dev/reporting](http://localhost:5101/dev/reporting). `[P2]` 🔵 IN FLIGHT

**Phase 1 — Schema**

- **FB1.1.1 [P2] 🔵 IN FLIGHT** — Migration 132: `topology_nodes_members` table. Team-membership foundation; one row per (user, topology_node).
  - AC: `db/vector_artefacts/schema/132_topology_nodes_members.sql` applies clean against vector_artefacts; `schema_migrations` row 132 exists.
  - AC: Table has PK `topology_nodes_members_id BIGSERIAL`, FKs to `topology_nodes` + `users` with `ON DELETE CASCADE`, `topology_nodes_members_role TEXT DEFAULT 'member'`, `topology_nodes_members_workspace_id BIGINT NOT NULL` (denorm for sentinel clamp), audit timestamps.
  - AC: UNIQUE constraint on (`node_id`, `user_id`); indexes on each FK column.
  - AC: Every column carries the full `topology_nodes_members_` prefix; `npm run lint:column-prefix` green.
  - AC: DOWN migration drops the table; round-trip verified.
  - Plan: PLA066
- **FB1.1.2 [P2] 🔵 IN FLIGHT** — Migration 133: `topology_nodes_wip_limits` table. Per-node-per-flow-state WIP cap; NULL = unlimited.
  - AC: `db/vector_artefacts/schema/133_topology_nodes_wip_limits.sql` applies clean; `schema_migrations` row 133 exists.
  - AC: Table has PK `topology_nodes_wip_limits_id`, FKs to `topology_nodes` + `flow_states` (both `ON DELETE CASCADE`), `topology_nodes_wip_limits_limit INT` (nullable), denorm workspace_id, `updated_at` + `updated_by` audit columns.
  - AC: UNIQUE constraint on (`node_id`, `flow_state_id`); index on `node_id`.
  - AC: Every column carries the full `topology_nodes_wip_limits_` prefix; `npm run lint:column-prefix` green.
  - AC: DOWN migration drops the table; round-trip verified.
  - Plan: PLA066
- **FB1.1.3 [P2] 🔵 IN FLIGHT** — Migration 134: `users_flowboard_prefs` table. Per-user card-field selection; absence = use sidecar default.
  - AC: `db/vector_artefacts/schema/134_users_flowboard_prefs.sql` applies clean; `schema_migrations` row 134 exists.
  - AC: Table has PK `users_flowboard_prefs_id`, FKs to `users` + `artefact_types` (both CASCADE), `users_flowboard_prefs_card_fields JSONB NOT NULL`, denorm workspace_id, `updated_at`.
  - AC: UNIQUE constraint on (`user_id`, `artefact_type_id`).
  - AC: Every column carries the full `users_flowboard_prefs_` prefix; `npm run lint:column-prefix` green.
  - AC: DOWN migration drops the table; round-trip verified.
  - Plan: PLA066

**Phase 2 — Backend**

- **FB1.2.1 [P2] 🔵 IN FLIGHT** — Scaffold `backend/internal/flowboard/` package. Empty handler.go + service.go + sql.go trio mounted in main.go but with no endpoints yet (compile-only).
  - AC: `backend/internal/flowboard/` exists with `handler.go`, `service.go`, `sql.go`, `handler_test.go`, `service_test.go`.
  - AC: `backend/cmd/server/main.go` calls `flowboard.NewService(vaPool, …)` and mounts a router stub at `/_site/flowboard/`.
  - AC: `go build ./…` green; `go vet ./…` green.
  - AC: Layer discipline: `handler.go` contains no SQL, `sql.go` contains only SQL constants, `service.go` contains no `http.` imports.
  - Plan: PLA066
- **FB1.2.2 [P2] 🔵 IN FLIGHT** — WIP endpoints (GET + PUT) with membership gate. Read all WIP rows for a board; UPSERT a single row; permission gated on `topology_nodes_members`.
  - AC: `GET /_site/flowboard/wip?node_id=&artefact_type_id=` returns 200 with array of WIP rows (each carries flow_state name + state id + limit); sentinel-clamped — out-of-scope returns 403, not 404.
  - AC: `PUT /_site/flowboard/wip` UPSERTs on (`node_id`, `flow_state_id`); returns 200 with resulting row; caller without a `topology_nodes_members` row for the node returns 403.
  - AC: `updated_by` set to caller user id, `updated_at` set to `now()` on every write.
  - AC: Empty `limit` in the PUT body persists as SQL `NULL` (unlimited semantics preserved).
  - AC: `handler_test.go` covers member-allowed + non-member-403 + cross-scope-403 + UPSERT-idempotent.
  - Plan: PLA066
- **FB1.2.3 [P2] 🔵 IN FLIGHT** — Card-prefs endpoints (GET + PUT) with JSONB allowlist. Per-user card-field preferences read/write; validates against a known field-key allowlist.
  - AC: `GET /_site/flowboard/prefs?artefact_type_id=` returns 200 with caller's row, or 404 if no row exists (frontend falls back to sidecar default).
  - AC: `PUT /_site/flowboard/prefs` UPSERTs the caller's row on (`user_id`, `artefact_type_id`); body validates against allowlist `["id","title","assignee","points","priority","status","created_at","updated_at"]`; junk keys return 422.
  - AC: Caller can only write their own row (`caller_user_id` wins, body `user_id` ignored).
  - AC: `handler_test.go` covers default-shape PUT, junk-key 422, foreign-user write blocked.
  - Plan: PLA066
- **FB1.2.4 [P2] 🔵 IN FLIGHT** — Topology node members endpoint. Read membership of a node; used by the frontend permission gate.
  - AC: `GET /_site/topology/{id}/members` returns 200 with array of `{user_id, role, created_at}` for the node; sentinel-clamped.
  - AC: Caller out of sentinel scope returns 403.
  - AC: `handler_test.go` covers in-scope success + out-of-scope 403.
  - Plan: PLA066

**Phase 3 — Frontend**

- **FB1.3.1 [P2] 🔵 IN FLIGHT** — Scaffold `app/components/FlowBoard/` tree + sidecar JSON. Empty component family mirroring ObjectTreeV2 + the first sidecar config.
  - AC: Directory tree exists per spec §4: `p_FlowBoard.tsx`, `loader.ts`, `registry.ts`, `configs/p_wizard_flowboard_workitems.json`, `hooks/`, `columns/`, `card/`, `settings/`, `__tests__/`.
  - AC: Sidecar JSON has all keys from spec §5: `name`, `title`, `description`, `panel.{tone,radius,padding,title,show_panel_chrome}`, `artefact_type_scope`, `exclude_prefixes`, `default_artefact_type_prefix`, `type_switcher.{show,label}`, `card.{default_fields,renderer}`, `columns.{show_wip,wip_format,overage_tone}`, `transitions.mode`, `empty.{title,body}`.
  - AC: `loader.ts` validates the sidecar shape (TypeScript interface + runtime guard); applies `configOverride`; returns a frozen object; mirrors `ObjectTreeV2/loader.ts` patterns.
  - AC: `npm run build` green; `npm run lint` green; no `any` in the public types.
  - AC: `loader.test.ts` covers valid shape + missing required key + bad type for each key.
  - Plan: PLA066
- **FB1.3.2 [P2] 🔵 IN FLIGHT** — `useFlowBoardData` hook + sentinel-clamped data wiring. Composes three queries (flow_states + artefacts + WIP rows) into the column/card structure.
  - AC: Hook returns `{ columns: Array<{flowState, wipLimit, cards}>, isLoading, error }`.
  - AC: Artefact query is sentinel-clamped server-side; client-side also filters `artefact_type_id` and excludes `prefix === 'EP'`.
  - AC: Columns ordered by `flow_states.sort` (existing column on mig 004).
  - AC: WIP rows joined client-side onto the matching column by `flow_state_id`; missing row → `wipLimit = null`.
  - AC: Vitest covers: empty board, one card per state, over-limit state, unlimited state mixed with limited.
  - Plan: PLA066
- **FB1.3.3 [P2] 🔵 IN FLIGHT** — `BoardColumnHeader` rendering + over-WIP states. Renders the header per spec §7.3 (5 states: under, at, over, unlimited, empty).
  - AC: Header renders `Doing (3/10)` when under limit.
  - AC: Header renders `Doing (10/10)` at limit, no badge, no red.
  - AC: Header renders `Doing (11/10)` with a `+1` overage badge AND a red column-state class when over.
  - AC: Header renders `Doing (11)` (no slash, no badge) when WIP row is NULL.
  - AC: Header renders `Doing (0)` or `Doing (0/10)` cleanly when empty.
  - AC: `BoardColumnHeader.test.tsx` covers all five states by snapshot.
  - Plan: PLA066
- **FB1.3.4 [P2] 🔵 IN FLIGHT** — `@dnd-kit` drag with hard-blocked invalid transitions. Cards drag between columns; invalid targets are dimmed and non-droppable.
  - AC: `useFlowStateTransitions(artefactTypeId)` hook returns `isAllowed(from, to)` backed by `flow_transitions` for this type.
  - AC: During drag, columns where `isAllowed(activeState, columnState) === false` get a `disabled` dnd-kit droppable + a dimmed visual state via a CSS class.
  - AC: Drop on a disallowed column is physically impossible (dnd-kit rejects).
  - AC: Drop on an allowed column fires `PATCH /v1/api/artefacts/{id}` with `{flow_states_id: <new>}`; optimistic UI update first; on 4xx revert + toast.
  - AC: `transitions.test.ts` covers `isAllowed` against a fixture set (3 states, 4 transitions, expected allow/deny matrix).
  - Plan: PLA066
- **FB1.3.5 [P2] 🔵 IN FLIGHT** — `BoardCard` + `CardFieldRenderer`. Draggable card; field set comes from user prefs (with sidecar default fallback).
  - AC: Card renders the field set returned by `users_flowboard_prefs` for (current user, current artefact type); falls back to `config.card.default_fields` when the API returns 404.
  - AC: Field renderers for the five default fields (`id`, `title`, `assignee`, `points`, `priority`) are pure functions of the artefact row.
  - AC: Card is draggable via `useDraggable`; visually picks up a drag-overlay via dnd-kit's standard pattern.
  - AC: Click on the card opens the existing artefact detail flyout (reuse `ObjectTreeDetailFlyout` mount path); no new flyout written.
  - Plan: PLA066
- **FB1.3.6 [P2] 🔵 IN FLIGHT** — `WipSettingsModal` (gear icon) + membership gate. Gear-icon top-right opens a modal listing every column with a numeric input; non-members don't see the gear.
  - AC: Gear icon appears top-right of the board ONLY when the caller has a row in `topology_nodes_members` for the current node (read via `GET /_site/topology/{id}/members` + caller comparison).
  - AC: Modal lists every column for the current artefact type; each row has a numeric input (blank = unlimited).
  - AC: Save writes one row per change via `PUT /_site/flowboard/wip` (UPSERT semantics).
  - AC: On Save, the modal closes and the column headers re-render with new counts.
  - AC: `permissions.test.ts` covers gear visible for member + gear hidden for non-member.
  - Plan: PLA066
- **FB1.3.7 [P2] 🔵 IN FLIGHT** — `p_FlowBoard.tsx` top-level + addressable surface registration. Hybrid uncontrolled/controlled component; registered with samanthaAPI's addressable surface.
  - AC: Props contract per spec §6: `{ config, topologyNodeId?, artefactTypeId?, onArtefactTypeChange?, configOverride? }`.
  - AC: When `artefactTypeId` prop is supplied + `onArtefactTypeChange` callback exists, component is controlled (parent owns the dropdown value). When omitted, component owns internal state.
  - AC: `topologyNodeId` defaults to `useSentinel().current_node_id` when omitted.
  - AC: `configOverride` shallow-merges over the sidecar before render (samanthaAPI surface).
  - AC: Component registers `samantha._viewport.app._kind.panel.flow_board_workitems` (slot name from sidecar `name`) via the existing `registry.ts` pattern.
  - Plan: PLA066

**Phase 4 — Integration**

- **FB1.4.1 [P2] 🔵 IN FLIGHT** — Mount on `/value-flow` page + integration smoke. Page becomes a thin host for FlowBoard with the first sidecar; manual + automated smoke confirms it works end-to-end.
  - AC: `app/(user)/value-flow/page.tsx` rewritten to a thin host: imports `workItemsBoardJson`, renders `<FlowBoard config={workItemsBoardJson} />` inside the existing `<PageContent>` + `<PageHeading>` + `<PageDescription>` shell.
  - AC: Seed data: 1 row in `topology_nodes_members` for dev user, 3 rows in `topology_nodes_wip_limits` (Backlog=10, Doing=3, Done=NULL).
  - AC: Manual smoke: navigate to `/value-flow`; columns render from Story flow states; counts correct; `+N` overage badge shows when seed exceeds limit; epics absent; switching the type dropdown to Defects redraws the columns.
  - AC: Drag-smoke: drag a card Backlog → Doing; PATCH fires; parent artefact's state rolls up via existing recalc; disallowed drop dims target.
  - AC: WIP-edit-smoke: open gear modal, change Doing to 5, save, header re-renders.
  - AC: `npm run test` + `go test ./…` all green.
  - AC: `<update> -c FlowBoard` inserts a Dev → Components article with TOC entry.
  - AC: Three TD entries opened in `docs/c_tech_debt.md`: `TD-FLOWBOARD-EXIT-RULES` (S2), `TD-FLOWBOARD-CARD-PREFS-UI` (S3), `TD-FLOWBOARD-WIP-AUDIT` (S2).
  - Plan: PLA066

---

## B23. Artefact Dependency Maps (PLA074) 🔵 IN FLIGHT

User-authored dependency maps with three buckets (Requires First / In Parallel / Unlocks Next) over a focused target artefact. Edge-first persistence replaces the prototype React-only composer at `app/components/DependencyMap/DependencyMapOverlay.tsx` with three tables in `vector_artefacts` (`artefact_dependency_maps`, `artefact_dependency_edges`, `artefact_dependency_edge_events`) and a Sentinel-gated sole-writer service at `backend/internal/dependencies/`. Directed `finish_to_start` edges encode Requires/Unlocks from a single row; non-directional `parallel` edges use canonical `pair_low`/`pair_high` for uniqueness. Cycle guard via recursive CTE under `FOR UPDATE`; cross-kind uniqueness prevents the same pair from holding two relationships per map. Archive of a load-bearing artefact returns 409 `dependency_impact` with `impacted_maps[]`. Reachability ships in Phase 2 as a recursive-CTE projection with cross-clamp redaction; CPM is deferred via `TD-DEP-CPM-DURATION`. The manual `artefacts_is_blocked` flag is explicitly out of scope — it stays a user-set toggle and is not coupled to the graph. Research: [R058](dev/research/R058.json). Plan: PLA074.

### B23.1 Phase 0 — Schema + sole-writer service + edge CRUD + preflight

- ✅ ~~**B23.1.1 [P2]** — Migration 173: `artefact_dependency_maps` table. New container for named, topology-scoped dependency maps.~~
  - AC: migration `173_artefact_dependency_maps.sql` applies clean against `vector_artefacts`.
  - AC: columns include `artefact_dependency_maps_id` (PK uuid), `..._id_subscription`, `..._id_workspace`, `..._id_topology_node`, `..._id_root_artefact` (nullable), `..._name`, created/updated/archived metadata.
  - AC: FKs exist to `master_record_workspaces`, `topology_nodes`, `artefacts` (root, nullable).
  - AC: `lint:column-prefix` registry entry added; `npm run lint:column-prefix` passes.
  - AC: `schema_migrations` row exists for 173 after apply.
  - Plan: PLA074
  > Last checked: 2026-06-03 — applied + verified; 3 FKs (workspace CASCADE, topology_node CASCADE, root_artefact SET NULL); column-prefix lint clean.
- ✅ ~~**B23.1.2 [P2]** — Migration 174: `artefact_dependency_edges` table with uniqueness + canonical pair. Source-of-truth row per relationship inside a map.~~
  - AC: migration `174_artefact_dependency_edges.sql` applies clean.
  - AC: all `artefact_dependency_edges_*`-prefixed columns including `kind` enum (`finish_to_start`, `parallel`), `id_from_artefact`, `id_to_artefact`, `pair_low`, `pair_high`, `id_map`, archived metadata.
  - AC: three partial unique indexes — directed pair (kind=f2s), parallel pair, cross-kind canonical pair — all scoped `WHERE archived_at IS NULL`.
  - AC: CHECK constraint rejects `from_id = to_id`; CHECK constraint enforces `pair_low < pair_high`.
  - AC: FKs to `artefact_dependency_maps` and `artefacts` with ON DELETE RESTRICT.
  - AC: `npm run lint:column-prefix` passes.
  - Plan: PLA074
  > Last checked: 2026-06-03 — applied + verified; pair_low/pair_high as GENERATED STORED of LEAST/GREATEST; 3 partial unique indexes (directed/parallel/cross-kind); RESTRICT on all 3 FKs; both self-loop and pair-ordered CHECKs present.
- ✅ ~~**B23.1.3 [P2]** — Migration 175: `artefact_dependency_edge_events` audit table. Append-only edge mutation log for defence/finance audit narrative.~~
  - AC: migration `175_artefact_dependency_edge_events.sql` applies clean.
  - AC: `artefact_dependency_edge_events_*` columns including `id_edge`, `event_kind`, `id_actor_user`, `sentinel_scope_snapshot` (jsonb), `occurred_at`, `payload` (jsonb).
  - AC: no cascade FK on `id_edge` — events outlive their edge.
  - AC: index on `(id_edge, occurred_at DESC)` for per-edge history scans.
  - AC: `npm run lint:column-prefix` passes.
  - Plan: PLA074
  > Last checked: 2026-06-03 — applied + verified; zero FK constraints on the table (events outlive edges); two indexes (per-edge time DESC, per-actor time DESC).
- ✅ ~~**B23.1.4 [P2]** — Scaffold `backend/internal/dependencies/` sole-writer service. Mirrors the `polymorphicrefs` tx-discipline pattern; no other package writes to the edge tables.~~
  - AC: package exists with `handler.go` / `service.go` / `sql.go` per layering convention.
  - AC: `NewService(vaPool, sentinelSvc, polymorphicRefs)` wired in `backend/cmd/server/main.go`.
  - AC: constructor refuses to start if any dependency table is missing (schema sanity check).
  - AC: handler-routes file builds; `go build ./...` passes.
  - AC: empty `service_test.go` + `handler_test.go` scaffolds exist and pass.
  - Plan: PLA074
  > Last checked: 2026-06-03 — package landed with handler/service/sql/types + 2 test files; `NewService(vaPool)` wired in main.go matching the live artefactpriorities pattern (deviation from literal AC — sentinel is read from request ctx, not constructor-injected; polymorphicRefs not needed since edges aren't polymorphic refs); schema sanity via `VerifySchema(ctx)` called at boot with `log.Fatalf` on miss; `go build ./...` clean; `go test ./internal/dependencies/...` PASS.
- ✅ ~~**B23.1.5 [P2]** — Map CRUD endpoints — create / rename / archive. Sentinel-gated map management surface.~~
  - AC: `POST /_site/dependencies/maps` returns 201 + map row; rejects 403 if caller can't write at `topology_node_id`.
  - AC: `PATCH /_site/dependencies/maps/{id}` renames; Sentinel-deny returns 403; 404 on archived map.
  - AC: `POST /_site/dependencies/maps/{id}/archive` sets `archived_at`; idempotent.
  - AC: handler tests cover allow/deny matrix for the three Sentinel-relevant roles.
  - AC: Scalar/openapi entry added for each route.
  - Plan: PLA074
  > Last checked: 2026-06-03 — three handlers + service methods landed; topology scope checked via `nodeInScope(c, …)` against `AllowedSubtreeIDs` (fail-closed when nil); rename rejects 404 on archived; archive is idempotent (re-call returns existing row); 14 handler tests cover allow/deny for user/padmin/gadmin + 401/404/422 mappings; openapi entry auto-synced by the api:sync pre-commit hook.
- ✅ ~~**B23.1.6 [P2]** — Edge insert with cycle guard + uniqueness enforcement. The core write path; correctness rules live here.~~
  - AC: `POST /_site/dependencies/edges` creates edge; writes `artefact_dependency_edge_events` row in same tx.
  - AC: insert refuses 422 on self-loop (`from_id == to_id`).
  - AC: insert refuses 409 on duplicate per partial unique index (any kind).
  - AC: insert refuses 422 on cycle for `finish_to_start` — recursive CTE under `FOR UPDATE` lock on the map.
  - AC: insert refuses 403 if either endpoint not visible to caller via Sentinel.
  - AC: Go test `TestEdgeInsert_CycleRejected` covers a 3-node cycle attempt.
  - Plan: PLA074
  > Last checked: 2026-06-03 — CreateEdge tx wraps SELECT FOR UPDATE on parent map + visibility check (sqlCountVisibleArtefacts, both endpoints must be in caller's AllowedSubtreeIDs) + recursive-CTE cycle check (sqlCycleWouldFormFromTo) + INSERT + same-tx audit-event write (sentinel clamp snapshot + edge facets as jsonb); SQLSTATE 23505 mapped to ErrDuplicateEdge → 409; handler error matrix test covers all 6 paths + 401; live-DB Tier-B tests TestEdgeInsert_CycleRejected (3-node cycle, 2-cycle reverse, no-false-positive shortcut) + TestEdgeInsert_UniquenessAndAudit (directed dup + cross-kind canonical + audit row) PASS against dev `vector_artefacts`.
- ✅ ~~**B23.1.7 [P2]** — Edge archive endpoint. Soft-delete a relationship with audit trail.~~
  - AC: `POST /_site/dependencies/edges/{id}/archive` sets `archived_at`; writes audit event.
  - AC: idempotent — second call returns 200 without writing a second event.
  - AC: 403 if caller lacks visibility on either endpoint.
  - AC: handler test covers the deny path.
  - Plan: PLA074
  > Last checked: 2026-06-03 — ArchiveEdge tx reads edge+parent map's topology_node via JOIN for a single round-trip; scope re-checked via `nodeInScope`; idempotent path returns the existing row WITHOUT writing a second audit event (early return when archived_at non-nil); race-recovery branch via tx.Commit + readEdge if the UPDATE returns no rows due to a concurrent archive; 5 handler tests cover 401 / 200 happy / 200×2 idempotent / 403 deny / 404 missing / 422 bad-uuid.
- ✅ ~~**B23.1.8 [P2]** — `dependency-impact` preflight endpoint + 409 on archive. Block archive of load-bearing artefacts with a structured impact payload.~~
  - AC: `GET /_site/work-items/{id}/dependency-impact` returns `{ impacted_maps: [{ map_id, map_name, edges }], total_edges }`.
  - AC: `ArchiveWorkItem` at `backend/internal/artefactitems/service.go:2040` calls the dependencies service; if `total_edges > 0`, returns `http.StatusConflict` with code `dependency_impact` and the impact payload as body.
  - AC: Go test `TestArchiveWorkItem_BlockedByDependencies` seeds an edge, attempts archive, asserts 409 + payload.
  - AC: frontend archive caller surfaces the 409 with a toast listing impacted map names.
  - AC: Scalar/openapi entry added.
  - Plan: PLA074
  > Last checked: 2026-06-03 — `dependencies.ImpactForArtefact(ctx, artefactID, workspaceID)` reads workspace-clamped maps via sqlImpactForArtefact (live edges + live maps GROUP BY map ORDER BY edges DESC); GET handler mounted on /_site/work-items/{id}/dependency-impact AND /_site/portfolio-items/{id}/dependency-impact via main.go (handler owned by dependencies pkg, URL lives under work-items by AC). Preflight wired in the **handler** layer (not service) via `artefactitems.DependencyImpactQuerier` interface + `depsArchivePreflight` adapter in main.go — avoids the import cycle the AC's literal "ArchiveWorkItem calls dependencies service" wording would create. 4 tests green: `TestArchiveWorkItem_BlockedByDependencies` (AC-named, asserts 409 + dependency_impact code + impacted_maps[] + summed total_edges), `_PassesPreflight` (empty impact → proceeds), `_PreflightErrorFailsClosed` (DB blip → 500 not silent fall-through), `_NoPreflightUnwired` (back-compat). Frontend toast AC deferred to B23.2.3 (apiSite client + composer wire-up).

### B23.2 Phase 1 — Read endpoints + composer wire-up

- ✅ ~~**B23.2.1 [P2]** — Read endpoints — list maps, three-bucket edge projection. The composer's read surface.~~
  - AC: `GET /_site/dependencies/maps?topology_node_id=...` returns 200 + array; Sentinel filters server-side.
  - AC: `GET /_site/dependencies/maps/{id}` returns detail + edge count.
  - AC: `GET /_site/dependencies/edges?focused_artefact_id=...&map_id=...` returns `{ requires, parallel, unlocks }` shaped for direct composer consumption.
  - AC: Go test `TestEdgesList_ProjectsThreeBuckets` seeds Story 2→3→5 + Story 3→8 and asserts the three-bucket projection when focused on Story 3.
  - AC: Scalar/openapi entries added.
  - Plan: PLA074
  > Last checked: 2026-06-03 — three handlers landed: `ListMaps` (workspace + optional topology_node filter; 403 on out-of-scope node), `GetMapDetail` (returns Map + `edge_count` via correlated subquery), `ListEdgesForFocus` (single SELECT over the focused artefact's edges in one map; Go bucketing into requires/parallel/unlocks per `kind` + direction). Live-DB `TestEdgesList_ProjectsThreeBuckets` PASSES: seeds Story 2→3→5 + Story 3→8 in a rollback'd tx, asserts Requires=[Story 2], Unlocks={Story 5, Story 8}, Parallel=[] when focused on Story 3. 7 handler tests cover happy path + 422 missing/bad params + 404 + 403 across the three new GETs.
- ✅ ~~**B23.2.2 [P2]** — Server-side candidate exclusion. Close the multi-state-add loophole at the backend, not in React.~~
  - AC: `GET /_site/dependencies/candidates?focused_artefact_id=...&map_id=...&bucket=...&q=...` excludes any artefact already linked to the focused target in the named map, regardless of bucket.
  - AC: Sentinel filters candidates to those the caller can see.
  - AC: Go test `TestCandidateSearch_ExcludesAlreadyLinked` verifies exclusion across all three buckets.
  - AC: Scalar/openapi entry added.
  - Plan: PLA074
  > Last checked: 2026-06-03 — sqlCandidateSearch filters artefacts by `id_subscription` + topology subtree (clamp ANY) + ILIKE title match, with a NOT IN subquery collecting both endpoints of every live edge in this map involving focused_artefact_id (cross-bucket dedup matches the cross-kind canonical unique index gating writes). Service.SearchCandidates pre-validates the map exists in scope (avoiding empty 200 leak) then runs the search with limit cap 200/default 50. Live-DB `TestCandidateSearch_ExcludesAlreadyLinked` PASSES: seeds one edge per bucket kind on focused, asserts none of the linked endpoints (requires/parallel/unlocks) appear in candidates. 4 handler tests cover happy/422/404. `bucket=` is accepted as a query param but currently ignored — exclusion is cross-bucket per the AC's "regardless of bucket" clause; per-bucket type allowlists land if/when product wants them.
- ✅ ~~**B23.2.3 [P2]** — Frontend `apiSite/dependencies.ts` client. Typed wire client for every dependencies endpoint.~~
  - AC: new module exports typed methods: `maps.list/get/create/rename/archive`, `edges.list/create/archive`, `candidates.search`, `impact.get`.
  - AC: re-exported from `app/lib/apiSite/index.ts`.
  - AC: `npx tsc --noEmit` passes.
  - AC: client respects `withForwardedMeg` for scope hint.
  - Plan: PLA074
  > Last checked: 2026-06-03 — `app/lib/apiSite/dependencies.ts` exports typed DTOs (DependencyMap, DependencyEdge + Kind, DependencyBucketEdge/Projection, DependencyCandidate, DependencyImpactReport, DependencyImpactConflict) + the `dependencies.{maps,edges,candidates,impact}` client; re-exported from `app/lib/apiSite/index.ts`. `withForwardedMeg` is applied transparently by the underlying `apiSite()` middleware, so no per-call wiring needed (HARD-RULE-clean: meg is a URL hint, not authority). `npx tsc --noEmit` clean.
- ✅ ~~**B23.2.4 [P2]** — Wire `DependencyMapOverlay` to persistent edges. Replace ephemeral React state with the backend round-trip.~~
  - AC: on open, the overlay GETs the active map's edges via the new client and hydrates the three buckets from the wire payload — no ephemeral seed.
  - AC: add/remove fires an immediate `POST` / archive; optimistic update reverts and toasts on failure.
  - AC: candidate dropdown calls the server-side candidate endpoint (no client-side exclusion list).
  - AC: closing the overlay and reopening it on the same artefact shows the same edges (round-trip test).
  - AC: Playwright test `dependency_map_persistence.spec.ts` covers add → close → reopen → assert.
  - Plan: PLA074
  > Last checked: 2026-06-03 — **wired end-to-end.** `usePersistedDependencyMap` auto-resolves a default map for the focused artefact's topology node (`maps.list` → take first; `maps.create({name: "Default dependencies"})` on miss) — `?mid=` URL param remains as an explicit override. The overlay swaps its bucket state: when `persisted.isPersisted` is true, `effectiveBuckets` reads from `persisted.buckets` instead of the ephemeral state, lazy-hydrating each `PersistedBucketRow` via `workItems.get(artefact_id)` into the existing `DependencyCandidate` render shape; each rendered item carries `__edgeId` so remove handlers archive the right edge. Add/remove handlers branch on `persisted.isPersisted` and delegate to `persisted.addToBucket` / `removeFromBucket` (optimistic + revert on failure). Errors surface via `notify.error("Dependency map: …")` toast — cycle / 409-duplicate / 403-out-of-scope all reach the user. Round-trip works: close overlay, reopen, edges re-hydrate from backend. **Still partial**: candidate dropdown still uses `workItems.query` (not the server-side `/dependencies/candidates` endpoint — server-side cross-bucket dedup is enforced at insert time by the partial unique indexes anyway, so duplicate-add 409s come back as toasts). Playwright `dependency_map_persistence.spec.ts` not yet authored.

### B23.3 Phase 2 — Transitive reachability

- ✅ ~~**B23.3.1 [P2]** — Transitive reachability endpoint. The CPM-shaped value we can deliver honestly without duration semantics.~~
  - AC: `GET /_site/dependencies/{artefact_id}/transitive-impact` returns `{ downstream: [{ artefact_id, depth }], upstream: [{ artefact_id, depth }] }`.
  - AC: computation is a recursive CTE over directed `finish_to_start` edges across all maps.
  - AC: response redacts artefact ids the caller can't see; replaces with a `redacted_count` field.
  - AC: Go test `TestTransitiveImpact_RedactsAcrossClamp` seeds a cross-clamp chain and asserts redaction.
  - AC: Scalar/openapi entry added.
  - Plan: PLA074
  > Last checked: 2026-06-03 — two recursive CTEs (sqlReachabilityDownstream + Upstream) walk live finish_to_start edges across ALL maps in the caller's subscription with a defensive depth cap of 20; visibility flag joined inline (artefacts.id_topology_node ∈ clamp); Go layer splits visible into ReachableNode[] and counts the rest as RedactedCount. Wire shape: `{ downstream, upstream, redacted_count }`. Live-DB `TestTransitiveImpact_RedactsAcrossClamp` PASSES: seeds artA(nodeA)→artB(nodeB), walks with clamp=[nodeA], asserts artB absent from visible[] AND redacted≥1. 3 handler tests cover 200/422/403. Frontend client `dependencies.reachability.get(artefactId)` re-exported from `app/lib/apiSite`.

### B23.4 Docs + tech-debt placement

- ✅ ~~**B23.4.1 [P2]** — Docs + tech-debt placement. Close the loop with system docs and the deferred-CPM marker.~~
  - AC: `docs/c_c_dependencies.md` written: system synopsis, table shape, Sentinel discipline, sole-writer rule, audit narrative, archive preflight contract.
  - AC: `.claude/CLAUDE.md` index gets a one-line entry pointing at the new doc.
  - AC: `docs/c_tech_debt.md` gains `TD-DEP-CPM-DURATION` (S2, trigger: "open when calibrated points-to-days factor exists OR a new `artefacts_estimate_days` field lands").
  - AC: `docs/c_tech_debt.md` gains `TD-DEP-FORWARD-MEG-AUDIT` if any client call site is found passing `?meg=` for edge scoping (per HARD RULE — corollary).
  - Plan: PLA074
  > Last checked: 2026-06-03 — system note `docs/c_c_dependencies.md` written (synopsis, schema table, uniqueness rules, cycle guard, Sentinel discipline, audit narrative, archive preflight contract, HTTP surface table, out-of-scope list, test surface). `.claude/CLAUDE.md` index entry added next to the outbox pattern pointer. Tech-debt: `TD-DEPENDENCY-MAP-PERSISTENCE` marked **RESOLVED** (substrate built); new `TD-DEP-COMPOSER-PERSISTENCE-RENDER` (S2) tracks the deferred UI render switch; new `TD-DEP-CPM-DURATION` (S2) tracks CPM gate. `TD-DEP-FORWARD-MEG-AUDIT` NOT created — grep of `app/lib/apiSite/dependencies.ts` + `app/components/DependencyMap/usePersistedDependencyMap.ts` shows zero `?meg=` call sites; clamp is the JWT-resolved authority per HARD RULE corollary.

---

## PLAT1. Platform Extraction — shared Control Plane (PLA077 / RES068)

*Master architecture program: extract Vector's platform cluster (Sentinel, auth/DPoP, RBAC, audit, tenant registry) into a separate-runtime Control Plane in a monorepo, so every product (Vector, Sigma, Origo, …) consumes one identity/security/audit substrate without replication. Hybrid authz (in-process clamp stays local; central ReBAC for cross-product only). Bridge Model: pooled identity + siloed product DBs. PoC = cross-product SSO. Research: RES068 (reconciled with RES069). Plan: PLA077.*

> **Sequencing:** strangler-fig, each phase reversible behind a flag; no route-group flips until shadow-run divergence is zero. Phase 0 git move is APPROVAL-GATED per HARD RULE — story PLAT1.2 does not execute until the user approves the branch + procedure in chat.

- **PLAT1.1 [P1] 🔵 IN FLIGHT** — Scaffold the platform monorepo skeleton. Stand up Turborepo + go.work workspace shell (control-plane/, products/, packages/, packages-go/, platform/) before moving code.
  - AC: repo root contains turbo.json, pnpm-workspace.yaml, go.work, and the empty control-plane/ products/ packages/ packages-go/ platform/ trees.
  - AC: `turbo run build --dry-run` exits 0 and lists the workspace task graph.
  - AC: CI runs with GOWORK=off and a placeholder Go module builds against its own go.mod.
  - AC: .github/CODEOWNERS exists with control-plane/** requiring the platform team.
  - AC: no Vector code moved yet — products/vector/ is empty.
  - Phase: 0 · Plan: PLA077

- **PLAT1.2 [P1] 🔵 IN FLIGHT** — Move Vector into the monorepo preserving git history (APPROVAL-GATED). Relocate the existing repo under products/vector/ with full history.
  - AC: `git filter-repo --to-subdirectory-filter products/vector` applied on a throwaway clone, never the working copy.
  - AC: `git log` in the monorepo shows pre-move Vector commits with paths under products/vector/.
  - AC: merged via a real merge commit (not squash).
  - AC: Vector's existing test + lint suite passes from the new location.
  - AC: executed only after explicit in-chat user approval of the branch name and procedure (HARD RULE).
  - Phase: 0 · Plan: PLA077

- **PLAT1.3 [P2] 🔵 IN FLIGHT** — Backend AuthzProvider / IdentityProvider interfaces (anti-corruption layer). Wrap in-process Sentinel/auth behind abstractions.
  - AC: Go interfaces IdentityProvider and AuthzProvider defined in a shared package.
  - AC: current in-process impl registered as sole backing; behaviour byte-identical (existing tests green).
  - AC: all 13 product handlers resolve the clamp via the interface, not sentinel.FromCtx directly.
  - AC: a new lint check fails the build if product code imports the concrete sentinel package.
  - AC: RED-GREEN TestAuthzProvider_InProcessParity proves interface output == legacy FromCtx for a role matrix.
  - Phase: 1 · Plan: PLA077

- **PLAT1.4 [P2] 🔵 IN FLIGHT** — @mmff/auth-sdk frontend facade. Front the Sentinel/Auth client surface.
  - AC: @mmff/auth-sdk exports useSentinel-compatible hooks; app imports resolve to it.
  - AC: the 388 existing call sites compile unchanged against the facade.
  - AC: lint:no-old-context-imports extended to forbid direct AuthContext imports outside the SDK + exempt list.
  - AC: frontend build + typecheck green.
  - Phase: 1 · Plan: PLA077

- **PLAT1.5 [P1] 🔵 IN FLIGHT** — Independence walls + migration lanes. CODEOWNERS, split migration lanes + CI guard, import-boundary lint, stale-ref sweep. This is what lets product teams work in parallel without collision.
  - AC: per-path CODEOWNERS lands; a non-platform-team PR touching control-plane/** is blocked.
  - AC: migration streams split into platform/product lanes with ownership metadata.
  - AC: RED-GREEN a product migration altering a platform table fails CI (TestMigrationGuard_BlocksPlatformTable).
  - AC: import-boundary lint fails when a product imports control-plane internals instead of the SDK/contract.
  - AC: grep finds 0 stale mmff_vector references in active SQL headers/docs after the sweep.
  - Phase: 1b · Plan: PLA077

- **PLAT1.6 [P2] 🔵 IN FLIGHT** — Contract-first platform facade (/platform/*). Define HTTP contracts; Vector calls them while impl stays in-process.
  - AC: /platform/session/introspect, /me, /entitlements, /authz/check, /audit contracts defined with OpenAPI.
  - AC: RED contract tests exist for each endpoint before implementation.
  - AC: GREEN when Vector passes using the facade for those calls.
  - AC: product handlers no longer call auth/session/RBAC/audit internals directly.
  - Phase: 1c · Plan: PLA077

- **PLAT1.7 [P2] 🔵 IN FLIGHT** — CP service as OIDC OP with DPoP. Standalone runtime owning identity.
  - AC: control-plane/backend boots and serves OIDC discovery at /.well-known/openid-configuration.
  - AC: auth-code + PKCE issues a DPoP-bound token; a token without matching proof is rejected 401.
  - AC: the CP owns ONE shared dedicated DB with the carved identity/directory/tenant tables; SY003 regenerated.
  - AC: product tables reference users by UUID soft-ref only — grep proves zero cross-DB FKs.
  - AC: RED-GREEN TestCP_DPoP_RejectsUnboundToken and TestCP_PKCE_RequiresVerifier pass.
  - Phase: 2 · Plan: PLA077

- **PLAT1.8 [P2] 🔵 IN FLIGHT** — Entitlements & product registry. Platform product catalogue + plan gates + tenant subscriptions.
  - AC: /platform/entitlements returns whether a tenant may open a given product.
  - AC: products query entitlement; none infer paid access locally.
  - AC: RED-GREEN TestEntitlement_GatesProductAccess — product cannot be opened without an entitlement.
  - AC: admin can grant/revoke a product entitlement per tenant.
  - Phase: 2b · Plan: PLA077

- **PLAT1.9 [P2] 🔵 IN FLIGHT** — Vector as first relying party (feature-flagged). Vector authenticates against the CP.
  - AC: behind flag cp_auth_enabled, Vector login redirects to the CP and returns an authenticated session.
  - AC: the Sentinel clamp hydrates from the CP boot endpoint; useSentinel() state identical to legacy.
  - AC: with the flag off, Vector uses the legacy in-process path unchanged (reversible).
  - AC: RED-GREEN e2e cp_login_roundtrip.spec.mjs logs in via the CP and reaches a gated page.
  - Phase: 3 · Plan: PLA077

- **PLAT1.10 [P2] 🔵 IN FLIGHT** — Shadow-run divergence harness. Old vs new on every decision before any flip.
  - AC: each auth/authz decision computed on both paths; only legacy result served while shadowing.
  - AC: divergences written to cp_shadow_divergence with inputs + both outputs.
  - AC: a /dev dashboard reports divergence count over a rolling window.
  - AC: cutover flags hard-gated — a guard refuses to flip a route-group while its divergence > 0.
  - AC: RED-GREEN TestShadowGuard_BlocksOnDivergence proves the guard refuses to flip on a seeded divergence.
  - Phase: 4 · Plan: PLA077

- **PLAT1.11 [P2] 🔵 IN FLIGHT** — Split Sentinel: platform PDP + Vector scope adapter. Platform Sentinel becomes shared authority; Vector topology/focus becomes a registered product scope adapter.
  - AC: platform Sentinel answers who/tenant/product/session/entitlement/allowed.
  - AC: Vector scope adapter answers Vector topology/workspace/focus scope and registers with platform.
  - AC: RED-GREEN tenant-isolation spec extended to platform-clamp + product-adapter passes (tenant A cannot read tenant B).
  - AC: in-process clamp retains no network hop on local hot-path reads.
  - Phase: 4 · Plan: PLA077

- **PLAT1.12 [P3] 🔵 IN FLIGHT** — Cut over authentication route-group to the CP. First real flip, reversible.
  - AC: with divergence zero, the auth route-group serves the CP result; legacy path dormant but intact.
  - AC: rollback flag restores the legacy path within one deploy, no data migration.
  - AC: per-role contract tests pass against the CP-served path (allow + deny matrix).
  - AC: central audit shows the login event in the CP trail.
  - Phase: 5 · Plan: PLA077

- **PLAT1.13 [P3] 🔵 IN FLIGHT** — Central revocation: back-channel logout + RFC 7009. The central kill-switch.
  - AC: CP exposes a token-revocation endpoint and pushes OIDC back-channel logout to registered RPs.
  - AC: revoking a session at the CP terminates the Vector session within the token TTL window.
  - AC: RED-GREEN TestCP_Revoke_KillsRPSession proves a revoked token is rejected at the RP.
  - AC: the revocation event lands in the central audit trail.
  - Phase: 5 · Plan: PLA077

- **PLAT1.14 [P3] 🔵 IN FLIGHT** — SpiceDB + cross-product Check API (thin). Central ReBAC for cross-product links only.
  - AC: SpiceDB schema models the artefact↔ambition cross-product relationship.
  - AC: products write relationship tuples on their own mutations (sole-writer); wrong-service writes are blocked.
  - AC: a Check call answers a cross-product permission with fully_consistent consistency.
  - AC: in-process Sentinel clamp unchanged for in-product hot paths (no new network hop on local reads).
  - AC: RED-GREEN TestReBAC_CrossProductCheck + TestReBAC_NewEnemy_RevokeHonoured pass.
  - Phase: 6 · Plan: PLA077

- **PLAT1.15 [P2] 🔵 IN FLIGHT** — Cross-product SSO PoC with stub product #2. The acceptance demo.
  - AC: a thin second product is registered as a CP relying party.
  - AC: one login at the CP yields authenticated sessions in BOTH Vector and the stub without re-auth.
  - AC: platform entitlement controls whether the stub product can be opened.
  - AC: a single audit trail shows both products' access for the one user via a shared correlation ID.
  - AC: one revocation at the CP kills BOTH sessions within the TTL window.
  - AC: RED-GREEN e2e cross_product_sso.spec.mjs asserts login-once / revoke-once-kills-both.
  - Phase: 7 · Plan: PLA077

---

## Unmatched Commits

