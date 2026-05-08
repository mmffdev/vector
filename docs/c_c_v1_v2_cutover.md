# v1 → v2 API Cutover Register (PLA-0030)

Tracks every `/samantha/v1` route group, its data pool, what blocks it from moving to `/samantha/v2`, and its current cutover state.

The end state: `/samantha/v1` is removed from the router entirely. All external API consumers point at `/samantha/v2`. Auth/infra routes become unversioned root-level endpoints.

**Status values:** `done` | `in-progress` | `blocked` | `infra` (will not version)

---

## v2 — already live

| Route | Handler pool | Moved | Notes |
|---|---|---|---|
| `/work-items` (full CRUD + bulk + field-values) | `vaPool` (vector_artefacts) | ✅ done | PLA-0023 / PLA-0025 |
| `/rank/move` | `vaPool` | ✅ done | Moved 2026-05-08; frontend uses `apiV2` |
| `/timeboxes/sprints` (list + get) | `vaPool` | ✅ done | PLA-0027; sprints mutations still v1 — see below |

---

## Blocked — data migration required

| Route | Handler pool | Blocker | Depends on |
|---|---|---|---|
| `/topology` | `pool` (mmff_vector) | `org_nodes` / `org_node_roles` not yet in `vector_artefacts` | Topology data migration plan (not yet created) |
| `/portfolio-models` | `libPools.RO` (library DB) | Library DB is a separate read-only pool; not a `vector_artefacts` candidate — needs architectural decision on whether portfolio models move or stay library-scoped | PLA-0026 completion + architectural decision |
| `/portfolio` (master record) | `pool` | `master_record_tenant` / `master_record_portfolio` still in mmff_vector | PLA-0024 (subscriptions cutover) + PLA-0026 (portfolio adoption cutover) |
| `/portfolio-items` | `pool` | Work-items v1 legacy table; superseded by `/work-items` on v2 but v1 surface still live for backwards compat | Deprecation + client migration |
| `/subscription/layers` | `pool` | Layer data in mmff_vector; workspace-scoped successor (`/workspace/{id}/portfolio/layers`) partially uses vaPool | PLA-0026 |
| `/workspace/{id}/portfolio/layers` | `pool` + `vaPool` | Partial — reads vaPool but falls back to pool; not fully cut over | PLA-0026 completion |
| `/workspace/{id}/fields` | `pool` + `vaPool` | Field schema reads vaPool; handler still has mmff_vector dependency for tenancy/membership | PLA-0026 completion |
| `/timeboxes/sprints` mutations (POST, PUT, DELETE) | `vaPool` | Handler uses vaPool but route is registered v1-only; mutations need permission middleware audit before promoting | Middleware audit story |
| `/defects` | `pool` | Defects not yet migrated to vector_artefacts | Defects migration (not yet planned) |
| `/user-stories` | `pool` | User stories not yet migrated to vector_artefacts | User stories migration (not yet planned) |
| `/flows` | `pool` | Flow states live in mmff_vector | Part of work-items data model migration |
| `/tenant-settings` | `pool` | Tenant config lives in mmff_vector; no vector_artefacts equivalent | PLA-0024 |

---

## Infra — will not version (permanent v1 or unversioned)

These serve session/user/navigation data that lives in mmff_vector permanently and has no case for versioning. They will either stay on v1 with a deprecation notice or become root-level unversioned routes (alongside `/healthz`, `/env`, `/ws`).

| Route | Rationale |
|---|---|
| `/auth` (refresh, logout, change-password, me) | Session infrastructure — not data endpoints |
| `/me` (theme-pack) | User preferences in mmff_vector — not portfolio data |
| `/nav` (catalogue, prefs, bookmarks, profiles) | Navigation config in mmff_vector |
| `/user/tab-order` | UI state in mmff_vector |
| `/custom-pages` | Page config in mmff_vector |
| `/addressables/*`, `/page-help/*` | UI registry in mmff_vector |
| `/roles`, `/admin` | RBAC + admin surface — mmff_vector; PLA-0007 |
| `/errors` | Error reporting — no versioning requirement |
| `/library/releases` | Library DB read-only — separate data domain |
| `/workspaces` | Workspace config in mmff_vector |

**Decision needed:** promote infra routes to root-level (unversioned, alongside `/healthz`) or keep on v1 with explicit `Deprecated: true` in spec. Either way, external SDK consumers must never depend on them.

---

## openapi-v2.yaml — spec split

The current `openapi.yaml` is the v1 spec. A separate `openapi-v2.yaml` is required that:

- Has `servers: [{url: .../samantha/v2}]`
- Contains only the v2 paths above
- Is validated independently by `check_routes.sh` and `check_callers.py`
- Is snapshotted by `api:snap` into `api-snapshots/v2/vN.yaml`

**Status:** not yet created — tracked as Task 1 of PLA-0030.

---

## Deprecation plan for v1

Once all non-infra routes have moved:

1. Add `Deprecated: true` to all v1 paths in `openapi.yaml`
2. Add `Deprecation` + `Sunset` response headers to the v1 router middleware
3. Give external consumers one release cycle (date TBD)
4. Remove the `/samantha/v1` `r.Route(...)` block from `main.go`
5. Archive `openapi.yaml` → `openapi-v1-archived.yaml`

---

## Related

- [`docs/c_plan_index.md`](c_plan_index.md) — PLA-0030
- [`docs/c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md) — data migration context
- [`docs/c_c_v2_workitems_cutover_followups.md`](c_c_v2_workitems_cutover_followups.md) — work-items specific deferrals
- [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) — `api:check` toolchain
