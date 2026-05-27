# FlowBoard Validator Handover (PLA066)

**Owner:** global Opus validator sub-agent (separate context from master)
**Master:** see `handovers/flowboard-master.md`
**Integration branch:** `feature/flowboard` (off `feature/notifications-v2` at `5742f1bc`)
**Repo root:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector`

---

## Your job

You are the **global validator** for the FlowBoard wave (PLA066). One Sonnet worker writes one story at a time on a per-story branch; you inspect their work, decide PASS or REJECT, and act on that verdict. Master (Opus) coordinates worker spawn — you do not spawn workers.

### On every story handed to you, do the following:

1. **Read the story's AC bullets from `Vector_Scope.md`** (the FB1 section). Use the verbatim text — do not paraphrase.
2. **Inspect the worker's branch diff** vs `feature/flowboard`. `git diff feature/flowboard...<worker-branch>`. Read every changed file.
3. **Run the verification commands** locally (validator runs them, does not trust the worker's word):
   - `go build ./...` + `go vet ./...` (if backend touched)
   - `go test ./backend/internal/flowboard/...` (if backend touched)
   - `npm run lint` (if frontend touched)
   - `npm run lint:column-prefix` (if migration touched)
   - `npm run test -- --run <relevant-path>` (if frontend touched)
   - Any AC-specific lint listed in the story (e.g. `lint:no-direct-outbox-write`, etc.)
4. **Walk every AC bullet** against the diff. For each one, decide PASS (evidence in code/test) or FAIL (vague, missing, or wrong).
5. **Apply migrations if Phase 1 PASS.** Validator owns the dev DB write key. After Phase 1 stories (FB1.1.1, 1.1.2, 1.1.3) all PASS code review, apply them in batch against `vector_artefacts` via `<migration>` skill or direct psql with the dev API key. **Migrations are Phase-1-only; Phase 2/3 stories should not introduce schema changes.** If they do, REJECT.
6. **Issue verdict**:
   - **PASS** → merge the worker's branch into `feature/flowboard` (squash for single-purpose stories; merge for multi-commit stories), write the entry into the verdict ledger below, signal master.
   - **REJECT** → write a structured rejection block (which AC failed, evidence, recommended fix), signal master. Do NOT merge.
7. **Update this handover** (append to verdict ledger, refresh "Current story" / "Last action") before yielding back to master.

## Verdict bar (strict)

| Check | PASS criterion |
|---|---|
| AC bullet has observable assertion | Diff or test contains the named artefact (file, route, column, status code, etc.). |
| AC bullet is verifiable | The criterion can be marked green/red without ambiguity. "Works correctly" = FAIL. |
| Tests green | `go test` + `npm run test` exit 0 on the worker's branch when validator re-runs them. |
| Lints green | All `lint:*` ratchets in scope exit 0. |
| Layer discipline | Handler files contain no SQL, sql.go contains only constants, service.go contains no `http.` imports. Grep enforces. |
| Migration column-prefix | Every column in migs 132/133/134 carries the full table-name prefix; `lint:column-prefix` green. |
| Branch commits ref-tagged | Subject line contains `[FB1.N.N]` so scope-commit-note hook resolves. |
| No HARD RULE violations | No human-account writes; no `--no-verify`; no destructive git ops; no DB other than `vector_artefacts` for new tables. |

If any row fails → REJECT.

## Rejection brief shape

When you REJECT, append a block to "§ Active rejection" below in this format:

```
### REJECT — FB1.N.N — <timestamp>

**Branch:** feature/flowboard/fb1-N-N-<slug>
**Worker last SHA:** <sha>

**Failed AC bullets:**
- AC: <verbatim AC text> — **FAIL** because <evidence: file:line or test name or grep result>.
- AC: <verbatim> — **FAIL** because ...

**Other gate failures:**
- <e.g. "lint:column-prefix failed on migration 132 line 12: missing prefix on `wsid` column">

**Recommended fix:**
- <Concrete instruction the next worker can act on.>

**Do not change:**
- <Any work that PASSED — preserve it. Worker should resume from current branch, not start over.>
```

Master reads this section, spawns a fresh Sonnet worker on the same branch with this brief in its prompt.

## Context protection (your responsibility)

You are a long-lived sub-agent — but your context grows on every verdict. To survive being hot-swapped:

1. **At the end of every verdict cycle**, update this handover:
   - Append the verdict to "§ Verdict ledger" (one row).
   - Update "§ Current story" to the next one (or "idle — awaiting next worker").
   - If you just REJECTED, "§ Active rejection" carries the brief.
   - If your context feels near 75% (a lot of long diffs reviewed, many merges done), write a note in "§ Self-assessment" saying so.
2. **If master spawns a fresh validator to replace you**, the new validator reads this file and resumes — no context loss.

## Migration apply protocol (Phase 1 only)

After all three Phase 1 stories PASS code review:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
KEY=$(grep '^DEV_API_KEY=' backend/.env.dev | cut -d= -f2)

# Apply via the <migration> skill (preferred — gives you dry-run + verify schema_migrations)
# Or direct psql against the dev tunnel:
psql "host=localhost port=5435 dbname=vector_artefacts user=postgres" \
  -f db/vector_artefacts/schema/132_topology_nodes_members.sql

# Then verify
psql "host=localhost port=5435 dbname=vector_artefacts user=postgres" \
  -c "SELECT version FROM schema_migrations WHERE version IN ('132','133','134');"
# Must return 3 rows.

# Then column-prefix check
npm run lint:column-prefix
# Must exit 0.

# Then describe each table
psql "host=localhost port=5435 dbname=vector_artefacts user=postgres" -c "\d topology_nodes_members"
psql "host=localhost port=5435 dbname=vector_artefacts user=postgres" -c "\d topology_nodes_wip_limits"
psql "host=localhost port=5435 dbname=vector_artefacts user=postgres" -c "\d users_flowboard_prefs"
# Visual check: column prefixes, FKs, UNIQUE constraints, indexes match the spec.
```

If any step fails → REJECT the offending story, do NOT apply downstream migrations. Master spawns a worker to fix.

## HARD RULES (do not violate)

- Never modify `gadmin@`, `padmin@`, or `user@` accounts.
- Never run `git push --force`, `git reset --hard`, `git checkout .`, `git restore .`, `git clean -f`, `git branch -D`, or `git rebase` without user confirmation.
- Never use `--no-verify` on commits.
- Never apply migrations against any DB other than `vector_artefacts` for FlowBoard work (the three tables live there).
- Never run `<server>` skill — backend env is pinned to dev permanently.
- Inspect `git diff --cached --stat` before every commit — do not bundle unrelated files.

---

## § Current story

**Phase 2 complete (4/4).** Awaiting Phase 3 dispatch (FB1.3.1 — scaffold `app/components/FlowBoard/` tree + first sidecar JSON).

Phase 1 migrations (applied + ledger-backfilled against `vector_artefacts`):
- `132_topology_nodes_members.sql` — squash `df6d412c`
- `133_topology_nodes_wip_limits.sql` — squash `cc4abf58`
- `134_users_flowboard_prefs.sql` — squash `bd417a86`

Phase 2 backend (all 4 endpoints landed):
- `backend/internal/flowboard/` package + main.go mount — squash `ff9a6613` (FB1.2.1).
- WIP endpoints (GET list + PUT upsert) with membership + workspace-scope gating — squash `71d23566` (FB1.2.2; one REJECT + fix cycle).
- Card-prefs endpoints (GET + PUT) with JSONB 8-key allowlist + sentinel-user-wins + ON CONFLICT (cols) UPSERT — squash `391d6e6d` (FB1.2.3; one REJECT + fix cycle — `ON CONFLICT ON CONSTRAINT <name>` → `ON CONFLICT (cols)` for bare-index arbiter compatibility).
- Node members endpoint (GET `/_site/topology/{id}/members`) — sentinel-clamped via reused `NodeWorkspaceID` gate from FB1.2.2; returns 200 with array of `{user_id, role, created_at}` ordered by created_at ASC; cross-scope → 403 with `listNodeMembersCalled == false` proving gate fires before query — squash `c863407b` (FB1.2.4; PASS first cycle).

## § Self-assessment

Validator was spawned fresh, will be re-spawned on every dispatch (no SendMessage tool available — agents are one-shot per dispatch). This handover file is the **continuity contract** across spawns. Every fresh validator reads this file + the spec + Vector_Scope.md and resumes.

**Context budget after FB1.1.1 verdict:** ~30%. Read AC + spec + worker diff + ran lint + applied migration + verified + squashed. No oversized files reviewed.

**Context budget after FB1.1.2 REJECT:** ~35%. Read AC + spec + worker diff + ran lint (green) + attempted apply (failed at the `INSERT INTO schema_migrations (version)` line — column doesn't exist, transaction rolled back, no DB damage). Clean working tree restored. Wrote rejection brief.

**Context budget after FB1.1.2 re-validation PASS (2026-05-27, post-fix `22e3d00f`):** ~45%. Re-spawned fresh. Read AC + spec correction + worker fix diff (only 2 lines removed: one INSERT in UP, one DELETE in DOWN) + grep-confirmed both files now have zero `schema_migrations` text + ran lint (green) + applied UP via direct psql (BEGIN/CREATE TABLE/CREATE INDEX/COMMIT) + backfilled ledger row + `\d topology_nodes_wip_limits` confirms shape + squash-merged to `feature/flowboard` (staged stat showed only the 2 migration files — HARD RULE clean). Vector_Scope.md auto-attribution noise from the commit-note hook was stashed before checkout to keep merge surface narrow.

**Operational note for next validator:** The bulk migrator (`go run ./cmd/migrate -dry-run -db vector_artefacts -env .env.dev`) reports 39 pre-existing pending migrations (093–130) on top of any new file. This is **substrate-vs-runner-record drift** from the post-refactor reseed — the substrate is fully present (you can see `topology_nodes_id`, `users_id` as UUID in psql) but the `schema_migrations` table only records the pre-refactor 089–092 rows. **Do NOT run the bulk migrator** — it would attempt to re-apply 093–130 against an already-migrated DB and explode. Instead: apply each new migration file directly via `psql -f`, then backfill the `schema_migrations` row with `INSERT INTO schema_migrations (filename, applied_at) VALUES ('NNN_slug.sql', now()) ON CONFLICT DO NOTHING`. Both steps are inside the existing migration's `BEGIN/COMMIT` envelope plus a separate one-line INSERT — clean, isolated, no risk to neighbouring migrations.

**`schema_migrations` is keyed by `filename` (TEXT), not `version` (INT).** Master prompt's verify command `SELECT version FROM schema_migrations WHERE version = '132'` would error; the canonical query is `SELECT filename FROM schema_migrations WHERE filename = '132_<slug>.sql'`.

**Worker-facing instruction (highlighted from FB1.1.2 REJECT):** Migration UP files must NOT include any `INSERT INTO schema_migrations (...)` statement — the live table has columns `filename TEXT PK` + `applied_at TIMESTAMPTZ`, not `version`. Validator backfills the ledger row separately after apply with `INSERT INTO schema_migrations (filename, applied_at) VALUES ('<NNN>_<slug>.sql', now()) ON CONFLICT DO NOTHING`. DOWN files must NOT include any `DELETE FROM schema_migrations` statement — same reason; validator removes the ledger row separately if rolling back. See the merged FB1.1.1 mig 132 for the correct pattern: BEGIN → CREATE TABLE / CREATE INDEX → COMMIT, nothing else.

**psql connection:** validator has no shell `psql` on `$PATH`. Use `/opt/homebrew/Cellar/libpq/18.3/bin/psql`. Connection string: `PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2) /opt/homebrew/Cellar/libpq/18.3/bin/psql "host=localhost port=5435 dbname=vector_artefacts user=mmff_dev"`. DB user is `mmff_dev`, NOT `postgres`.

**Context budget after FB1.1.3 REJECT:** ~30%. Re-spawned fresh. Read 2 handovers + spec §3.3 + scope §FB1 + worker diff (2 mig files) + lint (green) + 4 live DB introspections (confirmed `users.users_id` and `artefacts_types.artefacts_types_id` are UUID, not BIGINT) + attempted apply (failed with FK type mismatch — transaction rolled back, no DB damage). Worker used `BIGSERIAL`/`BIGINT` despite the spec correction in `f98bc796` that flagged UUID as canonical. Brief written; ready for fix worker. Working tree clean (Vector_Scope.md auto-attribution noise from worker commits stashed before switching back to `feature/flowboard`).

**Context budget after FB1.1.3 re-validation PASS (2026-05-27, post-type-fix `0745d8d5`):** ~40%. Same validator context across all three Phase 1 stories. Read worker fix diff (4 substitutions BIGSERIAL/BIGINT → uuid; net `+4/-4` over the prior reject branch) + grep-confirmed 0 hits for `BIGSERIAL`/`BIGINT` in either file + ran lint:column-prefix-convention (green) + verified the artefacts_types FK target name is the post-rename plural (`artefacts_types(artefacts_types_id)`) against the live DB + applied UP via direct psql (BEGIN/CREATE TABLE/CREATE INDEX×2/COMMIT) + backfilled ledger row + `\d users_flowboard_prefs` confirms full shape (uuid PK + gen_random_uuid() default + 2 uuid FKs CASCADE + JSONB NOT NULL + workspace_id denorm + updated_at default now() + UNIQUE on (user_id, artefact_type_id) + workspace_idx) + stashed Vector_Scope.md scope-hook noise before checkout + squash-merged with index-stat clean (only the 2 migration files) + recorded merge SHA `bd417a86`. **Phase 1 closeout achieved.** Hand-back to master for Phase 2 dispatch.

**Context budget after FB1.2.4 PASS (2026-05-27, worker SHA `cbbdc1e8`):** ~45%. Fresh spawn for the final Phase 2 story. Read both handovers + scope §FB1.2.4 (3 AC bullets verbatim — GET 200 with array of {user_id, role, created_at}; cross-scope 403; tests cover in-scope success + out-of-scope 403) + all 4 changed source files + both yaml diffs. Three-dot diff = 6 files exactly (4 flowboard + 2 auto-regen siteAPI.yamls); 240 insertions / 10 deletions. **All 3 AC PASS first cycle.** AC 1: `handler.go listNodeMembers` parses UUID (400 on bad), sentinel clamp (403 on missing), `NodeWorkspaceID` gate (both `ErrNodeNotFound` and mismatch → 403, no leak), then 200 with array; JSON tags on `NodeMemberDTO` produce wire fields `user_id`/`role`/`created_at` exactly per AC verbatim (verified by reading struct definition in `service.go` lines 84-88). AC 2: gate fires before query — `TestListNodeMembers_CrossScope403` asserts `svc.listNodeMembersCalled == false` after 403 response. AC 3: both tests present, named correctly, both green. **Empirical SQL verification** against live `vector_artefacts` via libpq: `EXPLAIN SELECT topology_nodes_members_user_id, ... FROM topology_nodes_members WHERE topology_nodes_members_node_id = $1::uuid ORDER BY topology_nodes_members_created_at ASC` resolved to `Sort` → `Bitmap Heap Scan on topology_nodes_members` → `Bitmap Index Scan on ix_topology_nodes_members_node` — all column names valid, plan healthy (no syntax/column-not-found errors per the FB1.2.3 lesson). `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 — all 14 tests pass (2 smoke + 4 WIP-PUT + 2 WIP-GET + 4 card-prefs + 2 node-members); `go vet ./...` shows only the two pre-existing baseline warnings (polymorphicrefs unreachable, featuretests vectorArtefactsPoolForF1 undefined) unchanged. Layer-discipline greps all clean (handler.go: 0 SQL strings; service.go: 0 `"net/http"` imports; sql.go: 0 control-flow keywords — only the const block, with FB1.2.4 adding one SELECT constant). siteAPI.yaml regen sane: 200 array response with `user_id`/`role`/`created_at` properties (all 3 required) + 403 forbidden ref. Index-stat at commit time: 6 files exactly — NV1.S06 noise (Vector_Scope.md scope-hook breadcrumbs from FB1.2.4 worker commit + docs/superpowers/specs/2026-05-26-notifications-v2-design.md residual) stashed pre-checkout from worker branch; one further `Vector_Scope.md` scope-breadcrumb mod that had been deposited on `feature/flowboard` working tree from a prior session was also stashed before merge. Merge SHA `c863407b`. **Phase 2 closeout — all 4 backend endpoint stories landed; 14 unit tests across the flowboard package; all layer discipline checks clean.** Hand-back to master for Phase 3 dispatch (FB1.3.1 — `app/components/FlowBoard/` scaffold).

**Context budget after FB1.2.3 re-validation PASS (2026-05-27, post-fix-worker SHA `85342893`):** ~45%. Fresh spawn for re-validation after the runtime UPSERT REJECT. Read both handovers + prior REJECT brief + scope §FB1.2.3 (4 AC bullets verbatim) + sql.go (one-line fix verified: `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx` → `ON CONFLICT (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)`) + mig 134 (CREATE UNIQUE INDEX over the same two columns in the same order — Postgres can pick it as arbiter). **Empirically verified against live `vector_artefacts`** via `EXPLAIN INSERT ... ON CONFLICT (cols) DO UPDATE ...` — plan returned `Conflict Resolution: UPDATE` and `Conflict Arbiter Indexes: users_flowboard_prefs_user_type_uidx`. This is the lesson worth pinning: **EXPLAIN against the real DB is a 1-second cheap check that fake-service tests cannot substitute for SQL syntax/arbiter-index resolution bugs.** Future Phase 2 stories should run EXPLAIN on every new UPSERT/MERGE/INSERT...ON CONFLICT before the PASS verdict. `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 with 12 tests passing (4 PUT WIP + 2 GET WIP + 2 smoke + 4 card-prefs: DefaultShape / JunkKey422 / ForeignUserBlocked / GetCardPrefs_NotFound404); layer discipline greps all 0 hits. Three-dot diff = 6 files (4 flowboard + 2 auto-regen siteAPI yamls), index-stat clean at merge (no NV1.S06 noise — Vector_Scope.md / docs/c_tech_debt.md / notif-v2 plan / 3 infra files stashed pre-checkout; one extra `docs/superpowers/specs/2026-05-26-notifications-v2-design.md` that had survived on `feature/flowboard` working tree from prior session was also stashed). Merge SHA `391d6e6d`. **FB1.2.3 closed.** Hand-back to master for FB1.2.4 dispatch.

**Context budget after FB1.2.3 REJECT (2026-05-27, worker SHA `8b5c342f`):** ~45%. Fresh spawn for FB1.2.3 (card-prefs endpoints). Read both handovers + scope §FB1.2.3 (4 AC bullets verbatim) + all 6 changed files (handler.go +100, service.go +99, sql.go +32, handler_test.go +196, both siteAPI.yamls +56 each). `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 (12/12 — 2 smoke + 4 PUT WIP + 2 GET WIP + 4 card-prefs); `go vet ./...` shows the two pre-existing baseline warnings unchanged. Layer-discipline greps all clean (0/0/0). AC 1 PASS (`getCardPrefs` correctly returns 200/404/403 with sentinel-derived user_id). AC 2 **FAIL at runtime** — see § Active rejection. Allowlist semantics + 422 mapping are correct, but `sqlUpsertCardPrefs` uses `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx` and mig 134 created that name as a UNIQUE INDEX, NOT a CONSTRAINT. Validator empirically verified the runtime failure against the live `vector_artefacts` DB (`EXPLAIN INSERT ... ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx` → `ERROR: constraint "users_flowboard_prefs_user_type_uidx" for table "users_flowboard_prefs" does not exist`). `pg_constraint` lookup returned 0 rows; `pg_indexes` returned 1 row — confirming the name lives as an index only. The fake-service tests don't catch this because they bypass SQL entirely. Worker's "matches sqlUpsertWipLimit pattern" claim is wrong: mig 133 declared its uniqueness via `CONSTRAINT topology_nodes_wip_limits_node_state_uq UNIQUE (...)` inline (which DOES create a pg_constraint row), but mig 134 used a bare `CREATE UNIQUE INDEX` (no `CONSTRAINT` keyword, no pg_constraint row). AC 3 PASS (sentinel `clamp.UserID` flows into service, body `req.UserID *uuid.UUID` is decoded but never read; `TestUpsertCardPrefs_ForeignUserBlocked` exercises this). AC 4 PASS (4 named tests including bonus NotFound404). One-line fix in sql.go: `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx` → `ON CONFLICT (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)`. No migration amendment needed (column-list form uses the existing unique index as arbiter). NV1.S06 working-tree noise (6 untracked/modified files: Vector_Scope.md, docs/c_tech_debt.md, notif-v2 plan, 3 infra files) never touched the branch — clean isolation. Brief written; worker can resume on same branch.

**Context budget after FB1.2.2 re-validation PASS (2026-05-27, post-fix-worker SHA `63c8e05b`):** ~45%. Fresh spawn for re-validation after the AC 1 REJECT. Read both handovers + prior REJECT brief + scope §FB1.2.2 (5 AC bullets verbatim) + all 4 changed files (handler.go, service.go, sql.go, handler_test.go) + verified the `topology_nodes_id_workspace` column name claim against `db/vector_artefacts/schema/*.sql` (mig 103 confirms `ALTER TABLE topology_nodes RENAME COLUMN workspace_id TO topology_nodes_id_workspace` — worker's choice was correct, NOT `topology_nodes_workspace_id`). Three-dot diff = 6 files (4 flowboard + 2 auto-regen siteAPI yamls), index-stat clean at merge time. AC 1 PASS: handler.go `listWipLimits` (lines 91-134) now calls `h.svc.NodeWorkspaceID(r.Context(), nodeID)` BEFORE the SQL query, and `errors.Is(err, ErrNodeNotFound) || (err == nil && nodeWS != clamp.WorkspaceID)` both collapse to HTTP 403 with `httperr.Write(w, r, http.StatusForbidden, "forbidden")` — no existence leak, no 200+empty path on cross-scope. The fix is exactly the patch the prior REJECT brief recommended. AC 2/3/4/5 still PASS (preserved untouched per the brief; PUT path unchanged). AC 5 now has 2 GET tests in addition to 4 PUT tests: `TestListWipLimits_InScope200` (200 + 1 row) and `TestListWipLimits_CrossScope403` (403 when callerWorkspaceID ≠ nodeWorkspaceID) — verified both fail without the gate and pass with it. `service.go` `NodeWorkspaceID` (lines 76-89) maps `pgx.ErrNoRows` → `ErrNodeNotFound` correctly; nil-pool returns explicit error (consistent with other methods in this file). `sql.go` `sqlSelectNodeWorkspace` uses the verified live column name `topology_nodes_id_workspace`. Layer discipline clean (handler.go: 0 SQL strings; service.go: 0 `net/http` imports — only a comment mentioning the rule; sql.go: 0 control-flow keywords, only the const block). `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 — all 8 tests pass (`TestNewHandler_NotNil` + `TestNewService_NotNil` + 4 PUT + 2 GET); `go vet ./...` shows only the two pre-existing baseline warnings (polymorphicrefs unreachable, featuretests vectorArtefactsPoolForF1 undefined) — unchanged. NV1.S06 noise (Vector_Scope.md + docs/c_tech_debt.md + 2 notif-v2 plan/spec files + 3 infra/* + 1 untracked notif-v2 plan) stashed pre-checkout, never touched the merge. Index-stat at commit time: 6 files exactly (4 flowboard + 2 siteAPI.yaml regenerated by pre-commit hook on commit). Merge SHA `71d23566`. **FB1.2.2 closed.** Hand-back to master for FB1.2.3 dispatch.

**Context budget after FB1.2.2 REJECT (2026-05-27, worker SHA `67763492`):** ~40%. Fresh spawn for FB1.2.2 (first endpoints story). Read both handovers + scope §FB1.2.2 (5 AC bullets verbatim) + spec §§3.1/3.2/7.4/8 + worker diff (6 files: 4 flowboard + 2 auto-regen siteAPI yamls). `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 with all 6 tests passing (4 new AC scenarios + 2 scaffold smokes); `go vet ./...` shows only the two pre-existing warnings (polymorphicrefs unreachable, featuretests undefined) — unchanged by this branch. Layer-discipline greps all clean (handler SQL: 0; service net/http: 0; sql.go func/if/for/switch: 0 — only const block). AC 2 PASS (PUT membership gate via ErrNotMember → 403, evidence in handler.go:166-169 + service.go:127-134 + `TestUpsertWipLimit_NonMember403`). AC 3 PASS (`updated_by = $5`, `updated_at = now()` in sqlUpsertWipLimit; `TestUpsertWipLimit_MemberAllowed` asserts response UpdatedBy matches caller). AC 4 PASS (`Limit *int` → `limit` SQL NULL via pgx pointer mapping in service.go:147; type-level safety; `TestUpsertWipLimit_MemberAllowed` round-trips a non-nil int and the Idempotent test exercises overwrite). AC 5 PASS (all four named test funcs present and green). **AC 1 FAIL** — see § Active rejection. Worker self-flagged the divergence and offered a defensible security argument (200+empty leaks less than 403 against cross-workspace probing), but the AC text is verbatim and explicit: "out-of-scope returns 403, not 404." The validator cannot accept reinterpretation of a verbatim AC bullet on its own authority. Brief written with the minimal patch (sentinel-scope check at top of listWipLimits + matching GET cross-scope test). Master can choose to revise the AC text if it wants to keep the 200+empty behavior — but as written, the AC requires 403.

**Context budget after FB1.2.1 PASS (2026-05-27, worker SHA `2db247ff`):** ~50%. Fresh spawn for Phase 2 opener. Read both handovers + scope §FB1.2.1 (4 AC bullets verbatim) + spec §4 (component anatomy) + spec §8 (5-endpoint backend surface, all `/_site/` per transport segregation, `/topology/{id}/members` owned by flowboard package). Three-dot diff = 8 files (5 new in `backend/internal/flowboard/` + `backend/cmd/server/main.go` + `siteAPI.yaml` + `api-reference/static/siteAPI.yaml` auto-regen from pre-commit hook). YAML regen contains exactly 3 path entries (/flowboard/prefs, /flowboard/wip, /topology/{id}/members) = 5 ops total — no spurious unrelated route churn. Layer-discipline greps all 0 hits (handler.go SQL: 0; service.go net/http: 0 — only pgxpool; sql.go func/if/for/switch: 0 — only `const` block with 5 named empty strings). `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 (2 smoke tests pass — `TestNewHandler_NotNil`, `TestNewService_NotNil`); `go vet ./...` exit 1 — but the two warnings (`polymorphicrefs/service.go:136 unreachable code` + `featuretests vectorArtefactsPoolForF1 undefined`) are pre-existing on `feature/flowboard` baseline (verified by checking out baseline, re-running vet, getting the identical two warnings). Not introduced by FB1.2.1. All 4 AC bullets PASS. Main.go wiring confirmed: `flowboard.NewService(vaPool)` constructed after `orgDesignSvc` (line ~579), `flowboardH.Mount(r)` called inside `mountSiteRoutes` within a `RequireAuth + RequireFreshPassword + httprate.LimitByIP` group (line ~1882). Five handler methods all return `http.StatusNotImplemented` with `// TODO(FB1.2.N)` comments naming the implementing story. Worker self-report verified accurate end-to-end. Squash-merged with index-stat clean (8 files exactly as expected, no master-handover or scope-hook noise bundled — `handovers/flowboard-master.md` master edits + `Vector_Scope.md` scope-hook breadcrumbs both stashed pre-merge and re-popped post-commit). Merge SHA `ff9a6613`.

## § Active rejection

(none — FB1.2.3 REJECT resolved by `85342893` and re-validated; merged as `391d6e6d`. The historical REJECT briefs from FB1.2.3 / FB1.2.2 / FB1.1.3 / FB1.1.2 are retained below for audit trail; the next worker dispatch starts with a clean slate.)

### REJECT — FB1.2.3 — 2026-05-27 (RESOLVED 2026-05-27 — kept for audit trail)

**Branch:** `fb1-2-3-card-prefs`
**Worker last SHA:** `8b5c342f`

**Failed AC bullets:**

- AC: *"`PUT /_site/flowboard/prefs` UPSERTs the caller's row on (`user_id`, `artefact_type_id`); body validates against allowlist `["id","title","assignee","points","priority","status","created_at","updated_at"]`; junk keys return 422."* — **FAIL** at runtime.

  `backend/internal/flowboard/sql.go` lines 102-116 `sqlUpsertCardPrefs` uses `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx`. Mig 134 (`db/vector_artefacts/schema/134_users_flowboard_prefs.sql` lines 34-38) creates `users_flowboard_prefs_user_type_uidx` via `CREATE UNIQUE INDEX` — which makes an INDEX, not a CONSTRAINT. PostgreSQL's `ON CONFLICT ON CONSTRAINT <name>` only resolves names registered in `pg_constraint`; a bare `CREATE UNIQUE INDEX` is NOT promoted to a constraint row. Validator verified directly against the live `vector_artefacts` DB:

  ```
  SELECT conname FROM pg_constraint WHERE conname = 'users_flowboard_prefs_user_type_uidx';
  -- 0 rows
  SELECT indexname FROM pg_indexes WHERE indexname = 'users_flowboard_prefs_user_type_uidx';
  -- 1 row: users_flowboard_prefs_user_type_uidx
  ```

  And confirmed empirically that a real UPSERT with the worker's SQL throws:

  ```
  EXPLAIN INSERT INTO users_flowboard_prefs (...) VALUES (...) ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx DO UPDATE ...;
  ERROR:  constraint "users_flowboard_prefs_user_type_uidx" for table "users_flowboard_prefs" does not exist
  ```

  The worker's claim that the pattern matches `sqlUpsertWipLimit` is wrong: mig 133 declares its uniqueness inline via `CONSTRAINT topology_nodes_wip_limits_node_state_uq UNIQUE (...)` in CREATE TABLE — that DOES create a `pg_constraint` row. Mig 134 took a different path (`CREATE UNIQUE INDEX`, no `CONSTRAINT` keyword anywhere), so the named constraint does not exist.

  Tests pass green ONLY because `handler_test.go` uses a fake service whose `UpsertCardPrefs` is a Go map operation that never touches PostgreSQL — the SQL string is dead code in tests. The bug is invisible until the endpoint is hit against a real DB.

**Passing AC bullets (preserve — do NOT redo):**

- ✅ AC 1 (GET 200 with caller's row OR 404 if absent): `handler.go getCardPrefs` (lines 209-234) correctly reads `clamp.UserID` from the sentinel, parses `artefact_type_id` from query string, calls `svc.GetCardPrefs(callerUserID, artefactTypeID)`, maps `ErrCardPrefsNotFound` → 404 with JSON body, else 200 with DTO. `TestGetCardPrefs_NotFound404` exercises the 404 path. Missing-clamp returns 403 (`clamp.UserID == uuid.Nil`).
- ✅ AC 2 — allowlist semantics in Go (junk → 422): `service.go UpsertCardPrefs` (lines 252-257) iterates `fields` and returns `fmt.Errorf("%w: %q", ErrInvalidCardField, f)` on first miss. The 8-key allowlist (`service.go` lines 51-60) is EXACTLY `["id","title","assignee","points","priority","status","created_at","updated_at"]` per AC verbatim. Handler maps `ErrInvalidCardField` → 422 with `{"error": ...}` body (handler.go 284-289). `TestUpsertCardPrefs_JunkKey422` exercises this. This part of AC 2 PASSES — only the UPSERT SQL is broken.
- ✅ AC 3 (caller_user_id wins, body user_id ignored): `handler.go upsertCardPrefs` (line 278) passes `clamp.UserID` to `svc.UpsertCardPrefs(...)` — NOT `req.UserID`. The `UserID *uuid.UUID` field on `upsertCardPrefsRequest` (line 242, comment: "ignored — sentinel wins") is decoded but never read. Validator traced dataflow end-to-end: handler `clamp.UserID` → service signature `callerUserID uuid.UUID` → SQL `$1 = user_id` — body `user_id` is decoded and dropped. `TestUpsertCardPrefs_ForeignUserBlocked` proves the test fake stores by sentinel user_id (the real service does the same via the parameter binding).
- ✅ AC 4 (3 tests: default-shape PUT, junk-key 422, foreign-user blocked + bonus NotFound404): all four tests present and green — `TestUpsertCardPrefs_DefaultShape`, `TestUpsertCardPrefs_JunkKey422`, `TestUpsertCardPrefs_ForeignUserBlocked`, `TestGetCardPrefs_NotFound404`.
- ✅ Layer discipline: handler.go 0 SQL strings; service.go 0 `"net/http"` imports; sql.go 0 control-flow keywords (only const block). All three greps clean.
- ✅ Build + tests + vet: `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 (12/12 pass — 2 smoke + 4 PUT WIP + 2 GET WIP + 4 card-prefs); `go vet ./...` shows only the two pre-existing baseline warnings (polymorphicrefs unreachable + featuretests vectorArtefactsPoolForF1 undefined) — unchanged.
- ✅ Three-dot diff scope: 6 files exactly (handler.go +100, service.go +99, sql.go +32, handler_test.go +196, siteAPI.yaml +56, api-reference/static/siteAPI.yaml +56). No NV1.S06 noise bundled into the branch.
- ✅ `CardPrefsDTO` shape correctness (service.go 76-80): `artefact_type_id` UUID + `card_fields []string` + `updated_at` time. Matches AC's GET 200 contract.
- ✅ siteAPI.yaml regen sane (no unrelated route churn — validator did not deep-read the YAML diff but the file-count and line-count match expectations).
- ✅ Commit subject contains `[FB1.2.3]` ref-tag.
- ✅ `sqlSelectCardPrefs` is correct (SELECT-only, no UPSERT primitive needed; reads by (user_id, artefact_type_id) and returns ErrNoRows when missing — handler maps to 404).
- ✅ `sqlSelectNodeWorkspace` constant (sql.go 123-126) untouched from FB1.2.2 fix — correct.

**Other gate failures:** None beyond the constraint-name mismatch. No HARD-RULE violations. No bundled unrelated files.

**Recommended fix (single-line SQL edit, NO migration needed):**

Replace the conflict-target line in `backend/internal/flowboard/sql.go` `sqlUpsertCardPrefs`:

```sql
-- WRONG (current worker output, line ~110):
ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx

-- RIGHT (column-list form — uses the existing unique index as the arbiter):
ON CONFLICT (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)
```

PostgreSQL's column-list `ON CONFLICT` resolves the arbiter via any unique index over those columns — the existing `users_flowboard_prefs_user_type_uidx` UNIQUE INDEX is found and used as the conflict arbiter. No mig 134 amendment required; no other code changes; no test changes.

**Optional second test (NICE-TO-HAVE, NOT REQUIRED for re-validation):** add a real-DB roundtrip test under a build tag (e.g. `integrationdb`) that hits the actual `vector_artefacts` pool to UPSERT a row twice and assert idempotency. This would catch the bug class going forward. Not required for this REJECT-fix cycle.

**Do not change:**

- handler.go — all four endpoints + sentinel gating are correct.
- service.go `GetCardPrefs`, `UpsertCardPrefs` — Go-side logic correct; only the SQL string changes.
- `allowedCardFields` map — 8 keys exactly per AC verbatim.
- `CardPrefsDTO`, `upsertCardPrefsRequest`, `getCardPrefs`, `upsertCardPrefs` handler methods — correct.
- All 12 tests — green; preserve.
- `sqlSelectCardPrefs` constant — correct.
- migration 134 — DO NOT amend (would force a re-apply against an already-migrated DB; column-list ON CONFLICT works against the existing unique index).

**Worker prompt seed:**

> Open `backend/internal/flowboard/sql.go` `sqlUpsertCardPrefs`. The current line `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx` fails at runtime against the live `vector_artefacts` DB with `ERROR: constraint "users_flowboard_prefs_user_type_uidx" for table "users_flowboard_prefs" does not exist` — mig 134 created that name as a UNIQUE INDEX (not a CONSTRAINT), and PostgreSQL's `ON CONFLICT ON CONSTRAINT` requires a row in `pg_constraint`. Replace the conflict-target with the column-list form: `ON CONFLICT (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)` — this uses the existing unique index as the arbiter without requiring a constraint. DO NOT change mig 134, handler.go, service.go business logic, the allowlist map, the DTO shape, or any tests. Re-run `go build ./...` + `go test ./internal/flowboard/...` (both should remain green — tests use a fake service that never touches SQL). Commit on the same branch `fb1-2-3-card-prefs` with subject `fix(flowboard): card-prefs UPSERT — use column-list ON CONFLICT [FB1.2.3]`. Push and report new SHA to master.

(Historical REJECT briefs retained below for audit trail.)


### REJECT — FB1.2.2 — 2026-05-27 (RESOLVED 2026-05-27 — kept for audit trail)

**Branch:** `fb1-2-2-wip-endpoints`
**Worker last SHA:** `67763492` (recovery worker on top of an aborted original)

**Failed AC bullets:**

- AC: *"`GET /_site/flowboard/wip?node_id=&artefact_type_id=` returns 200 with array of WIP rows (each carries flow_state name + state id + limit); sentinel-clamped — **out-of-scope returns 403, not 404**."* — **FAIL**.

  `backend/internal/flowboard/handler.go:85-118` (`listWipLimits`) only returns 403 when the sentinel clamp itself is missing (`clamp.WorkspaceID == uuid.Nil`). For a request where the clamp IS valid but `node_id` belongs to a different workspace, the implementation falls through to the SQL query whose `WHERE topology_nodes_wip_limits_workspace_id = $2` clause filters out cross-workspace rows — so the handler emits **200 with an empty array `[]`** (handler.go:121: `writeJSON(w, http.StatusOK, rows)` with `rows` initialised to `make([]WipLimitDTO, 0)` in service.go:81).

  Verbatim handler comment (handler.go:79-86) confirms the intent: *"A node_id whose workspace differs from the sentinel WorkspaceID is invisible to this query — the WHERE clause in sqlSelectWipLimitsByNode enforces workspace_id = $2, so cross-workspace requests receive an empty array (200) rather than 403"*.

  The AC text is verbatim and explicit. It does not say "may return 200 with empty" or "out-of-scope is invisible." It says **"out-of-scope returns 403, not 404"** — choosing 403 deliberately over 404. 200+empty is a third option the AC does not authorise. The verdict bar is strict per the validator contract: "every AC bullet must be verifiable from the diff or a passing test"; a passing test for `expected 403, got 200` cannot exist against this implementation.

  Additionally, **AC 5 names four scenarios** (`member-allowed + non-member-403 + cross-scope-403 + UPSERT-idempotent`) but all four implemented tests exercise PUT only. There is **no GET test in `handler_test.go`** — neither a happy-path GET nor a cross-scope GET. The "cross-scope-403" scenario named in AC 5 is satisfiable as either GET or PUT; the worker chose PUT. Once GET cross-scope returns 403 (per the fix), a GET cross-scope test should be added so the AC 1 contract is pinned.

  Note on the security argument: the worker's defensible position is that **200+empty actually leaks less existence information than 403** — a 403 confirms the node_id resolves to a node in some workspace, whereas 200+empty cannot be distinguished from "node exists in your scope but has no WIP rows yet." This is a real argument and the validator agrees it has merit. **However**, the AC text was written by master with full knowledge of these tradeoffs, and the verdict bar requires verbatim AC compliance. If master wants the 200+empty behavior, master must revise the AC text in `Vector_Scope.md` § FB1.2.2 first, then redispatch — the validator cannot reinterpret a verbatim AC on its own authority. (Spec §8 says "Read is allowed for any user with `artefacts_read` at the node's scope" — that line could be read either way, but the scope-§FB1.2.2 AC text is the binding contract for this story.)

**Passing AC bullets (preserve — do NOT redo):**

- ✅ AC 2 (PUT membership gate): `service.go:127-134` queries `sqlCheckMembership`; pgx.ErrNoRows → ErrNotMember; handler.go:166-169 maps ErrNotMember → 403. `TestUpsertWipLimit_NonMember403` exercises this path and passes.
- ✅ AC 3 (updated_by + updated_at on every write): `sqlUpsertWipLimit` (sql.go:39-66) sets both columns on INSERT (`now(), $5`) AND on UPDATE (`SET ... updated_at = now(), updated_by = EXCLUDED.updated_by`). `TestUpsertWipLimit_MemberAllowed` asserts the returned `UpdatedBy` matches the caller's UserID.
- ✅ AC 4 (empty limit → SQL NULL): `Limit *int` in the request struct + `limit` parameter typed `*int` end-to-end + pgx pointer-NULL mapping in service.go:147. `TestUpsertWipLimit_Idempotent` round-trips a non-nil int through the store; the *int type discipline plus the JSON `null`/missing-field → nil mapping is sufficient evidence. (A test asserting `*int == nil` would be a nice-to-have but not required by the AC text.)
- ✅ AC 5 (four named scenarios): all four test function names present and green — `TestUpsertWipLimit_MemberAllowed`, `_NonMember403`, `_CrossScope403`, `_Idempotent`. Cross-scope-403 currently covers PUT; once AC 1 fix lands, add a parallel GET cross-scope test.
- ✅ Layer discipline: handler.go contains zero SQL strings; service.go has no `"net/http"` import; sql.go has only a `const` block, no functions/conditionals/loops. All three layer-discipline greps return 0 hits.
- ✅ Build + tests + vet: `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 (6/6 tests pass — 4 AC scenarios + `TestNewHandler_NotNil` + `TestNewService_NotNil`); `go vet ./...` exit 1 with only the two pre-existing baseline warnings (polymorphicrefs unreachable + featuretests vectorArtefactsPoolForF1 undefined) — unchanged by this branch.
- ✅ Three-dot diff scope: 6 files exactly as expected (4 flowboard + 2 auto-regen siteAPI yamls). No NV1.S06 noise bundled into the commit (recovery worker correctly left scope files / notif-v2 spec changes in the working tree, unstaged).
- ✅ siteAPI.yaml regen: parameter shapes + response schemas (200 with array of `{flow_state_id, flow_state_name, limit, updated_at, updated_by}`) match the handler/DTO. No unrelated route churn.
- ✅ Commit subject contains `[FB1.2.2]` ref-tag.
- ✅ DTO shape correctness: `WipLimitDTO` includes `flow_state_id`, `flow_state_name`, `limit` per AC 1; plus `updated_at` + `updated_by` audit fields per AC 3. Matches the joined SQL (sql.go:23-34) which `JOIN flows_states ... ORDER BY flows_states_sort_order`.
- ✅ Test infrastructure: pre-existing `serviceIface` + `newHandlerWithIface` from the FB1.2.1 scaffold enable fake-service injection — no surprise refactor introduced by this story.

**Other gate failures:** None. No HARD-RULE violations. No layer-discipline breakage. No bundled unrelated files. Build + lint + vet all clean.

**Recommended fix (single concrete change to handler.go + one new test):**

1. **handler.go `listWipLimits`** — add an explicit sentinel-scope check on `node_id` BEFORE the SQL query. Specifically: extend `serviceIface` with a `NodeWorkspaceID(ctx, nodeID) (uuid.UUID, error)` method that returns the owning workspace_id of a topology node (with `pgx.ErrNoRows` → a new sentinel error `ErrNodeNotFound` or simply propagated). In `listWipLimits`, after parsing `nodeID` and before calling `ListWipLimits`:

   ```go
   nodeWS, err := h.svc.NodeWorkspaceID(r.Context(), nodeID)
   if errors.Is(err, ErrNodeNotFound) {
       // Node does not exist — return 403, not 404 (per AC: do not leak existence).
       httperr.Write(w, r, http.StatusForbidden, "forbidden")
       return
   }
   if err != nil {
       httperr.Write(w, r, http.StatusInternalServerError, "failed to resolve node workspace")
       return
   }
   if nodeWS != clamp.WorkspaceID {
       httperr.Write(w, r, http.StatusForbidden, "forbidden")
       return
   }
   ```

   This satisfies the AC verbatim: out-of-scope returns 403, not 404. Both cases (node doesn't exist AND node belongs to other workspace) collapse to the same 403 response so existence-leakage stays contained.

2. **service.go** — add `NodeWorkspaceID` method. SQL: `SELECT topology_nodes_workspace_id FROM topology_nodes WHERE topology_nodes_id = $1`. New sentinel error `ErrNodeNotFound` exported alongside `ErrNotMember`. Update `serviceIface` to include the method.

3. **sql.go** — add `sqlSelectNodeWorkspace` constant.

4. **handler_test.go** — add two GET tests:
   - `TestListWipLimits_InScope200` — fake service returns nodeWS == callerWS; expect 200 + array.
   - `TestListWipLimits_CrossScope403` — fake service returns nodeWS ≠ callerWS; expect 403.

   The fake service's `NodeWorkspaceID` mirrors `setNodeWorkspace`/`workspaceForNode` plumbing already present.

5. **Update the handler.go doc comment block** at line 79-86 to reflect the new behavior (out-of-scope returns 403 per AC) — drop the "200 with empty array" explanation, replace with the AC-citation.

6. **Commit on the same branch** `fb1-2-2-wip-endpoints` with subject `fix(flowboard): GET listWipLimits returns 403 on cross-scope per AC 1 [FB1.2.2]`. Re-push, report new SHA to master.

**Do not change:**

- The four passing PUT tests — all green, preserve as-is.
- The membership-gate logic in `service.go.UpsertWipLimit` (lines 127-134) — correct.
- The `sqlUpsertWipLimit` SQL — correct: ON CONFLICT ON CONSTRAINT name `topology_nodes_wip_limits_node_state_uq` matches mig 133 exactly.
- The `WipLimitDTO` shape, `Limit *int` typing, JSON tags — all correct.
- The siteAPI.yaml auto-regen — leave the pre-commit hook to regenerate it cleanly on the next commit.
- The `Mount` route table — five routes correctly registered; only listWipLimits' internals change.
- main.go wiring — untouched, no need to change.

**Worker prompt seed:**

> Re-open `backend/internal/flowboard/handler.go` `listWipLimits`. The current implementation returns 200 with an empty array when `node_id` belongs to a different workspace than the sentinel clamp. The AC for FB1.2.2 says verbatim: "out-of-scope returns 403, not 404." Add an explicit sentinel-scope check on the node before the SQL query: (1) add a `NodeWorkspaceID(ctx, nodeID) (uuid.UUID, error)` method to `Service` + `serviceIface` with sentinel error `ErrNodeNotFound`, backed by a new `sqlSelectNodeWorkspace` constant (`SELECT topology_nodes_workspace_id FROM topology_nodes WHERE topology_nodes_id = $1`); (2) in `listWipLimits`, call it after parsing nodeID — both `ErrNodeNotFound` and `nodeWS != clamp.WorkspaceID` collapse to 403 (so existence is not leaked); (3) update the handler.go doc comment to match the new behavior; (4) add `TestListWipLimits_InScope200` and `TestListWipLimits_CrossScope403` to `handler_test.go` (extend the fake service with `NodeWorkspaceID` using the existing `workspaceForNode` map). Do NOT touch the PUT path, the membership gate, the WipLimitDTO shape, or the SQL constants for UPSERT. Run `go build ./...` + `go test ./internal/flowboard/...` locally; both must pass. Commit on the same branch `fb1-2-2-wip-endpoints` with subject `fix(flowboard): GET listWipLimits returns 403 on cross-scope per AC 1 [FB1.2.2]`. Report the new SHA to master.

(Historical REJECT briefs from Phase 1 retained below for audit trail.)
---


### REJECT — FB1.1.3 — 2026-05-27T03:17Z (RESOLVED 2026-05-27 — kept for audit trail)

**Branch:** `fb1-1-3-mig-134-user-prefs`
**Worker last SHA:** `c4068701` (pre-emptive fix-worker strip of inline `-- ---- DOWN ----` comment block on top of original `d7d3e1eb`)

**Failed AC bullets:**

- AC: *"`db/vector_artefacts/schema/134_users_flowboard_prefs.sql` applies clean; `schema_migrations` row 134 exists."* — **FAIL**. Migration aborts on apply against live `vector_artefacts`:

  ```
  BEGIN
  psql:db/vector_artefacts/schema/134_users_flowboard_prefs.sql:31: ERROR:
    foreign key constraint "users_flowboard_prefs_users_flowboard_prefs_user_id_fkey"
    cannot be implemented
  DETAIL: Key columns "users_flowboard_prefs_user_id" and "users_id" are of
    incompatible types: bigint and uuid.
  ```

  The UP file declares `BIGSERIAL` PK and `BIGINT` FKs but `users.users_id` and `artefacts_types.artefacts_types_id` are both `uuid` in the live schema (verified via `information_schema.columns` against the dev tunnel). Whole transaction rolled back; no table created. No DB damage.

- AC: *"Table has PK `users_flowboard_prefs_id`, FKs to `users` + `artefact_types` (both CASCADE), `users_flowboard_prefs_card_fields JSONB NOT NULL`, denorm workspace_id, `updated_at`."* — **FAIL (type half)**. Column names + ON DELETE CASCADE + JSONB NOT NULL + denorm workspace_id + updated_at default — all correct. BUT the PK is `BIGSERIAL` and the three integer columns (`user_id` FK, `artefact_type_id` FK, `workspace_id` denorm) are `BIGINT`. Per the spec correction in `f98bc796` and the merged mig 132 precedent, the PK MUST be `uuid PRIMARY KEY DEFAULT gen_random_uuid()` and all three remaining integer columns MUST be `uuid`.

  Reference (already-merged mig 132 shape, `df6d412c`):

  ```sql
  topology_nodes_members_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topology_nodes_members_node_id      uuid NOT NULL REFERENCES topology_nodes(topology_nodes_id) ON DELETE CASCADE,
  topology_nodes_members_user_id      uuid NOT NULL REFERENCES users(users_id) ON DELETE CASCADE,
  topology_nodes_members_workspace_id uuid NOT NULL,
  ```

**Passing AC bullets (preserve — do NOT redo):**

- ✅ UNIQUE constraint on (`user_id`, `artefact_type_id`). Implemented as `CREATE UNIQUE INDEX users_flowboard_prefs_user_type_uidx ON users_flowboard_prefs (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id);`.
- ✅ Every column carries the full `users_flowboard_prefs_` prefix; `npm run lint:column-prefix-convention` exits 0 cleanly.
- ✅ DOWN migration structure correct (BEGIN → DROP INDEX × 2 → DROP TABLE IF EXISTS → COMMIT). DOWN does not need any change.
- ✅ Fix-worker's pre-emptive strip of the inline `-- ---- DOWN ----` comment block in the UP file (commit `c4068701`) is correct — keep that fix.
- ✅ Only 2 files touched in the three-dot diff (UP + DOWN). No collateral.
- ✅ `grep -n schema_migrations` on both files: 0 hits. No INSERT, no DELETE, no comment reference. Fix-worker's earlier sweep is correct.
- ✅ UP shape matches canonical 132/133: BEGIN → CREATE TABLE → CREATE INDEX × 2 → COMMIT. Only the type declarations inside CREATE TABLE are wrong.
- ✅ Commit subject contains `[FB1.1.3]` ref-tag.

**Other gate failures:** None beyond the type mismatch. No layer-discipline check applicable (no Go touched). No HARD RULE violations. No bundled unrelated files.

**Recommended fix (single concrete change, ~4 character substitutions):**

In `db/vector_artefacts/schema/134_users_flowboard_prefs.sql`, replace the CREATE TABLE block (lines 22-31) with:

```sql
CREATE TABLE users_flowboard_prefs (
    users_flowboard_prefs_id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    users_flowboard_prefs_user_id          uuid        NOT NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    users_flowboard_prefs_artefact_type_id uuid        NOT NULL
        REFERENCES artefacts_types(artefacts_types_id) ON DELETE CASCADE,
    users_flowboard_prefs_card_fields      JSONB       NOT NULL,
    users_flowboard_prefs_workspace_id     uuid        NOT NULL,
    users_flowboard_prefs_updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Four type substitutions only:
1. `BIGSERIAL` → `uuid        PRIMARY KEY DEFAULT gen_random_uuid()` on PK column.
2. `BIGINT` → `uuid` on `users_flowboard_prefs_user_id`.
3. `BIGINT` → `uuid` on `users_flowboard_prefs_artefact_type_id`.
4. `BIGINT` → `uuid` on `users_flowboard_prefs_workspace_id`.

Everything else — column names, NOT NULLs, ON DELETE CASCADE refs, JSONB, TIMESTAMPTZ default, both indexes, BEGIN/COMMIT envelope, the entire DOWN file, the header comment block — stays untouched.

**Do not change:**

- DOWN file: zero edits. It's correct as-is.
- Indexes (UNIQUE + workspace_idx): zero edits. Correct.
- Column names + `users_flowboard_prefs_` prefix: zero edits. Lint-clean.
- File header comment block: zero edits.
- BEGIN/COMMIT envelope: zero edits.
- The fix-worker's earlier strip of the inline DOWN comment block (commit `c4068701`): keep it.

**Worker prompt seed:**

> Re-open `db/vector_artefacts/schema/134_users_flowboard_prefs.sql`. The CREATE TABLE on lines 22-31 uses `BIGSERIAL` PK + `BIGINT` FKs, but the live `vector_artefacts` schema has UUID PKs on `users.users_id` and `artefacts_types.artefacts_types_id` — the migration aborts on apply with a FK type-mismatch error. Replace `BIGSERIAL` on the PK with `uuid PRIMARY KEY DEFAULT gen_random_uuid()` and replace each `BIGINT` (3 of them — `users_flowboard_prefs_user_id`, `users_flowboard_prefs_artefact_type_id`, `users_flowboard_prefs_workspace_id`) with `uuid`. Match the already-merged mig 132 exactly (see `db/vector_artefacts/schema/132_topology_nodes_members.sql`). DO NOT touch the DOWN file, indexes, comments, or anything else. Commit on the same branch `fb1-1-3-mig-134-user-prefs` with subject `fix(flowboard): mig 134 — UUID types for PK and FKs to match live schema [FB1.1.3]`, push, and report the new SHA to master.

(Audit trail of resolved FB1.1.2 REJECT below.)

### REJECT — FB1.1.2 — 2026-05-27 (RESOLVED 2026-05-27 — kept for audit trail)

**Branch:** `fb1-1-2-mig-133-wip-limits`
**Worker last SHA:** `459efbb1` (post-cherry-pick; original worker SHA was `0f599c88`, content identical)

**Failed AC bullets:**

- AC: *"`db/vector_artefacts/schema/133_topology_nodes_wip_limits.sql` applies clean; `schema_migrations` row 133 exists."* — **FAIL** because the UP file contains `INSERT INTO schema_migrations (version) VALUES (133);` at line 51, and the live `schema_migrations` table has no `version` column (only `filename TEXT PK` + `applied_at TIMESTAMPTZ`). Verified by `\d schema_migrations` against `vector_artefacts` via the dev tunnel. Direct apply with `psql -v ON_ERROR_STOP=1 -f` produced:

  ```
  BEGIN
  CREATE TABLE
  CREATE INDEX
  psql:db/vector_artefacts/schema/133_topology_nodes_wip_limits.sql:51: ERROR:  column "version" of relation "schema_migrations" does not exist
  LINE 1: INSERT INTO schema_migrations (version) VALUES (133);
  ```

  Transaction rolled back. Table not created. The merged FB1.1.1 mig 132 has no such `INSERT` — it relies on the validator to backfill the ledger row separately, which is documented in this handover's "Migration apply protocol" section and in the dispatch prompt itself.

- AC: *"DOWN migration drops the table; round-trip verified."* — **FAIL** for the same reason. The DOWN file at `db/vector_artefacts/schema/down/133_topology_nodes_wip_limits.sql` contains `DELETE FROM schema_migrations WHERE version = 133;` at line 14, which would error against the same non-existent column. (Round-trip is otherwise structurally fine — `DROP INDEX` + `DROP TABLE` would succeed; only the third statement is broken.)

**AC bullets that PASS (preserve this work — do NOT rewrite from scratch):**

- ✅ Table PK `topology_nodes_wip_limits_id UUID DEFAULT gen_random_uuid()`.
- ✅ FK `topology_nodes_wip_limits_node_id` → `topology_nodes(topology_nodes_id) ON DELETE CASCADE`.
- ✅ FK `topology_nodes_wip_limits_flow_state_id` → `flows_states(flows_states_id) ON DELETE CASCADE` (correct post-rename table name and PK column name).
- ✅ `topology_nodes_wip_limits_limit INT` nullable (NULL = unlimited per Rally convention).
- ✅ `topology_nodes_wip_limits_workspace_id UUID NOT NULL` denorm.
- ✅ `topology_nodes_wip_limits_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
- ✅ `topology_nodes_wip_limits_updated_by UUID` nullable, FK to `users(users_id)`.
- ✅ `UNIQUE (topology_nodes_wip_limits_node_id, topology_nodes_wip_limits_flow_state_id)` — constraint named `topology_nodes_wip_limits_node_state_uq`.
- ✅ Index `ix_topology_nodes_wip_limits_node` on `topology_nodes_wip_limits_node_id`.
- ✅ Every column carries the full `topology_nodes_wip_limits_` prefix. `npm run lint:column-prefix-convention` exits 0 with the worker's files staged.
- ✅ Separate UP / DOWN files (`schema/` + `schema/down/`).
- ✅ BEGIN/COMMIT envelope on both files.
- ✅ Commit subject contains `[FB1.1.2]` ref-tag.

**Other gate failures:** None beyond the two `schema_migrations` row writes. Layer discipline N/A (no Go touched). No HARD-RULE violations.

**Recommended fix (single-file, minimal touch):**

1. In `db/vector_artefacts/schema/133_topology_nodes_wip_limits.sql`, **delete** line 51 (`INSERT INTO schema_migrations (version) VALUES (133);`) entirely. The whole "schema_migrations row (runner expects this to mark completion)" comment block and INSERT goes — runner expects no such thing; validator backfills externally.
2. In `db/vector_artefacts/schema/down/133_topology_nodes_wip_limits.sql`, **delete** line 14 (`DELETE FROM schema_migrations WHERE version = 133;`) entirely.
3. Also strip the matching inline `-- ---- DOWN ----` reference block in the UP file (the commented-out `DELETE FROM schema_migrations WHERE version = 133;` at line 56 in the UP file's reference DOWN comment). Cleaner to just match the pattern in mig 132 — no DOWN reference inline at all, since the real DOWN lives in `schema/down/`.
4. Re-commit on the same branch (`fb1-1-2-mig-133-wip-limits`) with subject `feat(flowboard): mig 133 — topology_nodes_wip_limits WIP-cap table [FB1.1.2]` (same as before).
5. Push and re-report SHA to master.

**Do not change:**

- The table definition itself (columns, FKs, UNIQUE, indexes) — all PASS, structurally correct, lint-clean.
- File locations or names.
- BEGIN/COMMIT envelopes.
- The header comment block (it's already in the standard form).

**Reference pattern:** the merged `db/vector_artefacts/schema/132_topology_nodes_members.sql` (on `feature/flowboard` now) shows the correct shape — BEGIN → CREATE TABLE → CREATE INDEX×2 → COMMIT, no ledger writes inside the transaction.

## § Branch model (post-recovery 2026-05-27)

Workers cannot create `feature/flowboard/<slug>` branches because `feature/flowboard` exists as a branch ref (git refuses nested paths under an existing ref). Per-story branch names are **flat**:
- `fb1-1-1-mig-132-members`
- `fb1-1-2-mig-133-wip-limits`
- `fb1-1-3-mig-134-user-prefs`
- `fb1-N-N-<slug>` going forward.

Integration branch is still `feature/flowboard`.

**Diff command for validator:** use **three-dot** form `git diff feature/flowboard...<story-branch>` (not two-dot) so the diff is merge-base relative. Two-dot will include changes that happened on `feature/flowboard` after the worker forked, which is noise.

## § Spec correction landed in `f98bc796`

Live `vector_artefacts` schema uses UUID for every PK/FK; spec showed BIGINT. Plus `artefact_types→artefacts_types` (mig 062) and `flow_states→flows_states` (mig 061). Workers correctly used UUID and live table names. Verify the migrations use UUID + the post-rename table names; if they don't, REJECT.

## § Verdict ledger

| # | story | branch | verdict | merge SHA | timestamp | notes |
|---|---|---|---|---|---|---|
| 1 | FB1.1.1 | fb1-1-1-mig-132-members | PASS | df6d412c | 2026-05-27 | mig 132 applied directly via psql against vector_artefacts; schema_migrations row backfilled (`132_topology_nodes_members.sql`); `\d topology_nodes_members` confirms UUID PK + FKs ON DELETE CASCADE + UNIQUE (node_id, user_id) + 2 ix indexes + 6 fully-prefixed columns; `npm run lint:column-prefix-convention` green; DOWN file static-verified (BEGIN/DROP INDEX×2/DROP TABLE/COMMIT). All 5 AC PASS. |
| 2 | FB1.1.2 | fb1-1-2-mig-133-wip-limits | REJECT | — | 2026-05-27 | Worker SHA `459efbb1`. Table definition + columns + FKs + UNIQUE + indexes + column-prefix lint ALL PASS. Apply failed because UP file line 51 has `INSERT INTO schema_migrations (version) VALUES (133)` and the live table has no `version` column (only `filename TEXT PK` + `applied_at`); transaction rolled back, no DB damage. DOWN file has the same defect at line 14. Brief in §Active rejection asks worker to delete those two lines + inline DOWN-comment block; preserve everything else. |
| 3 | FB1.1.2 | fb1-1-2-mig-133-wip-limits | PASS | cc4abf58 | 2026-05-27 | **After REJECT + fix cycle.** Fix-worker SHA `22e3d00f` made the recommended surgical edit (removed the two `schema_migrations` row writes — INSERT in UP, DELETE in DOWN — nothing else). Re-validated: grep confirms zero `schema_migrations` text in either file; three-dot diff shows only the 2 migration files; column-prefix lint green; UP applied cleanly to vector_artefacts via direct psql (BEGIN → CREATE TABLE → CREATE INDEX → COMMIT); schema_migrations row 133 backfilled externally; `\d topology_nodes_wip_limits` confirms UUID PK + FKs to topology_nodes/flows_states (ON DELETE CASCADE) + FK to users (nullable updated_by) + UNIQUE on (node_id, flow_state_id) + ix on node_id + 7 fully-prefixed columns. All 5 AC PASS. Structural content was correct from the start; only the schema_migrations row writes needed removal. |
| 4 | FB1.1.3 | fb1-1-3-mig-134-user-prefs | REJECT | — | 2026-05-27T03:17Z | Worker SHA `c4068701` (fix-worker on top of `d7d3e1eb`). Column names + prefixes + lint + UP/DOWN structural shape + UNIQUE index + workspace index all PASS. Apply failed at FK creation: `users_flowboard_prefs_user_id BIGINT` cannot FK to `users.users_id uuid`. Live `vector_artefacts` schema is UUID throughout (verified `users.users_id` + `artefacts_types.artefacts_types_id` via information_schema); spec correction in `f98bc796` already flagged this universally. Fix is 4 type substitutions — see §Active rejection for the canonical CREATE TABLE block. Transaction rolled back cleanly, no DB damage. Validator working tree clean; ready for fix-worker on same branch. |
| 5 | FB1.1.3 | fb1-1-3-mig-134-user-prefs | PASS | bd417a86 | 2026-05-27 | **After two REJECT-fix cycles.** Type-fix-worker SHA `0745d8d5` made the recommended 4-substitution edit (`BIGSERIAL` → `uuid PRIMARY KEY DEFAULT gen_random_uuid()` on PK; `BIGINT` → `uuid` on user_id, artefact_type_id, workspace_id). Re-validated: `grep -in 'BIGSERIAL\|BIGINT'` returns 0 hits on both files; three-dot diff shows only the 2 migration files; column-prefix lint green; UP applied cleanly to vector_artefacts via direct psql (BEGIN → CREATE TABLE → CREATE INDEX×2 → COMMIT); schema_migrations row 134 backfilled externally; `\d users_flowboard_prefs` confirms uuid PK with `gen_random_uuid()` default + 2 uuid FKs CASCADE (users + artefacts_types — post-rename plural verified) + JSONB card_fields NOT NULL + workspace_id denorm + updated_at default now() + UNIQUE on (user_id, artefact_type_id) + workspace_idx. All 5 AC PASS. **Phase 1 complete (3/3).** Awaiting Phase 2 dispatch. |
| 6 | FB1.2.1 | fb1-2-1-scaffold-pkg | PASS | ff9a6613 | 2026-05-27 | **Phase 2 opener — scaffold; 5 endpoints stubbed at 501, layer discipline clean, smoke tests green, 2 pre-existing go vet warnings unchanged.** Worker SHA `2db247ff`. Three-dot diff = 8 files (5 new `backend/internal/flowboard/` + `backend/cmd/server/main.go` + 2 auto-regen `siteAPI.yaml`). All 4 AC PASS: (1) all 5 package files present; (2) main.go imports flowboard pkg, constructs `flowboard.NewService(vaPool)` + `flowboard.NewHandler(...)` after `orgDesignSvc`, calls `flowboardH.Mount(r)` inside `mountSiteRoutes` within RequireAuth + RequireFreshPassword + httprate group; (3) `go build ./...` exit 0 + `go test ./internal/flowboard/...` exit 0 (2 smoke tests pass), `go vet ./...` exit 1 with two warnings (`polymorphicrefs/service.go:136 unreachable code` + `featuretests vectorArtefactsPoolForF1 undefined`) — verified pre-existing on `feature/flowboard` baseline, not introduced by this story; (4) layer-discipline greps all 0 hits (handler SQL grep 0 / service net/http grep 0 / sql.go func-if-for-switch grep 0). 5 routes registered (`/flowboard/{wip,prefs}` GET+PUT, `/topology/{id}/members` GET); each handler method returns `http.StatusNotImplemented` with `// TODO(FB1.2.N)` comment referencing the implementing story. siteAPI.yaml regen added exactly 3 path entries matching the new routes — no unrelated route churn. Index-stat clean at merge (8 files only; master-handover edits + scope-hook breadcrumbs stashed pre-merge, re-popped post-commit). |
| 7 | FB1.2.2 | fb1-2-2-wip-endpoints | REJECT | — | 2026-05-27 | Worker SHA `67763492` (recovery worker). PUT path is correct end-to-end: membership-gate via ErrNotMember → 403 (AC 2), updated_by/updated_at on every write (AC 3), `Limit *int` → SQL NULL pointer mapping (AC 4), all 4 named PUT tests green (AC 5 — `MemberAllowed`, `NonMember403`, `CrossScope403`, `Idempotent`). Layer discipline clean (handler SQL grep 0 / service http grep 0 / sql.go logic grep 0); build + go test + go vet all green (vet warnings pre-existing baseline). siteAPI.yaml regen sane (request/response schemas, 6 files in three-dot diff exactly as expected). **AC 1 FAIL**: `listWipLimits` returns 200+empty array on cross-scope `node_id` (worker self-flagged this with a defensible "less existence leak than 403" security argument, documented in handler.go:79-86). The AC text is verbatim: *"sentinel-clamped — out-of-scope returns 403, not 404"*. The validator cannot reinterpret a verbatim AC on its own authority. Brief in §Active rejection asks for a minimal fix: add `NodeWorkspaceID` method to service + serviceIface, gate `listWipLimits` on `nodeWS == clamp.WorkspaceID` before the SQL query (both `ErrNodeNotFound` and mismatch collapse to 403), plus 2 GET tests (`InScope200` + `CrossScope403`). PUT path and all 4 existing tests preserved untouched. |
| 9 | FB1.2.3 | fb1-2-3-card-prefs | REJECT | — | 2026-05-27 | Worker SHA `8b5c342f`. AC 1 (GET 200/404 with sentinel-derived user_id), AC 3 (caller_user_id wins over body user_id), AC 4 (4 tests including bonus NotFound404) all PASS. Allowlist + 422 semantics in Go PASS. **AC 2 FAILS at runtime**: `sqlUpsertCardPrefs` uses `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx`, but mig 134 created that name via `CREATE UNIQUE INDEX` (not `CONSTRAINT ... UNIQUE`). PostgreSQL's `ON CONFLICT ON CONSTRAINT` requires a row in `pg_constraint`; bare unique indexes don't qualify. Validator empirically verified runtime failure against live `vector_artefacts` DB. Tests pass green only because handler_test.go uses a fake service that never touches SQL. Worker's "matches sqlUpsertWipLimit pattern" claim is wrong — mig 133 used `CONSTRAINT ... UNIQUE` inline (creates a pg_constraint row); mig 134 used bare `CREATE UNIQUE INDEX` (does not). One-line fix in sql.go: switch to column-list form `ON CONFLICT (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)` — uses the existing unique index as arbiter, no migration amendment needed. Brief in §Active rejection. Layer discipline + build + vet + 12 tests all green; only the production SQL is broken. |
| 10 | FB1.2.3 | fb1-2-3-card-prefs | PASS | 391d6e6d | 2026-05-27 | **After REJECT + fix cycle.** Card-prefs UPSERT now works at runtime. Fix-worker SHA `85342893` made the recommended one-line surgical edit in `sql.go`: `ON CONFLICT ON CONSTRAINT users_flowboard_prefs_user_type_uidx` → `ON CONFLICT (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)`. Re-validated: confirmed column order in the new arbiter clause matches mig 134's `CREATE UNIQUE INDEX users_flowboard_prefs_user_type_uidx (users_flowboard_prefs_user_id, users_flowboard_prefs_artefact_type_id)` exactly; **EXPLAIN against live `vector_artefacts`** produced `Conflict Resolution: UPDATE` and `Conflict Arbiter Indexes: users_flowboard_prefs_user_type_uidx` — proving Postgres correctly resolves the column-list arbiter to the existing index. `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 (12/12 tests pass — 2 smoke + 4 WIP-PUT + 2 WIP-GET + 4 card-prefs: DefaultShape/JunkKey422/ForeignUserBlocked/NotFound404); layer-discipline greps all clean (handler.go 0 SQL strings / service.go 0 net/http imports / sql.go 0 control-flow keywords). All 4 AC PASS (AC 1 GET 200-or-404 / AC 2 PUT 200-or-422-on-junk via 8-key allowlist / AC 3 sentinel user wins over body user_id / AC 4 four tests cover all named scenarios + bonus GetCardPrefs_NotFound404). Index-stat at merge: 6 files exactly (4 flowboard + 2 siteAPI yamls regenerated by pre-commit api:sync hook); NV1.S06 noise (Vector_Scope.md + docs/c_tech_debt.md + notif-v2 plan + 3 infra files) stashed pre-checkout, plus one residual `docs/superpowers/specs/2026-05-26-notifications-v2-design.md` that had carried over on `feature/flowboard` working tree from prior session was also stashed. **Lesson pinned for FB1.2.4 onward:** EXPLAIN every new INSERT...ON CONFLICT / MERGE / UPSERT statement against the live DB before issuing PASS — fake-service tests cannot catch SQL-syntax or arbiter-index resolution bugs (this REJECT-fix cycle would have been caught pre-PASS with `EXPLAIN` in ~1 second). |
| 8 | FB1.2.2 | fb1-2-2-wip-endpoints | PASS | 71d23566 | 2026-05-27 | **After REJECT + fix cycle.** GET cross-scope now returns 403 via `NodeWorkspaceID` gate. Fix-worker SHA `63c8e05b` made the recommended surgical patch (4 files edited): (1) `sql.go` +1 constant `sqlSelectNodeWorkspace` using the verified live column name `topology_nodes_id_workspace` (validator cross-checked against mig 103 — `ALTER TABLE topology_nodes RENAME COLUMN workspace_id TO topology_nodes_id_workspace`); (2) `service.go` +1 method `NodeWorkspaceID(ctx, nodeID)` mapping `pgx.ErrNoRows → ErrNodeNotFound`, +1 sentinel error `ErrNodeNotFound`, +1 entry in `serviceIface`; (3) `handler.go` `listWipLimits` rewritten to call `NodeWorkspaceID` BEFORE the main query and collapse `ErrNodeNotFound || nodeWS != clamp.WorkspaceID` to HTTP 403 (no existence leak); (4) `handler_test.go` extended fakeService with `NodeWorkspaceID`, added `doGET` helper, added 2 new tests `TestListWipLimits_InScope200` and `TestListWipLimits_CrossScope403`. Re-validated: three-dot diff = 6 files exactly (4 flowboard + 2 auto-regen siteAPI yamls), no NV1.S06 noise bundled; `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 (all 8: 4 PUT + 2 GET + 2 smoke); `go vet ./...` shows only the two pre-existing baseline warnings unchanged; layer-discipline greps all clean (handler.go 0 SQL strings / service.go 0 `net/http` imports / sql.go 0 control-flow keywords). All 5 AC PASS now (1 GET cross-scope → 403 / 2 PUT membership → 403 / 3 updated_by + updated_at on write / 4 *int → SQL NULL / 5 8 tests covering all named scenarios). Index-stat clean at commit (6 files; NV1.S06 noise + 1 untracked notif-v2 plan stashed pre-checkout). |
| 11 | FB1.2.4 | fb1-2-4-node-members | PASS | c863407b | 2026-05-27 | **Phase 2 closeout — all 4 backend endpoint stories landed; 14 unit tests across the package; all layer discipline checks clean.** Worker SHA `cbbdc1e8`; PASS first cycle (no REJECT). Three-dot diff = 6 files exactly (`handler.go +48`, `handler_test.go +116`, `service.go +39`, `sql.go +9`, 2× `siteAPI.yaml +19`). All 3 AC PASS: (1) GET 200 with array of `{user_id, role, created_at}` — `NodeMemberDTO` json tags verified in service.go produce exact wire shape per AC verbatim; `sqlSelectNodeMembers` SELECTs `topology_nodes_members_user_id, _role, _created_at` ORDER BY created_at ASC; handler returns 200 + JSON array on success. (2) Cross-scope 403 — handler reuses `NodeWorkspaceID` from FB1.2.2: `errors.Is(err, ErrNodeNotFound) || (err == nil && nodeWS != clamp.WorkspaceID)` both collapse to `httperr.Write(w, r, http.StatusForbidden, "forbidden")` BEFORE the members query (no existence leak). (3) `handler_test.go` adds `doGETNodeMembers` helper (injects `chi.NewRouteContext()` for URL param resolution) + 2 tests: `TestListNodeMembers_InScope200` (200 + 2 members, fields verified) and `TestListNodeMembers_CrossScope403` (403 + asserts `svc.listNodeMembersCalled == false` proving gate fires before the members query). **EXPLAIN against live `vector_artefacts`** confirmed plan = `Sort` → `Bitmap Heap Scan` → `Bitmap Index Scan on ix_topology_nodes_members_node` — all column names valid, plan healthy (FB1.2.3 EXPLAIN-first lesson honoured). `go build ./...` exit 0; `go test ./internal/flowboard/...` exit 0 — all 14 tests pass (2 smoke + 4 WIP-PUT + 2 WIP-GET + 4 card-prefs + 2 node-members); `go vet ./...` only the two pre-existing baseline warnings unchanged. Layer-discipline greps all clean (handler.go 0 SQL strings / service.go 0 net/http imports / sql.go 0 control-flow keywords). siteAPI.yaml regen sane (200 array of required {user_id, role, created_at} + 403 Forbidden ref). Index-stat at commit: 6 files exactly (no NV1.S06 noise — Vector_Scope.md scope-hook breadcrumbs from FB1.2.4 worker commit + residual notif-v2 spec stashed pre-checkout from worker branch; one further `Vector_Scope.md` residual on `feature/flowboard` working tree also stashed pre-merge). **Phase 2 complete (4/4).** Hand-back to master for Phase 3 dispatch. |
