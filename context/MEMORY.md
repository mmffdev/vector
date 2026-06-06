<!-- Cap: ~15,000 chars (raised from 10,000 on 2026-06-02). Curated working memory, loaded as frozen snapshot at session start. Mid-session writes persist but take effect next session. Add via `/remember` or the memory-write skill. -->
# Working Memory

## HARD RULES (verbatim — also in .claude/CLAUDE.md)

**HARD RULE — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify password_hash/email/is_active/role/password_changed_at of `gadmin@`, `padmin@`, `cookra@me.com`, or `user@mmffdev.com` (all `@mmffdev.com`). Reset to `password` 2026-05-02. Login fails → ASK, never overwrite. For testing, create NEW accounts (e.g. `claude-gadmin@mmffdev.com`). Cannot be overridden.

**HARD RULE — NEVER DESTRUCTIVE GIT:** Never run `reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, or any command that destroys work — without explicit confirmation. Cannot be overridden.

**HARD RULE — NEVER GIT STASH:** Never `git stash` (any variant). 2026-05-16 a `stash --include-untracked` nuked hours of work across 17 files. Pre-session state: `git diff HEAD -- <file>` / `git show HEAD:<file>` (read-only). Temp revert: copy to `/tmp/` first, then `git checkout HEAD -- <file>`. Never `git add .`/`-A` — stage by explicit path.

**HARD RULE — INSPECT INDEX BEFORE EVERY COMMIT:** Before any `git commit`, run `git diff --cached --stat` and READ IT IN FULL. Explicit-path `git add` is additive over already-staged entries (`git mv` renames, hook-staged files, earlier adds). If the staged list contains ANYTHING beyond this commit's scope, `git reset HEAD <path>` BEFORE committing. Origin: 2026-05-21 — pre-staged `git mv` renames survived an explicit-path add and bundled into unrelated commits.

**HARD RULE — NEVER ASSUME A DATABASE:** Before any `psql` query / schema lookup / "table probably lives in X": (1) find handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` `NewService(...)` for the pool (`vaPool` / `libPools`), (3) cross-check `docs/c_c_db_routing.md`. Only then open psql with the right `-d <dbname>`. **Two DBs (post-refactor 2026-05-26):** `vector_artefacts` (vaPool — canonical tenant DB, all 71 tenant tables incl. merged-in auth/nav/users + artefact_types/artefacts/flows/field_library/timebox_*) and `mmff_library` (libPools — read-only spine). Legacy `mmff_vector` DROPPED; legacy `pool` var now aliases `vector_artefacts`. Cannot be overridden.

**HARD RULE — BACKEND PINNED TO `dev`:** Active env is permanently dev; changes ONLY if the user types it in chat. Never run `<server> -s`/`-p`, never switch via launcher, never ask "should I switch?". If the marker flips to staging/prod: silently revert (restart Go on :5100 with `BACKEND_ENV=dev`, tunnel :5435, rewrite marker). Staging/prod env files are refusing stubs (recovery: `backend/.env.{staging,production}.locked`). Cannot be overridden.

**HARD RULE — LOOP DETECTED:** A `LOOP DETECTED` system-reminder = loop-detector fired 5 consecutive stuck signals. MUST invoke `<r> --auto-loop` before any further tool use except Read. Don't "just try one more thing".

**HARD RULE — SERVER IS THE GATE:** Any visibility/role/scope/permission filter writes the SERVER-SIDE check FIRST; client-side is defence-in-depth only. The wire payload must NOT contain data the caller isn't cleared for (Trust-No-One / SOC 2 / defence-finance). "Is this locked by the backend?" → "yes" + proof (handler + test). UX-only change that acts as security: STOP, write the backend filter first. Origin: TD-NAV-AUTH-TIER. Cannot be overridden.

**HARD RULE — SY003 IS THE SUBSTRATE SOURCE OF TRUTH:** SY003 (`dev_reports`, `type=system`) is the master inventory for the two Vector DBs (`vector_artefacts`, `mmff_library`; legacy `mmff_vector` DROPped 2026-05-26) — every table + row counts + USED/PLACEHOLDER/DEAD flags + purpose + every Go SQL touchpoint. Fetch: `curl -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/admin/dev/reporting/SY003`. ANY substrate change (migration, table drop, column add, new Go SQL constant, cross-DB ref) MUST regenerate SY003 via `<report> -sy "current state of the Vector databases ..."` (Change Log auto-prepends on re-POST). Full detail in .claude/CLAUDE.md. Cannot be overridden.

## Active Mode

**Solo-dev mode since 2026-05-17.** WIP cap 5 in `Vector_Scope.md` (overflow → `## Parked`). Stories: title + AC only (7-gate behind `--full`). No new PLA plans — new work = one-line in Vector_Scope.md; 53 PLA files kept as archaeology; indexes frozen. Retros auto-only. Scratch at `~/Vector-scratch/`. Commit tag `[solo-dev]`. Flips to prod-ready on first external user OR launch date set.

**Collaboration baseline** → [c_collaboration_baseline.md](memory/c_collaboration_baseline.md) — design conversation before code; foundation mode; buyer = defence + finance.

**"Commit all" = group them ALL.** "commit all" → group EVERY dirty file into commits by workstream (never ship only "my" work). Exception only if Rick names exclusions. Stage by explicit path, one commit per workstream. 2026-05-29.

**Rally → Vector vocabulary mapping.** Translate the noun (never carry "project"/"iteration" into Vector code): Project → **topology node** (`topology_nodes`); Iteration → **sprint** (`timeboxes_sprints`); Portfolio Item → **strategic artefact** (tier=`strategy`, slot `strt_*`); Release → **release** (`timeboxes_releases`); User Story → `wrk_story`; Task/Defect/Risk → `wrk_task`/`wrk_defect`/`wrk_risk`. 2026-05-29.

**Workflow rules** → [c_workflow_rules.md](memory/c_workflow_rules.md) — red-green-refactor first; empirical blast radius; single-agent ownership per domain.

**CSS conventions** → [c_css_conventions.md](memory/c_css_conventions.md) — button/table/naming standards; no inline styles except CSS vars.

## Test surface

**Claude-owned accounts** → [c_claude_test_accounts.md](memory/c_claude_test_accounts.md) — three test roles; default padmin; never touch Rick's accounts.
**`claude_2_test@mmffdev.com` password** → `mmff` (reset 2026-05-23) — stable easy-to-remember override of the default `password123!`.

## Active Threads

**New Grid primitive (`app/components/Grid/`) replaces OTV2 for /scope.** Headless `useTree` + skin `Grid__Tree`, flat-row render: indent + ├└│ rails live ONLY in the primary cell via `Grid__Tree_Lines` SVG (ResourceTree model), so lead columns (stripe/checkbox/drag/cog) stay fixed when nesting. Bands: Title(badge) · ActionBar(RadialPillMenu create + search) · Head · Rows(+`Grid__Tree_Forms` flyout, opened by type-badge click) · Pagination. TEMP `<Panel>` wrapper for card+main-header (retrofit into Grid__Tree then delete dup). Create flyout deferred to form-builder. OTV2 was the copy source.

**ObjectTreeV2 bulk-create — timeboxes only** → [c_bulkcreate_scoped_to_timeboxes.md](memory/c_bulkcreate_scoped_to_timeboxes.md) — `{ kind: "bulk" }` is scoped to sprints + releases; never propose for work-items / portfolio-items / risks.

**Portfolio hierarchy model** → [c_portfolio_hierarchy_model.md](memory/c_portfolio_hierarchy_model.md) — strategic portfolio layers come from adopted library templates; execution work layers sit beneath them.

**Sentinel clamp model** → [c_sentinel_clamp_model.md](memory/c_sentinel_clamp_model.md). **Sentinel owns ONLY the resolved clamp (TenantID/WorkspaceID/FocusNodeID/AllowedSubtreeIDs); it knows NO artefact table/column names.** SQL helper moved out into `backend/internal/topologyclamp/clamp_sql.go` (old `sentinel/clamp_sql.go`+test DELETED); consumers supply their OWN column: `topologyclamp.SubtreeClause(ctx, "a.artefacts_id_topology_node", args, n)`. **EVERY artefact read (list/children/query) MUST call SubtreeClause** — a bare subscription+parent_id filter LEAKS out-of-scope rows (SERVER-IS-THE-GATE) that then 404 at GetWorkItem. Origin 2026-06-02: `artefactitems.ListChildren` missed it → /scope lazy children over-returned (25 vs 6) + inline form 404'd; fixed to mirror `ListWorkItems`. Doc on `Clamp` in `sentinel/types.go`.

**Destructive git applies to "empty" branches too** → [c_destructive_git_empty_branches.md](memory/c_destructive_git_empty_branches.md) — restatement of the HARD RULE; no exception for zero-unique-commit branches. 2026-05-21 incident.

**Filter chip "does nothing" = topology-clamp UUID mismatch.** Chips load WORKSPACE-clamped (`useChipTypeOptions`); list also clamps by TOPOLOGY NODE — both type-ANY AND node-ANY must hit. A chip's "Task" UUID can differ from visible rows' Task UUID (tagged in another workspace under the active scope). Diagnostic: open a row's flyout, read its TOPOLOGY NODE. 2026-05-23 Insurance.

**Tracing request authority — name the ctx-writer, not loud handler machinery.** Clamp/tenant/role authority enters via middleware, injected through `ctx` (`sentinel.FromCtx`) — invisible to handler/service/SQL signatures. `?meg=` is a re-validated cosmetic NARROW hint (PLA-0053) with NO authority; the JWT-anchored `AllowedSubtreeIDs` clamp is the gate. Protocol: route mount first → name each `FromCtx` value's SOLE writer → ESTABLISH-vs-NARROW → forgery test. `.claude/skills/diagnose/SKILL.md` § Tracing authority. 2026-05-30.

**Subagent implementers slip in undisclosed adjacent edits when they spot orphan code.** Task 9 (CSS-add for Prio column) implementer also renamed `.grid__Tree_Title_Badge` → `.prefix-block-stripes` + parameterised its size because they noticed an untracked `PrefixBlockStripes.tsx` orphan-referencing the new class. Edit was benign + correct, but bundled into a commit titled only "style Prio cell" → wrong attribution; "Concerns: none" hid it. Why: implementers optimise locally for "make the file consistent" rather than respecting commit-scope. How to apply: every implementer prompt must say "ONLY touch lines specified in the task; if you find orphan/unrelated issues, REPORT them — do NOT fix them, even if the fix looks trivial." Inspect `git show <sha>` (not just `--stat`) on any commit that touched CSS / globals / shared utility files. 2026-06-04.

**Context-protection delegation pattern (Rick, 2026-06-06).** For larger multi-layer builds, protect the main-loop context by spinning up ONE sub-agent at a time: brief it tightly on a single layer, let it finish, drop it, carry the handoff forward myself, then spin the next. Not parallel fan-out — sequential, one live agent max, main loop owns the handoff state between them. **No agent — and not the main loop — may run ANY git command or commit during these builds** (Rick commits himself). Pair with the standing "implementers ONLY touch specified lines; report orphans, don't fix" rule.

## Environment Notes

- **Docker does NOT run on Rick's Mac. NEVER run `docker` anything — not `docker run`, not `docker ps`, not pg-mcp (it's Docker-backed).** Dev Postgres lives on remote `vector-dev-pg` (77.68.33.216) as a Docker Swarm stack (`infra/swarm/vector-dev-stack.yml`); local backend reaches it via SSH tunnel `localhost:5435`.
- **DB read = ONE command, every time, no improvising.** `psql` is installed but off-PATH at `/opt/homebrew/Cellar/libpq/*/bin/psql`. The canonical read (used for weeks):
  ```bash
  set -a; source backend/.env.dev; set +a
  PGPASSWORD="$VA_DB_PASSWORD" /opt/homebrew/Cellar/libpq/18.3/bin/psql -h localhost -p 5435 -U "$VA_DB_USER" -d vector_artefacts -c "SELECT ..."
  ```
  (lib spine: `-d mmff_library` with `$LIBRARY_DB_*`.) Migrations apply via `cd backend && go run ./cmd/migrate -dry-run -db vector_artefacts -env .env.dev` over the same tunnel. If psql/tunnel genuinely fail, ASK Rick — do NOT reach for Docker. Origin 2026-06-06: ran `docker run` twice for a DB read when this very line already forbade it and gave the psql command — the failure was NOT consulting loaded memory before acting.
- Backend pinned dev. Env file `backend/.env.dev`. DB tunnel `localhost:5435`. Dev VPS 77.68.33.216.
- Frontend `http://localhost:5101`. Backend `http://localhost:5100`.
- `<server>` skill handles env switching but is locked off staging/prod.
- **SHARED WORKING DIRECTORY — NEVER `git checkout`/`switch`/`checkout -b` in the repo root.** This folder is open in VS Code and used by concurrent sessions/agents; `git checkout` moves HEAD for EVERYONE at once — every VS Code window, every other session — and silently drags their in-flight commits onto the wrong branch. To do branch work, use a **`git worktree`** (separate path, isolated HEAD) — that's why worktrees exist. So: need a branch? `git worktree add ../<dir> -b <branch>` and work there; do NOT switch the shared root. When asked to commit on a heavily-dirty root, prefer committing on the current branch or ASK first — do not auto-branch. Origin 2026-06-06: ran `git checkout -b feat/...` in the shared root to commit a feature; it yanked the branch out from under another active session, whose commit then landed on my branch. Recovery was a stash-dance back to `main`. Use a worktree next time.
- Memory: this file (~10 KB) + `context/USER.md` (~3 KB) loaded at session start. Daily logs `context/memory/{YYYY-MM-DD}.md`. Transcripts gitignored. `<index>` for semantic recall; nightly cron.

## Pending Decisions

_(empty)_
