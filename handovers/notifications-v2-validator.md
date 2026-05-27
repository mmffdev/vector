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

- Wave 1: pending
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
- [ ] Security — no secrets in code, no auth bypass, no SQL injection, validates inputs at boundaries
- [ ] Scalability — no N+1 queries on hot paths, indexes match access patterns, no unbounded scans
- [ ] No hacks-as-fixes — per the HARD RULE
- [ ] Tech-debt entries logged in docs/c_tech_debt.md for any deferred work

## OPEN BLOCKERS

- None yet.

External dependency tracked in spec:
- **DEP1** — dev sending domain + provider API key. Owner: Rick. Blocks S08/S09 QA only (not foundation work).

## RECENT ACTIVITY (last 5 actions, newest first)

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
