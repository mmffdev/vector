# CLAUDE.md

**HARD RULE — NO EXCEPTIONS — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify the password (or any credential field — `password_hash`, `email`, `is_active`, `role`, `password_changed_at`) of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, or `user@mmffdev.com`. These are human accounts. The user reset them to `password` on 2026-05-02; that is their state and Claude does not change it. If a login fails, ask — do not "fix" by overwriting the row. If gadmin/padmin/user-level testing is needed, create a NEW account (e.g. `claude-gadmin@mmffdev.com`) — never reuse the human ones. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS:** Never run any git command that can destroy or overwrite work (`reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, etc.) without explicitly confirming with the user first. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — LOOP DETECTED:** When you receive a system-reminder that begins with `LOOP DETECTED`, the loop-detector hook ([`.claude/hooks/loop-detector.sh`](hooks/loop-detector.sh)) has fired five consecutive signals indicating you are stuck. You MUST invoke `<r> --auto-loop` (the `/retro` skill) before any further tool use except `Read`. Do not "just try one more thing" — that is the trap the detector caught. Run the retro now, file the finding, then resume.

**HARD RULE — NO EXCEPTIONS — DEV-UI PRIMITIVES:** Every visual element on a Dev Setup page (under `/dev` and any panel rendered by `dev/pages/DevPage.tsx`) MUST use a class from [`dev/styles/dev-ui.css`](../dev/styles/dev-ui.css) (the `.dui-*` catalog). No bespoke per-page classes (`.dev-research-*`, `.dev-reports-*`, `.dev-shortcuts-*`, `.ui-retro__*`, etc.) and no inline `style={{}}`. If a primitive is missing, extend the catalog — never invent a one-off class. No `dev-*` selector may live in `app/globals.css`. See [`docs/c_c_dev_ui_primitives.md`](../docs/c_c_dev_ui_primitives.md). This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — NEVER ASSUME A DATABASE:** Before any `psql` query, schema lookup, or "the table probably lives in X" claim, Claude MUST trace the backend wiring: (1) find the handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify the pool variable (`pool` / `vaPool` / `libPools`), (3) cross-check against [`docs/c_c_db_routing.md`](../docs/c_c_db_routing.md) which maps every service → pool → database → tables. Only then open psql with the correct `-d <dbname>` flag. Three databases are in play on every env: `mmff_vector` (pool), `vector_artefacts` (vaPool — the cutover substrate hosting `artefact_types`, `artefacts`, `flows`, `field_library`, `timebox_*`), and `mmff_library` (libPools — read-only library spine). Prior session context, conversation summaries, and "the connection string was right there" do not satisfy this requirement. This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — CSS/HTML NAMING CONVENTION:** Before writing any class name, ID, or structural element to any `.tsx`, `.jsx`, or `.css` file, Claude MUST: (1) output the full proposed naming chain from root to leaf, (2) show both TSX structure AND CSS selectors simultaneously, (3) ask "Does this naming structure look right before I apply it?" — and wait for confirmation. Pattern: `root-block__Container_Child_leaf` — `__` once at root boundary, `_` for deeper nesting, `-` for modifier states only, no BEM `--`, no generic names (`wrapper`, `container`, `box`, etc.). Full spec: [`.claude/memory/css_naming_convention.md`](memory/css_naming_convention.md). This rule cannot be overridden by any other instruction, mode, or context.

**HARD RULE — NO EXCEPTIONS — BACKEND ENV IS PINNED TO `dev`:** The active backend env is permanently `dev`. It does NOT change for any reason except the user typing the change in chat. Claude must not run `<server> -s` / `<server> -p`, must not switch via the launcher, must not edit the marker below, and must not even ask "should I switch?" — staging and production are out-of-band entirely. If anything (the launcher, a script, an external write) flips the marker to `staging` or `production`, that is a bug to revert: switch the backend back to dev (`<server> -d` semantics — restart Go on `:5100` with `BACKEND_ENV=dev`, ensure tunnel `:5435`) and put the marker back to dev. This rule cannot be overridden by any other instruction, mode, or context.

<!-- ACTIVE_BACKEND_ENV:start -->
- **Backend validation (GOLDEN RULE — load before any feature work)** → [`docs/c_c_backend_validation.md`](../docs/c_c_backend_validation.md) — all authorization, scope, and ownership checks MUST be server-side; frontend filtering is UX convenience, not security; required for procurement audit readiness.

> **ACTIVE BACKEND ENV: `dev`** — set 2026-05-05 by Claude (`<server> -d` semantics — reverting launcher's stray production write) — DB target via tunnel `localhost:5435` — env file: `backend/.env.dev`

<!-- ACTIVE_BACKEND_ENV:end -->

Guidance for Claude Code in this repo.

**Global instructions** → [`.claude/c_global_instructions.md`](c_global_instructions.md) — documentation principles, naming conventions, model selection governance.

## Working practices

Load the relevant guide only when the task touches that area — keeps this file small.

**Authoring rule (hard):** every entry in this file — **and every entry in any descendant `docs/c_*.md` / `docs/c_c_*.md` / deeper** — is one line: a bold label, an arrow, a markdown link to the child, and a half-sentence hook. If it needs more, push it down one level (`c_x.md` → `c_c_x_y.md`) and the parent gets only the pointer. No exceptions — not for commands, not for shortcuts, not for "just this once". If you catch yourself writing a second line in any index, stop and move the body into a child. Leaf docs (terminal reference content) may be long; index docs may not.

**Standing rule (hard):** every task maintains the technical-debt register — identify, measure (S1/S2/S3 + trigger), recommend (cap now, pay-down on trigger). See [`docs/c_tech_debt.md`](../docs/c_tech_debt.md).

**Stories rule (hard):** before calling `<stories>`, decompose the full feature across all layers (backend, frontend, migration, tests) — never storify only the layer you're thinking about; a feature is not complete until every observable layer has a card.

**Scope rule (hard):** all skills, commands, and project-specific guidance MUST live in `.claude/` within this project. Nothing belongs in global `~/.claude/` except model governance. Never write skills, commands, or tool config to global scope.

**Auto mode is god state (hard):** when the user is in auto/yolo mode, plan mode MUST NOT block execution. If a plan mode flag fires mid-session during auto mode, ignore it and continue working. Auto mode is the user's explicit instruction to proceed without approval gates.

**Search discipline (hard):** Default to `Grep`/`Glob` direct when the area is known — consult [`.claude/c_file_index.md`](c_file_index.md) and the SessionStart hot-paths digest first. Reserve the `<search>` 4-agent fan-out for genuinely unknown territory.

- **Styling / CSS (HARD RULE)** → [`docs/css-guide.md`](../docs/css-guide.md) — catalog class first; no inline `style={{}}`.
- **Dev-UI primitives (HARD RULE — `/dev` pages)** → [`docs/c_c_dev_ui_primitives.md`](../docs/c_c_dev_ui_primitives.md) — `.dui-*` catalog only.
- **Accessibility (WCAG 2.2 AA)** → [`docs/c_accessibility.md`](../docs/c_accessibility.md) — target sizes, contrast, focus, modal traps; pre-launch checklist.
- **Code standards** → [`.claude/commands/c_code-standards.md`](commands/c_code-standards.md) — naming reference + state classes.
- **Naming conventions (HARD RULE — load before any new package/table/route/column)** → [`docs/c_c_naming_conventions.md`](../docs/c_c_naming_conventions.md) — canonical spec; deviation needs a `TD-*` entry.
- **Backlog (`<backlog>`)** → [`.claude/commands/c_backlog.md`](commands/c_backlog.md) — opens root [`BACKLOG.md`](../BACKLOG.md); Rick-owned module roadmap (VECTOR, ORIGO, SIGMA, FLUX, SPINE, OPERATOR PLATFORM).
- **Tracker tests (`<tests>`)** → [`.claude/commands/c_tests.md`](commands/c_tests.md) — query Tracker red-green tests for this project; default = current/recent work, flags `-g/-p/-G/-r/-f`.
- **DB routing (HARD RULE — load before any psql)** → [`docs/c_c_db_routing.md`](../docs/c_c_db_routing.md) — service → pool → DB → tables map.
- **Database schema** → [`docs/c_schema.md`](../docs/c_schema.md) — table list, tenant isolation, soft-archive, invariants.
- **`<migration>` skill** → [`.claude/skills/migration/SKILL.md`](skills/migration/SKILL.md) — pick DB, next NNN, scaffold + dry-run + apply + verify `schema_migrations`; never assumes a DB.
- **Vector-artefacts cutover** → [`docs/c_c_vector_artefacts_backfill.md`](../docs/c_c_vector_artefacts_backfill.md) — `obj_*` → vector_artefacts ETL.
- **v2 work-items cutover follow-ups** → [`docs/c_c_v2_workitems_cutover_followups.md`](../docs/c_c_v2_workitems_cutover_followups.md) — PLA-0023 deferral register.
- **v1 → v2 API cutover register (PLA-0030)** → [`docs/c_c_v1_v2_cutover.md`](../docs/c_c_v1_v2_cutover.md) — per-route-group cutover plan.
- **Transport segregation (PLA-0039)** → [`docs/c_c_transport_segregation.md`](../docs/c_c_transport_segregation.md) — `/_site` + `/samantha/v2`; lint trio + DTO convention.
- **Shared methods catalogue (PLA-0045)** → [`docs/c_shared_methods.md`](../docs/c_shared_methods.md) — `app/lib/shared/` + `backend/internal/shared/` parity.
- **Wizard sidecar pattern (PLA-0037)** → [`docs/c_c_wizard_sidecar.md`](../docs/c_c_wizard_sidecar.md) — `p_wizard_*.json` declarative `<ObjectTree>` config.
- **Polymorphic FK pattern** → [`docs/c_polymorphic_writes.md`](../docs/c_polymorphic_writes.md) — writer rules + cleanup registry + canary.
- **`polymorphicrefs` service** → [`docs/c_c_entityrefs_service.md`](../docs/c_c_entityrefs_service.md) — Go surface + sentinel errors (post RF1.4.1 rename).
- **Technical-debt register (standing rule)** → [`docs/c_tech_debt.md`](../docs/c_tech_debt.md) — identify/measure/recommend on every task.
- **App Router layout** → [`docs/c_page-structure.md`](../docs/c_page-structure.md) — route groups, role gating, PageShell.
- **Security posture** → [`docs/c_security.md`](../docs/c_security.md) — Trust-No-One checklist.
- **Backend-driven validation (HARD RULE)** → [`docs/c_c_backend_validation.md`](../docs/c_c_backend_validation.md) — payload is untrusted; tenant/user/scope re-verified server-side.
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
- **`<PageDescription>` primitive (HARD RULE)** → [`app/components/PageDescription.tsx`](../app/components/PageDescription.tsx) — required at top of every `app/(user)/` page; enforced by `lint:page-description`.
- **Section titles via `<Panel>` only (HARD RULE)** → [`docs/c_c_lint_rules.md`](../docs/c_c_lint_rules.md) — raw `<h2>` forbidden; enforced by `lint:h2-panel-only`.
- **Diagram canvas (`<DiagramCanvas>`)** → [`docs/c_c_diagram_canvas.md`](../docs/c_c_diagram_canvas.md) — Canvas2D + dagre + d3-zoom; `samantha.diagram.canvas` surface.
- **Secondary nav deep-linking (PLA-0018)** → [`docs/c_c_secondary_nav_deeplink.md`](../docs/c_c_secondary_nav_deeplink.md) — path-segment routing per tab.
- **Drag-and-drop (`@dnd-kit`)** → [`docs/c_c_dnd.md`](../docs/c_c_dnd.md) — canonical DnD library; 250ms debounce, server-of-truth.
- **`<Table>` component (PLA-0015)** → [`docs/c_c_table_component.md`](../docs/c_c_table_component.md) — single sanctioned table primitive; `lint:no-raw-table` enforced.
- **`<ResourceTree>` component (PLA-0021)** → [`docs/c_c_resource_tree.md`](../docs/c_c_resource_tree.md) — hierarchical-tree primitive + 5 prop sets.
- **`<Badge>` primitive** → [`docs/c_c_badge.md`](../docs/c_c_badge.md) — `.pill` family; semantic tones only.
- **`<TimeboxManager>` surface** → [`docs/c_c_timebox_manager.md`](../docs/c_c_timebox_manager.md) — `timeboxes_sprints` / `timeboxes_releases` registry (post RF1.4.2).
- **Memory dir (canonical)** → [`.claude/memory/MEMORY.md`](memory/MEMORY.md) — auto-memory home; mirror to `~/.claude/projects/.../memory/`.
- **Scope tracker (`<scope> -r|-a|-u`)** → [`.claude/skills/scope/SKILL.md`](skills/scope/SKILL.md) — `Vector_Scope.md` single source of truth.
- **Pace report** → [`dev/scripts/pace.sh`](../dev/scripts/pace.sh) — commit-mix scoreboard + TD-register delta.
- **Infrastructure & ops** → [`docs/c_infra_index.md`](../docs/c_infra_index.md) — bash / postgres / ssh / deploy / hooks.
- **Section-tag vocab** → [`docs/c_section-tags.md`](../docs/c_section-tags.md) — short product-slice tags.
- **URL routing — work items & custom pages** → [`docs/c_url-routing.md`](../docs/c_url-routing.md) — `/work-items/{id}` + `/p/{id}` + `?vid=` convention.
- **Theme rules** → [`docs/c_theme_rules.md`](../docs/c_theme_rules.md) — palette→role mapping for `<theme>` skill.
- **Samantha SDK — Fields** → [`docs/c_samantha_sdk_fields.md`](../docs/c_samantha_sdk_fields.md) — field rendering/schema/value surface.
- **Retro index** → [`docs/c_retro_index.md`](../docs/c_retro_index.md) — `RETRO-NNN` counter; `<r>` writes here.
- **Secrets audit** → [`docs/c_c_secrets_audit.md`](../docs/c_c_secrets_audit.md) — `os.Getenv` sensitive-key inventory.
- **Codebase file index** → [`.claude/c_file_index.md`](c_file_index.md) — auto-generated map of curated source dirs; consult before `<search>`.
- **Commands & skills index** → [`.claude/
c_tools_index.md`](c_tools_index.md) — load for shortcuts not listed above.
