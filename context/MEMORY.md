<!-- Cap: ~10,000 chars. Curated working memory, loaded as frozen snapshot at session start. Mid-session writes persist but take effect next session. Add via `/remember` or the memory-write skill. -->
# Working Memory

## HARD RULES (verbatim — also in .claude/CLAUDE.md)

**HARD RULE — HUMAN ACCOUNTS ARE OFF LIMITS:** Never modify password_hash, email, is_active, role, or password_changed_at of `gadmin@mmffdev.com`, `padmin@mmffdev.com`, `cookra@me.com`, or `user@mmffdev.com`. Reset to `password` on 2026-05-02. If a login fails, ASK — never "fix" by overwriting. For gadmin/padmin/user testing, create NEW accounts (e.g. `claude-gadmin@mmffdev.com`). Cannot be overridden.

**HARD RULE — NEVER DESTRUCTIVE GIT:** Never run `reset --hard`, `push --force`, `checkout .`, `restore .`, `clean -f`, `branch -D`, `rebase` without review, or any command that destroys work — without explicit confirmation. Cannot be overridden.

**HARD RULE — NEVER GIT STASH:** Never run `git stash`, `git stash --include-untracked`, `git stash pop`, or `git stash drop`. Full stop. On 2026-05-16 a `stash --include-untracked` nuked hours of in-flight work across 17 files. For pre-session state use `git diff HEAD -- <file>` or `git show HEAD:<file>` (read-only). For temporary revert: copy to `/tmp/` first, then `git checkout HEAD -- <specific-file>`. Never `git add .` or `git add -A` — stage by explicit path.

**HARD RULE — INSPECT INDEX BEFORE EVERY COMMIT:** Before any `git commit`, run `git diff --cached --stat` and READ THE OUTPUT IN FULL. Explicit-path `git add` is additive over already-staged entries (renames from `git mv`, files staged by hooks, files staged by an earlier add). If the staged file list contains ANYTHING beyond what this commit is meant to ship, unstage the unrelated entries with `git reset HEAD <path>` BEFORE committing. Origin: 2026-05-21 two separate commits accidentally bundled in user's in-flight rename ops (`(user)` → `user` route restructure) under unrelated docs / test-fix subject lines because the renames were pre-staged via `git mv` and survived an explicit-path `git add`.

**HARD RULE — NEVER ASSUME A DATABASE:** Before any `psql` query, schema lookup, or "the table probably lives in X" claim: (1) find handler in `backend/internal/`, (2) read `backend/cmd/server/main.go` for the `NewService(...)` call to identify pool (`vaPool` / `libPools`), (3) cross-check `docs/c_c_db_routing.md`. Only then open psql with the correct `-d <dbname>`. **Two DBs in play (post-refactor 2026-05-26):** `vector_artefacts` (vaPool — the canonical tenant DB; all 71 tenant tables incl. the merged-in former-mmff_v auth/nav/subscriptions/users/pages cluster + artefact_types, artefacts, flows, field_library, timebox_*) and `mmff_library` (libPools — read-only spine). The legacy `mmff_vector` DB was DROPPED at the end of the three-pillar refactor; the legacy `pool` var still exists in main.go but now points at `vector_artefacts` (same DB as vaPool) as a fallback alias — there is no longer a separate tenant DB. Cannot be overridden.

**HARD RULE — BACKEND PINNED TO `dev`:** Active env is permanently dev. Does not change for any reason except the user typing it in chat. Never run `<server> -s` / `<server> -p`, never switch via launcher, never ask "should I switch?". If anything flips the marker to staging/production: silently revert (restart Go on :5100 with `BACKEND_ENV=dev`, tunnel :5435, rewrite marker). Staging/prod env files are refusing stubs; recovery files at `backend/.env.staging.locked` / `.env.production.locked`. SSH config `mmffdev-pg` deliberately omits `LocalForward 5434`. Cannot be overridden.

**HARD RULE — LOOP DETECTED:** When a system-reminder begins with `LOOP DETECTED`, the loop-detector hook has fired 5 consecutive stuck signals. MUST invoke `<r> --auto-loop` before any further tool use except Read. Do not "just try one more thing".

**HARD RULE — SERVER IS THE GATE:** Any visibility / role / scope / permission filter writes the SERVER-SIDE check FIRST. Client-side is defence-in-depth, never the authoritative gate. The wire payload must not contain data the caller isn't cleared for; hiding it in the client is the wrong answer for a Trust-No-One, SOC 2, defence/finance product. When user asks "is this locked by the backend?" the answer must be "yes" with proof (handler + test). If the change is UX-only and looks like security: STOP, identify the threat, write the backend filter first. Origin: TD-NAV-AUTH-TIER. Cannot be overridden.

**HARD RULE — SY003 IS THE SUBSTRATE SOURCE OF TRUTH:** SY003 (`dev_reports`, `type=system`) is the master inventory for the **two Vector databases** (`vector_artefacts`, `mmff_library`) — post-refactor 2026-05-26 the legacy `mmff_vector` was DROPped. Every table with row counts + USED/PLACEHOLDER/DEAD flags + one-line purpose; the 8 former mmff_vector→vector_artefacts soft FKs are now real Postgres FKs inside vector_artefacts (only the mmff_library boundary still has soft refs); the old `master_record_workspaces` registry-vs-sidecar collision is RESOLVED by the Pillar 2 fold; every SQL touchpoint itemized with file/purpose/caller/DB/table/rows/fields. Fetch on demand: `curl -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/admin/dev/reporting/SY003`. ANY change to the substrate (migration, table drop, column add, new Go SQL constant, cross-DB ref change, naming-collision resolution) MUST be followed by regenerating SY003 via `<report> -sy "current state of the Vector databases (vector_artefacts, mmff_library) ..."` so the master record never drifts. The Change Log section auto-prepends on re-POST of the same ID. Cannot be overridden.

## Active Mode

**Solo-dev mode since 2026-05-17.** WIP cap 5 in `Vector_Scope.md`; anything past goes to `## Parked` (swap-in/swap-out). Stories: title + AC only (full 7-gate flow behind `--full` flag). No new PLA plans — new work = one-line entry in Vector_Scope.md; existing 53 PLA files preserved as archaeology. Indexes (c_plan_index.md, c_story_index.md) frozen with `## FROZEN — solo-dev mode` header. Retros auto-only (loop-detector circuit breaker stays). Scratch outside repo at `~/Vector-scratch/`. ★ FORCING FUNCTION pinned top of Vector_Scope.md. Flips to prod-ready on first external user committed OR launch date set. Commit tag in solo-dev: `[solo-dev]`.

**Collaboration baseline** → [c_collaboration_baseline.md](memory/c_collaboration_baseline.md) — design conversation before code; foundation mode; buyer = defence + finance.

**"Commit all" = group them ALL.** When Rick says "commit all" / "commit all workstreams", group EVERY dirty file into commits by workstream — never selectively ship "my" work and leave the rest. Exception only if Rick names what to exclude. Origin: 2026-05-29. Stage by explicit path (per `git add .` hard rule), one commit per workstream.

**Rally → Vector vocabulary mapping.** Reading Rally fields/specs/docs, translate the noun (never carry "project"/"iteration" into Vector code): Project → **topology node** (`artefacts_topology_node_id`, `topology_nodes`); Iteration → **sprint** (`artefacts_id_timebox_sprint`, `timeboxes_sprints`); Portfolio Item → **strategic artefact** (tier=`strategy`, slot `strt_*`); Release → **release** (`artefacts_id_timebox_release`, `timeboxes_releases`); User Story → **story** (slot `wrk_story`); Task → `wrk_task`; Defect → `wrk_defect`; Risk → `wrk_risk` (work-tier). Origin: 2026-05-29 core-field demotion — use the Vector name in column/spec/commit.

**Workflow rules** → [c_workflow_rules.md](memory/c_workflow_rules.md) — red-green-refactor first; empirical blast radius; single-agent ownership per domain.

**CSS conventions** → [c_css_conventions.md](memory/c_css_conventions.md) — button/table/naming standards; no inline styles except CSS vars.

## Test surface

**Claude-owned accounts** → [c_claude_test_accounts.md](memory/c_claude_test_accounts.md) — three test roles; default padmin; never touch Rick's accounts.
**`claude_2_test@mmffdev.com` password** → `mmff` (reset 2026-05-23) — stable easy-to-remember override of the default `password123!`.

## Active Threads

**ObjectTreeV2 is intentionally stateless + row-type generic.** Core generics (`useObjectTreeWindow<T>`, `ResourceTree<T>`, `ObjectTreeDataConfig<T>`) are done; `p_ObjectTree.tsx` still imports WorkItem-specific helpers (`buildWorkItemsColumns`, `useWorkItemsFilters`/`Sort`, `WorkItemsFilterChips`, `useWorkItemFlowStates`) — that's the UNFINISHED tail, not the end state. Mounting OTV2 on a non-WorkItem surface: do NOT say "needs big refactor" / "fake a WorkItem shape" / "build a parallel AdminGrid"; finish the generalisation + extract orchestration into `ObjectTreeAdapter<T>` (WorkItemsAdapter default) so the 5 mounts keep working. Spec: `docs/superpowers/specs/2026-05-28-objecttree-generic-rowtype-design.md`.

**ObjectTreeV2 bulk-create — timeboxes only** → [c_bulkcreate_scoped_to_timeboxes.md](memory/c_bulkcreate_scoped_to_timeboxes.md) — `{ kind: "bulk" }` is scoped to sprints + releases; never propose for work-items / portfolio-items / risks.

**Destructive git applies to "empty" branches too** → [c_destructive_git_empty_branches.md](memory/c_destructive_git_empty_branches.md) — restatement of the HARD RULE; no exception for zero-unique-commit branches. 2026-05-21 incident.

**Work-items filter chips clamp by WORKSPACE, list endpoint also clamps by TOPOLOGY NODE.** When a Type/Status/Priority chip "does nothing", suspect a UUID mismatch via the topology clamp: chips load via `useArtefactTypeCatalogue` → `ListByWorkspace` (workspace-clamped), so the chip's "Task" UUID may differ from the visible rows' Task UUID (tagged in another workspace whose nodes are mounted under the active scope). List applies type-ANY **and** topology-node-ANY — both must hit. Diagnostic: open a visible row's detail flyout, read its TOPOLOGY NODE; cross-workspace subtree = the mismatch. 2026-05-23 Insurance incident. Ref: `service.go:200-243`+`:259-263`, `app/hooks/useChipTypeOptions.ts`.

**Tracing request authority — name the ctx-writer, not the loud handler machinery.** "How is X scoped/authorised?" — clamp/tenant/role authority enters via middleware and is injected through `ctx` (`sentinel.FromCtx`), invisible to handler/service/SQL signatures; a handler-only trace over-weights loud in-handler `?meg=`/`CanReadScope`/403 code and names the wrong thing. `?meg=` is a re-validated cosmetic NARROW hint (Megan, PLA-0053) with NO authority — the JWT-anchored `AllowedSubtreeIDs` clamp is the gate. Protocol (route mount first → name each `FromCtx` value's SOLE writer → ESTABLISH-vs-NARROW → forgery test, not happy path): `.claude/skills/diagnose/SKILL.md` § Tracing authority + CLAUDE.md pointer. 2026-05-30 sub-agent framing error.

## Environment Notes

- **Docker does NOT run on Rick's Mac.** Dev Postgres tier lives on remote host `vector-dev-pg` (77.68.33.216) as a Docker Swarm stack (source of truth: `infra/swarm/vector-dev-stack.yml`). Local backend reaches it via SSH tunnel on `localhost:5435`. Never suggest local Docker, `docker ps` / daemon checks on the Mac, or installing Docker Desktop. For DB introspection: (a) Adminer in browser on the remote swarm, (b) `psql -h localhost -p 5435` via the tunnel (psql NOT pre-installed — needs `brew install libpq` first), or (c) ask Rick to run the query.
- Backend pinned dev. Env file `backend/.env.dev`. DB tunnel `localhost:5435`. Dev VPS 77.68.33.216.
- Frontend `http://localhost:5101`. Backend `http://localhost:5100`.
- `<server>` skill handles env switching but is locked off staging/prod.
- Memory: this file (~10 KB) + `context/USER.md` (~3 KB) loaded at session start. Daily logs `context/memory/{YYYY-MM-DD}.md`. Transcripts gitignored. `<index>` for semantic recall; nightly cron.

## Pending Decisions

_(empty)_
