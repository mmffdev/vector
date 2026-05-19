# Codebase File Index (auto-generated)

**Generated:** 2026-05-19 00:49:43
**Generator:** `dev/scripts/gen-file-index.sh`

Map of curated source directories. Use this to **locate the right area before reaching for `<search>`**.
`Grep`/`Glob` direct from here is sub-second; `<search>` should be reserved for unknown territory.

Hand-edited `Purpose:` lines are preserved across regenerations.

## App router & components (TS/TSX)

### app
2 file(s) · key: layout.tsx, page.tsx
Purpose: _(unset)_

### app/(user)
2 file(s) · key: layout.tsx, _shared.tsx
Purpose: _(unset)_

### app/(user)/dev
2 file(s) · key: page.tsx, layout.tsx
Purpose: _(unset)_

### app/(user)/portfolio-items
2 file(s) · key: page.tsx, layout.tsx
Purpose: _(unset)_

### app/(user)/portfolio-model
6 file(s) · key: page.tsx, WizardModelCardList.tsx, LayersPreviewTable.tsx
Purpose: _(unset)_

### app/(user)/vector-admin/api-manager
2 file(s) · key: page.tsx, layout.tsx
Purpose: _(unset)_

### app/(user)/vector-admin/api-manager/webhooks
2 file(s) · key: page.tsx, WebhookForm.tsx
Purpose: _(unset)_

### app/(user)/work-items
2 file(s) · key: page.tsx, layout.tsx
Purpose: _(unset)_

### app/(user)/workspace-admin/artefacts
2 file(s) · key: layout.tsx, page.tsx
Purpose: _(unset)_

### app/(user)/workspace-admin/custom-fields
2 file(s) · key: layout.tsx, page.tsx
Purpose: _(unset)_

### app/components
82 file(s) · key: ResourceTree.tsx, ScopeTreePanel.tsx, QRCodeTrigger.tsx
Purpose: _(unset)_

### app/components/ObjectTree
3 file(s) · key: p_ObjectTree.tsx, p_ObjectTreeRegistry.tsx, index.tsx
Purpose: _(unset)_

### app/components/ObjectTree/configs
2 file(s) · key: work-items-config.tsx, strategy-items-config.tsx
Purpose: _(unset)_

### app/components/WorkItemRelations
4 file(s) · key: RelationsSidebar.tsx, RelationsGraph.tsx, RelationsToolbar.tsx
Purpose: _(unset)_

### app/components/__tests__
7 file(s) · key: p_ObjectTree.test.tsx, NavigationPie.test.tsx, InheritanceIndicator.test.tsx
Purpose: _(unset)_

### app/components/flow-rules
5 file(s) · key: OrbitCanvas.tsx, StateRail.tsx, OrbitView.tsx
Purpose: _(unset)_

### app/components/topology
17 file(s) · key: useTopologyTreeState.ts, useTopologyData.ts, layoutWithDagre.ts
Purpose: _(unset)_

### app/contexts
15 file(s) · key: ScopeContext.tsx, AuthContext.tsx, Sentinel.tsx
Purpose: _(unset)_

### app/featuretests/__tests__
5 file(s) · key: f_sentinel_scope_reload.test.tsx, f9_priority_chip_customisation.test.tsx, f6_status_renam
Purpose: _(unset)_

### app/hooks
25 file(s) · key: useTopologyHandoffs.ts, useRealtimeSubscription.ts, useStepUpAction.ts
Purpose: _(unset)_

### app/hooks/__tests__
2 file(s) · key: useStepUpAction.test.tsx, useKeyboardGrid.test.tsx
Purpose: _(unset)_

### app/lib
25 file(s) · key: api.ts, shareableParams.ts, dpop.ts
Purpose: _(unset)_

### app/lib/__tests__
7 file(s) · key: dpop.test.ts, wsClose.test.ts, api-session-codes.test.ts
Purpose: _(unset)_

### app/lib/graph-engine/interactions
3 file(s) · key: index.ts, hover.ts, drag.ts
Purpose: _(unset)_

### app/lib/graph-engine/layout
2 file(s) · key: index.ts, hierarchy.ts
Purpose: _(unset)_

### app/lib/graph-engine/view
3 file(s) · key: Node.tsx, GraphCanvas.tsx, Edges.tsx
Purpose: _(unset)_

### app/login
2 file(s) · key: page.tsx, layout.tsx
Purpose: _(unset)_

### app/redesign
3 file(s) · key: page.tsx, ShellContext.tsx, layout.tsx
Purpose: _(unset)_

### app/redesign/components
8 file(s) · key: DebugPanel.tsx, RedesignTopBar.tsx, RedesignShell.tsx
Purpose: _(unset)_

### app/store/shared
2 file(s) · key: types.ts, Widget.tsx
Purpose: _(unset)_

### app/store/ui_apps/ui_app_name
2 file(s) · key: c_store_app_name.manifest.ts, c_store_app_name-index.tsx
Purpose: _(unset)_

### _Single-file dirs (rolled up)_
- app/(overlay)
- app/(overlay)/topology
- app/(user)/account-settings
- app/(user)/account-settings/mfa
- app/(user)/account-settings/sessions
- app/(user)/admin
- app/(user)/admin/roles
- app/(user)/backlog
- app/(user)/dashboard
- app/(user)/dev/[tab]
- app/(user)/dev/library
- app/(user)/favourites
- app/(user)/library-releases
- app/(user)/my-vista
- app/(user)/notifications
- app/(user)/p/[id]/[[...vid]]
- app/(user)/planning
- app/(user)/portfolio
- app/(user)/portfolio-model/__tests__
- app/(user)/portfolio-model/custom
- app/(user)/portfolio-settings
- app/(user)/preferences/navigation
- app/(user)/product/[id]
- app/(user)/releases
- app/(user)/risk
- app/(user)/risk/__tests__
- app/(user)/scope
- app/(user)/sprints
- app/(user)/table-harness
- app/(user)/theme
- app/(user)/theme-classic
- app/(user)/user-management
- app/(user)/user-management/[userId]/topology-permissions
- app/(user)/user-management/permissions
- app/(user)/vector-admin
- app/(user)/vector-admin/api-manager/asset-register
- app/(user)/vector-admin/tenant-settings
- app/(user)/workspace-admin
- app/(user)/workspace-admin/artefact-types
- app/(user)/workspace-admin/artefacts/artefact-types
- app/(user)/workspace-admin/artefacts/flow-states-v2
- app/(user)/workspace-admin/artefacts/transition-rules
- app/(user)/workspace-admin/custom-fields/defects
- app/(user)/workspace-admin/custom-fields/portfolio-items
- app/(user)/workspace-admin/custom-fields/risks
- app/(user)/workspace-admin/custom-fields/tasks
- app/(user)/workspace-admin/custom-fields/work-items
- app/(user)/workspace-admin/flow-states
- app/(user)/workspace-admin/flow-states-v2
- app/(user)/workspace-admin/portfolio-model
- app/(user)/workspace-admin/topology
- app/(user)/workspace-admin/topology-map
- app/(user)/workspace-admin/transition-rules
- app/(user)/workspace-admin/work-items
- app/(user)/workspace-admin/workspace-details
- app/(user)/workspace-admin/workspaces
- app/api/dev/api-changelog
- app/api/dev/artefact-types
- app/api/dev/artefact-types/[id]/fields
- app/api/dev/artefact-types/[id]/fields/[fieldLibraryId]
- app/api/dev/field-library
- app/api/dev/field-library/[id]
- app/api/dev/go-test
- app/api/dev/library
- app/api/dev/library/file
- app/api/dev/memory-reports
- app/api/dev/operations
- app/api/dev/plans
- app/api/dev/research
- app/api/dev/retros
- app/api/dev/scope
- app/api/dev/scope/stream
- app/api/dev/security-audits
- app/api/dev/services
- app/api/v2/artefact-types
- app/api/v2/field-library
- app/api/v2/field-library/[id]
- app/api/v2/strategy-items
- app/api/v2/strategy-items/[id]
- app/api/v2/work-items
- app/api/v2/work-items/[id]
- app/api/v2/work-items/relations
- app/change-password
- app/components/MapRelationship3D
- app/components/catalogue/c_circular_additor
- app/components/timebox
- app/help/[id]
- app/lib/apiSite
- app/lib/graph-engine
- app/lib/shared/topology
- app/lib/shared/topology/__tests__
- app/lib/v2
- app/login/reset
- app/login/reset/confirm
- app/store
- app/v2
- app/v2/compare
- app/v2/custom-fields
- app/v2/portfolio-model
- app/v2/work-items

## Backend Go services

### backend/cmd/auditidx
1 file(s) · key: main.go
Purpose: _(unset)_

### backend/cmd/backfill-artefact-types
1 file(s) · key: main.go
Purpose: _(unset)_

### backend/cmd/cli
1 file(s) · key: main.go
Purpose: _(unset)_

### backend/cmd/cli/client
1 file(s) · key: client.go
Purpose: _(unset)_

### backend/cmd/cli/commands/apikeys
1 file(s) · key: apikeys.go
Purpose: _(unset)_

### backend/cmd/cli/commands/auth
3 file(s) · key: me.go, logout.go, login.go
Purpose: _(unset)_

### backend/cmd/cli/commands/flows
1 file(s) · key: flows.go
Purpose: _(unset)_

### backend/cmd/cli/commands/portfolios
1 file(s) · key: portfolios.go
Purpose: _(unset)_

### backend/cmd/cli/commands/workitems
1 file(s) · key: workitems.go
Purpose: _(unset)_

### backend/cmd/cli/commands/workspaces
1 file(s) · key: workspaces.go
Purpose: _(unset)_

### backend/cmd/cli/printer
1 file(s) · key: printer.go
Purpose: _(unset)_

### backend/cmd/cli/session
1 file(s) · key: session.go
Purpose: _(unset)_

### backend/cmd/encsecret
1 file(s) · key: main.go
Purpose: _(unset)_

### backend/cmd/migrate
1 file(s) · key: main.go
Purpose: _(unset)_

### backend/cmd/server
1 file(s) · key: main.go
Purpose: _(unset)_

### backend/dev/scripts
1 file(s) · key: seed_workspace.go
Purpose: _(unset)_

### backend/internal/addressables
9 file(s) · key: sql.go, service.go, help_lifecycle_test.go
Purpose: _(unset)_

### backend/internal/alerting
2 file(s) · key: alerting_test.go, alerting.go
Purpose: _(unset)_

### backend/internal/apikeys
5 file(s) · key: middleware.go, handler.go, dev.go
Purpose: _(unset)_

### backend/internal/artefactitems
11 file(s) · key: types.go, sql.go, service_test.go
Purpose: _(unset)_

### backend/internal/artefactpriorities
4 file(s) · key: types.go, sql.go, service.go
Purpose: _(unset)_

### backend/internal/artefacttypes
6 file(s) · key: sql.go, seed_test.go, seed.go
Purpose: _(unset)_

### backend/internal/audit
1 file(s) · key: audit.go
Purpose: _(unset)_

### backend/internal/auth
18 file(s) · key: handler.go, service.go, codes.go
Purpose: _(unset)_

### backend/internal/bootstatus
1 file(s) · key: bootstatus.go
Purpose: _(unset)_

### backend/internal/cspreport
3 file(s) · key: handler.go, sql.go, service.go
Purpose: _(unset)_

### backend/internal/custompages
2 file(s) · key: service.go, handler.go
Purpose: _(unset)_

### backend/internal/db
1 file(s) · key: db.go
Purpose: _(unset)_

### backend/internal/dbinvariants
2 file(s) · key: orphans_test.go, dispatch_triggers_test.go
Purpose: _(unset)_

### backend/internal/errorsreport
5 file(s) · key: handler_test.go, sql.go, service.go
Purpose: _(unset)_

### backend/internal/featuretests
8 file(s) · key: f1_workspace_clamp_test.go, f8_priority_crud_wire_test.go, f8_priorities_pkg_shape_test.go
Purpose: _(unset)_

### backend/internal/fields
6 file(s) · key: sql.go, service.go, resolver_test.go
Purpose: _(unset)_

### backend/internal/flows
10 file(s) · key: sql.go, service.go, handler.go
Purpose: _(unset)_

### backend/internal/geo
1 file(s) · key: geo.go
Purpose: _(unset)_

### backend/internal/httperr
1 file(s) · key: httperr.go
Purpose: _(unset)_

### backend/internal/librarydb
9 file(s) · key: sql.go, releases_test.go, releases.go
Purpose: _(unset)_

### backend/internal/libraryreleases
6 file(s) · key: sql.go, service.go, reconciler.go
Purpose: _(unset)_

### backend/internal/logger
2 file(s) · key: middleware.go, logger.go
Purpose: _(unset)_

### backend/internal/messaging/email
7 file(s) · key: types.go, transport.go, templates.go
Purpose: _(unset)_

### backend/internal/nav
10 file(s) · key: sql.go, service_test.go, service.go
Purpose: _(unset)_

### backend/internal/pageaccess
3 file(s) · key: sql.go, resolver.go, handler.go
Purpose: _(unset)_

### backend/internal/permissions
5 file(s) · key: sql.go, resolver.go, catalogue_test.go
Purpose: _(unset)_

### backend/internal/polymorphicrefs
3 file(s) · key: service_test.go, service.go, lifecycle_test.go
Purpose: _(unset)_

### backend/internal/portfolio
4 file(s) · key: sql.go, master_record_service.go, master_record_handler_test.go
Purpose: _(unset)_

### backend/internal/portfoliomodels
34 file(s) · key: handler_test.go, sql.go, dev_reset.go
Purpose: _(unset)_

### backend/internal/ranking
6 file(s) · key: service_integration_test.go, registry.go, handler.go
Purpose: _(unset)_

### backend/internal/realtime
13 file(s) · key: session_sweeper_test.go, ws_origin_test.go, client.go
Purpose: _(unset)_

### backend/internal/roles
7 file(s) · key: audit_smoke_test.go, cache_invalidation_test.go, handler_test.go
Purpose: _(unset)_

### backend/internal/roletypes
1 file(s) · key: models.go
Purpose: _(unset)_

### backend/internal/search
2 file(s) · key: service.go, handler.go
Purpose: _(unset)_

### backend/internal/searchworker
2 file(s) · key: worker.go, sql.go
Purpose: _(unset)_

### backend/internal/secrets
4 file(s) · key: secrets_test.go, secrets.go, get_test.go
Purpose: _(unset)_

### backend/internal/security
8 file(s) · key: csrf.go, mfaremember.go, clientip.go
Purpose: _(unset)_

### backend/internal/shared/topology
2 file(s) · key: walker_test.go, walker.go
Purpose: _(unset)_

### backend/internal/tenantmasterrecord
4 file(s) · key: sql.go, service_test.go, service.go
Purpose: _(unset)_

### backend/internal/timeboxreleases
4 file(s) · key: types.go, sql.go, service.go
Purpose: _(unset)_

### backend/internal/timeboxsprints
6 file(s) · key: service.go, types.go, sql.go
Purpose: _(unset)_

### backend/internal/topology
12 file(s) · key: middleware_workspace_test.go, sql.go, service.go
Purpose: _(unset)_

### backend/internal/transport
1 file(s) · key: transport.go
Purpose: _(unset)_

### backend/internal/usermessages
1 file(s) · key: messages.go
Purpose: _(unset)_

### backend/internal/users
7 file(s) · key: service_test.go, prefs.go, sql.go
Purpose: _(unset)_

### backend/internal/usertaborder
2 file(s) · key: service.go, handler.go
Purpose: _(unset)_

### backend/internal/webhooks
5 file(s) · key: worker.go, sql.go, service.go
Purpose: _(unset)_

### backend/internal/workspacemasterrecord
6 file(s) · key: sql.go, inheritance_wiring.go, service_inheritance_test.go
Purpose: _(unset)_

### backend/internal/workspaces
10 file(s) · key: handler_test.go, crossdb_integration_test.go, sql.go
Purpose: _(unset)_

## Dev tooling

### dev/components
2 file(s) · key: DevTabNav.tsx, DevAccordion.tsx
Purpose: _(unset)_

### dev/pages
16 file(s) · key: DevComponentsPanel.tsx, DevShortcutsPanel.tsx, DevSecurityAuditsPanel.tsx
Purpose: _(unset)_

### dev/scripts
39 file(s) · key: ssh_manager.sh, cookbook_harvest.sh, rg-rerun.sh
Purpose: _(unset)_

### dev/scripts/backup/lib
4 file(s) · key: common.sh, rotate.sh, preflight.sh
Purpose: _(unset)_

### dev/scripts/backup/producers
6 file(s) · key: 50_plesk.sh, 30_rabbitmq.sh, 60_opt_configs.sh
Purpose: _(unset)_

### dev/store/ui_apps/ui_app_iconbrowser
2 file(s) · key: d_store_app_iconbrowser-index.tsx, d_store_app_iconbrowser.manifest.ts
Purpose: _(unset)_

### dev/tests/playwright
4 file(s) · key: work-item-relations.spec.ts, work-items-drag.spec.ts, rank-drag.spec.ts
Purpose: _(unset)_

### _Single-file dirs (rolled up)_
- dev/scripts/backup
- dev/scripts/backup/launchd

## Dev fixtures & data

### dev/fixtures/shared/topology
6 file(s) · key: single-root-deep.json, orphan-drop.json, multi-root-forest.json
Purpose: _(unset)_

### dev/plans
47 file(s) · key: PLA-0055.json, PLA-0054.json, PLA-0053.json
Purpose: _(unset)_

### dev/registries
15 file(s) · key: page_description_exempt.json, raw_table_exempt.json, h2_panel_only_exempt.json
Purpose: _(unset)_

### dev/reports
521 file(s) · key: 20260519-003857-addressables.json, 20260519-003617-addressables.json, 20260519-001549-addr
Purpose: _(unset)_

### dev/research
58 file(s) · key: R057.json, R056.json, R055.json
Purpose: _(unset)_

### dev/scripts
10 file(s) · key: etl_workspace_settings.sql, etl_portfolio_items.sql, etl_user_stories.sql
Purpose: _(unset)_

### _Single-file dirs (rolled up)_
- dev/operations
- dev/retros
- dev/scripts/backup
- dev/security-audits

## Database schema

### db/mmff_library/schema
13 file(s) · key: 014_rename_library_RF1_4_2.sql, 013_rename_errors_RF1_4_2.sql, 011_layer_tag_definitions.s
Purpose: _(unset)_

### db/mmff_library/schema/seed
5 file(s) · key: 005_layer_tag_definitions.sql, 004_portfolio_templates.sql, 003_extra_models.sql
Purpose: _(unset)_

### db/mmff_vector/schema
215 file(s) · key: 217_nav_artefacts_purge_user_prefs.sql, 216_nav_artefacts_leaf_unpinnable.sql, 215_nav_art
Purpose: _(unset)_

### db/mmff_vector/schema/down
36 file(s) · key: 200_drop_broken_master_record_tenant_seed_trigger_DOWN.sql, 199_seed_role_page_grants_lock
Purpose: _(unset)_

### db/ops
1 file(s) · key: cleanup_perm_test_tenants.sql
Purpose: _(unset)_

### db/seed
5 file(s) · key: 010_master_reset.sql, 003_load_test_work_items_DOWN.sql, 003_load_test_work_items.sql
Purpose: _(unset)_

### db/vector_artefacts/dev-seeds
1 file(s) · key: seed_risks.sql
Purpose: _(unset)_

### db/vector_artefacts/schema
79 file(s) · key: 082_drop_subscription_prefix_unique.sql, 081_migrate_artefacts_priority_to_uuid.sql, 080_c
Purpose: _(unset)_

### db/vector_artefacts/schema/down
26 file(s) · key: 077_adopt_risk_into_existing_workspaces_DOWN.sql, 076_seed_risk_number_sequence_DOWN.sql, 
Purpose: _(unset)_

### db/vector_artefacts/schema/seed
1 file(s) · key: 01_work_items_fixture.sql
Purpose: _(unset)_

## Documentation indexes

### .
8 file(s) · key: Vector_Scope.md, hover2.md, BACKLOG.md
Purpose: _(unset)_

### docs
71 file(s) · key: c_tech_debt.md, c_sentinel_plan.md, c_sql_cookbook.md
Purpose: _(unset)_

### docs/notes
7 file(s) · key: rick_notes_api.md, mmffdev_builder_brief.md, agent_workspace.md
Purpose: _(unset)_

### docs/superpowers/plans
4 file(s) · key: 2026-05-07-pla-0024-subscriptions-cutover.md, 2026-05-08-samantha-api-rename.md, 2026-05-0
Purpose: _(unset)_

### docs/superpowers/specs
3 file(s) · key: 2026-05-07-subscriptions-to-master-record-tenant-cutover-design.md, 2026-05-08-samantha-ap
Purpose: _(unset)_

