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

REJECTED FB1.1.2 — awaiting respawn of worker on `fb1-1-2-mig-133-wip-limits` with rejection brief below.

## § Self-assessment

Validator was spawned fresh, will be re-spawned on every dispatch (no SendMessage tool available — agents are one-shot per dispatch). This handover file is the **continuity contract** across spawns. Every fresh validator reads this file + the spec + Vector_Scope.md and resumes.

**Context budget after FB1.1.1 verdict:** ~30%. Read AC + spec + worker diff + ran lint + applied migration + verified + squashed. No oversized files reviewed.

**Context budget after FB1.1.2 REJECT:** ~35%. Read AC + spec + worker diff + ran lint (green) + attempted apply (failed at the `INSERT INTO schema_migrations (version)` line — column doesn't exist, transaction rolled back, no DB damage). Clean working tree restored. Wrote rejection brief.

**Operational note for next validator:** The bulk migrator (`go run ./cmd/migrate -dry-run -db vector_artefacts -env .env.dev`) reports 39 pre-existing pending migrations (093–130) on top of any new file. This is **substrate-vs-runner-record drift** from the post-refactor reseed — the substrate is fully present (you can see `topology_nodes_id`, `users_id` as UUID in psql) but the `schema_migrations` table only records the pre-refactor 089–092 rows. **Do NOT run the bulk migrator** — it would attempt to re-apply 093–130 against an already-migrated DB and explode. Instead: apply each new migration file directly via `psql -f`, then backfill the `schema_migrations` row with `INSERT INTO schema_migrations (filename, applied_at) VALUES ('NNN_slug.sql', now()) ON CONFLICT DO NOTHING`. Both steps are inside the existing migration's `BEGIN/COMMIT` envelope plus a separate one-line INSERT — clean, isolated, no risk to neighbouring migrations.

**`schema_migrations` is keyed by `filename` (TEXT), not `version` (INT).** Master prompt's verify command `SELECT version FROM schema_migrations WHERE version = '132'` would error; the canonical query is `SELECT filename FROM schema_migrations WHERE filename = '132_<slug>.sql'`.

**Worker-facing instruction (highlighted from FB1.1.2 REJECT):** Migration UP files must NOT include any `INSERT INTO schema_migrations (...)` statement — the live table has columns `filename TEXT PK` + `applied_at TIMESTAMPTZ`, not `version`. Validator backfills the ledger row separately after apply with `INSERT INTO schema_migrations (filename, applied_at) VALUES ('<NNN>_<slug>.sql', now()) ON CONFLICT DO NOTHING`. DOWN files must NOT include any `DELETE FROM schema_migrations` statement — same reason; validator removes the ledger row separately if rolling back. See the merged FB1.1.1 mig 132 for the correct pattern: BEGIN → CREATE TABLE / CREATE INDEX → COMMIT, nothing else.

**psql connection:** validator has no shell `psql` on `$PATH`. Use `/opt/homebrew/Cellar/libpq/18.3/bin/psql`. Connection string: `PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2) /opt/homebrew/Cellar/libpq/18.3/bin/psql "host=localhost port=5435 dbname=vector_artefacts user=mmff_dev"`. DB user is `mmff_dev`, NOT `postgres`.

## § Active rejection

### REJECT — FB1.1.2 — 2026-05-27

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
