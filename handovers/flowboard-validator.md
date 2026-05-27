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

**FB1.1.1** — Mig 132 `topology_nodes_members`. Worker complete on branch `fb1-1-1-mig-132-members` at SHA `732d2cac`. Awaiting validator gate.

## § Self-assessment

Validator was spawned fresh, will be re-spawned on every dispatch (no SendMessage tool available — agents are one-shot per dispatch). This handover file is the **continuity contract** across spawns. Every fresh validator reads this file + the spec + Vector_Scope.md and resumes.

## § Active rejection

(none)

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
| (none yet — FB1.1.1 in flight) |
