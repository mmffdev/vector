<!-- Cap: ~10,000 chars. Curated working memory, loaded as frozen snapshot at session start. Mid-session writes persist but take effect next session. Add via `/remember` or the memory-write skill. -->
# Working Memory

## HARD RULES (verbatim — also in .claude/CLAUDE.md)

**HARD RULE — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify password_hash, email, is_active, role, or password_changed_at of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `cookra@me.com`, or `user@mmffdev.com`. Reset to `password` on 2026-05-02. If a login fails, ASK — never "fix" by overwriting. For gadmin/padmin/user testing, create NEW accounts (e.g. `claude-gadmin@mmffdev.com`). Cannot be overridden.

**HARD RULE — NEVER DESTRUCTIVE GIT:** Never run `reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, or any command that destroys work — without explicit confirmation. Cannot be overridden.

**HARD RULE — NEVER GIT STASH:** Never run `git stash`, `git stash --include-untracked`, `git stash pop`, or `git stash drop`. Full stop. On 2026-05-16 a `stash --include-untracked` nuked hours of in-flight work across 17 files. For pre-session state use `git diff HEAD -- <file>` or `git show HEAD:<file>` (read-only). For temporary revert: copy to `/tmp/` first, then `git checkout HEAD -- <specific-file>`. Never `git add .` or `git add -A` — stage by explicit path.

**HARD RULE — INSPECT INDEX BEFORE EVERY COMMIT:** Before any `git commit`, run `git diff --cached --stat` and READ THE OUTPUT IN FULL. Explicit-path `git add` is additive over already-staged entries (renames from `git mv`, files staged by hooks, files staged by an earlier add). If the staged file list contains ANYTHING beyond what this commit is meant to ship, unstage the unrelated entries with `git reset HEAD <path>` BEFORE committing. Origin: 2026-05-21 two separate commits accidentally bundled in user's in-flight rename ops (`(user)` → `user` route restructure) under unrelated docs / test-fix subject lines because the renames were pre-staged via `git mv` and survived an explicit-path `git add`.

**HARD RULE — NEVER ASSUME A DATABASE:** Before any `psql` query, schema lookup, or "the table probably lives in X" claim: (1) find handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify pool (`pool` / `vaPool` / `libPools`), (3) cross-check `docs/c_c_db_routing.md`. Only then open psql with the correct `-d <dbname>`. Three DBs in play: `mmff_vector` (pool), `vector_artefacts` (vaPool — artefact_types, artefacts, flows, field_library, timebox_*), `mmff_library` (libPools — read-only spine). Cannot be overridden.

**HARD RULE — BACKEND PINNED TO `dev`:** Active env is permanently dev. Does not change for any reason except the user typing it in chat. Never run `<server> -s` / `<server> -p`, never switch via launcher, never ask "should I switch?". If anything flips the marker to staging/production: silently revert (restart Go on :5100 with `BACKEND_ENV=dev`, tunnel :5435, rewrite marker). Staging/prod env files are refusing stubs; recovery files at `backend/.env.staging.locked` / `.env.production.locked`. SSH config `mmffdev-pg` deliberately omits `LocalForward 5434`. Cannot be overridden.

**HARD RULE — LOOP DETECTED:** When a system-reminder begins with `LOOP DETECTED`, the loop-detector hook has fired 5 consecutive stuck signals. MUST invoke `<r> --auto-loop` before any further tool use except Read. Do not "just try one more thing".

**HARD RULE — SERVER IS THE GATE:** Any visibility / role / scope / permission filter writes the SERVER-SIDE check FIRST. Client-side is defence-in-depth, never the authoritative gate. The wire payload must not contain data the caller isn't cleared for; hiding it in the client is the wrong answer for a Trust-No-One, SOC 2, defence/finance product. When user asks "is this locked by the backend?" the answer must be "yes" with proof (handler + test). If the change is UX-only and looks like security: STOP, identify the threat, write the backend filter first. Origin: TD-NAV-AUTH-TIER. Cannot be overridden.

**HARD RULE — SY003 IS THE SUBSTRATE SOURCE OF TRUTH:** SY003 (`dev_reports`, `type=system`) is the master inventory for all three Vector databases — every table in `mmff_vector`/`vector_artefacts`/`mmff_library` with row counts + USED/PLACEHOLDER/DEAD flags, naming collisions named (`master_record_workspaces` in both DBs; `subscriptions` vs `master_record_tenants`), every cross-DB soft FK cataloged, ~498 SQL touchpoints itemized with file/purpose/caller/DB/table/rows/fields. Fetch on demand: `curl -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/admin/dev/reporting/SY003`. ANY change to the substrate (migration, table drop, column add, new Go SQL constant, cross-DB ref change, naming-collision resolution) MUST be followed by regenerating SY003 via `<report> -sy "current state of all three Vector databases ..."` so the master record never drifts. The Change Log section auto-prepends on re-POST of the same ID. Cannot be overridden.

## Active Mode

**Solo-dev mode since 2026-05-17.** WIP cap 5 in `Vector_Scope.md`; anything past goes to `## Parked` (swap-in/swap-out). Stories: title + AC only (full 7-gate flow behind `--full` flag). No new PLA plans — new work = one-line entry in Vector_Scope.md; existing 53 PLA files preserved as archaeology. Indexes (c_plan_index.md, c_story_index.md) frozen with `## FROZEN — solo-dev mode` header. Retros auto-only (loop-detector circuit breaker stays). Scratch outside repo at `~/Vector-scratch/`. ★ FORCING FUNCTION pinned top of Vector_Scope.md. Flips to prod-ready on first external user committed OR launch date set. Commit tag in solo-dev: `[solo-dev]`.

**Collaboration baseline** → [c_collaboration_baseline.md](memory/c_collaboration_baseline.md) — design conversation before code; foundation mode; buyer = defence + finance.

**"Commit all workstreams" = group them ALL, no exceptions.** When Rick says "commit all", "commit all workstreams", or similar phrasing, the instruction is to group EVERY dirty file/workstream on disk into commits by logical workstream and commit them all in one go — never selectively ship only "my" work and leave the rest. Exception only if Rick explicitly names what to exclude. Reason: 2026-05-29 — Claude defaulted to inventorying and excluding "not mine" files; Rick clarified that "all" means all, always, unless he says otherwise. How to apply: stage by explicit path (per the never-`git add .` hard rule) but stage EVERYTHING, grouped by workstream; one commit per workstream with a message that names what each touches.

**Workflow rules** → [c_workflow_rules.md](memory/c_workflow_rules.md) — red-green-refactor first; empirical blast radius; single-agent ownership per domain.

**CSS conventions** → [c_css_conventions.md](memory/c_css_conventions.md) — button/table/naming standards; no inline styles except CSS vars.

## Test surface

**Claude-owned accounts** → [c_claude_test_accounts.md](memory/c_claude_test_accounts.md) — three test roles; default padmin; never touch Rick's accounts.
**`claude_2_test@mmffdev.com` password** → `mmff` (reset 2026-05-23) — stable easy-to-remember override of the default `password123!`.

## Active Threads

**ObjectTreeV2 is intentionally stateless + row-type generic.** The refactor (weeks before 2026-05-28) genericised `useObjectTreeWindow<T>`, `ResourceTree<T>`, `ObjectTreeDataConfig<T>`; the orchestration in `p_ObjectTree.tsx` still imports WorkItem-specific helpers (`buildWorkItemsColumns`, `useWorkItemsFilters`, `useWorkItemsSort`, `WorkItemsFilterChips`, `useWorkItemFlowStates`) — that's the unfinished part of the refactor, NOT the intended end state. When mounting OTV2 on a non-WorkItem surface (custom-fields, future admin grids), do NOT propose "can't be done without big refactor" or "fake a WorkItem shape" or "build a parallel AdminGrid". Finish the prop-signature generalisation + extract WorkItem orchestration into an `ObjectTreeAdapter<T>` with WorkItemsAdapter as default so the 5 existing mounts keep working. Spec: `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md`.

**ObjectTreeV2 bulk-create — timeboxes only** → [c_bulkcreate_scoped_to_timeboxes.md](memory/c_bulkcreate_scoped_to_timeboxes.md) — `{ kind: "bulk" }` is scoped to sprints + releases; never propose for work-items / portfolio-items / risks.

**Destructive git applies to "empty" branches too** → [c_destructive_git_empty_branches.md](memory/c_destructive_git_empty_branches.md) — restatement of the HARD RULE; no exception for zero-unique-commit branches. 2026-05-21 incident.

**Work-items filter chips clamp by WORKSPACE, list endpoint also clamps by TOPOLOGY NODE.** When a Type/Status/Priority chip "does nothing", first suspect is a UUID mismatch via the topology clamp: the chip is loaded via `useArtefactTypeCatalogue` → `ListByWorkspace` (workspace-clamped, NOT topology-clamped), so the chip's "Task" option carries the workspace's Task UUID; the visible rows may be tagged with a different Task UUID from another workspace whose nodes are mounted under the active topology scope. The list endpoint then applies `at.artefacts_types_id = ANY($N)` AND `a.topology_node_id = ANY(<descendants>)` — both must hit. Diagnostic: open the detail flyout for a visible row and read its TOPOLOGY NODE field; if the scope is from a different workspace's subtree, that's the mismatch.
**Why:** 2026-05-23 — Insurance scope showed 27 Tasks in the grid; clicking Task in the new NavigationPie filter returned zero. Detail flyout showed `Insurance (current scope)` as the topology node, confirming the workspace-vs-scope split.
**How to apply:** before assuming a filter bug, inspect the row's topology node. Reference: `backend/internal/artefactitems/service.go:200-243` (scope clamp) + `:259-263` (type clamp), `app/hooks/useChipTypeOptions.ts` (chip side).

## Environment Notes

- **Docker does NOT run on Rick's Mac.** Dev Postgres tier lives on remote host `vector-dev-pg` (77.68.33.216) as a Docker Swarm stack (source of truth: `infra/swarm/vector-dev-stack.yml`). Local backend reaches it via SSH tunnel on `localhost:5435`. Never suggest local Docker, `docker ps` / daemon checks on the Mac, or installing Docker Desktop. For DB introspection: (a) Adminer in browser on the remote swarm, (b) `psql -h localhost -p 5435` via the tunnel (psql NOT pre-installed — needs `brew install libpq` first), or (c) ask Rick to run the query.
- Backend pinned dev. Env file `backend/.env.dev`. DB tunnel `localhost:5435`. Dev VPS 77.68.33.216.
- Frontend `http://localhost:5101`. Backend `http://localhost:5100`.
- `<server>` skill handles env switching but is locked off staging/prod.
- Memory: this file (~10 KB) + `context/USER.md` (~3 KB) loaded at session start. Daily logs `context/memory/{YYYY-MM-DD}.md`. Transcripts gitignored. `<index>` for semantic recall; nightly cron.

## Pending Decisions

_(empty)_
