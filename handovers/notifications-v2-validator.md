# Notifications v2 — Validator Handover

**Owner:** Global Validator agent
**Started:** 2026-05-27T00:20:03Z
**Spec:** docs/superpowers/specs/2026-05-26-notifications-v2-design.md
**Integration branch:** feature/notifications-v2

## YOUR ROLE & AUTHORITY

You are the sole quality gate and git authority for this PLA. Workers (separate sub-agents, dispatched by the Master agent in the main conversation) implement individual stories. The Master forwards their output to you. You:

1. **Validate** each story: spec adherence, code quality, security, scalability, tests, lints.
2. **Commit** validated work locally (git commits only — NO pushes, NO HEAD manipulation; see rules below).
3. **Maintain a handover doc** at `handovers/notifications-v2-validator.md` so the next time you're invoked, you have full continuity.
4. **Report PASS / FAIL** to the Master with specifics. The Master decides what to do with FAIL.

You do NOT dispatch workers. You do NOT communicate with the user directly. You report to the Master, who reports to the user.

### Git authority (standing approval for this PLA run)

Authorized:
- `git commit` on any branch (including main, for spec/plan docs)
- `git checkout -b` (new branch creation)
- `git checkout <existing branch>` (move worker focus, never to reset state)
- `git merge` into the feature integration branch
- `git stash` (non-destructive)
- `git add` (always inspect with `git diff --cached --stat` before commit per HARD RULE)

NOT authorized (return to Master if needed):
- `git push` (ANY remote, ANY branch) — entirely local run
- `git reset` (any variant)
- `git rebase`
- `git push --force / --force-with-lease`
- `git branch -D` or `git branch -d`
- Anything touching the `HEAD` pointer beyond plain checkouts of existing refs

If unauthorized op needed: STOP and report to Master. No workarounds.

### Pre-existing dirty files (NOT to be touched)

Leave these alone — they belong to a separate ongoing work item:
- `Vector_Scope.md` (modified)
- `api-snapshots/caller-map.json` (modified)
- `backend/migrate` (modified)
- `backend/db/` (untracked)

## PROGRESS

- Wave 1: plans approved + committed; awaiting Master to dispatch workers for S01 + S04
- Wave 2: pending
- Wave 3: pending
- Wave 4: pending
- Wave 5: pending
- Wave 6: pending

## STORIES STATUS

| # | Story | Branch | Status | Validator verdict | SHA |
|---|---|---|---|---|---|
| S01 | Schema migrations (10 tables, indexes, CHECK, seed `notifications_platform_channels`) | feature/notifications-v2/s01-schema | not started | — | — |
| S02 | Domain types + Producer interface + dbproducer | feature/notifications-v2/s02-producer | not started | — | — |
| S03 | Inverse-Sentinel Resolver + broadcast.Service | feature/notifications-v2/s03-broadcast | not started | — | — |
| S04 | RabbitMQ broker wrapper + exchange/queue declarations | feature/notifications-v2/s04-broker | not started | — | — |
| S05 | Relay + outbox drain + stuck-claim sweeper | feature/notifications-v2/s05-relay | not started | — | — |
| S06 | Pipeline: enrich → filter → router | feature/notifications-v2/s06-pipeline | not started | — | — |
| S07 | Rules engine — real matchConditions | feature/notifications-v2/s07-rules | not started | — | — |
| S08 | Templates: DB-backed lookup + interpolation + seed templates | feature/notifications-v2/s08-templates | not started | — | — |
| S09 | Dispatchers: interface + in_app + sse + email (real) + audit writer | feature/notifications-v2/s09-dispatchers | not started | — | — |
| S10 | Handler (read side) + sentinel clamps + frontend rewire | feature/notifications-v2/s10-handler | not started | — | — |
| S11 | Broadcast handlers + admin UIs + preview-count | feature/notifications-v2/s11-broadcast-ui | not started | — | — |
| S12 | PendingStore (Redis) + debounce + digest cron + Redis infra | feature/notifications-v2/s12-pending | not started | — | — |
| S13 | Producers: mention rewire + 5 artefact lifecycle producers | feature/notifications-v2/s13-producers | not started | — | — |
| S14 | Parity harness + dev page | feature/notifications-v2/s14-parity | not started | — | — |
| S15 | Cutover smoke + flip flag + 30-day soak | feature/notifications-v2/s15-cutover | not started | — | — |
| S16 | v1 deletion | feature/notifications-v2/s16-cleanup | not started | — | — |

## VALIDATION CHECKLIST (per story)

For every story you review, work through this checklist. Record PASS/FAIL per item in your verdict to the Master.

- [ ] Spec adherence — every requirement in the relevant spec section is met
- [ ] Column-prefix HARD RULE — every new column is `<full_table_name>_<col>`
- [ ] Sentinel clamp — every handler touching tenant data calls `sentinel.FromCtx`
- [ ] Tests exist and pass — `go test ./backend/internal/notifications/v2/...` green
- [ ] Lints pass — at minimum `lint:column-prefix`, `lint:no-direct-workspace-id`, `lint:no-old-context-imports`, the sentinel clamp test
- [ ] **Linter coverage updated for this story** (see § Amendment 1) — any new architectural rule the story introduces has a corresponding lint rule defined, ledger entry added in `docs/c_c_lint_rules.md`, and the rule wired into CI / pre-commit. PASS verdict must explicitly name the rule added (or "none needed" + one-line rationale).
- [ ] **Vector_Scope.md entry appended** (see § Amendment 2) — story has a one-line entry under NV1 in `Vector_Scope.md` staged in the SAME commit as the story's code.
- [ ] Security — no secrets in code, no auth bypass, no SQL injection, validates inputs at boundaries
- [ ] Scalability — no N+1 queries on hot paths, indexes match access patterns, no unbounded scans
- [ ] No hacks-as-fixes — per the HARD RULE
- [ ] Tech-debt entries logged in docs/c_tech_debt.md for any deferred work

## AMENDMENT 1 — LINTER DISCIPLINE (added 2026-05-27, Master directive)

**Linter coverage must be kept current as we go.** For every story:

- Any new architectural rule the story introduces (e.g. "no direct INSERT into `notifications_outbox_v2`", "every Event must have `event_key`", "every dispatcher must implement the `Dispatcher` interface") gets a corresponding lint rule defined and wired into the existing `lint:*` family BEFORE the story passes.
- New lint rules live under `dev/scripts/lint_*.sh` / `dev/scripts/lint_*.py` (frontend/cross-cutting) or `backend/internal/lintchecks/` (Go) per project convention — see `docs/c_c_lint_rules.md` for the canonical catalog and shape.
- The lint ledger in `docs/c_c_lint_rules.md` gets a new row naming the rule + when it fires + its registry path (if any).
- The rule MUST actually be wired into CI (`.github/workflows/...`) or the equivalent local pre-commit hook (`dev/scripts/pre-push.sh`) — not just defined.
- The Validator PASS verdict explicitly lists which lint rule was added for this story (or "none needed" with a one-line rationale).

Reason: linter drift is a major source of regression in this codebase per CLAUDE.md history. We do not let it lag behind feature work.

## AMENDMENT 2 — SCOPE TRACKER ENTRY PER STORY (added 2026-05-27, Master directive)

The `<scope>` skill flags any commit whose subject doesn't match a scope item in `Vector_Scope.md`. The earlier `chore(notif-v2): init validator handover` commit (`e6a32d8f`) tripped this and was flagged as unmatched.

**Before committing a story's work**:

- Append a `Vector_Scope.md` entry for it under the **NV1. Notifications v2 — PLA build (orchestrated)** section (added 2026-05-27 in the backfill commit).
- One-line format: `> Commit \`<sha>\` (YYYY-MM-DD): <commit subject>`. Match the surrounding style in the file — quote-block lines, paste verbatim.
- Stage `Vector_Scope.md` alongside the story's code in the SAME commit. The commit then has its matching scope entry and the skill won't flag it.
- The scope skill's source of truth is `Vector_Scope.md`. If unsure where to put an entry, the lower in-flight section (NV1) is right; entries flip to "completed" when the wave closes.

**Special case — backfill commit (one-time, already done 2026-05-27):** the spec commit on main (`038d937e`) and the handover commit on feature branch (`e6a32d8f`) were added to NV1 in a single bookkeeping commit alongside this amendment. Future per-story commits do their own scope-entry inline; no further bookkeeping commits needed.

Reason: scope hygiene is part of the project's "no drift" discipline; unmatched commits accumulate as audit debt.

## OPEN BLOCKERS

- None yet.

External dependency tracked in spec:
- **DEP1** — dev sending domain + provider API key. Owner: Rick. Blocks S08/S09 QA only (not foundation work).

## PENDING LINTS (to be implemented by worker stories)

Linter discipline (Amendment 1) — track new rules introduced by each story so the Validator can verify they land before PASS.

| Lint rule | Introduced by | Status | Notes |
|---|---|---|---|
| `lint:no-v1-broker-imports` | S04 | planned | Strangler-fig — v2 broker code must not import `backend/internal/notifications/broker`. Grep script + ledger entry + wire into CI. Defined in S04 Task 7. |
| (sentinel clamp v2 scan-list) | S10 | planned | Add `backend/internal/notifications/v2/` to `backend/internal/lintchecks/sentinel_clamp_test.go` scan list. Spec §Testing Layer 5. Not a new lint, but a scope extension of existing. |
| `lint:column-prefix` scope sweep | S01 | passive — existing rule | Validator must confirm the existing rule picks up the eleven new v2 tables automatically; if it has a hardcoded table list, S01 Task 13.3 extends it. |

## RECENT ACTIVITY (last 5 actions, newest first)

3. 2026-05-27 — Wave 1 plans reviewed + committed (`65f2bfb9`) on `feature/notifications-v2`. Three docs: `docs/superpowers/plans/2026-05-26-notifications-v2-index.md`, `…-s01-schema.md`, `…-s04-broker.md`. Checklist PASS on spec adherence, bite-sized tasks, no placeholders in instruction text, worker-ready commands + paths, HARD RULES referenced, DoD + Risks sections present. Pre-existing dirty four (Vector_Scope.md, api-snapshots/caller-map.json, backend/migrate, backend/db/) preserved untouched. Ready for Master to dispatch S01 + S04 workers.
2. 2026-05-27 — Master directive: TWO amendments added (Amendment 1 linter discipline; Amendment 2 scope-entry-per-story). Per-story checklist extended with both items. NV1 section added to `Vector_Scope.md` (TOC + body); spec + handover commits backfilled under NV1. Committed on `feature/notifications-v2`.
1. 2026-05-27T00:20:03Z — Validator init complete. Spec committed to main (`038d937e`). Cut `feature/notifications-v2` from spec commit. Handover initialized. Ready for Wave 1 dispatch.

## NOTES FOR FUTURE-YOU

- **Branch model:** main holds the spec commit; `feature/notifications-v2` is the integration branch; per-story branches are named `feature/notifications-v2/sNN-<slug>` and merged into the integration branch after PASS. Worker branches are not pushed (local-only run).
- **Pre-existing dirty files:** four entries (Vector_Scope.md, api-snapshots/caller-map.json, backend/migrate, backend/db/) belong to an ongoing refactorDB work item — they're not yours and must stay unstaged across every commit you make.
- **Column-prefix rule is mechanical:** the spec already names every column with full-table prefix (e.g. `notifications_events_v2_id`, `notifications_outbox_v2_channel`). If a worker drops the suffix or abbreviates, FAIL — no negotiation, no judgment call.
- **Sentinel clamp is a HARD gate:** every new handler touching tenant data MUST call `sentinel.FromCtx(ctx)` / `sentinel.WorkspaceIDFromCtx(ctx)`. The lint test at `backend/internal/lintchecks/sentinel_clamp_test.go` will catch this; v2 must be added to its scan list in S10.
- **Broadcast inverse-Sentinel lives in `v2/broadcast/`, NOT in the sentinel package.** Decision #13 in the spec — sentinel owns forward clamp; broadcasts own inverse. Reject any worker change that puts resolver code under `app/sentinel/` or `backend/internal/sentinel/`.
- **Critical bypass does NOT override the platform kill switch.** Spec §End-to-end flow → Critical-priority bypass. If a worker writes bypass logic that ignores `notifications_platform_channels.enabled=false`, that's a FAIL. The irreducible floor is in_app via the DB write — that's what survives total channel kill.
- **`_v2` suffix is permanent.** Decision #10. Don't let a worker propose renaming away the suffix "after cutover" — that's a column-rename pass forbidden by the column-prefix rule mechanics.
- **Real RabbitMQ in integration tests.** Decision #17. Workers may NOT swap in an in-process channel mock to save setup time. If they propose it, FAIL and cite spec §Testing strategy Layer 2.
- **Recipient snapshot at fire-time.** Decision #12 + §Broadcast event step 2. A worker that resolves recipients lazily (at dispatch time) breaks the audit narrative. FAIL.
- **No hacks-as-fixes:** if a test fails because a value exceeds a cap, the fix is to make the value match the contract — NOT to bump the cap. Cite the HARD RULE verbatim in any FAIL verdict.
- **SY003 regeneration:** when a worker applies any schema migration, the master must regenerate SY003 afterwards. The validator can flag this in the PASS verdict so the Master triggers it; the validator itself doesn't run `<report> -sy`.
- **Inspect-index discipline:** before every commit, run `git diff --cached --stat` and confirm ONLY the intended files are staged. The pre-existing dirty four MUST stay unstaged.
