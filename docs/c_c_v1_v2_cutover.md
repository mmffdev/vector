# v1 → v2 API Cutover Register (PLA-0030)

> **Reality check 2026-05-14:** the `/samantha/v1` block no longer exists in [main.go](../backend/cmd/server/main.go). The architecture shifted under PLA-0039 to **two transports** — `/_site` (BFF for the Vector UI) and `/samantha/v2` (public API). All routes that used to live under `/samantha/v1` are now mounted either on `/_site` (internal-only) or `/samantha/v2` (external), and every data handler reads from `vector_artefacts` (`vaPool`); `mmff_vector` (`pool`) is retained only for tenancy/membership gates. The PLA-0030 cutover from v1→v2 is effectively complete; only some legacy v1 *frontend call sites* and *openapi.yaml deprecation paperwork* remain. See [c_c_transport_segregation.md](c_c_transport_segregation.md) for the new transport model.

This doc tracks the v1→v2 migration; remaining DB-side cleanup (draining `mmff_vector` toward the eventual minimal substrate of auth/sessions/nav/RBAC) is tracked in [c_c_vector_artefacts_backfill.md](c_c_vector_artefacts_backfill.md).

**Status values:** `done` | `in-progress` | `blocked` | `infra` (will not version)

---

## v2 — live (on `/samantha/v2`)

| Route | Handler pool | Moved | Notes |
|---|---|---|---|
| `/work-items` (full CRUD + bulk + field-values) | `vaPool` | ✅ done | PLA-0023 / PLA-0025 |
| `/portfolio-items` (full CRUD + bulk + field-values) | `vaPool` | ✅ done | PLA-0037 / B21 — same handler as `/work-items` with `scope='strategy'`; package renamed `workitemsv2` → `artefactitems` |
| `/rank/move` | `vaPool` | ✅ done | Moved 2026-05-08; v1 registration removed 2026-05-09 |
| `/timeboxes/sprints` (full CRUD + bulk-create) | `vaPool` | ✅ done | PLA-0027 + PLA-0030 T2 |
| `/workspace/{id}/fields` | `vaPool` | ✅ done | PLA-0030 T3 (2026-05-08) |
| `/workspace/{id}/portfolio/layers` | `vaPool` | ✅ done | PLA-0030 T3 (2026-05-08) |
| `/portfolio/master_record` | `vaPool` | ✅ done | PLA-0030 T4a (2026-05-08) |
| `/flows` (GET — list per subscription) | `vaPool` | ✅ done | PLA-0031 / M1 — `flows.New(vaPool, mainPool)` at [main.go:476](../backend/cmd/server/main.go#L476); registered on `/_site` at L1400 |
| `/topology` (full CRUD + grants + commit/reset) | `vaPool` | ✅ done | PLA-0034 — `topology.New(pool, vaPool)` at [main.go:378](../backend/cmd/server/main.go#L378); all writes use `vaPool`; `pool` is membership/auth lookups only |

---

## `/_site` — site-only BFF (PLA-0039)

Routes that serve the Vector UI exclusively. Internal-only; not part of the external API surface. Frontend uses `apiSite()` (formerly `apiInfra()`) to reach these. Mounted at `/_site` with a back-compat shim at root that emits a `Deprecation` header pointing at `/_site`.

| Route | Pool | Notes |
|---|---|---|
| `/topology` (BFF mirror of `/samantha/v2/topology`) | `vaPool` | Internal-only; staff + padmin only |
| `/flows` | `vaPool` | PLA-0031 — single GET endpoint, padmin-managed workflow definitions |
| `/workspace-settings` (formerly `/tenant-settings`) | `vaPool` | PLA-0032 — handler now in `tenantmasterrecord` package; reads `master_record_tenant` from vector_artefacts |
| `/portfolio-models` | `libPools.RO` (mmff_library) | Library-scoped — see PLA-0030 T6 architectural decision (stays library-DB-resident) |
| `/work-items`, `/portfolio-items`, `/rank` | `vaPool` | Site mirror of v2 surface |
| `/roles`, `/artefact-types` | `vaPool` / `pool` | RBAC + artefact-types catalogue |
| Plus all infra: `/auth`, `/me`, `/nav`, `/user/tab-order`, `/custom-pages`, `/addressables/*`, `/page-help/*`, `/errors`, `/library/releases`, `/workspaces`, `/admin` | mostly `pool` | Identity/session/nav substrate — see "Stays in mmff_vector" below |

---

## Legacy / pending

| Route | Status | Notes |
|---|---|---|
| `/defects` | ❌ never existed as a separate handler | PLA-0033 anticipated migrating a `defects` table; no `backend/internal/defects/` package exists. All artefact types (defect, user-story, portfolio-item) flow through the unified `artefactitems` handler. PLA-0033 obsolete. |
| `/user-stories` | ❌ never existed as a separate handler | Same as `/defects` — handled via `artefactitems` with type filter |
| `/subscription/layers` (v1 GET) | 🔵 deprecated, legacy handler still live | Workspace-scoped successor `/workspace/{id}/portfolio/layers` is on `vaPool`. Frontend migration pending. R047 §9 marker. |
| `/samantha/v1` block in main.go | ✅ removed | No `samantha/v1` route group exists in [main.go](../backend/cmd/server/main.go) any longer |
| `openapi.yaml` v1 spec | 🔵 to archive | Mark v1 paths Deprecated; rename to `openapi-v1-archived.yaml` once frontend callers migrate (PLA-0030 T10) |

---

## openapi-v2.yaml — spec split

**Status:** ✅ created 2026-05-09 (PLA-0030 Task 1). `check_routes.sh --spec openapi-v2.yaml` and `check_callers.py --spec openapi-v2.yaml` both validate clean. `npm run api:check` runs both specs.

---

## Deprecation plan for v1

1. ✅ `Deprecation: true` + `Sunset` + `Link` headers on v1 router middleware — done 2026-05-09 (sunset `Fri, 07 Aug 2026 00:00:00 GMT`; successor `</samantha/v2>`)
2. 🔵 Mark `Deprecated: true` on all v1 paths in `openapi.yaml` (Task 9 paperwork)
3. ⏳ External consumers cut over by 2026-08-07 (sunset)
4. ✅ `/samantha/v1` `r.Route(...)` block removed from `main.go`
5. 🔵 Archive `openapi.yaml` → `openapi-v1-archived.yaml`

---

## What stays in `mmff_vector` (will not migrate)

Even when all data-cutover work completes, `mmff_vector` keeps the **identity / session / nav / RBAC substrate** because these have no business being workspace-scoped and no case for API versioning. See [c_c_vector_artefacts_backfill.md](c_c_vector_artefacts_backfill.md) for the broader DB-drain picture.

- `users`, `users_sessions`, `users_password_resets`, `users_roles`, `users_permissions`, `users_roles_workspaces`, `users_nav_*`
- `audit_logs`, `errors_events`
- `pages`, `pages_tags`, `users_roles_pages`, `users_custom_pages`, `user_custom_page_views`, `page_entity_refs`
- `subscriptions`, `subscriptions_sequence`, `master_record_workspaces`
- Mirror tables: `subscription_layers`, `subscription_workflows`, `subscription_workflow_transitions`, `subscription_artifacts`, `subscription_terminology`

---

## Plan status reconciliation (2026-05-14)

The four plans listed below were all created 2026-05-08 with intent to drain mmff_vector handler-by-handler. They are **substantially complete on the handler/route side** but their plan JSON files still show `date_started: null` and all work-items `"todo"` because nobody updated them as the work happened (it was absorbed into PLA-0039 / PLA-0030 / PLA-0037).

| Plan | Original intent | Reality |
|---|---|---|
| [PLA-0031](../dev/plans/PLA-0031.json) — flows | ETL + service rewrite + v2 register | ✅ handler on `vaPool`, route registered, GET live. ETL state unverified — needs `mmff_vector.obj_flow_tenant` row-count check vs `vector_artefacts.flows`. |
| [PLA-0032](../dev/plans/PLA-0032.json) — tenant-settings | Move `master_record_tenant` to vector_artefacts | ✅ handler renamed to `tenantmasterrecord`, route renamed to `/workspace-settings`, reads from `vaPool` |
| [PLA-0033](../dev/plans/PLA-0033.json) — defects / user-stories / portfolio-items consolidation | ETL three legacy tables into `artefacts` | ⚠️ obsolete in current form — no separate `defects` / `userstories` packages ever existed in the backend tree on this branch; the unified `artefactitems` handler already serves all types. Confirm no orphan tables remain in `mmff_vector`. |
| [PLA-0034](../dev/plans/PLA-0034.json) — topology | Move `org_nodes` / `roles_org_nodes` / `org_node_view_state` to vector_artefacts | ✅ topology service uses `vaPool` for every write; `pool` for membership lookups only. Route registered under `/_site/topology` and `/samantha/v2/topology`. |

**Next action if you want to formally close them:** for each, set `date_started` + `date_finished`, flip work-items to `status: done`, flip acceptance criteria `done: true` after a smoke-test pass. PLA-0033 likely closes as "obsolete — superseded by PLA-0037 unified handler".

---

## Related

- [`docs/c_plan_index.md`](c_plan_index.md) — PLA-0030 / PLA-0039 / PLA-0037
- [`docs/c_c_vector_artefacts_backfill.md`](c_c_vector_artefacts_backfill.md) — DB-side cutover context
- [`docs/c_c_transport_segregation.md`](c_c_transport_segregation.md) — `/_site` vs `/samantha/v2` transports
- [`docs/c_c_v2_workitems_cutover_followups.md`](c_c_v2_workitems_cutover_followups.md) — work-items deferrals
- [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) — `api:check` toolchain
