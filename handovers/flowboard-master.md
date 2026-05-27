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
- 2026-05-27 — **Phase 2 (Backend) closed — 4/4 endpoints landed + merged on `feature/flowboard`.**
  - **FB1.2.1** scaffold `backend/internal/flowboard/` package + main.go mount — merged `ff9a6613`. PASS first cycle.
  - **FB1.2.2** WIP endpoints (GET list + PUT upsert) with membership + workspace-scope gating — merged `71d23566`. 1 REJECT+fix cycle (cross-scope 200+empty → 403 gate added).
  - **FB1.2.3** Card-prefs endpoints (GET + PUT) with JSONB 8-key allowlist — merged `391d6e6d`. 1 REJECT+fix cycle (`ON CONFLICT ON CONSTRAINT <idx>` → `ON CONFLICT (cols)` for bare-index arbiter).
  - **FB1.2.4** Topology node members (GET `/_site/topology/{id}/members`) — merged `c863407b`. PASS first cycle.
- 2026-05-27 — **Phase 3 (Frontend) closed — 7/7 stories landed + merged on `feature/flowboard`.**
  - **FB1.3.1** scaffold component tree + sidecar JSON — merged `47f242da`. PASS first cycle.
  - **FB1.3.2** `useFlowBoardData` hook composing flow_states + artefacts + WIP into columns — merged `2914448b`. PASS first cycle.
  - **FB1.3.3** `BoardColumnHeader` (5 WIP states, overage badge) — merged `4f1288a5`. PASS first cycle.
  - **FB1.3.4** `@dnd-kit` drag + hard-blocked transitions hook — merged `52da1686`. 1 REJECT+fix cycle (CSS gap: `flow-board__Column` class referenced without matching CSS rule).
  - **FB1.3.5** `BoardCard` + `CardFieldRenderer` — merged `21c3560b`. PASS first cycle.
  - **FB1.3.6** `WipSettingsModal` + `WipGearButton` + `useNodeMembership` — merged `7417c902`. PASS first cycle.
  - **FB1.3.7** `p_FlowBoard.tsx` top-level + addressable surface — merged `43afd1ad`. 1 REJECT+fix cycle (slot-helper doubled prefix from un-exercised FB1.3.1 helper).
- 2026-05-27 — **Phase 4 (Integration) closed — FB1.4.1 cherry-picked to `feature/flowboard` as `d644f101`. WAVE 14/14 COMPLETE.**
  - **FB1.4.1** Mount on `/value-flow` + seed mig 135 + flyout adapter + 8 CSS tokens + 3 TDs — cherry-picked `d644f101` (worker SHA `82b3d316`). PASS first cycle. Cherry-pick (not squash-merge) used to skip the unrelated dev-erd commit `baf865b4` that had landed on `fb1-4-1-integration` between the wave-close base and the FB1.4.1 commit. Pre-commit `git diff --cached --stat` showed exactly 7 files (page.tsx, p_FlowBoard.tsx, globals.css, mig 135 UP/DOWN, c_tech_debt.md, DevComponentsPanel.tsx) — no ERD bundling. **Dev DB state:** mig 135 applied to `vector_artefacts`; 2 members seeded on Insurance node `ae2d4ff5-4c8d-4839-af89-7769067476ae` (user@ `583b8276-092f-4645-8e79-367fdcb5c4b6` + padmin@ `6cabe266-b2f4-43f9-879c-06020c789a0b`); 3 WIP rows live (Backlog=10, Doing=3, Completed=NULL). State-name divergence (AC said "Done") correctly resolved — Story flow has no Done state; Completed is the canonical done-kind. **Bonus closure:** worker resolved **TD-FB-CSS-TOKENS** by defining all 8 tokens in globals.css legacy-bridge block (the 7 spec'd + `--border-subtle`) as `var()` cascades with sensible light-mode hex fallbacks. Flyout adapter `FlowBoardFlyoutBody` inline in p_FlowBoard.tsx (~30 LoC) — bridges `DetailFlyoutBodyProps.rowId` → `ArtefactInlineForm {artefactId, resourceUrl: "/work-items", scope: "work"}`. Dev → Components article added inline to `DevComponentsPanel.tsx` (existing pattern for that panel; not a separate .md) with all 4 sections (Synopsis · Architecture · Wire · Backlog) + TOC slug `flow-board`. 3 TD entries opened: TD-FLOWBOARD-EXIT-RULES (S2), TD-FLOWBOARD-CARD-PREFS-UI (S3), TD-FLOWBOARD-WIP-AUDIT (S2). All gates green: 70 vitest pass; tsc clean; go build + go test flowboard exit 0; `lint:column-prefix-convention` exit 0; `/value-flow` returns HTTP 200.

## What is IN PROGRESS

- **None — wave 14/14 complete.**

## What is NEXT

**FB1.4.1 visual smoke in browser is the only remaining manual step.** User authenticates, navigates to `/value-flow`, exercises drag (card across columns) + WIP-modal (gear icon → numeric input → save) + type-switcher (dropdown change re-renders columns). Wave can be marked DONE in `Vector_Scope.md` § FB1 when smoke confirms.

Original dependency-ordered plan retained below for audit trail (Phases 1-3 all done).

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

---

## Closing handover

**Wave 13/14 closed 2026-05-27.** Phase 1 (schema, 3/3) + Phase 2 (backend, 4/4) + Phase 3 (frontend, 7/7) all landed and squash-merged on `feature/flowboard`. **FB1.4.1 (page mount + integration smoke) is user-owned** and was explicitly excluded from worker/validator scope.

### Final commit list — `feature/flowboard` (all squash merges, newest at top)

| Story    | Merge SHA   | Notes |
|----------|-------------|-------|
| FB1.3.7  | `43afd1ad`  | p_FlowBoard.tsx top-level + addressable surface; 1 REJECT+fix (slot-helper doubled prefix). |
| FB1.3.6  | `7417c902`  | WipSettingsModal + WipGearButton + useNodeMembership; PASS first cycle. |
| FB1.3.5  | `21c3560b`  | BoardCard + CardFieldRenderer; PASS first cycle. |
| FB1.3.4  | `52da1686`  | @dnd-kit drag + hard-blocked transitions; 1 REJECT+fix (CSS gap). |
| FB1.3.3  | `4f1288a5`  | BoardColumnHeader (5 WIP states + overage badge); PASS first cycle. |
| FB1.3.2  | `2914448b`  | useFlowBoardData hook (flow_states + artefacts + WIP); PASS first cycle. |
| FB1.3.1  | `47f242da`  | Frontend tree scaffold + first sidecar JSON; PASS first cycle. |
| FB1.2.4  | `c863407b`  | Topology node members endpoint; PASS first cycle. |
| FB1.2.3  | `391d6e6d`  | Card-prefs endpoints (GET + PUT) with JSONB allowlist; 1 REJECT+fix (ON CONFLICT arbiter form). |
| FB1.2.2  | `71d23566`  | WIP endpoints (GET + PUT) with membership gate; 1 REJECT+fix (cross-scope 403 gate). |
| FB1.2.1  | `ff9a6613`  | Backend package scaffold + main.go mount; PASS first cycle. |
| FB1.1.3  | `bd417a86`  | mig 134 `users_flowboard_prefs`; 2 REJECT+fix cycles (DOWN comment block, BIGSERIAL/BIGINT → UUID). |
| FB1.1.2  | `cc4abf58`  | mig 133 `topology_nodes_wip_limits`; 1 REJECT+fix (stripped `INSERT INTO schema_migrations`). |
| FB1.1.1  | `df6d412c`  | mig 132 `topology_nodes_members`; PASS first cycle. |

### Test count

**70 unit tests across the FlowBoard package** (8 files):
- 15 loader (13 from FB1.3.1 + 2 contract from FB1.3.7 fix-worker)
- 9 useFlowBoardData
- 6 BoardColumnHeader (snapshot tests)
- 13 BoardCard
- 4 permissions (gear visibility gating)
- 9 p_FlowBoard
- 7 WipSettingsModal
- 7 transitions (hard-blocked transitions matrix)

Backend tests: all in `backend/internal/flowboard/` exit 0; `go vet` shows only the pre-existing baseline warnings (polymorphicrefs / featuretests) unchanged by this wave.

### Open TD entries (3)

- **TD-FLOWBOARD-EXIT-RULES** (S2) — spec-noted v1 deferral; exit-rule semantics for `flow_transitions` (e.g. "must have non-empty `flow_states_id` before leaving Doing").
- **TD-FB-GEAR-ICON** (S3) — unicode ⚙ placeholder used in `WipGearButton`; replace with icon component when icon library is wired.
- **TD-FB-CSS-TOKENS** (S2) — 7 undefined CSS tokens referenced in the WIP modal block of `app/globals.css` (`--text-primary`, `--text-secondary`, `--surface-hover`, `--surface-secondary`, `--surface-input`, `--border-default`, `--accent-primary`). Resolve to empty CSS values at runtime; modal still functions but loses visual polish. Define in design-system primitives.

### Branch state

`feature/flowboard` is **local-only — never pushed** per master's "no merge no push" + FB1.4.1 user-owned constraint. Branch is based off `feature/notifications-v2` commit `5742f1bc`. 14 squash merges + interleaved validator-verdict / handover-update commits make up the branch history.

### Next-session bootstrap

When resuming this wave (or the FB1.4.1 page-mount):

1. Read this file (`handovers/flowboard-master.md`) first — final state of the wave.
2. Read `handovers/flowboard-validator.md` — verdict ledger + lessons.
3. Read `docs/superpowers/specs/2026-05-27-flowboard-design.md` — spec.
4. For FB1.4.1: dispatch manually as the human-in-the-loop user — mount on `app/(user)/value-flow/page.tsx`, wire `ObjectTreeDetailFlyout` Body adapter (DetailFlyoutBodyProps → ArtefactInlineForm adapter is the >50 LoC sub-component deferred by FB1.3.7), seed `topology_nodes_members` + `topology_nodes_wip_limits` rows per Vector_Scope.md § FB1.4.1 AC, manual visual smoke, then `<update> -c FlowBoard` for the Dev → Components article.
5. Optional pre-work for FB1.4.1: resolve TD-FB-CSS-TOKENS so the modal renders at the design-ethos bar before manual smoke.

### Wave close — 2026-05-27

**WAVE 14/14 COMPLETE.** The user authorised FB1.4.1 inclusion in the worker/validator scope (no longer user-only) and the cherry-pick `d644f101` lands on `feature/flowboard`. Wave closes at 14/14, not 13/14. Final wave state:

- **Cherry-pick used (not squash-merge)** because `fb1-4-1-integration` branch carried unrelated dev-erd commit `baf865b4` in front of the FB1.4.1 worker commit `82b3d316`. `git cherry-pick 82b3d316` produced clean 7-file commit `d644f101` (page.tsx, p_FlowBoard.tsx, globals.css, mig 135 UP/DOWN, c_tech_debt.md, DevComponentsPanel.tsx). Pre-commit `git diff --cached --stat` HARD RULE verified.
- **Dev DB seeded:** mig 135 applied to `vector_artefacts`; ledger row `135_flowboard_seed_members.sql` at `2026-05-27 20:11:40`.
- **Two seeded user UUIDs (verified live):** `583b8276-092f-4645-8e79-367fdcb5c4b6` (user@mmffdev.com) + `6cabe266-b2f4-43f9-879c-06020c789a0b` (padmin@mmffdev.com).
- **Chosen topology node UUID:** `ae2d4ff5-4c8d-4839-af89-7769067476ae` (Insurance node — 63 artefacts in dev, workspace `a4df2e21-8d9a-452b-b4f9-eded455381c8`).
- **3 WIP rows live** on the Insurance node (Backlog=10, Doing=3, Completed=NULL — Completed is the canonical done-kind in the Story flow; there is no state named "Done").
- **TD-FB-CSS-TOKENS resolved as a bonus** — 8 CSS tokens defined in globals.css (the 7 spec'd + `--border-subtle`) as `var()` cascades with light-mode hex fallbacks.
- **3 new TDs opened:** TD-FLOWBOARD-EXIT-RULES (S2), TD-FLOWBOARD-CARD-PREFS-UI (S3), TD-FLOWBOARD-WIP-AUDIT (S2).
- **Only manual step left:** visual smoke in the browser (drag, WIP modal, type-switcher redraw, flyout-open via card click). Tests + dev server prove the page compiles and routes (HTTP 200).

Final `feature/flowboard` HEAD: `d644f101` (FB1.4.1 cherry-pick) on top of `2db11075` (FB1.3.7 close).
