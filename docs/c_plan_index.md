# Plan Index

**Last issued:** `PLA-0023`

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

## Deletion log

_(none)_
