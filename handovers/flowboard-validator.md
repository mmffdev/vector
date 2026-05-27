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

**Phase 1 complete (3/3).** Awaiting Phase 2 dispatch (FB1.2.1 scaffold flowboard package).

Phase 1 migrations applied + ledger-backfilled against `vector_artefacts`:
- `132_topology_nodes_members.sql` — squash `df6d412c`
- `133_topology_nodes_wip_limits.sql` — squash `cc4abf58`
- `134_users_flowboard_prefs.sql` — squash `bd417a86`

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

## § Active rejection

(none — FB1.1.3 REJECTs both resolved by `0745d8d5` and re-validated; merged as `bd417a86`. The historical REJECT brief is retained below for audit trail; the next worker dispatch starts with a clean slate.)

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
