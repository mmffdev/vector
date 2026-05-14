- [User background and expertise](user_background.md) — UX/Art History degree, 20+ years Agile Coach & transformation lead; no formal engineering training.
- [Read source when stuck or flying blind](feedback_read_source_when_stuck.md) — If a fix doesn't work, STOP and read 100–200 lines of source before grepping/curling/blaming cache; source is truth.
- [Empirical blast-radius before any change](feedback_empirical_blast_radius.md) — Never rely on a prior agent's summary; read the actual workflow/script/snapshot files yourself before recommending or making cross-cutting changes.
- [Deferrals always go in the tech-debt register](feedback_deferrals_register.md) — When I defer work ("hold until", "out of scope", "needs its own plan", "follow-up"), file it in docs/c_tech_debt.md with severity + trigger BEFORE the commit that creates the deferral. Spoken deferrals decay; register entries persist.
- [Never create debt — fix now, flag if detected](feedback_no_debt.md) — Overrides cap-and-defer; introduce no new debt, surface detected debt immediately.
- [No hardcoded order/list from DB data](feedback_no_hardcoded_order_from_db_data.md) — Never invent an order/mapping in TSX or Go when the data is DB-driven; if the column doesn't carry the signal, STOP and surface the gap — don't paper over with a hardcoded list.
- [Card lifecycle — move states on every task](feedback_card_lifecycle.md) — Backlog→To Do→Doing→Completed on every task, including quick fixes; no code before card is in Doing.
- [Stories all layers before starting](feedback_stories_all_layers.md) — Decompose across backend, frontend, migration, tests before /stories; never one layer at a time.
- [Stories acceptance system — 7 gates, Fibonacci, risk](feedback_stories_system.md) — Hard gates: AIGEN+phase+feature+EST+RISK+description; F21+ auto-splits; 85%/90% confidence thresholds.
- [All stories MUST go through /stories shortcut](feedback_stories_shortcut_mandatory.md) — No exceptions, no direct Planka writes; every story routes through the 7-gate skill.
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
- [CSS canonical — buttons, tables, inline styles, tokens](css_canonical.md) — `.btn` + variant on every button; `tree_accordion-dense__*` for every table; no inline `style={{}}`; `--accent`/`--accent-ink` for interactive state, never `--brand`.
- [CSS/HTML naming convention — hierarchical semantic pattern](css_naming_convention.md) — `root__Container_Child_leaf`; `__` once at root boundary, `_` for deeper nesting, `-` for modifiers only; propose full TSX+CSS chain before writing any class name.
- [Test accounts — Claude-owned + human-owned](test_accounts.md) — All test logins (claude@, claude_N_test@, gadmin/padmin/user@) consolidated; HARD RULE on human accounts.
- [Vector Design System](reference_design_system.md) — `/MMFFDev - Vector Assets/Vector Design System/`; skill `/vector-design`; Inter font, warm neutrals.
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

### Rules

1. When you learn something worth remembering, write it to the right file immediately.
2. Keep MEMORY.md as a current index with one-line descriptions. Do not break this rule!
3. Read MEMORY.md at session start. Load other files only when relevant.
4. If a file doesn't exist yet, create it.
5. **Project memory dir is canonical:** `.claude/memory/` inside this repo. Mirrored to `~/.claude/projects/.../memory/` so Claude Code's auto-load picks it up. Always write to project; sync to global as a follow-up.
6. **Boot files are not indexed.** Boot snapshots (`boot1.md`, `boot2.md`, …, `bootA.md`) live in this directory but DO NOT get MEMORY.md entries — they are one-shot session-launch artefacts read via the `<b> -N -R` skill. See [`.claude/commands/c_boot.md`](../commands/c_boot.md).
