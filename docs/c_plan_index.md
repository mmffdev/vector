# Plan Index

**Last issued:** `PLA-0010`

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
| `PLA-0006` | Topology — federated canvas-based organisational modelling (MVP) | 2026-05-02 | active |
| `PLA-0007` | Data-driven RBAC — roles + permissions + role_permissions; system-role immutability; cache invalidation; protected-account preservation | 2026-05-03 | active |
| `PLA-0008` | Page Help Library — rich-content help docs (HTML body + YouTube embeds + image lists) per addressable, auto-seeded on Panel mount, full-page /help/<id> route, gadmin editor | 2026-05-04 | active |
| `PLA-0009` | Self-healing dev pipeline & degraded-state observability — air file-watcher, bootstatus tolerant boot, /api/status/pipeline, EnvBadge degraded dot + 3s prod hold, launcher observer mode | 2026-05-04 | complete |
| `PLA-0010` | Codebase Audit Remediation — Dead Code & Security Gaps (R035) | 2026-05-04 | active |

## Deletion log

_(none)_
