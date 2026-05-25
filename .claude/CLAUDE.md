# CLAUDE.md

**HARD RULE — NO EXCEPTIONS — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify the password (or any credential field — `password_hash`, `email`, `is_active`, `role`, `password_changed_at`) of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, or `user@mmffdev.com`. These are human accounts. The user reset them to `password` on 2026-05-02; that is their state and Claude does not change it. If a login fails, ask — do not "fix" by overwriting the row. If gadmin/padmin/user-level testing is needed, create a NEW account (e.g. `claude-gadmin@mmffdev.com`) — never reuse the human ones. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS:** Never run any git command that can destroy or overwrite work (`reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, etc.) without explicitly confirming with the user first. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — LOOP DETECTED:** When you receive a system-reminder that begins with `LOOP DETECTED`, the loop-detector hook ([`.claude/hooks/loop-detector.sh`](hooks/loop-detector.sh)) has fired five consecutive signals indicating you are stuck. You MUST invoke `<report> -retro --auto-loop` (the retrospective flag of the `<report>` skill — folded in from the retired `<r>`/`<retro>` skills on 2026-05-21) before any further tool use except `Read`. Do not "just try one more thing" — that is the trap the detector caught. Run the retro now, file the finding, then resume.

**HARD RULE — NO EXCEPTIONS — NEVER ASSUME A DATABASE:** Before any `psql` query, schema lookup, or "the table probably lives in X" claim, Claude MUST trace the backend wiring: (1) find the handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify the pool variable (`pool` / `vaPool` / `libPools`), (3) cross-check against [`docs/c_c_db_routing.md`](../docs/c_c_db_routing.md) which maps every service → pool → database → tables. Only then open psql with the correct `-d <dbname>` flag. Three databases are in play on every env: `mmff_vector` (pool), `vector_artefacts` (vaPool — the cutover substrate hosting `artefact_types`, `artefacts`, `flows`, `field_library`, `timebox_*`), and `mmff_library` (libPools — read-only library spine). Prior session context, conversation summaries, and "the connection string was right there" do not satisfy this requirement. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — BACKEND ENV IS PINNED TO `dev`:** The active backend env is permanently `dev`. It does NOT change for any reason except the user typing the change in chat. Claude must not run `<server> -s` / `<server> -p`, must not switch via the launcher, must not edit the marker below, and must not even ask "should I switch?" — staging and production are out-of-band entirely. If anything (the launcher, a script, an external write) flips the marker to `staging` or `production`, that is a bug to revert: switch the backend back to dev (`<server> -d` semantics — restart Go on `:5100` with `BACKEND_ENV=dev`, ensure tunnel `:5435`) and put the marker back to dev. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — SERVER IS THE GATE:** Any visibility / role / scope / permission filter writes the SERVER-SIDE check FIRST. Client-side is defence-in-depth, never the authoritative gate. The wire payload returned to a caller must not contain data the caller isn't cleared for — hiding it in the client is the wrong answer for a Trust-No-One, SOC 2, defence/finance product. When the user asks "is this locked by the backend?" the answer must be "yes" with proof (the handler that drops the data + the test that pins the contract per role). If a change looks like UX but acts as security (rail filter, page hide, "admin-only" anything), STOP — identify the threat, write the backend filter first, then the client filter as redundancy. Origin: 2026-05-19 nav-rail admin-tier lapse — see [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) `TD-NAV-AUTH-TIER`. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — INSPECT INDEX BEFORE EVERY COMMIT:** Before any `git commit`, Claude MUST run `git diff --cached --stat` and read the output IN FULL. Explicit-path `git add` is additive over already-staged entries — renames from a prior `git mv`, files staged by hooks, files staged by an earlier add all survive. If the staged file list contains ANYTHING beyond what this commit is meant to ship, unstage the unrelated entries with `git reset HEAD <path>` BEFORE committing. Origin: 2026-05-21 — two separate commits accidentally bundled in the user's in-flight rename ops (`(user)` → `user` route restructure) under unrelated docs / test-fix subject lines because the renames were pre-staged via `git mv` and survived explicit-path `git add` calls. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — NO HACKS DISGUISED AS FIXES:** A hack is any change that makes the symptom disappear without fixing why the symptom appeared. Examples: bumping a constant to clear a tripwire (cap, timeout, retry count); silently dropping/truncating user data to satisfy a server invariant; catching an error and swallowing it; expanding a validation cap because the seed exceeded it; "trim to fit" anywhere. When the symptom is "X exceeds Y," the answer is to fix why X grew (or whether Y is the right gate at all) — NOT to grow Y. If a hack is genuinely the right call (rare, e.g. user explicitly chose speed over correctness with full understanding of the trade), Claude MUST (1) say "this is a hack, not a fix" in chat BEFORE shipping it, (2) flag it in the commit message subject, (3) open a `TD-*` entry in [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) naming the proper fix and a trigger condition for paying it down. Origin: 2026-05-25 — two-day block on the account-settings homepage dropdown where Claude bumped `MaxPinned` from 50 → 100 to clear `ErrTooManyPinned` instead of fixing why the seed produced an over-cap state; documented the bump as "comfortable headroom" instead of admitting it just moved the tripwire. The cost was paid by the user, who lost bookmarks to a TRUNCATE invoked as part of the same wrong-diagnosis cascade. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — DIAGNOSE WITH DB AND CODE, NOT THE USER:** Before asking the user to reload, paste logs, paste network requests, or run anything in their browser, Claude MUST exhaust direct diagnosis first: (1) query the live DB via `curl` against the backend with the dev API key from `backend/.env.dev` OR via the `pg-mcp.sh` wrapper, (2) grep the relevant Go/TS code for the constant or error class, (3) read the handler/validator end-to-end. The user is not a debugger. If three tool calls would answer the question, make those three tool calls. "Could you check the network tab" is a last resort, not a first step, and never a substitute for reading the source. When direct diagnosis IS impossible (the user's session state is unobservable from outside, e.g. a localStorage cache problem), Claude must SAY that explicitly and explain why before asking. Origin: 2026-05-25 — same homepage-dropdown bug, where Claude asked the user to reload + paste console logs five separate times when one `curl /_site/nav/prefs` + one `grep MaxPinned service.go` would have found the bug (seed = 51, cap = 50) in under 30 seconds. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — THIS IS A LIVE BUSINESS, NOT A CODING EXERCISE:** Vector is the user's business. "No release date" does NOT mean "no consequences" — every shortcut becomes tech debt the owner pays for, alone, possibly months later in a fresh session with no memory of the conversation that created it. "Works for now" is not done. Done is: (1) the failure mode is closed at the source, (2) the fix matches the threat model (defence/finance bar — `context/USER.md`), (3) the next reader of the code would not have to wonder why something is the way it is, (4) any deferred work is explicitly written into [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) with a trigger and payment plan. Optimising for "close the current loop" instead of "leave the codebase in a state the owner can build on" is the disease this rule treats. Origin: 2026-05-25 — Claude turned a 5-minute config decision into a two-day block, lost the user's bookmarks via a destructive TRUNCATE, and shipped a constant-bump masquerading as a fix; the user named the pattern ("kicking it downstream is disgusting") and this rule is what survives that. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — SENTINEL IS THE SOLE IDENTITY/TENANT/SCOPE OWNER:** `app/sentinel/` is the only place that owns who-the-user-is, which-tenant, and which-topology-node on the frontend. On the backend, `backend/internal/sentinel/` is the only place that resolves the clamp. The legacy `app/contexts/{Scope,Tenant}Context.tsx` + `Sentinel.tsx` bridge + `scopeReloadRegistry.ts` are DELETED (PLA062 S22, commit `d14bcc70`); reintroducing any of them is forbidden. New frontend code MUST read identity/scope via `useSentinel()` — never `useAuth().user.workspace_id` or any direct context-bypass. New backend handlers that touch `artefact_*` tables MUST call `sentinel.FromCtx(ctx)` / `sentinel.WorkspaceIDFromCtx(ctx)` — enforced by `backend/internal/lintchecks/sentinel_clamp_test.go` (PLA062 S20, commit `40a6b565`). The frontend ratchets `lint:no-direct-workspace-id` + `lint:no-old-context-imports` (PLA062 S19, commit `55af5214`) catch regressions in CI. AuthContext.tsx remains ONLY for the credential flow (login/logout/refresh/DPoP keypair lifecycle) — its 9 remaining consumers are listed in `dev/registries/no_old_context_imports_exempt.json` and pinned by TD-SENT-AUTH-EXTRACT in `docs/Security/Sentinel/sentinel_tech_debt.md`; any NEW import from AuthContext outside that exempt list is a lint failure. Procurement narrative for SOC 2 / defence / finance: see [`docs/Security/Sentinel/sentinel_docs.md`](../docs/Security/Sentinel/sentinel_docs.md). This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — SY003 IS THE SUBSTRATE SOURCE OF TRUTH:** SY003 (lives in `mmff_dev.dev_reports`, `type=system`) is the master inventory for all three Vector databases (`mmff_vector`, `vector_artefacts`, `mmff_library`). It carries: every table with live row count + USED / PLACEHOLDER / DEAD / UNCERTAIN flag + one-line purpose; every cross-DB soft FK (8 currently, all app-enforced because Postgres can't FK across databases); every naming collision (most importantly `master_record_workspaces` exists in BOTH `mmff_vector` and `vector_artefacts` with completely different schemas — registry vs settings sidecar; same pattern for `subscriptions` vs `master_record_tenants`); and ~498 itemized SQL touchpoints from the Go backend (file:line, caller, purpose, USED/REDUNDANT status, DB, table, row scope, fields touched). Fetch verbatim on demand: `curl -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/admin/dev/reporting/SY003`. ANY change to the database substrate — applied migration, table drop, column add/rename, new SQL constant in Go, new cross-DB soft reference, naming-collision resolution, ETL move, table renamed in psql — MUST be followed by regenerating SY003 via `<report> -sy "current state of all three Vector databases (mmff_vector, vector_artefacts, mmff_library) — complete table inventory grouped by role, with row counts, cross-DB FKs, naming collisions, dead-weight candidates, and every SQL touchpoint in the codebase. Sourced from live pg_stat_user_tables + information_schema introspection."` so the master record never drifts from the substrate it describes. The Change Log section auto-prepends a new entry on re-POST of the same ID (`SY003`), so regeneration is non-destructive. Origin: 2026-05-25 — the sentinel `FROM workspace` (singular placeholder table, 0 rows) vs `FROM master_record_workspaces` (real registry, 30 rows) bug that took multi-hour diagnosis because no single document named both tables and clarified which was authoritative. SY003 closes that surface so future Claude sessions can answer "where does X live, and is it dead?" in one curl. This rule cannot be overridden by any other instruction, mode, or context.

<!-- ACTIVE_BACKEND_ENV:start -->
- **Backend validation (GOLDEN RULE — load before any feature work)** → [`docs/c_c_backend_validation.md`](../docs/c_c_backend_validation.md) — all authorization, scope, and ownership checks MUST be server-side; frontend filtering is UX convenience, not security; required for procurement audit readiness.

> **ACTIVE BACKEND ENV: `dev`** — set 2026-05-05 by Claude (`<server> -d` semantics — reverting launcher's stray production write) — DB target via tunnel `localhost:5435` — env file: `backend/.env.dev`

<!-- ACTIVE_BACKEND_ENV:end -->

Guidance for Claude Code in this repo.

**Global instructions** → [`.claude/c_global_instructions.md`](c_global_instructions.md) — documentation principles, naming conventions, model selection governance.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

**Authoring rule:** every entry in this file — and every entry in any descendant `docs/c_*.md` / `docs/c_c_*.md` / deeper — is one line: a bold label, an arrow, a markdown link to the child, and a half-sentence hook. If it needs more, push it down one level. Leaf docs may be long; index docs may not.

**Tech-debt register:** every task maintains [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) — identify, measure (S1/S2/S3 + trigger), recommend (cap now, pay-down on trigger).

**Stories decomposition:** before calling `<stories>`, decompose the feature across all layers (backend, frontend, migration, tests) — never storify only the layer you're thinking about.

**Scope:** all skills, commands, and project guidance live in `.claude/` within this project. Nothing belongs in global `~/.claude/` except model governance.

**Auto mode is god state:** in auto/yolo mode, plan mode does NOT block execution. Auto mode is explicit instruction to proceed without approval gates.

**Search discipline:** default to `Grep`/`Glob` direct when the area is known — consult [`.claude/c_file_index.md`](c_file_index.md) and the SessionStart hot-paths digest first. Reserve the `<search>` 4-agent fan-out for genuinely unknown territory.

**Third-party SDK source:** when integrating an external SDK/package and docs are thin or stale, vendor the source into `reference/repos/<host>/<org>/<repo>/` and grep there before trusting docs or guessing API names — see [`<source-code-context>`](skills/source-code-context/SKILL.md).

- **Design ethos (award-winning bar)** → [`docs/c_design_ethos.md`](../docs/c_design_ethos.md) — ultra-modern, experimental UI/UX; wow with colour + craft; Awwwards SOTD is the target, not "clean SaaS"; visual quality is part of DoD, never a follow-up polish step.
- **Styling / CSS** → [`docs/css-guide.md`](../docs/css-guide.md) — catalog class first; no inline `style={{}}`.
- **CSS/HTML naming** → [`.claude/memory/css_naming_convention.md`](memory/css_naming_convention.md) — pattern `root-block__Container_Child_leaf` (`__` once at root, `_` for deeper, `-` for modifiers only; no BEM `--`, no generic names like `wrapper`/`container`/`box`). When introducing a NEW root-block, propose the full TSX+CSS chain and ask before applying. For edits to existing chains, apply directly.
- **Dev-UI primitives (`/dev` pages)** → [`docs/c_c_dev_ui_primitives.md`](../docs/c_c_dev_ui_primitives.md) — `.dui-*` catalog only on `/dev` pages and panels rendered by `dev/pages/DevPage.tsx`; no inline `style={{}}`; no `dev-*` selector in `app/globals.css`.
- **Accessibility (WCAG 2.2 AA)** → [`docs/c_accessibility.md`](../docs/c_accessibility.md) — target sizes, contrast, focus, modal traps; pre-launch checklist.
- **Code standards** → [`.claude/commands/c_code-standards.md`](commands/c_code-standards.md) — naming reference + state classes.
- **Naming conventions** → [`docs/c_c_naming_conventions.md`](../docs/c_c_naming_conventions.md) — canonical spec for packages/tables/routes/columns; deviation needs a `TD-*` entry.
- **Backlog (`<backlog>`)** → [`.claude/commands/c_backlog.md`](commands/c_backlog.md) — opens root [`BACKLOG.md`](../BACKLOG.md); Rick-owned module roadmap (VECTOR, ORIGO, SIGMA, FLUX, SPINE, OPERATOR PLATFORM).
- **Tracker tests (`<tests>`)** → [`.claude/commands/c_tests.md`](commands/c_tests.md) — query Tracker red-green tests for this project; default = current/recent work, flags `-g/-p/-G/-r/-f`.
- **DB routing** → [`docs/c_c_db_routing.md`](../docs/c_c_db_routing.md) — service → pool → DB → tables map (referenced by the "Never assume a database" hard rule above).
- **SQL cookbook** → [`docs/c_sql_cookbook.md`](../docs/c_sql_cookbook.md) — curated `psql` queries that worked; append non-trivial queries before moving on.
- **Bash cookbook** → [`docs/c_bash_cookbook.md`](../docs/c_bash_cookbook.md) — curated shell commands that worked; append non-trivial commands (non-obvious flag/path/env) before moving on.
- **`<cookbook>` skill** → [`.claude/commands/c_cookbook.md`](commands/c_cookbook.md) — safety-net harvester: scans `~/.psql_history` since last run, drafts novel queries to `c_sql_cookbook_staging.md` for curation. Inline cookbooking is still the primary discipline.
- **Database schema** → [`docs/c_schema.md`](../docs/c_schema.md) — table list, tenant isolation, soft-archive, invariants.
- **`<migration>` skill** → [`.claude/skills/migration/SKILL.md`](skills/migration/SKILL.md) — pick DB, next NNN, scaffold + dry-run + apply + verify `schema_migrations`; never assumes a DB.
- **`<artefacts>` skill** → [`.claude/skills/artefacts/SKILL.md`](skills/artefacts/SKILL.md) — tenant artefacts maintenance via backend API (`/_site/admin/dev/artefacts-{count,wipe}`); `-d` wipe-all with pre-flight count + explicit "yes" prompt; dev-only; never psql-direct.
- **`<audit>` skill** → [`.claude/skills/audit/SKILL.md`](skills/audit/SKILL.md) — repo-wide audits; `-api` regenerates `dev/audits/api-touchpoints.json` (/dev/api-audit); `-graph` regenerates `dev/audits/codegraph.json` (/dev/visualiser, unified TS+Go force-directed graph); read-only grep, ~2–5s.
- **Vector-artefacts cutover** → [`docs/c_c_vector_artefacts_backfill.md`](../docs/c_c_vector_artefacts_backfill.md) — `obj_*` → vector_artefacts ETL.
- **v2 work-items cutover follow-ups** → [`docs/c_c_v2_workitems_cutover_followups.md`](../docs/c_c_v2_workitems_cutover_followups.md) — PLA-0023 deferral register.
- **v1 → v2 API cutover register (PLA-0030)** → [`docs/c_c_v1_v2_cutover.md`](../docs/c_c_v1_v2_cutover.md) — per-route-group cutover plan.
- **Transport segregation (PLA-0039)** → [`docs/c_c_transport_segregation.md`](../docs/c_c_transport_segregation.md) — `/_site` + `/samantha/v2`; lint trio + DTO convention.
- **Shadow-backend exemptions** → [`docs/c_c_shadow_backend_exceptions.md`](../docs/c_c_shadow_backend_exceptions.md) — `app/api/dev/*` file-only handlers exempted from the siteAPI rule (no DB touch); SOC2 audit narrative.
- **Scalar IDE setup (B20.5.K + .L)** → [`docs/c_c_scalar_setup.md`](../docs/c_c_scalar_setup.md) — `DEV_API_KEY` in `backend/.env.dev` + `apikeys.SeedDevKey` boot path; `apikeys.Middleware` dual-mounted on `/_site` AND `/samantha/v2` (B20.5.L); synthetic-User shim seeds `auth.UserFromCtx()` from the subscription's highest-tier active user. Unlocks the full 268-endpoint surface.
- **Shared methods catalogue (PLA-0045)** → [`docs/c_shared_methods.md`](../docs/c_shared_methods.md) — `app/lib/shared/` + `backend/internal/shared/` parity.
- **Wizard sidecar pattern (PLA-0037)** → [`docs/c_c_wizard_sidecar.md`](../docs/c_c_wizard_sidecar.md) — `p_wizard_*.json` declarative `<ObjectTree>` config.
- **Polymorphic FK pattern** → [`docs/c_polymorphic_writes.md`](../docs/c_polymorphic_writes.md) — writer rules + cleanup registry + canary.
- **`polymorphicrefs` service** → [`docs/c_c_entityrefs_service.md`](../docs/c_c_entityrefs_service.md) — Go surface + sentinel errors (post RF1.4.1 rename).
- **Technical-debt register (standing rule)** → [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) — identify/measure/recommend on every task.
- **App Router layout** → [`docs/c_page-structure.md`](../docs/c_page-structure.md) — route groups, role gating, PageShell.
- **Security posture** → [`docs/c_security.md`](../docs/c_security.md) — Trust-No-One checklist.
- **Sentinel — single source of truth for identity/tenant/scope (PLA062)** → [`docs/Security/Sentinel/sentinel_docs.md`](../docs/Security/Sentinel/sentinel_docs.md) — system synopsis + RED-GREEN protocol; backlog + tests-log + tech-debt + revision-history in sibling files. While PLA062 is in flight, `app/contexts/Auth*`/`Scope*`/`Tenant*` are being collapsed into `app/sentinel/`; new code must use `useSentinel()` and `sentinel_*` fields (see § What replaces what).
- **Backend-driven validation** → [`docs/c_c_backend_validation.md`](../docs/c_c_backend_validation.md) — payload is untrusted; tenant/user/scope re-verified server-side. (Same content as the "Backend validation (GOLDEN RULE)" pointer above.)
- **Risk artefact type design (PLA-0052)** → [`docs/c_c_risk_artefact_type.md`](../docs/c_c_risk_artefact_type.md) — mirror-Defect playbook + coupling inventory + per-subscription seed gotcha.
- **Scope — features underway** → [`docs/c_scope.md`](../docs/c_scope.md) — live in-flight table.
- **Story ID index** → [`docs/c_story_index.md`](../docs/c_story_index.md) — global `NNNNN` counter + label spec.
- **Plan ID index** → [`docs/c_plan_index.md`](../docs/c_plan_index.md) — `PLA-NNNN` registry.
- **`<stories>` skill** → [`.claude/skills/stories/SKILL.md`](skills/stories/SKILL.md) — 7-gate acceptance + Fibonacci estimation.
- **Story acceptance gates** → [`docs/c_story_acceptance.md`](../docs/c_story_acceptance.md) — full gate spec + confidence thresholds.
- **Feature areas** → [`docs/c_feature_areas.md`](../docs/c_feature_areas.md) — `FE-AAA-NNNN` taxonomy.
- **Error codes (cross-cutting)** → [`docs/c_c_error_codes.md`](../docs/c_c_error_codes.md) — `errors_codes` library migration + decision tree (post RF1.4.2).
- **Generic ranking + realtime adoption** → [`docs/c_c_ranking.md`](../docs/c_c_ranking.md) — checklist for orderable resources.
- **Addressable elements (PLA-0005)** → [`docs/c_c_addressables.md`](../docs/c_c_addressables.md) — `samantha._viewport.<slot>._kind.name` + sole-writer + lint.
- **Topology — federated canvas (PLA-0006)** → [`docs/c_c_topology.md`](../docs/c_c_topology.md) — `topology_nodes` tree + `topology.Service` sole writer (post RF1.4.1).
- **Roles & permissions RBAC (PLA-0007)** → [`docs/c_c_roles_permissions.md`](../docs/c_c_roles_permissions.md) — `users_roles`/`users_permissions`/`users_roles_permissions` (post RF1.4.2); `useHasPermission` gates; lint trio.
- **Project lint rules (custom)** → [`docs/c_c_lint_rules.md`](../docs/c_c_lint_rules.md) — `lint:*` catalog + ledgers.
- **`<PageDescription>` primitive** → [`app/components/PageDescription.tsx`](../app/components/PageDescription.tsx) — required at top of every `app/(user)/` page; enforced by `lint:page-description`.
- **Section titles via `<Panel>` only** → [`docs/c_c_lint_rules.md`](../docs/c_c_lint_rules.md) — raw `<h2>` forbidden; enforced by `lint:h2-panel-only`.
- **Diagram canvas (`<DiagramCanvas>`)** → [`docs/c_c_diagram_canvas.md`](../docs/c_c_diagram_canvas.md) — Canvas2D + dagre + d3-zoom; `samantha.diagram.canvas` surface.
- **Secondary nav deep-linking (PLA-0018)** → [`docs/c_c_secondary_nav_deeplink.md`](../docs/c_c_secondary_nav_deeplink.md) — path-segment routing per tab.
- **Drag-and-drop (`@dnd-kit`)** → [`docs/c_c_dnd.md`](../docs/c_c_dnd.md) — canonical DnD library; 250ms debounce, server-of-truth.
- **`<Table>` component (PLA-0015)** → [`docs/c_c_table_component.md`](../docs/c_c_table_component.md) — single sanctioned table primitive; `lint:no-raw-table` enforced.
- **`<ResourceTree>` component (PLA-0021)** → [`docs/c_c_resource_tree.md`](../docs/c_c_resource_tree.md) — hierarchical-tree primitive + 5 prop sets.
- **`<Badge>` primitive** → [`docs/c_c_badge.md`](../docs/c_c_badge.md) — `.pill` family; semantic tones only.
- **`<TimeboxManager>` surface** → [`docs/c_c_timebox_manager.md`](../docs/c_c_timebox_manager.md) — `timeboxes_sprints` / `timeboxes_releases` registry (post RF1.4.2).
- **Memory (canonical)** → [`context/MEMORY.md`](../context/MEMORY.md) (~10 KB) + [`context/USER.md`](../context/USER.md) (~3 KB) — frozen-snapshot working memory loaded once per session (see § Session Startup); old [.claude/memory/](memory/) is retired but indexed by [`<index>`](skills/index/SKILL.md) for grep-only recall.
- **Scope tracker (`<scope> -r|-a|-u`)** → [`.claude/skills/scope/SKILL.md`](skills/scope/SKILL.md) — `Vector_Scope.md` single source of truth.
- **Pace report** → [`dev/scripts/pace.sh`](../dev/scripts/pace.sh) — commit-mix scoreboard + TD-register delta.
- **Infrastructure & ops** → [`docs/c_infra_index.md`](../docs/c_infra_index.md) — bash / postgres / ssh / deploy / hooks.
- **Swarm stack (dev)** → [`infra/swarm/README.md`](../infra/swarm/README.md) — `vector-dev` Docker Swarm stack file is source of truth for the dev Postgres tier; re-sync on any out-of-band `docker service update`.
- **Section-tag vocab** → [`docs/c_section-tags.md`](../docs/c_section-tags.md) — short product-slice tags.
- **URL routing — work items & custom pages** → [`docs/c_url-routing.md`](../docs/c_url-routing.md) — `/work-items/{id}` + `/p/{id}` + `?vid=` convention.
- **Theme rules** → [`docs/c_theme_rules.md`](../docs/c_theme_rules.md) — palette→role mapping for `<theme>` skill.
- **Samantha SDK — Fields** → [`docs/c_samantha_sdk_fields.md`](../docs/c_samantha_sdk_fields.md) — field rendering/schema/value surface.
- **Retro index** → [`docs/c_retro_index.md`](../docs/c_retro_index.md) — `RET###` / legacy `RETRO-NNN` counter; `<report> -retro` writes here.
- **Secrets audit** → [`docs/c_c_secrets_audit.md`](../docs/c_c_secrets_audit.md) — `os.Getenv` sensitive-key inventory.
- **`<makeskill>` skill** → [`.claude/skills/makeskill/SKILL.md`](skills/makeskill/SKILL.md) — meta-skill: turns a chat-statement brief + `-<name>[-<scope>]` flags into a new audit/report skill wired to the canonical R### → `dev/research/` pipeline.
- **`<report>` skill** → [`.claude/skills/report/SKILL.md`](skills/report/SKILL.md) — umbrella for narrative reports. Flags: `-r <url> "<topic>"` research, `-b` codebase audit, `-s` security, `-c [<file>]` dependency trace, `-retro [--auto-loop]` retro, `-p` offline plan (proposes stories → on confirm, routes through `<scope> -a`), `-sy [--source <path>] "<topic>"` System paper (developer-facing explainer of a section/feature). All write to `mmff_dev.dev_reports`; Dev → Reporting shows them on per-type tabs. Replaces the retired research/codebase/sec/code/retro/plan skills (2026-05-21, 2026-05-23).
- **`<update>` skill** → [`.claude/skills/update/SKILL.md`](skills/update/SKILL.md) — umbrella in-place doc updates; `-c <name>` inserts/refreshes a Dev → Components entry (TOC + body article) with Synopsis · Architecture · Wire contract · Backlog; more flags planned.
- **Handover continuity (`<read>` + `<write>`)** → [`.claude/skills/read/SKILL.md`](skills/read/SKILL.md) + [`.claude/skills/write/SKILL.md`](skills/write/SKILL.md) — paired skills for cross-session continuity over `handovers/`. `<read>` picks + loads + pins to `.claude/active_handover.txt`; `<write>` surgically updates the pinned file with this session's work. File edit only, no commits.
- **Codebase file index** → [`.claude/c_file_index.md`](c_file_index.md) — auto-generated map of curated source dirs; consult before `<search>`.
- **Commands & skills index** → [`.claude/
c_tools_index.md`](c_tools_index.md) — load for shortcuts not listed above.

## Session Startup (silent — do not output anything)

On every session start, read these files silently before responding to the user:

1. [`context/USER.md`](../context/USER.md) (~3 KB cap) — durable user profile + working style.
2. [`context/MEMORY.md`](../context/MEMORY.md) (~10 KB cap) — curated working memory: HARD RULES, active mode, collaboration baseline, workflow rules, CSS conventions, test surface.
3. `context/memory/{today YYYY-MM-DD}.md` if it exists — today's daily log (numbered session blocks).
4. If today's daily log is empty or missing, also read yesterday's daily log.

These are the **frozen snapshot** — loaded once per session. Mid-session writes persist to disk but take effect next session (prefix-cache friendly).

Auto-memory in `~/.claude/projects/.../memory/` is divergent legacy — IGNORE it; `context/` is the canonical home.

### Memory Budget

- `context/MEMORY.md` ≤ **10,000 chars** — raised from the Hermes default to fit Vector's HARD RULES + load-bearing safety surface.
- `context/USER.md` ≤ **3,000 chars**.
- Before writing, check `wc -c <file>`. If over cap, consolidate existing entries before adding.

### Memory Write

When the user says "remember this", "note that", "update memory", "save this", or "forget about" — route through the [`<memory-write>`](skills/memory-write/SKILL.md) skill:

1. Read `context/MEMORY.md` in full.
2. Dedup: scan for substring match — if the fact already exists, update in place; don't append.
3. Check `wc -c < context/MEMORY.md` — if over 10,000 chars, consolidate before adding.
4. Add under the appropriate section (`## Active Threads`, `## Environment Notes`, `## Pending Decisions`, etc.).
5. For **forget about**: confirm with the user before deleting.
6. After writing: "Saved — will be active from next session."

### Memory Retrieval

When the user asks about past context, decisions, or rules:

1. **Tier 0** — check `context/MEMORY.md` + today's daily log (already in context, zero cost).
2. **L1 (semantic)** — run [`<index> -q "<query>"`](skills/index/SKILL.md) (memsearch hybrid search over `context/memory/`, `context/transcripts/`, and the retired `.claude/memory/` archive).
3. **L2 (expand)** — run `memsearch expand <chunk_hash>` to get the full markdown section around a match.
4. **L3 (raw)** — open `context/transcripts/{YYYY-MM-DD}.md` directly for unsummarised dialogue.
5. **Fallback** — "I don't have a record of that."

Escalate only if the previous tier didn't answer.

### Daily Log

Track session activity in `context/memory/{YYYY-MM-DD}.md`. One file per day, numbered session blocks:

```
#### Session N
**Goal**: <one line, filled when user states their goal>
**Deliverables**: <files created/modified>
**Decisions**: <key decisions and rationale>
**Open threads**: <anything unfinished>
```

Log silently as work progresses. Never announce "I've logged that."
