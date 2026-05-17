# MEMORY archive — grep, don't auto-load

Entries below are **not loaded into every session.** They live here so you can grep / find them when context is needed. The files themselves still exist in `.claude/memory/` — nothing was deleted. If an archived rule starts firing every session because the task touches it, promote it back to [MEMORY.md](MEMORY.md).

### Workflow / stories

- [Stories all layers before starting](feedback_stories_all_layers.md) — Decompose across backend, frontend, migration, tests before /stories; never one layer at a time.
- [Stories acceptance system — 7 gates, Fibonacci, risk](feedback_stories_system.md) — Hard gates: AIGEN+phase+feature+EST+RISK+description; F21+ auto-splits; 85%/90% confidence thresholds.
- [Feature-driven testing SOP — tests live at feature level, Tracker = regression library](feedback_feature_driven_testing_sop.md) — Every story → FEAT-N; every feature → one feature_test suite with red/green/regression-lock AC.
- [Push migrations + commits often, don't stack](feedback_push_often.md) — Push migrations as they land; backfill `schema_migrations` immediately if applied via raw psql.
- [Research-paper writer = Sonnet, investigators = Opus](feedback_research_paper_writer_model.md) — `<addpaper>` / `/research --page` writer agent on Sonnet; scan/audit agents on Opus.
- [API reference docs must stay in sync](feedback_api_docs_sync.md) — Update api-reference/ + redeploy after any handler/route file change.
- [Scan dev/plans/ descending for highest PLA-NNNN](feedback_scan_plans_descending.md) — Use `ls -r dev/plans/ | grep PLA | head -1` to find highest plan ID.
- [Sanitise legacy DB gradually, drop as unused](feedback_gradual_db_sanitisation.md) — Never big-bang DB cutovers; drop legacy tables/columns one at a time as their last reader is migrated.
- [Verify backend env after every start](feedback_verify_backend_env_after_start.md) — Curl /api/env after backend start; auth failures = wrong DB before wrong password.

### UI / CSS / design

- [Sidebar toolbar icon alignment](feedback_sidebar_toolbar.md) — Toggle + pencil left margin = 22px (user confirmed).
- [Pages default to full screen](feedback_pages_fullscreen.md) — All new pages full screen by default; no max-width unless specified.
- [No browser alert/confirm/prompt — in-page UI only](feedback_no_browser_alerts.md) — Never window.alert/confirm/prompt; pick form by context.
- [Helper icon — always wire through `<Panel>`](feedback_helper_icon.md) — Never render inline TbHelpHexagon + popover; wrap host block in `<Panel name="..." title="...">` so help ties into Page Help admin via the addressable substrate.
- [Vector Design System](reference_design_system.md) — `/MMFFDev - Vector Assets/Vector Design System/`; skill `/vector-design`; Satoshi font, warm neutrals.

### Routing / data / boundaries

- [DB routing — service → pool → DB → tables](reference_db_routing_doc.md) — Canonical map at `docs/c_c_db_routing.md`; pool/DB/table for every Go service.
- [Workspace scope is invisible to the user](project_workspace_scope_invisible.md) — Backend-only mechanism: no URL params, no pickers, no UUIDs in client code; UI labels + permissions are the only legitimate signals.
- [URL is path-only — no query state of any kind](feedback_url_is_path_only.md) — Generalises workspace rule: no `?type=`, `?status=`, `?sort=`, `?vid=`, nothing.
- [System layers vs display layers — never cross](feedback_system_vs_display_layers.md) — UUIDs/slots/URLs are project-locked + invisible; catalogue names/labels are tenant-free + visible.
- [Table names use domain prefix for transparency](feedback_table_naming_prefixes.md) — New tables MUST carry their substrate prefix (e.g. `artefact_*`); generic names like `field_library` rejected.
- [DB migrations — file-based ordered SQL only](project_db_migrations.md) — `db/<dbname>/schema/NNN_*.sql` per DB; runner `backend/cmd/migrate`.
- [Shared cross-runtime methods home (PLA-0045)](feedback_shared_methods_home.md) — `app/lib/shared/<domain>/` (TS) + `backend/internal/shared/<domain>/` (Go) + `dev/fixtures/shared/<domain>/`.

### Architecture / project state

- [Role boundaries — gadmin vs padmin vs user](project_role_boundaries.md) — gadmin=tech/support, padmin=product owner, user=consumer; portfolio model = padmin-only.
- [BlockingReleaseGate — gadmin page gating pattern](project_blocking_release_gate.md) — Wrap gadmin pages; padmin pages must NOT import it.
- [Pre-launch security checklist](project_pre_launch_security.md) — Scrub git history, harden ssh_manager.sh, rotate secrets; deadline: before any external repo access.
- [Open-source-first stack, no subscription costs](project_open_source_first.md) — Hobby-funded; prefer MIT/BSD OSS → self-hosted → build → paid SaaS last resort.
- [PageBuilder architecture](project_pagebuilder_architecture.md) — Hierarchical container model (Section→Row→Column→Widget), phases 0–6, 100 stories.
- [Samantha SDK — internal app API name](project_samantha_sdk.md) — Custom app SDK named "Samantha"; root namespace `samantha.portfolio.*`.
- [Portfolio layers are tenant-built & independent (max 10)](project_portfolio_layers_independent.md) — Each `portfolio_item_types` row = one layer with own flow; depth 2–10.
- [Archive map flyout — live breadcrumb rows](project_archive_map_breadcrumbs.md) — `ArchiveMapFlyout` renders muted "live" intermediates; new callers MUST pass `liveAncestorsMap`.
- [Flow-state construction across <Table> artefacts](project_flow_state_construction.md) — PLA-0015→PLA-0017 pickup record: hyphen fix in Table.tsx → spec-flag model.
- [Flow-state seed model — kinds + is_pullable](project_flow_state_seed_model.md) — 6-kind primitive + is_pullable flag; po_ready deferred (FLOW1.4.1).
- [Work-items interaction perf — 2s sort block](project_workitems_perf.md) — Client-side sort hypothesis; fix = server-driven via ?sort=&dir=; observed 2026-05-06.

### Launcher / infra

- [Dev launcher uses `go run`](project_dev_launcher_runtime.md) — Backend runs from `go run`; check /healthz commit vs HEAD, not file mtimes.
- [Launcher backend stale-binary trap](project_launcher_stale_binary.md) — `/tmp/vector-backend` updates on disk but launcher serves OLD code; SIGKILL to force respawn.
- [MMFF Vector Launcher — backlog](project_launcher_backlog.md) — Swift macOS launcher (tunnel + backend + frontend + DB env) backlog & build plan.
- [Dev Setup page — route + source](reference_dev_page.md) — Route `/dev` → `app/(user)/dev/page.tsx` re-exports `dev/pages/DevPage.tsx`.
- [Tracker `<rg>` API key (Vector-clamped)](project_tracker_rg_api_key.md) — `trk_d6fd154a…` plaintext for rg-runner POSTs to Tracker; project_id auto-resolves from key.

### Historical / completed

- [`artefactitemsv2` → `artefactitems` rename DONE 2026-05-14](project_artefactitems_rename.md) — Lesson preserved: version suffixes are intentional but temporary; drop them when the older surface no longer casts a shadow.
