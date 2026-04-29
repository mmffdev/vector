- [User background and expertise](user_background.md) — UX/Art History degree, 20+ years Agile Coach & transformation lead; no formal engineering training
- [Read source when stuck or flying blind](feedback_read_source_when_stuck.md) — If a fix doesn't work, STOP and read 100–200 lines of source around the affected area before grepping, curling, or blaming cache. Source is truth.
- [Never create debt — fix now, flag if detected](feedback_no_debt.md) — Overrides standing register's cap-and-defer; introduce no new debt, surface detected debt immediately.
- [Card lifecycle — move states on every task](feedback_card_lifecycle.md) — Backlog→To Do→Doing→Completed on every task, including quick fixes. No code before card is in Doing.
- [Storify all layers before starting](feedback_storify_all_layers.md) — Decompose across backend, frontend, migration, tests before /storify; never storify only one layer of a feature.
- [Story acceptance system — 7 gates, Fibonacci, risk](feedback_story_system.md) — Hard gates for every card: AIGEN+phase+feature+EST+RISK+description; F21+ auto-splits; 85%/90% confidence thresholds.
- [Planka PATCH listId requires position field](feedback_planka_listid_patch.md) — PATCH /api/cards/:id silently ignores listId change if position is omitted — always include both.
- [Accounts pointer in CLAUDE.md — entry is live](feedback_claudemd_accounts.md) — <accounts> pointer exists in .claude/CLAUDE.md pointing to commands/c_accounts.md; no further action needed.
- [Role boundaries — gadmin vs padmin vs user](project_role_boundaries.md) — gadmin=tech/support, padmin=product owner, user=consumer. Portfolio model = padmin-only. Ask "product or system?" before gating.
- [BlockingReleaseGate — gadmin page gating pattern](project_blocking_release_gate.md) — Wrap gadmin pages with BlockingReleaseGate; padmin pages must NOT import it.
- [Dev launcher uses `go run`](project_dev_launcher_runtime.md) — Backend runs from `go run`, not `./backend/server`; check /healthz commit vs HEAD, not file mtimes.
- [Planka API reference](planka_api_access.md) — Authoritative: .claude/bin/planka helper, board/list IDs, REST endpoints, label gotchas. planka-mcp fully uninstalled.
- [Pre-launch security checklist](project_pre_launch_security.md) — Scrub git history (.env.local committed with MASTER_KEY), harden ssh_manager.sh, rotate secrets. Hard deadline: before any external repo access.
- [API reference docs must stay in sync](feedback_api_docs_sync.md) — Update api-reference/ + redeploy after any handler/route file change; Stop hook fires as a safety net.
- [Vector Design System](reference_design_system.md) — `/MMFFDev - Vector Assets/Vector Design System/`; skill `/vector-design`; Inter font, warm neutrals, no decorative color — future state vs current app's Zen Maru Gothic.
- [Sidebar toolbar icon alignment](feedback_sidebar_toolbar.md) — toggle + pencil left margin = 22px (user confirmed "perfect")
- [Samantha SDK — internal app API name](project_samantha_sdk.md) — Custom app SDK named "Samantha" (after Rick's wife); root namespace `samantha.portfolio.*`.
- [Pages default to full screen](feedback_pages_fullscreen.md) — All new pages are full screen by default; no max-width unless user specifies otherwise.
- [No browser alert/confirm/prompt — in-page UI only](feedback_no_browser_alerts.md) — Never window.alert/confirm/prompt; pick form by context (banner, inline tick/cross, accept/confirm, type-to-confirm).
- [Session restore — 2026-04-27 instance 1](boot1.md) — current working state snapshot.
- [Session restore — 2026-04-27 instance 2](boot2.md) — boot file reorganisation + DevSetup inline confirmation.
- [Session restore — 2026-04-27 instance 3](boot3.md) — Samantha SDK + terminology investigation.
- [Session restore — 2026-04-27 instance 4](boot4.md) — rebrand + tooling session.
- [MMFF Vector Launcher — backlog](project_launcher_backlog.md) — Swift macOS launcher (tunnel + backend + frontend + DB env) backlog & build plan.

- [Jira Cloud — mmffdev connection](reference_jira.md) — mmffdev.atlassian.net, services@mmffdev.com, API token, projects, hierarchy. Transitioning from Planka.
- [Button and interactive element CSS enforcement](feedback_button_classes.md) — Every button needs .btn + variant; custom elements use --accent/--accent-ink not --brand
- [Open-source-first stack, no subscription costs](project_open_source_first.md) — Hobby-funded, unlimited timeline. Prefer MIT/BSD OSS → self-hosted → build our own → paid SaaS last resort.

### Rules

1. When you learn something worth remembering, write it to the right file immediately. 
2. Keep MEMORY.md as a current index with one-line descriptions. Do not break this rule! 
3. Read MEMORY.md at session start. Load other files only when relevant. 
4. If a file doesn't exist yet, create it. 