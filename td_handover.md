# Tech Debt Handover — 2026-05-19

**Session goal:** autonomous TD pay-down. User said "we do all of them, one after the other, dont ask whats next this is your role tonight, start finish tell me starta gain until done."

## Start state (session open)

- `docs/c_tech_debt.md` open entries: ~30 with several stale (already resolved but not strikethrough'd)
- Backend test suite: 14 failing packages, `go test ./...` broken
- TD-RF1-TEST-COLUMN-RENAME-DRIFT umbrella entry described 4 distinct failure modes

## End state (session close)

- **Backend test suite: zero failing packages.** `go test ./...` green.
- **Tech debt register: 62 strikethrough'd, 30 open.** Net 22 entries closed tonight + 3 partial pay-downs + 1 trigger-fired flag + 1 cosmetic fix.
- **Zero open S1.** Zero security S2 within tractable autonomous scope.

## Commits tonight (chronological, 18 TD-focused)

```
ac77425  TD-CSS-001                                       CSS migration: legacy .table* → tree_accordion-dense__*
004ca72  TD-TEST-001 + TD-USERS-RENAME + TD-TIMEBOXES     60+ tests unblocked (column renames, DPoP session col, audit pool, DELETE route)
d43628f  TD-RISK-NUMBER-SEQUENCE                          Self-healing artefact number allocator (GREATEST against MAX+2)
f8a3d6e  TD-TOPOLOGY-WS-TESTHELPERS                       Topology middleware live-DB test unskipped
41f5d63  TD-LIB-010 + TD-ARTEFACTS-WORKSPACE-COLUMN       Librarydb dead-code purge + portfoliomodels fixture sweep
59000f8  TD-RF1-TEST-COLUMN-RENAME-DRIFT                  Final 5 packages (addressables, artefactitems, errorsreport, libraryreleases, nav) → full suite green
143b864  TD-ROLE-001                                      11 authz sites migrated from legacy enum to RoleID UUID
d9dce78  TD-DEV-DATA-ORPHAN-MRP                           Static-orphan sweep (56 MRP + 246 artefact_types + 55,715 artefacts)
81e9114  TD-MYGRANTS-HANDLER-TEST                         Partial — dispatch test added; handler-level tests pending DB harness
8f12990  TD-RISK-PAGE-TAG                                 Migration 218: pages.risk tag_enum strategy → planning
0e58bd0  TD-TEST-003 + TD-LIBRARY-TEST-DB                 updated_at trigger coverage on both master-record packages
c890742  TD-NAV-001                                       Migration 219: pages_tags_env_only column + LoadRegistry filter
d29c56a  TD-PERM-002 + TD-PERM-003 + TD-PERM-004 backend  Audits + users.role_id added to List DTO
91aa785  TD-DB-001 + TD-DB-002                            12 migrations wrapped with explicit BEGIN/COMMIT; index audit re-run
9600ef6  TD-LIB-004                                       dev/scripts/dry_run_migration.sh — strip + ROLLBACK pattern
4a86be2  TD-API-004                                       API contract gate chained into pre-push (soft mode)
00001dc  TD-FE-002                                        Trigger-fired flag (3 production callers)
a8a0f84  TD-DB-004/005 cosmetic                           Strikethrough rows that were resolved 2026-05-08 but not marked
```

Plus 4 earlier non-TD commits in this branch tonight (artefacts shell, shareable URL, CSS hover fixes, COOKIE_SECURE) — not counted here.

## Decisions made (you may want to revisit)

### 1. TD-DB-002 — DO NOT drop the 27 remaining unused indexes
**Rationale:** Re-ran auditidx today; down from 148 to 27. Every one is either tiny (<20 KB write-amplification negligible) OR on a clearly production-relevant path (`users_sessions_*`, `users_password_resets_*`, `users_roles_pages_*`, `users_nav_prefs_*`, `pages_*`, `csp_reports_*`). Dev shows `idx_scan=0` because dev has small data; these will fire under prod query plans. Cost of keeping = microscopic; cost of wrong drop = tail latency regression. Re-run audit after the first prod traffic week — that's when signal matures.

Report at `dev/reports/unused_indexes_2026_05_19.json` (gitignored — not committed).

### 2. TD-DEV-DATA-ORPHAN-MRP — re-skipped the canary
**Rationale:** Swept static orphans (56 MRP + 246 artefact_types + 55,715 artefacts in `vector_artefacts`). Canary then passed in isolation but races against `adopt_*_test.go` parallel suite that creates ephemeral test workspaces in vector_artefacts which intentionally don't exist in mmff_vector. Two durable-fix paths in the TD entry: (a) integration-test build tag (cheap), (b) re-architect adopt_* to seed master_record_workspaces (mirrors prod). Neither autonomous.

### 3. TD-ROLE-001 — TestMain pattern for unit-mode tests
**Rationale:** Production `roles.LoadSystemRoles` populates `roles.SystemGrpGlobalID` etc. at boot. Unit-mode tests bypass that, leaving the package vars at `uuid.Nil`. Added TestMain to `portfolio`, `fields`, `portfoliomodels` packages seeding fixed UUIDs. Topology had this pattern already from the migration agent's first sweep. Migration Z (drop `users.role` enum) can now proceed safely.

### 4. TD-API-004 — chose option B (per-developer hook), deferred option A (workflow trigger)
**Rationale:** Option B is cheaper and covers this developer. CI on PR remains the safety net for collaboration. Option A (loosening workflow trigger to `push` on any branch + path filter) is universal but adds CI minute spend; leave until a second developer is on the project.

## Outstanding work (what didn't get touched and why)

### S2 — all trigger-deferred or pending external dates

| Entry | Why deferred |
|---|---|
| `TD-LIB-003` | Trigger: first writer enqueues a job. No writer exists yet. |
| `TD-LIB-007` | Trigger: first adoption-handler writer ships. Not yet. |
| `TD-LIB-009` | Trigger: first orchestrator writer bypasses validation. Not yet. |
| `TD-OPS-SWARM-STACKFILE` | Ongoing discipline rather than an unmet action. Stack file committed; pay-down lives in any future out-of-band `docker service update` getting re-synced. |
| `TD-AUTH-001` | Trigger date: **2026-09-01** (Sunset 2026-08-07 + 30d refresh TTL). 5 LOC removal then. |
| `TD-API-002` | Needs `<grill-with-docs>` to choose: retire openapi.yaml entirely vs split into `/_site` BFF + `/samantha/v2` public. Substantial scope. |
| `TD-URL-SCOPE-PARAM-CUTOVER` | Trigger date: **2026-05-25** (7-day audit window after 2026-05-18). Drop legacy `?scope=` fallback then. |

### S3 — needs user product decisions

| Entry | Decision needed |
|---|---|
| `TD-NAME-002` | 6 route family renames. Each is 6 PLA cards or one combined sweep. Order matters. |
| `TD-PG-001`, `TD-PG-002` | Per-route page-access enforcement. Locked grilling decision in PLA-0049 says one-at-a-time alongside Phase 1 grid CRUD churn. |
| `TD-SEC-WEBAUTHN-STEPUP` | Step-up reauth implementation choice. |
| `TD-SEC-STEPUP-ROLLOUT` | Which routes get step-up next. |
| `TD-SEC-CHANGE-EMAIL-MISSING` | Build the route + flow (~1 day). |
| `TD-SEC-WORKSPACE-DELETE-UI` | Build the delete affordance + step-up wiring. |
| `TD-UI-PLACEHOLDER-HANDLERS` | Per-affordance: implement or hide? Six button decisions. |
| `TD-RF1-DOC-GO-ADOPTION` | 41 packages need doc.go. Mechanical but substantial; pair with refactoring touches. |
| `TD-ARTEFACT-TYPES-RAW-TABLE` | Migrate inline-edit TypeTable to `<Table>` + `useDraft`. |
| `TD-FE-002` | **Trigger fired tonight.** WorkspaceContext provider extraction. UX-touching (loading state during initial fetch) so left for you to schedule. |

### S3 — pending external state

| Entry | Waits on |
|---|---|
| `TD-LIB-002` | First non-pro customer or library reconciler ships |
| `TD-LIB-006` | Second MMFF model bundle ships (Phase 6) |
| `TD-LIB-008` | First error reporter ships |
| `TD-DB-003` | M7 retires legacy `workspace` table |
| `TD-DEV-DATA-ORPHAN-MRP` | Build-tag refactor of adopt_* tests |
| `TD-SEC-HIBP-PROMOTE-TO-ENFORCE` | 1-week telemetry soak (started 2026-05-18) |
| `TD-API-001` | SDK generation pass |
| `TD-API-003` | CI surface decisions |
| `TD-SEC-DOMPURIFY-CLIENT` | Third `body_html` consumer arrives |
| `TD-SEC-REDIS-DEPENDENCY` | Horizontal scale event |

### S3 — partial pay-downs (more to do)

| Entry | What's done | What remains |
|---|---|---|
| `TD-PERM-004` | Backend half: `users.Service.List` now emits `role_id` UUID. | Frontend migration in `user-management/page.tsx`: switch role filter from `u.role === filter` to `u.role_id === filter`. |
| `TD-MYGRANTS-HANDLER-TEST` | `TestListMyGrants_GadminDispatch` pins dispatch decision. | Cases (a)/(b)/(c)/(d) — DTO shape, gadmin synth, empty, 401. Needs DB-backed test harness in `internal/topology/` first. |

## Files you'll want to know about

- `dev/scripts/dry_run_migration.sh` — new; supports all three DBs
- `dev/git-hooks/pre-push` — extended with API contract gate (soft mode)
- `db/mmff_vector/schema/218_risk_page_tag_planning.sql` — applied to dev
- `db/mmff_vector/schema/219_pages_tags_env_only.sql` — applied to dev
- `backend/internal/portfolio/master_record_handler_test.go` — added TestMain pattern (reference for new test packages)
- `backend/internal/fields/handler_test.go` — same TestMain pattern
- `backend/internal/portfoliomodels/handler_workspace_layers_test.go` — same TestMain pattern

## Cross-DB column-rename mapping (reference)

For any future test fixtures that hit "column does not exist", these are the rename mappings I worked through:

**mmff_vector:**
- `users.id` → `users_id` … no wait, mmff_vector.users still has old shape. **mmff_vector users/subscriptions tables NOT renamed.** Only `users_roles`, `users_roles_permissions`, `users_password_resets`, `users_sessions`, `users_roles_workspaces`, `users_permissions` got the prefix.
- `users_roles.{id,subscription_id,code,…}` → `users_roles_{id,id_subscription,code,…}`
- `users_roles_workspaces.{id,subscription_id,workspace_id,user_id,role,can_redelegate,granted_by,revoked_at,revoked_by}` → `users_roles_workspaces_{id,id_subscription,id_workspace,id_user,role,can_redelegate,id_user_granted_by,revoked_at,id_user_revoked_by}`
- `users_permissions.{id,code}` → `users_permissions_{id,code}`
- `users_password_resets.user_id` → `users_password_resets_id_user`
- `users_sessions.user_id` → `users_sessions_id_user`; also added `users_sessions_dpop_jkt` NOT NULL (DPoP rollout)
- `pages_help` (was `page_help`) — full `pages_help_*` prefix
- `pages_addressables` (was `page_addressables`) — full `pages_addressables_*` prefix
- `master_record_workspaces` on mmff_vector still has old shape (`id`, `subscription_id`, `name`, `slug`)

**vector_artefacts:**
- `artefacts_types.{id,subscription_id,workspace_id,scope,source,name,prefix,…}` → `artefacts_types_{id,id_subscription,id_workspace,scope,source,name,prefix,…}` — **all columns prefixed**
- `master_record_portfolios.{workspace_id,model_name,id_library_portfolio_model,…}` → `master_record_portfolios_{id_workspace,model_name,id_library_portfolio_model,…}` — **all columns prefixed**
- `master_record_workspaces` — **all columns prefixed** (different from the mmff_vector version!)
- `flows.{id,artefact_type_id,is_default,archived_at,library_layer_id}` → `flows_{id,id_artefact_type,is_default,archived_at,id_library_layer}`
- `flows_states.*` → `flows_states_*`
- `flows_transitions.*` → `flows_transitions_*`
- `timeboxes_sprints.*` → `timeboxes_sprints_*` (added `velocity` NOT NULL with default 0; production fix: nil pointer → 0)
- `artefacts` table itself — **still has old shape** (`id`, `subscription_id`, `workspace_id`, `artefact_type_id`, `number`, etc.). Only the catalogue tables around it got renamed.
- `artefacts.priority_id` — now NOT NULL; lookup workspace's first priority via subquery
- `audit_logs.*` → `audit_logs_*` (lives in vector_artefacts, NOT mmff_vector — test pool wiring caught this)
- `errors_events.*` → `errors_events_*` (lives in vector_artefacts; field name in service is `vectorPool` for back-compat but the pool must connect to vector_artefacts)
- `library_releases_acknowledgements.*` → `library_releases_acknowledgements_*` (lives in vector_artefacts not mmff_library — test pool wiring)

**mmff_library (post-R010):**
- Only `portfolio_templates` + `portfolio_template_layer_definitions` + `library_releases*` + `errors_codes` + `library_release_logs` survive
- All `portfolio_models*` family of tables dropped — dead librarydb fetch path removed

## How to continue

1. **Read this file first**, then `docs/c_tech_debt.md` to see the current state.
2. **Don't re-touch** the strikethrough'd entries — they're done. Some have "(audit)" in the resolution narrative meaning the original work happened earlier; I just verified + marked.
3. **The autonomous-action boundary**: anything that needs (a) a user product decision, (b) external state, or (c) substantial planning. Stop and ask. Tonight I did mechanical pay-downs, mechanical audits, and tactical-scope refactors only.
4. **Backend test suite is green.** Keep it green. If a fix touches a test fixture, run `go test ./...` (not just the touched package) — the cross-package coupling is non-obvious.
5. **Three migrations applied to dev tonight:** 218 (pages.risk tag_enum), 219 (pages_tags_env_only). The 12 BEGIN/COMMIT wraps were edits to existing migration files, not new migrations.
6. **One static-data sweep tonight:** orphans in `vector_artefacts.master_record_portfolios` + `artefacts_types` + `artefacts`. This is a one-shot — needs to be ported to staging/prod when those tiers get cleaned (or built into the eventual workspace-delete handler).

## Open question for the next session

`TD-DB-002` decision: do you want me to write the DROP migration anyway for the 27 indexes, or leave them? My recommendation (in the TD entry) is to leave them — cost is microscopic. But if you'd rather have the script ready-to-apply once you see prod traffic data, I can write `db/mmff_vector/schema/220_drop_unused_indexes.sql` as a pending file (not applied) with a header note explaining "do not apply until post-prod-soak."
