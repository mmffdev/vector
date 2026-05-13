# Plan Index

**Last issued:** `PLA-0047`

## Format

- ID: `PLA-NNNN` (4-digit zero-padded, prefix `PLA-`).
- Storage: `dev/plans/PLA-NNNN.json`.
- Schema: see [`app/api/dev/plans/route.ts`](../app/api/dev/plans/route.ts) (`PlanDoc` type).
- Display: Plans tab in `/dev` (Dev Setup → Plans).

## Mandatory plan label

Every story card produced by `<stories>` for a given plan MUST carry that plan's `PLA-NNNN` label in addition to the existing mandatory labels (AIGEN, PH-NNNN, FE-AAA-NNNN, EST-FN, RISK-LOW/MED/HIGH).

## ID allocation rule

Read this file's **Last issued** AND scan `dev/plans/` for the highest existing `PLA-NNNN` filename. Use `max(file, scan) + 1`. Never reuse an ID, even if a plan was deleted.

## Plan registry

| ID | Title | Created | Status |
|---|---|---|---|
| `PLA-0001` | Dev Plans Page + Stories Skill PLA Workflow | 2026-05-02 | active |
| `PLA-0002` | Reusable per-panel Help popover with paneId registry → backend-served help store | 2026-05-02 | obsolete (duplicate of PLA-0004; addressables substrate via PLA-0005 is the live path) |
| `PLA-0003` | Adopt generic ranking + realtime drag-and-drop on the work-items table | 2026-05-02 | complete |
| `PLA-0004` | Reusable per-panel Help popover with paneId registry → backend-served help store | 2026-05-02 | complete (superseded by PLA-0005) |
| `PLA-0005` | Universal addressable element registry — DB-backed, Dashboard-first, full-site sweep | 2026-05-02 | complete |
| `PLA-0006` | Topology — federated canvas-based organisational modelling (MVP) | 2026-05-02 | complete |
| `PLA-0007` | Data-driven RBAC — roles + permissions + role_permissions; system-role immutability; cache invalidation; protected-account preservation | 2026-05-03 | active |
| `PLA-0008` | Page Help Library — rich-content help docs (HTML body + YouTube embeds + image lists) per addressable, auto-seeded on Panel mount, full-page /help/<id> route, gadmin editor | 2026-05-04 | active |
| `PLA-0009` | Self-healing dev pipeline & degraded-state observability — air file-watcher, bootstatus tolerant boot, /api/status/pipeline, EnvBadge degraded dot + 3s prod hold, launcher observer mode | 2026-05-04 | complete |
| `PLA-0010` | Codebase Audit Remediation — Dead Code & Security Gaps (R035) | 2026-05-04 | active |
| `PLA-0011` | Phase Baseline Audit Remediation (R036) — Clean Baseline Before Next Phase | 2026-05-05 | complete |
| `PLA-0012` | Reusable Page Summary Header — full-span stat strip + Work Items adopter | 2026-05-05 | complete |
| `PLA-0013` | Dev-UI Primitives & Migration — Standardize Dev Setup CSS | 2026-05-05 | active |
| `PLA-0014` | Tab reorder primitive — drag-and-drop substrate + per-user tab order | 2026-05-05 | complete |
| `PLA-0015` | `<Table>` component — declarative table primitive with expander, inline-edit, panel, pills | 2026-05-05 | active |
| `PLA-0016` | Docs site as a fourth Launcher component — supervised api-reference Docusaurus on :3000 | 2026-05-05 | complete |
| `PLA-0017` | `<Table>` universal modes — tree, accordion, dnd, section, dense; absorb the 8 allow-listed callers; final .table* CSS strip | 2026-05-05 | active |
| `PLA-0018` | Nested-tab deep-linking via nuqs — bookmarkable secondary tabs across the app | 2026-05-06 | complete |
| `PLA-0019` | Samantha External API Surface — OpenAPI Spec, Versioning, Error Standards, API Keys, SDK | 2026-05-06 | active |
| `PLA-0020` | E2E Human-Friendly Feedback System — Message constants, Toast layer, mmff-cli, Hints | 2026-05-06 | active |
| `PLA-0021` | ResourceTree — generic hierarchical tree primitive + WorkItemsTree preset (28-feature roadmap) | 2026-05-06 | active |
| `PLA-0022` | Auth bootstrap dedup — share AuthProvider.refresh() in-flight promise to prevent tab-duplicate logout | 2026-05-06 | active |
| `PLA-0023` | Vector Artefacts Cutover — move work-items + artefacts from `mmff_vector` to dedicated `vector_artefacts` DB | 2026-05-07 | complete (2026-05-07; dev cutover done, prod pending) |
| `PLA-0024` | Subscriptions → master_record_tenant table rename + organisation settings | 2026-05-07 | active |
| `PLA-0025` | Work-Items Full v2 Cutover — all 12 v2 endpoints against vector_artefacts | 2026-05-07 | complete |
| `PLA-0026` | Per-Workspace Portfolio Adoption Cutover to vector_artefacts — artefact_field_library + scope discriminator + workspace whitelist + master_record_portfolio + saga rewrite + re-adoption placeholder | 2026-05-07 | active |
| `PLA-0027` | Sprints — Timebox Management System | 2026-05-07 | active |
| `PLA-0028` | Samantha API Rename — `/v1/api/*` → `/samantha/v1/*`, drop `/api/` segment, extract v2 block | 2026-05-08 | active |
| `PLA-0029` | API Contract Protection & Blast Radius Toolchain — oasdiff, drift detection, caller map, Dev panel | 2026-05-08 | active |
| `PLA-0030` | v1 → v2 API Cutover — retire `/samantha/v1`, promote all routes to `/samantha/v2`, split openapi specs, deprecation headers | 2026-05-08 | active |
| `PLA-0031` | Flows Migration — `obj_flow_tenant` → vector_artefacts `flows`/`flow_states` tables | 2026-05-08 | active |
| `PLA-0032` | Tenant-Settings Migration — `master_record_tenant` → vector_artefacts | 2026-05-08 | active |
| `PLA-0033` | Polymorphic Artefact Consolidation — defects + user-stories + portfolio-items → `artefacts` | 2026-05-08 | active |
| `PLA-0034` | Topology Migration — `org_nodes` / `roles_org_nodes` / `org_node_view_state` → vector_artefacts | 2026-05-08 | active |
| `PLA-0035` | Work Item Relations Graph — 3D force-directed Obsidian-style globe on the Work Items page | 2026-05-09 | active |
| `PLA-0036` | Typed work-item links — `work_item_links` table for blocks/duplicates/relates_to cross-tree edges | 2026-05-09 | reserved |
| `PLA-0037` | Artefact-Items Substrate — rename `workitemsv2` → `artefactitemsv2`, scope-parameterised (B21) | 2026-05-09 | reserved (plan file pending) |
| `PLA-0038` | Blocked-state — orthogonal stuck flag with provenance for work items | 2026-05-09 | active |
| `PLA-0039` | Transport Segregation via Shared Service Core — `/_site` BFF + `/samantha/v2` public, with one Service per domain | 2026-05-09 | active |
| `PLA-0040` | (reserved — plan file on disk; entry to be filled) | 2026-05-10 | reserved |
| `PLA-0041` | Flow-States v2 Orbit POC — radial state-machine layout for flow design | 2026-05-10 | active |
| `PLA-0042` | Chrome scope picker (active topology scope) — top-left dropdown + ScopeContext + `?scope=<id>` URL persistence | 2026-05-11 | active (picker UI + ScopeContext only; read wiring deferred to PLA-0043) |
| `PLA-0043` | Topology scope clamp on artefact reads — `topology_node_id` FK + descendants helper + grant-down inheritance + apiSite forwarding | 2026-05-12 | drafted |
| `PLA-0044` | Unified topology-traversal engine — single `walkTopology()` walker shared by canvas dagre layout, topology tree state hook, topology flyout, scope rail; Go mirror for BFF + public API parity | 2026-05-12 | complete (2026-05-12) |
| `PLA-0045` | Shared Methods Catalogue + Soft-Reminder Hook — `app/lib/shared/` + `backend/internal/shared/` + `dev/fixtures/shared/` directory contract; `docs/c_shared_methods.md` index; PostToolUse hook nudges shared placement on new handler routes | 2026-05-12 | complete (2026-05-12) |
| `PLA-0046` | Topology Permissions page — gadmin user-pivot surface hosting UserNodeAssignment (B6.8) | 2026-05-12 | complete (2026-05-12) |
| `PLA-0047` | Samantha SDK v2 — Fluent Declarative Mount API (`_viewport` → `_app` → `_panel` chain) | 2026-05-13 | drafted |

## Scope linkage rule

When a new plan is created, check whether it maps to a scope item in `Vector_Scope.md`:

1. Scan all scope items for keyword overlap with the plan title.
2. If a match is found: append below that item's line (after any existing `>` notes):

   ```markdown
   > Plan `PLA-NNNN` (YYYY-MM-DD): {title}
   ```

3. If no match (bespoke / cross-cutting): skip. Do not add to Unmatched Commits.
4. Never create a new scope item from this step — only annotate an existing one.

## Deletion log

_(none)_
