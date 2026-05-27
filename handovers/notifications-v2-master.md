# Notifications v2 — Master Orchestrator Handover

**Last updated:** 2026-05-27 ~03:30
**Owner:** Master agent (orchestrator role) for the Notifications v2 PLA
**Companion:** validator handover at `handovers/notifications-v2-validator.md`
**Spec:** `docs/superpowers/specs/2026-05-26-notifications-v2-design.md`
**Master plan index:** `docs/superpowers/plans/2026-05-26-notifications-v2-index.md`
**Integration branch:** `feature/notifications-v2` at `cdb9cc78` (68 commits ahead of main)

## WAVE 2 — CLOSED ✓

All 5 stories merged: S02 `ada34a4a`, S03 `160f1554`, S05 `68fddc55`, S07 `a9fa7d73` (re-dispatched after initial rejection for strangler-fig violation), S08 `4af460b5`. S07 re-dispatch came in clean — 62 tests PASS, all 4 prior failure modes verified non-repeated.

**Two carryover blockers for next session (deferred from previous validator turn — environment lacked DB access):**
1. **SY003 regen** — substrate changed in Wave 1+2 (12 tables, 12 seed rows, new SQL touchpoints, multiple new lints). HARD RULE in CLAUDE.md mandates regen. Run `<report> -sy "current state of the Vector databases — complete table inventory grouped by role, with row counts, cross-DB soft refs against mmff_library, dead-weight candidates, and every SQL touchpoint in the codebase. Sourced from live pg_stat_user_tables + information_schema introspection."` Master skill, run before Wave 3 dispatch.
2. **schema_migrations tracker backfill (093..131)** — pre-existing drift (not PLA-introduced). Validator confirmed tracker table shape is `(filename TEXT PK, applied_at TIMESTAMPTZ)`. Find filenames with `ls db/vector_artefacts/schema/ | sort -n | awk -F_ '$1>=93 && $1<=131'` then INSERT each with current timestamp.

---

## YOUR ROLE IF YOU LAND HERE COLD

You are the **Master orchestrator** for a multi-agent build of the Notifications v2 system. Your duties:

1. **Brief workers** with story-specific plan docs; dispatch via Agent tool (Sonnet, `isolation: "worktree"`, `run_in_background: true` for parallel)
2. **Receive worker reports** when notified; forward to validator for review
3. **Maintain context discipline** — handover at ~75% context (this doc IS the handover protocol)
4. **Heartbeat user** every 10 min during active dispatch + on every state change
5. **STOP at every wave boundary** for user sign-off before kicking the next wave
6. **STOP immediately on any validator FAIL** and resolve with user

The Validator agent (long-lived Opus, persistent handover) owns ALL git operations and is the sole quality gate. You do NOT commit code; you brief and route.

## USER

- Solo developer (Rick, cookra@me.com)
- Defence/finance buyer profile — Trust-No-One, SOC 2 Type II target
- Foundation-mode preference: "right architecture, narrow wire" over "smallest correct thing"
- Off for the night; standing approval for autonomous orchestration with wave-boundary stops
- Will resume next session by reading this handover

## ORCHESTRATION RULES (LOCKED)

| Aspect | Decision |
|---|---|
| Branch naming | `notif-v2-sNN` (flat — no slash; the `feature/notifications-v2/...` form fails with parent-ref conflict — Wave 1 lesson) |
| Worker model | Sonnet (Opus for validator only) |
| Worker isolation | `isolation: "worktree"` (Wave 1 had collision when parallel workers shared the tree) |
| Validator review depth | Full per-story (spec + code + security + scalability + tests + lints) |
| Stop conditions | Wave boundaries + any validator FAIL |
| Heartbeat | Event-driven + 10min |
| Git authority (validator) | commit / checkout / cherry-pick / merge (--no-ff) / stash / explicit-path add; NO push, NO reset, NO rebase, NO HEAD manipulation, NO branch -D, NO hook renaming outside controlled recovery |
| Scope discipline | Each merged story gets one-line NV1 entry in Vector_Scope.md (validator handles via stash technique); validator's own meta-commits (handover updates, scope-entries commits) are EXEMPT from NV1 requirement |
| Vector_Scope.md hook | `scope-commit-note.sh` async-mutates between tool calls; validator handles via stash + `git checkout HEAD --` pattern; do NOT rename the hook (rejected as audit tampering) |

## PROGRESS (16 STORIES)

| # | Story | State | Merge SHA |
|---|---|---|---|
| S01 | Schema migrations (11 migs, 12 tables) | ✅ MERGED | `fa0b78e1` |
| S02 | Domain types + Producer | ✅ MERGED | `ada34a4a` |
| S03 | Broadcast + inverse-Sentinel Resolver | ✅ MERGED | `160f1554` |
| S04 | RabbitMQ broker (v2) | ✅ MERGED | `801928f8` |
| S05 | Relay + outbox drain + sweeper | ✅ MERGED | `68fddc55` |
| S06 | Pipeline (enrich→filter→router) | 🔵 NEXT — Wave 3, 13pt | — |
| S07 | Rules engine | ✅ MERGED (re-dispatch after strangler-fig rejection) | `a9fa7d73` |
| S08 | Templates DB-backed + seeds | ✅ MERGED | `4af460b5` |
| S09 | Dispatchers + audit writer | 🔴 Wave 4 | — |
| S10 | Handler + sentinel clamps + frontend | 🔴 Wave 5 | — |
| S11 | Broadcast handlers + admin UIs | 🔴 Wave 5 | — |
| S12 | PendingStore Redis + debounce + digest | 🔴 Wave 4 | — |
| S13 | Producers (mention rewire + 5 artefact) | 🔴 Wave 6 | — |
| S14 | Parity harness + dev page | 🔴 Wave 6 | — |
| S15 | Cutover smoke + 30d soak | 🔴 Wave 6 | — |
| S16 | v1 deletion | 🔴 Wave 6 | — |

**Wave 1 closed. Wave 2 closed.** Next: Wave 3 (S06 pipeline, 13pt sequential).

**Roughly 40% complete** (7 / 16 stories merged: S01 + S02 + S03 + S04 + S05 + S07 + S08; ~39 points of ~104 Fibonacci total).

## OPEN BLOCKERS / IMMEDIATE TASKS FOR NEXT SESSION

1. **SY003 regeneration** — HARD RULE in CLAUDE.md requires SY003 regen after any substrate change. Wave 1+2 added 12 tables + 12 seed rows + multiple new SQL touchpoints in v2 Go code + new lints. Run: `<report> -sy "current state of the Vector databases — complete table inventory grouped by role, with row counts, cross-DB soft refs against mmff_library, dead-weight candidates, and every SQL touchpoint in the codebase. Sourced from live pg_stat_user_tables + information_schema introspection."` Master-level skill. Do this BEFORE Wave 3 dispatch.

2. **Migration tracker backfill (093..131)** — `schema_migrations` says last applied = 092, but live DB has 131 applied. Pre-existing drift (not introduced by this PLA). Tracker schema is `(filename TEXT PK, applied_at TIMESTAMPTZ)`. Backfill via psql: `INSERT INTO schema_migrations (filename, applied_at) SELECT filename, now() FROM unnest(ARRAY[<list-from-ls>]) ...` or scripted. Do BEFORE any future migration tool re-attempts these.

3. **Wave 3 plan (S06 pipeline) needs writing** — biggest single story (13pt). Pulls together S02 (domain), S03 (broadcast scope), S05 (relay drains what pipeline writes), S07 (rules — pipeline.filter calls Evaluator.MatchEvent), S08 (templates — pipeline.router renders before outbox write). Spec section "End-to-end flow" steps 3a/3b/3c is canonical. Files: `pipeline.go`, `enrich.go`, `filter.go`, `router.go`, `pending.go` (interface — Redis impl ships in S12), `pipeline_test.go`. Sentinel clamp on recipient is filter.go's job. Quiet hours + platform-channels kill switch are filter-stage. Critical-priority bypass encoded in filter.go + audit row carries `bypass_reason='critical_priority'`.

4. **Wave 2 close report to user** — user is off; resume report goes in the first response of next session. Include: 7/16 stories merged, both Wave 2 carryovers (SY003 + tracker), Wave 3 status (plan TBD, then dispatch).

5. **S04 test-tag split** — now RESOLVED (validator updated handover; ignore prior note).

6. **`<scope> -r` unmatched commits from validator handover-update commits** — standing exemption per Master decision (these are intrinsic to scope-tracking). Review at PLA close, do not chase per-commit.

## CONTEXT DISCIPLINE FOR NEXT SESSION

The Wave 3 plan (S06) is the most detailed plan in the whole PLA. Fresh context is genuinely useful for drafting it. Recommended next-session flow:

1. Read this handover + validator handover
2. Read the spec section "End-to-end flow" steps 3a/3b/3c
3. Check status of S07 re-dispatch worker (look for completion notification or query agent state)
4. If S07 still running: write Wave 3 plan while waiting
5. If S07 done: route to validator, then write Wave 3 plan
6. Once S07 + SY003 + tracker backfill done → close Wave 2 cleanly with user report
7. Drop user a wave-boundary STOP, await go
8. Once user approves: dispatch S06 (sequential, NOT parallel — single 13pt story)

## DEPENDENCIES FOR WAVE 3 (S06 PIPELINE) PLAN

The S06 plan brief must include:

- Worker reads packages from S02 (domain), S03 (broadcast — for the broadcast variant of fan-out), S05 (relay → S06 is what writes the outbox rows S05 drains), S07 (rules — pipeline.filter calls Evaluator.MatchEvent), S08 (templates — pipeline.router renders template before writing outbox row).
- Files to create: `pipeline/pipeline.go`, `enrich.go`, `filter.go`, `router.go`, `pending.go` (interface only — S12 ships Redis impl), `pipeline_test.go`, plus integration tests.
- The PendingStore interface goes here but the Redis impl is S12. For S06's tests, a fake in-memory PendingStore is fine.
- Quiet-hours + platform-channels kill switch are filter-stage concerns; pipeline.filter.go reads from `users_notifications_settings` + `notifications_platform_channels` + `users_notifications_prefs_v2` + (via prefs.Service from a future story or pass through directly).
- Critical-priority bypass is encoded in filter.go AND audit row carries `bypass_reason='critical_priority'`.
- Sentinel clamp on recipient is filter.go's responsibility — verify recipient actually has access to `event.Data.artefact_id` etc.

## REFERENCES

- Spec: `docs/superpowers/specs/2026-05-26-notifications-v2-design.md`
- Master plan index: `docs/superpowers/plans/2026-05-26-notifications-v2-index.md`
- Per-story plans (Wave 1+2 written): `docs/superpowers/plans/2026-05-26-notifications-v2-s{01,02,03,04,05,07,08}-*.md`
- Validator handover: `handovers/notifications-v2-validator.md`
- This handover: `handovers/notifications-v2-master.md` (read on every Master resume)

## TONE & STYLE

- User prefers terse, factual updates with file paths + SHAs
- Use markdown tables for status — easier to scan than prose
- Reference files via `[name](path)` markdown links so they're clickable in the IDE
- Heartbeats: state what's running, what's blocked, what's next; one short sentence per row
- Wave-boundary reports: tabular summary + 1-paragraph narrative + the two-question gate (next wave size + pace cadence confirm)
- Do NOT narrate internal deliberation; state results

## SAFETY NETS

- Always inspect `git diff --cached --stat` before any commit; explicit-path adds only
- Pre-existing dirty four files (`Vector_Scope.md`, `api-snapshots/caller-map.json`, `backend/migrate`, `backend/db/`) are NEVER staged by validator without explicit Master direction
- The scope hook will keep firing on Vector_Scope.md; validator handles via stash technique
- Worktree-isolated workers cannot collide; this was the Wave 1 lesson
