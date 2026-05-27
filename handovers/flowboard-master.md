# FlowBoard Master Handover (PLA066)

**Last updated:** 2026-05-27 (session-start of orchestration wave)
**Current owner:** master Claude (Opus 4.7) running the orchestration loop
**Validator:** global Opus sub-agent, separate context, see `handovers/flowboard-validator.md`
**Workers:** Sonnet 4.6 sub-agents, one-shot per story
**Integration branch:** `feature/flowboard` (off `feature/notifications-v2` at `5742f1bc`)
**Plan:** PLA066 (live on `/dev/reporting` → Plan tab, 42 KB)
**Spec:** `docs/superpowers/specs/2026-05-27-flowboard-design.md`
**Scope:** `Vector_Scope.md` § FB1 (15 stories with verbatim AC sub-lists)

---

## What is DONE

- 2026-05-27 — Spec written (`docs/superpowers/specs/2026-05-27-flowboard-design.md`).
- 2026-05-27 — Plan PLA066 POSTed to `dev_reports` (`type=plan`).
- 2026-05-27 — 15 stories added to `Vector_Scope.md` under new FB1 theme; doc version 2.63 → 2.64.
- 2026-05-27 — 15 entries appended to `.claude/scope-refs.map`.
- 2026-05-27 — Pre-flight commit `5742f1bc` on `feature/notifications-v2`.
- 2026-05-27 — Integration branch `feature/flowboard` created off `5742f1bc`.
- 2026-05-27 — Master + validator handovers initialised.
- 2026-05-27 — Spec UUID-correction patch landed (`f98bc796`) — live `vector_artefacts` schema is UUID throughout, not BIGINT as the original spec illustrated. Also pinned: `artefact_types → artefacts_types` (mig 062) and `flow_states → flows_states` (mig 061).
- 2026-05-27 — **Phase 1 (Schema) closed — 3/3 migrations applied to `vector_artefacts` and merged.**
  - **FB1.1.1** mig 132 `topology_nodes_members` — merged `df6d412c`. PASS first cycle.
  - **FB1.1.2** mig 133 `topology_nodes_wip_limits` — merged `cc4abf58`. 1 REJECT-fix cycle (stripped `INSERT INTO schema_migrations (version)` and DOWN `DELETE` — live table is keyed by `filename TEXT PK`, not `version`).
  - **FB1.1.3** mig 134 `users_flowboard_prefs` — merged `bd417a86`. 2 REJECT-fix cycles (1: inline DOWN comment block; 2: BIGSERIAL/BIGINT → UUID).
- 2026-05-27 — **Patterns learned in Phase 1 (pinned in validator handover § Self-assessment):**
  - `schema_migrations` is keyed by `filename TEXT PK` + `applied_at TIMESTAMPTZ`. UP files must NOT contain any `INSERT INTO schema_migrations` — validator backfills externally after apply.
  - Bulk migrator (`go run ./cmd/migrate`) reports 39 phantom pending migrations from a post-refactor substrate-vs-ledger drift. **Unusable.** Apply each new migration via direct `psql -f` + manual ledger backfill.
  - libpq: `/opt/homebrew/Cellar/libpq/18.3/bin/psql`; conn: `PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2) ... user=mmff_dev` (not `postgres`).
  - Workers MUST verify live schema before writing migrations — spec is corrected but worker output sometimes predates corrections. Future briefs cite live-schema-first.

## What is IN PROGRESS

- **Phase 2 (Backend)** — FB1.2.1 scaffold worker complete at `2db247ff`; Opus validator dispatched and gating now.

## What is NEXT

In strict dependency order. Workers may run in parallel within a phase **only if** the validator confirms no shared file conflicts.

### Phase 1 — Schema (3 stories, independent within phase)

1. **FB1.1.1** — Mig 132: `topology_nodes_members`
2. **FB1.1.2** — Mig 133: `topology_nodes_wip_limits`
3. **FB1.1.3** — Mig 134: `users_flowboard_prefs`

Migrations can run in parallel (3 independent files, no shared state). Validator applies all 3 against `vector_artefacts` in one batch after all 3 PASS.

### Phase 2 — Backend (4 stories, sequential within phase)

4. **FB1.2.1** — Scaffold `backend/internal/flowboard/` package (must precede 2.2/2.3/2.4)
5. **FB1.2.2** — WIP endpoints (GET + PUT) with membership gate
6. **FB1.2.3** — Card-prefs endpoints (GET + PUT) with JSONB allowlist
7. **FB1.2.4** — Topology node members endpoint

2.2/2.3/2.4 may run in parallel after 2.1 lands.

### Phase 3 — Frontend (7 stories, partial parallelism)

8. **FB1.3.1** — Scaffold component tree + sidecar JSON (must precede all of 3.2–3.7)
9. **FB1.3.2** — `useFlowBoardData` hook
10. **FB1.3.3** — `BoardColumnHeader`
11. **FB1.3.4** — `@dnd-kit` drag + hard-blocked transitions
12. **FB1.3.5** — `BoardCard` + `CardFieldRenderer`
13. **FB1.3.6** — `WipSettingsModal` (gear icon + membership gate)
14. **FB1.3.7** — `p_FlowBoard.tsx` top-level + addressable surface registration (must follow 3.2–3.6)

3.2/3.3/3.4/3.5/3.6 may run in parallel after 3.1 lands. 3.7 must follow.

### Phase 4 — Integration (excluded from worker scope)

15. **FB1.4.1** — Mount on `/value-flow` page + integration smoke. **User drives this manually**; master + validator hand back to user after 3.7 PASS.

---

## Branch model

- **Integration branch:** `feature/flowboard`
- **Per-story branches:** `feature/flowboard/fb1-N-N-<slug>` (e.g. `feature/flowboard/fb1-1-1-mig-132-members`)
- Worker is spawned on its branch (worktree or `git checkout -b`).
- Worker commits all its work to that branch and reports the branch name + last commit SHA back to master.
- Validator inspects the diff, runs tests + lints, optionally applies migrations, then **either**:
  - **PASS** — validator merges the branch into `feature/flowboard` (squash or merge — squash for simple stories, merge for stories with multiple meaningful commits).
  - **REJECT** — validator writes rejection brief to `handovers/flowboard-validator.md`; master spawns a fresh worker on the same branch with the rejection brief in its prompt.

## Worker contract

- **Model:** Sonnet 4.6 (`claude-sonnet-4-6`).
- **Scope:** code + unit tests only. **No migration apply, no live API calls, no `/value-flow` page mount, no server restart, no `<server>` skill.**
- **Required outputs:**
  - All AC bullets for the story addressed and verified in the diff or in tests.
  - All tests written and green locally (Go: `go test ./backend/internal/flowboard/...`; TS: `npm run test -- --run app/components/FlowBoard`).
  - All lints green (`go vet`, `npm run lint`, plus any `lint:*` ratchet in the AC).
  - Layer discipline maintained (handler ≠ SQL, sql.go = constants only, service.go ≠ http).
  - Commits on the story branch with `[FB1.N.N]` ref-tag in subject (so the scope-commit-note hook resolves cleanly).
  - Final report back to master: branch name, last SHA, AC bullet status (each one PASS / FAIL with evidence), test summary, lint summary.

## Validator contract

- **Model:** Opus 4.7 (`claude-opus-4-7`).
- **Persistent** for the run, but updates `handovers/flowboard-validator.md` after every story-verdict cycle so it can be hot-swapped.
- **Owns:** the dev DB write key (migration apply), the merge to `feature/flowboard`, the `handovers/flowboard-validator.md` file, the verdict ledger.
- **Does NOT own:** the worker spawn (that's master), the page mount (that's the user).
- **Verdict bar:** strict.
  - Every AC bullet must be verifiable from the diff or a passing test. Vague "should work" claims = REJECT.
  - Tests must be green on the worker's branch (validator re-runs them; it doesn't trust the worker's word).
  - Lints must be green. Layer-discipline grep must be clean.
  - On PASS: validator applies migrations (Phase 1 only), merges branch, writes verdict to ledger, signals master.
  - On REJECT: validator writes a structured rejection (which AC failed, evidence, recommended fix), signals master, master spawns new worker.

## Context protection

- **Master (me):** monitor own context. At ~75% usage, write a fresh snapshot to this file (update §"What is DONE" + §"What is IN PROGRESS" + §"What is NEXT" + §"Known caveats"), warn user to `/clear` so next session loads via `<read>`.
- **Validator:** briefed to **write its handover after every verdict** — cheap (one block append). When validator output degrades (incoherent, missing AC bullets, repeating), master spawns a fresh validator with the handover as its sole bootstrap.
- **Workers:** one story each, short-lived. If a worker fails to finish, it's discarded and respawned fresh with the same brief + the partial branch state.

## Status reporting cadence

- Master reports to user every 10 minutes (1200s scheduled wakeup).
- Format: tight scoreboard — DONE / IN PROGRESS / BLOCKED counts, % complete (done / 14, since FB1.4.1 is user-owned), ETA based on rolling per-story average, current worker + current story.

## Known caveats

- The `<server>` skill is OFF-LIMITS to workers (HARD RULE — backend env pinned to dev, only user can flip).
- Workers MUST NOT touch human accounts (`gadmin@`, `padmin@`, `user@`) — HARD RULE.
- Column-prefix HARD RULE is enforced by `lint:column-prefix`; every column in migs 132/133/134 must carry the full table-name prefix.
- Workers must commit via the existing pre-commit hooks (no `--no-verify`).
- If a worker hits the `loop-detector` hook fires, master must call `<report> -retro --auto-loop` before respawn.
- The `notif-v2-s08` branch name visible in some artefacts is a stale label from the pre-merge state; current pre-flight base is `feature/notifications-v2` commit `5742f1bc`.

## File locations cheat-sheet

| Artefact | Path |
|---|---|
| Spec | `docs/superpowers/specs/2026-05-27-flowboard-design.md` |
| Scope | `Vector_Scope.md` § FB1 |
| Plan | `/dev/reporting` → PLA066 (curl with `DEV_API_KEY` to fetch verbatim) |
| Refs map | `.claude/scope-refs.map` (15 FB1.* entries) |
| Master handover | `handovers/flowboard-master.md` ← this file |
| Validator handover | `handovers/flowboard-validator.md` |
| Migrations | `db/vector_artefacts/schema/132_*.sql`, `133_*.sql`, `134_*.sql` (not yet written) |
| Backend pkg | `backend/internal/flowboard/` (not yet scaffolded) |
| Frontend tree | `app/components/FlowBoard/` (not yet scaffolded) |
| Host page | `app/(user)/value-flow/page.tsx` (placeholder; rewritten in FB1.4.1) |

## Verdict ledger

Updated by the validator on every PASS/REJECT. Newest entry on top.

```
| story    | branch                              | result | sha (squash on merge) | notes |
|----------|-------------------------------------|--------|-----------------------|-------|
| (none yet — orchestration loop not dispatched)                                          |
```
