# v1 → v2 API Cutover Register (PLA-0030)

Tracks every `/samantha/v1` route group, its data pool, what blocks it from moving to `/samantha/v2`, and its current cutover state.

The end state: `/samantha/v1` is removed from the router entirely. All external API consumers point at `/samantha/v2`. Auth/infra routes become unversioned root-level endpoints.

**Status values:** `done` | `in-progress` | `blocked` | `infra` (will not version)

---

## v2 — already live

| Route | Handler pool | Moved | Notes |
|---|---|---|---|
| `/work-items` (full CRUD + bulk + field-values) | `vaPool` (vector_artefacts) | ✅ done | PLA-0023 / PLA-0025 |
| `/rank/move` | `vaPool` | ✅ done | Moved 2026-05-08; v1 registration removed 2026-05-09; frontend uses `apiV2` |
| `/timeboxes/sprints` (full CRUD + bulk-create) | `vaPool` | ✅ done | PLA-0027 + PLA-0030 T2; all mutations in v2 block, `WorkItemsSettingsEdit` gate on writes |
| `/workspace/{id}/fields` | `vaPool` | ✅ done | PLA-0030 T3 (2026-05-08); `artefact_field_library` + `artefact_workspace_fields`; mmff_vector used only for tenancy gate |
| `/workspace/{id}/portfolio/layers` | `vaPool` | ✅ done | PLA-0030 T3 (2026-05-08); `artefact_types` scope=strategy; mmff_vector used only for tenancy gate |
| `/portfolio/master_record` | `vaPool` | ✅ done | PLA-0030 T4a (2026-05-08); `master_record_portfolio` in vector_artefacts; mmff_vector tenancy gate only |

---

## Blocked — data migration required

| Route | Handler pool | Blocker | Depends on |
|---|---|---|---|
| `/topology` | `pool` (mmff_vector) | `org_nodes` / `org_node_roles` not yet in `vector_artefacts` | Topology data migration plan (not yet created) |
| `/portfolio-models` | `libPools.RO` (library DB) | Library DB is a separate read-only pool; not a `vector_artefacts` candidate — needs architectural decision on whether portfolio models move or stay library-scoped | PLA-0026 completion + architectural decision |
| ~~`/portfolio/master_record`~~ | `vaPool` | ✅ Done — PLA-0030 T4a (2026-05-08). `master_record_portfolio` was already in vector_artefacts | — |
| `/portfolio-items` | `pool` | Work-items v1 legacy table; superseded by `/work-items` on v2 but v1 surface still live for backwards compat | Deprecation + client migration |
| `/subscription/layers` | `pool` | Layer data in mmff_vector; workspace-scoped successor (`/workspace/{id}/portfolio/layers`) partially uses vaPool | PLA-0026 |
| ~~`/workspace/{id}/portfolio/layers`~~ | `vaPool` | ✅ Done — PLA-0030 T3 (2026-05-08). mmff_vector tenancy gate retained inside handler | — |
| ~~`/workspace/{id}/fields`~~ | `vaPool` | ✅ Done — PLA-0030 T3 (2026-05-08). mmff_vector tenancy gate retained inside handler | — |
| ~~`/timeboxes/sprints` mutations (POST, PUT, DELETE)~~ | `vaPool` | ✅ Audit complete — mutations were already in v2 block with `WorkItemsSettingsEdit` gate; PLA-0030 T2 done | — |
| `/defects` | `pool` | Defects not yet migrated to vector_artefacts | Defects migration (not yet planned) |
| `/user-stories` | `pool` | User stories not yet migrated to vector_artefacts | User stories migration (not yet planned) |
| `/flows` | `pool` | Flow states live in mmff_vector | Part of work-items data model migration |
| `/tenant-settings` | `pool` | Tenant config lives in mmff_vector; no vector_artefacts equivalent | PLA-0024 |

---

## Infra — promoted to root-level (PLA-0030 Task 8 ✅)

These serve session/user/navigation data that lives in mmff_vector permanently and have no case for API versioning. All are now registered as root-level routes (alongside `/healthz`, `/env`, `/ws`). The `/samantha/v1` block no longer contains any of these. Frontend uses `apiInfra()` to reach them.

| Route | Rationale |
|---|---|
| `/auth` | Session infrastructure — login, refresh, logout, change-password, me |
| `/me` | User preferences (theme-pack) |
| `/nav` | Navigation catalogue, prefs, bookmarks, profiles, entities, start-page |
| `/user/tab-order` | Per-user per-page tab ordering (PLA-0014) |
| `/custom-pages` | Custom page config |
| `/addressables/*`, `/page-help/*` | Addressable substrate + page-help (PLA-0005) |
| `/roles`, `/admin` | RBAC + user admin surface (PLA-0007) |
| `/errors` | Error reporting |
| `/library/releases` | Library release notifications |
| `/workspaces` | Workspace config (PLA-0006) |

---

## openapi-v2.yaml — spec split

The current `openapi.yaml` is the v1 spec. A separate `openapi-v2.yaml` is required that:

- Has `servers: [{url: .../samantha/v2}]`
- Contains only the v2 paths above
- Is validated independently by `check_routes.sh` and `check_callers.py`
- Is snapshotted by `api:snap` into `api-snapshots/v2/vN.yaml`

**Status:** ✅ created 2026-05-09 (PLA-0030 Task 1). `check_routes.sh --spec openapi-v2.yaml` and `check_callers.py --spec openapi-v2.yaml` both validate clean. Baselines in `api-snapshots/v1/` and `api-snapshots/v2/`. `npm run api:check` runs both specs.

---

## Deprecation plan for v1

1. ✅ Add `Deprecation: true` + `Sunset` + `Link` headers to v1 router middleware — **done 2026-05-09** (sunset date: `Fri, 07 Aug 2026 00:00:00 GMT`; successor link: `</samantha/v2>`)
2. Add `Deprecated: true` to all v1 paths in `openapi.yaml` — pending Task 9 spec update
3. Give external consumers until 2026-08-07 (sunset date)
4. Remove the `/samantha/v1` `r.Route(...)` block from `main.go` — pending Task 10 (blocked until all data routes migrate)
5. Archive `openapi.yaml` → `openapi-v1-archived.yaml` — pending Task 10

---

## Related

- [`docs/c_plan_index.md`](c_plan_index.md) — PLA-0030
- [`docs/c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md) — data migration context
- [`docs/c_c_v2_workitems_cutover_followups.md`](c_c_v2_workitems_cutover_followups.md) — work-items specific deferrals
- [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) — `api:check` toolchain
