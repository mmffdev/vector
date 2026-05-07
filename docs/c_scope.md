# Scope — features underway

Live snapshot of what is actively being built. Update when a feature moves state.

**Status values:** `underway` | `paused` | `complete`

---

## Underway

| Feature | Area | Migration | Stories | Status | Notes |
|---|---|---|---|---|---|
| Work Items — execution page (tree grid, filter, detail panel, sprints, custom fields) | ITM / API / SQL | 062–066 | 00175–00189 | underway | Backend package in progress; frontend filter + tree grid next |
| Icon catalogue + per-subscription item-type icons | ITM / SQL | 067 | TBD | underway | `vector_icons` + `subscription_item_type_icons` tables created; padmin picker UI + API TBD; seed: epic=MdOutlineCreateNewFolder, story=MdOutlineFolder, task=MdChecklist, defect=MdOutlineBugReport (all md pack) |
| Scope page (sidebar entry + blank template) | UI / SQL | 070 | TBD | underway | Built-in static page under Planning tag; visible to all roles; route `/scope`; folder icon; body is an empty PageShell — upload + work-item linking deferred |
| Addressable element substrate (PLA-0005) | UI / API / SQL / GOV | 074–080 | 00244–00262 | underway | DB-backed `page_addressables` UUID registry; `<Panel>`/`<Table>`/`<Navigation>` adopters wrap every panel-shaped element across /dashboard, /preferences, /dev, /portfolio, /work-items, /backlog, /library-releases; `addressables.Service` is sole writer; `/dev/page-help` editor replaces `/dev/pane-help`; `lint:addressables` strict; **supersedes PLA-0004** (`pane_help` dropped, `<PaneHeader>` → `<Panel>`) |
| Topology MVP — federated canvas + Samantha diagram primitive (PLA-0006) | UX / UI / API / SQL / GOV / SEC | TBD | TBD | underway | Page named `<tenant>: Topology` (e.g. "MMFFDev: Topology"); default node noun **Office**; Vector-built `<DiagramCanvas>` primitive with 10px snap-to-grid (Canvas2D + dagre + d3-zoom — no third-party graph lib); `org_nodes` self-referential tree; node-scoped `org_node_roles` (single-admin in MVP, `can_redelegate` schema-only); `orgdesign.Service` sole writer + cross-cutting clamp predicate middleware on portfolio_items / user_stories; `/topology` page with collapse-by-default + lazy expand stress-tested at 3,000 Lloyds-scale nodes; primitive exposed via Samantha API (`samantha.diagram.canvas`) for custom-app authors; archive = greyed-out limbo (cascade rules → Phase X); **supersedes R028 Path C v1** (Workspace is now a tree, not a flat tag) |
| Data-driven RBAC — roles + permissions tables (PLA-0007) | SEC / GOV / API / SQL / UI | 088–089 | 00292–00309 | underway | Replaces `user_role` Postgres ENUM with `roles` / `permissions` / `role_permissions` tables; 5 seeded system roles with stable UUIDs (gadmin ad30, padmin ad25, team_lead ad20, user ad10, external archetype ad05); 21 seeded permissions across menu / users / roles / portfolio categories; `users.role_id` + `page_roles.role_id` backfilled, legacy `users.role` enum kept for one release-cycle dual-read window; `internal/roles.Service` to be the sole writer (story 00295); frontend gates migrate from `user.role === '…'` to `useHasPermission('<code>')` enforced by `lint:role-literals`; writer boundary enforced by `lint:writer-boundary`; protected-account preservation test (`backend/internal/users/protected_accounts_test.go`) bcrypt-verifies the three human accounts after every migration |

---

## Paused

_(none)_

---

## Recently completed

| Feature | Area | Stories | Completed |
|---|---|---|---|
| v2 work-items full cutover — all 12 endpoints + frontend switch (PLA-0025) | API / SQL / ITM / UI | — | 2026-05-07 |
| v2 work-items endpoint — vector_artefacts cutover (dev, PLA-0023) | API / SQL / ITM | 00461–00475 | 2026-05-07 |
| Portfolio templates (replace portfolio_models + layers) | POR / SQL | 00156–00174 | 2026-04-30 |
| Vector Design System rebrand | UI | 00108–00123 | 2026-04-27 |
| Library release channel (Phase 3) | LIB | — | 2026-04-25 |
