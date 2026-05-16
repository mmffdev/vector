- [User background and expertise](user_background.md) — UX/Art History degree, 20+ years Agile Coach & transformation lead; no formal engineering training.
- [Stakeholder foundation mode — recommend right architecture, not minimum patch](user_stakeholder_foundation_mode.md) — Sole stakeholder, no deadline. Default to "do it right" over "ship today"; Option B over Option A.
- [Design conversation IS the iteration loop](user_design_collaboration_mode.md) — Push and pull on ideas before coding; converge then build. Long-form architecture discussions are the work, not preamble to it.
- [Read source when stuck or flying blind](feedback_read_source_when_stuck.md) — If a fix doesn't work, STOP and read 100–200 lines of source before grepping/curling/blaming cache; source is truth.
- [Empirical blast-radius before any change](feedback_empirical_blast_radius.md) — Never rely on a prior agent's summary; read the actual workflow/script/snapshot files yourself before recommending or making cross-cutting changes.
- [Deferrals always go in the tech-debt register](feedback_deferrals_register.md) — When I defer work ("hold until", "out of scope", "needs its own plan", "follow-up"), file it in docs/c_tech_debt.md with severity + trigger BEFORE the commit that creates the deferral. Spoken deferrals decay; register entries persist.
- [Never create debt — fix now, flag if detected](feedback_no_debt.md) — Overrides cap-and-defer; introduce no new debt, surface detected debt immediately.
- [Red-green-refactor is non-negotiable](feedback_red_green_always.md) — Always write the failing test FIRST; never refactor/delete and verify after. No exceptions for "obvious" or "mechanical" changes.
- [No hardcoded order/list from DB data](feedback_no_hardcoded_order_from_db_data.md) — Never invent an order/mapping in TSX or Go when the data is DB-driven; if the column doesn't carry the signal, STOP and surface the gap — don't paper over with a hardcoded list.
- [Stories all layers before starting](feedback_stories_all_layers.md) — Decompose across backend, frontend, migration, tests before /stories; never one layer at a time.
- [Stories acceptance system — 7 gates, Fibonacci, risk](feedback_stories_system.md) — Hard gates: AIGEN+phase+feature+EST+RISK+description; F21+ auto-splits; 85%/90% confidence thresholds.
- [All stories MUST go through /stories shortcut](feedback_stories_shortcut_mandatory.md) — No exceptions, no direct Planka writes; every story routes through the 7-gate skill.
- [Feature-driven testing SOP — tests live at feature level, Tracker = regression library](feedback_feature_driven_testing_sop.md) — Every story → FEAT-N; every feature → one feature_test suite with red/green/regression-lock AC; plan declares tracker_group; enforced by /stories Steps 1.b, 3, 5, 6.5.d, 6.6.
- [Never change passwords (HARD RULE)](feedback_never_change_passwords.md) — Never touch password_hash/email/role/is_active on gadmin@/padmin@/cookra@/user@; ask Rick or use claude@ test account.
- [Backend pinned to dev (HARD RULE)](feedback_dev_only.md) — Env permanently dev; staging/prod refusing stubs; revert any non-dev marker silently.
- [Always recommend the safest, best approach](feedback_safety_first.md) — Lead with ranked safest-first recommendation; never neutral A/B/C menus.
- [Push migrations + commits often, don't stack](feedback_push_often.md) — Push migrations as they land; backfill `schema_migrations` immediately if applied via raw psql.
- [Research-paper writer = Sonnet, investigators = Opus](feedback_research_paper_writer_model.md) — `<addpaper>` / `/research --page` writer agent on Sonnet; scan/audit agents on Opus.
- [API reference docs must stay in sync](feedback_api_docs_sync.md) — Update api-reference/ + redeploy after any handler/route file change.
- [Sidebar toolbar icon alignment](feedback_sidebar_toolbar.md) — Toggle + pencil left margin = 22px (user confirmed).
- [Pages default to full screen](feedback_pages_fullscreen.md) — All new pages full screen by default; no max-width unless specified.
- [No browser alert/confirm/prompt — in-page UI only](feedback_no_browser_alerts.md) — Never window.alert/confirm/prompt; pick form by context.
- [Verify backend env after every start](feedback_verify_backend_env_after_start.md) — Curl /api/env after backend start; auth failures = wrong DB before wrong password.
- [Never assume a database (HARD RULE)](feedback_never_assume_database.md) — Always trace handler → main.go pool → routing doc before any psql query; no "probably lives in X".
- [DB routing — service → pool → DB → tables](reference_db_routing_doc.md) — Canonical map at `docs/c_c_db_routing.md`; pool/DB/table for every Go service.
- [Never wipe uncommitted](feedback_never_wipe_uncommitted.md) — Do not run destructive git clean; always preserve local work.
- [Never git stash, period](feedback_never_git_stash.md) — Never run `git stash`/`stash pop`/`stash drop`; on 2026-05-16 a stash --include-untracked nuked hours of Rick's in-flight work across 17 files. Use surgical `git checkout <ref> -- <path>` or copy-to-/tmp instead.
- [CSS canonical — buttons, tables, inline styles, tokens](css_canonical.md) — `.btn` + variant on every button; `tree_accordion-dense__*` for every table; no inline `style={{}}`; `--accent`/`--accent-ink` for interactive state, never `--brand`.
- [CSS/HTML naming convention — hierarchical semantic pattern](css_naming_convention.md) — `root__Container_Child_leaf`; `__` once at root boundary, `_` for deeper nesting, `-` for modifiers only; propose full TSX+CSS chain before writing any class name.
- [Test accounts — Claude-owned + human-owned](test_accounts.md) — All test logins (claude@, claude_N_test@, gadmin/padmin/user@) consolidated; HARD RULE on human accounts.
- [Vector Design System](reference_design_system.md) — `/MMFFDev - Vector Assets/Vector Design System/`; skill `/vector-design`; Satoshi font, warm neutrals.
- [Role boundaries — gadmin vs padmin vs user](project_role_boundaries.md) — gadmin=tech/support, padmin=product owner, user=consumer; portfolio model = padmin-only.
- [BlockingReleaseGate — gadmin page gating pattern](project_blocking_release_gate.md) — Wrap gadmin pages; padmin pages must NOT import it.
- [Dev launcher uses `go run`](project_dev_launcher_runtime.md) — Backend runs from `go run`; check /healthz commit vs HEAD, not file mtimes.
- [Launcher backend stale-binary trap](project_launcher_stale_binary.md) — `/tmp/vector-backend` updates on disk but launcher serves OLD code; SIGKILL to force respawn.
- [`artefactitemsv2` → `artefactitems` rename DONE 2026-05-14](project_artefactitems_rename.md) — Lesson preserved: version suffixes are intentional but temporary; drop them when the older surface no longer casts a shadow.
- [MMFF Vector Launcher — backlog](project_launcher_backlog.md) — Swift macOS launcher (tunnel + backend + frontend + DB env) backlog & build plan.
- [DB migrations — file-based ordered SQL only](project_db_migrations.md) — `db/<dbname>/schema/NNN_*.sql` per DB; runner `backend/cmd/migrate`.
- [Pre-launch security checklist](project_pre_launch_security.md) — Scrub git history, harden ssh_manager.sh, rotate secrets; deadline: before any external repo access.
- [Open-source-first stack, no subscription costs](project_open_source_first.md) — Hobby-funded; prefer MIT/BSD OSS → self-hosted → build → paid SaaS last resort.
- [PageBuilder architecture](project_pagebuilder_architecture.md) — Hierarchical container model (Section→Row→Column→Widget), phases 0–6, 100 stories.
- [Samantha SDK — internal app API name](project_samantha_sdk.md) — Custom app SDK named "Samantha"; root namespace `samantha.portfolio.*`.
- [Portfolio layers are tenant-built & independent (max 10)](project_portfolio_layers_independent.md) — Each `portfolio_item_types` row = one layer with own flow; depth 2–10.
- [Archive map flyout — live breadcrumb rows](project_archive_map_breadcrumbs.md) — `ArchiveMapFlyout` renders muted "live" intermediates; new callers MUST pass `liveAncestorsMap`.
- [Flow-state construction across <Table> artefacts](project_flow_state_construction.md) — PLA-0015→PLA-0017 pickup record: hyphen fix in Table.tsx → spec-flag model.
- [Flow-state seed model — kinds + is_pullable](project_flow_state_seed_model.md) — 6-kind primitive (backlog/todo/in_progress/done/accepted/cancelled) + is_pullable flag; seed names align with kinds; po_ready deferred (FLOW1.4.1).
- [Work-items interaction perf — 2s sort block](project_workitems_perf.md) — Client-side sort hypothesis; fix = server-driven via ?sort=&dir=; observed 2026-05-06.
- [Scan dev/plans/ descending for highest PLA-NNNN](feedback_scan_plans_descending.md) — Use `ls -r dev/plans/ | grep PLA | head -1` to find highest plan ID; ascending list buries it at the tail.
- [Table names use domain prefix for transparency](feedback_table_naming_prefixes.md) — New tables MUST carry their substrate prefix (e.g. `artefact_*`); generic names like `field_library` or `workspace_fields` are rejected.
- [Sanitise legacy DB gradually, drop as unused](feedback_gradual_db_sanitisation.md) — Never big-bang DB cutovers; drop legacy tables/columns one at a time as their last reader is migrated.
- [Bracket-tag commits with scope ref](feedback_scope_commit_bracket_ref.md) — Always include `[B19.1.4]` in commit subject; otherwise scope-commit-note hook can't match → Unmatched (no growthbar tick).
- [Helper icon — always wire through `<Panel>`](feedback_helper_icon.md) — Never render inline TbHelpHexagon + popover; wrap host block in `<Panel name="..." title="...">` so help ties into Page Help admin via the addressable substrate.
- [Shared cross-runtime methods home (PLA-0045)](feedback_shared_methods_home.md) — `app/lib/shared/<domain>/` (TS) + `backend/internal/shared/<domain>/` (Go) + `dev/fixtures/shared/<domain>/` parity fixtures; catalogue in `docs/c_shared_methods.md`.
- [Dev Setup page — route + source](reference_dev_page.md) — Route `/dev` → `app/(user)/dev/page.tsx` re-exports `dev/pages/DevPage.tsx`; rail cog icon links here.
- [Tracker <rg> API key (Vector-clamped)](project_tracker_rg_api_key.md) — `trk_d6fd154a…` plaintext for rg-runner POSTs to Tracker; project_id auto-resolves from key.
- [Workspace scope is invisible to the user](project_workspace_scope_invisible.md) — Backend-only mechanism: no URL params, no pickers, no UUIDs in client code; UI labels + permissions are the only legitimate signals.
- [URL is path-only — no query state of any kind](feedback_url_is_path_only.md) — Generalises workspace rule: no `?type=`, `?status=`, `?sort=`, `?vid=`, nothing. Filters/sort live in React state or backend prefs.
- [System layers vs display layers — never cross](feedback_system_vs_display_layers.md) — UUIDs/slots/URLs are project-locked + invisible; catalogue names/labels are tenant-free + visible. No display string is ever an identifier; no system identifier is ever user-facing.
- [Solo-dev mode (since 2026-05-17)](feedback_solo_dev_mode.md) — WIP cap 5, stories=title+AC, no new PLAs, indexes frozen, retros auto-only; hard rails unchanged; flips to prod-ready when first external user or launch date is set.
- [No new PLA plans in solo-dev mode](feedback_no_new_pla_plans.md) — New work = sub-item in Vector_Scope.md; 53 existing PLA files preserved as archaeology; c_plan_index.md frozen at PLA-0055.
- [Retros auto-only in solo-dev mode](feedback_retros_auto_only.md) — Loop-detector auto-retro stays as safety rail; manual <r> warns + offers lessons.md one-liner.

### Rules

1. When you learn something worth remembering, write it to the right file immediately.
2. Keep MEMORY.md as a current index with one-line descriptions. Do not break this rule!
3. Read MEMORY.md at session start. Load other files only when relevant.
4. If a file doesn't exist yet, create it.
5. **Project memory dir is canonical:** `.claude/memory/` inside this repo. Mirrored to `~/.claude/projects/.../memory/` so Claude Code's auto-load picks it up. Always write to project; sync to global as a follow-up.
6. **Boot files are not indexed.** Boot snapshots (`boot1.md`, `boot2.md`, …, `bootA.md`) live in this directory but DO NOT get MEMORY.md entries — they are one-shot session-launch artefacts read via the `<b> -N -R` skill. See [`.claude/commands/c_boot.md`](../commands/c_boot.md).
