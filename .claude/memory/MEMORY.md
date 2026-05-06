- [User background and expertise](user_background.md) — UX/Art History degree, 20+ years Agile Coach & transformation lead; no formal engineering training.
- [Read source when stuck or flying blind](feedback_read_source_when_stuck.md) — If a fix doesn't work, STOP and read 100–200 lines of source before grepping/curling/blaming cache; source is truth.
- [Never create debt — fix now, flag if detected](feedback_no_debt.md) — Overrides cap-and-defer; introduce no new debt, surface detected debt immediately.
- [Card lifecycle — move states on every task](feedback_card_lifecycle.md) — Backlog→To Do→Doing→Completed on every task, including quick fixes; no code before card is in Doing.
- [Stories all layers before starting](feedback_stories_all_layers.md) — Decompose across backend, frontend, migration, tests before /stories; never one layer at a time.
- [Stories acceptance system — 7 gates, Fibonacci, risk](feedback_stories_system.md) — Hard gates: AIGEN+phase+feature+EST+RISK+description; F21+ auto-splits; 85%/90% confidence thresholds.
- [All stories MUST go through /stories shortcut](feedback_stories_shortcut_mandatory.md) — No exceptions, no direct Planka writes; every story routes through the 7-gate skill.
- [Planka PATCH listId requires position field](feedback_planka_listid_patch.md) — PATCH /api/cards/:id silently ignores listId change if position omitted.
- [Accounts pointer in CLAUDE.md — entry is live](feedback_claudemd_accounts.md) — `<accounts>` pointer in .claude/CLAUDE.md → commands/c_accounts.md.
- [Never change passwords (HARD RULE)](feedback_never_change_passwords.md) — Never touch password_hash/email/role/is_active on gadmin@/padmin@/cookra@/user@; ask Rick or use claude@ test account.
- [Backend pinned to dev (HARD RULE)](feedback_dev_only.md) — Env permanently dev; staging/prod refusing stubs; revert any non-dev marker silently.
- [Always recommend the safest, best approach](feedback_safety_first.md) — Lead with ranked safest-first recommendation; never neutral A/B/C menus.
- [Push migrations + commits often, don't stack](feedback_push_often.md) — Push migrations as they land; backfill `schema_migrations` immediately if applied via raw psql.
- [Research-paper writer = Sonnet, investigators = Opus](feedback_research_paper_writer_model.md) — `<addpaper>` / `/research --page` writer agent on Sonnet; scan/audit agents on Opus.
- [API reference docs must stay in sync](feedback_api_docs_sync.md) — Update api-reference/ + redeploy after any handler/route file change.
- [Sidebar toolbar icon alignment](feedback_sidebar_toolbar.md) — Toggle + pencil left margin = 22px (user confirmed).
- [Pages default to full screen](feedback_pages_fullscreen.md) — All new pages full screen by default; no max-width unless specified.
- [No browser alert/confirm/prompt — in-page UI only](feedback_no_browser_alerts.md) — Never window.alert/confirm/prompt; pick form by context.
- [Button and interactive element CSS enforcement](feedback_button_classes.md) — Every button needs .btn + variant; custom elements use --accent/--accent-ink not --brand.
- [Canonical table HTML structure](feedback_table_structure.md) — thead/tbody/table__head/table__row/table__cell always.
- [Verify backend env after every start](feedback_verify_backend_env_after_start.md) — Curl /api/env after backend start; auth failures = wrong DB before wrong password.
- [Never wipe uncommitted](feedback_never_wipe_uncommitted.md) — Do not run destructive git clean; always preserve local work.
- [CSS — canonical .btn rule](css_buttons.md) — Every <button> MUST use .btn + variant; bespoke selectors override only positioning/colour, never restate baseline.
- [CSS — tables use tree_accordion-dense__scroll](css_tables.md) — `.table*` family deprecated 2026-05-05; touched files migrate as part of the change.
- [Test account — claude@mmffdev.com](test_account_claude.md) — `claude@mmffdev.com` / `password`, role=user, fixture subscription `00000000-...-0001`.
- [Test accounts — claude_N_test@mmffdev.com tier](test_accounts_claude_tier.md) — `claude_1_test` (user), `claude_2_test` (padmin), `claude_3_test` (gadmin), all `password123!`.
- [Dev app login credentials](reference_dev_app_login.md) — padmin/user/gadmin @mmffdev.com / TestPass1! on dev env (browser & Playwright).
- [Vector Design System](reference_design_system.md) — `/MMFFDev - Vector Assets/Vector Design System/`; skill `/vector-design`; Inter font, warm neutrals.
- [Planka API reference](planka_api_access.md) — Authoritative: .claude/bin/planka helper, board/list IDs, REST endpoints; planka-mcp uninstalled.
- [Role boundaries — gadmin vs padmin vs user](project_role_boundaries.md) — gadmin=tech/support, padmin=product owner, user=consumer; portfolio model = padmin-only.
- [BlockingReleaseGate — gadmin page gating pattern](project_blocking_release_gate.md) — Wrap gadmin pages; padmin pages must NOT import it.
- [Dev launcher uses `go run`](project_dev_launcher_runtime.md) — Backend runs from `go run`; check /healthz commit vs HEAD, not file mtimes.
- [Launcher backend stale-binary trap](project_launcher_stale_binary.md) — `/tmp/vector-backend` updates on disk but launcher serves OLD code; SIGKILL to force respawn.
- [MMFF Vector Launcher — backlog](project_launcher_backlog.md) — Swift macOS launcher (tunnel + backend + frontend + DB env) backlog & build plan.
- [DB migrations — file-based ordered SQL only](project_db_migrations.md) — `db/schema/NNN_*.sql` (vector) and `db/library_schema/NNN_*.sql` (library); runner `backend/cmd/migrate`.
- [Pre-launch security checklist](project_pre_launch_security.md) — Scrub git history, harden ssh_manager.sh, rotate secrets; deadline: before any external repo access.
- [Open-source-first stack, no subscription costs](project_open_source_first.md) — Hobby-funded; prefer MIT/BSD OSS → self-hosted → build → paid SaaS last resort.
- [PageBuilder architecture](project_pagebuilder_architecture.md) — Hierarchical container model (Section→Row→Column→Widget), phases 0–6, 100 stories.
- [Samantha SDK — internal app API name](project_samantha_sdk.md) — Custom app SDK named "Samantha"; root namespace `samantha.portfolio.*`.
- [Portfolio layers are tenant-built & independent (max 10)](project_portfolio_layers_independent.md) — Each `portfolio_item_types` row = one layer with own flow; depth 2–10.
- [Archive map flyout — live breadcrumb rows](project_archive_map_breadcrumbs.md) — `ArchiveMapFlyout` renders muted "live" intermediates; new callers MUST pass `liveAncestorsMap`.
- [Flow-state construction across <Table> artefacts](project_flow_state_construction.md) — PLA-0015→PLA-0017 pickup record: hyphen fix in Table.tsx → spec-flag model.
- [PLA-0019 — Samantha external API surface (active, Backlog)](project_pla0019_samantha.md) — 5 stories 00440–00444 awaiting "go"; Planka label `1768714873165841589`; exec order 00441→00442→00440→00443→00444.
- [Work-items interaction perf — 2s sort block](project_workitems_perf.md) — Client-side sort hypothesis; fix = server-driven via ?sort=&dir=; observed 2026-05-06.
- [Session restore — 2026-05-06 instance 1](boot1.md) — PLA-0019 Samantha API research + stories (00440–00444 Backlog); work-items 2s perf flagged; branch `main`, story counter `00444`.
- [Session restore — 2026-04-27 instance 2](boot2.md) — Boot file reorganisation + DevSetup inline confirmation snapshot.
- [Session restore — 2026-05-05 instance 3](boot3.md) — Qdrant research / vector DB exploration snapshot.
- [Session restore — 2026-04-27 instance 4](boot4.md) — Rebrand + tooling session snapshot.

### Rules

1. When you learn something worth remembering, write it to the right file immediately.
2. Keep MEMORY.md as a current index with one-line descriptions. Do not break this rule!
3. Read MEMORY.md at session start. Load other files only when relevant.
4. If a file doesn't exist yet, create it.
5. **Project memory dir is canonical:** `.claude/memory/` inside this repo. Mirrored to `~/.claude/projects/.../memory/` so Claude Code's auto-load picks it up. Always write to project; sync to global as a follow-up.
