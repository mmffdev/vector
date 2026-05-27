# Notifications v2 — Master Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement story-level plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `backend/internal/notifications/` with a v2 stack architected for the defence/finance buyer profile — full audit trail, sentinel-clamped handlers, multi-scope broadcasts, critical-bypass with platform kill switch, three-tier prefs resolution, real RabbitMQ test path. Strangler-fig: v2 ships alongside v1, gated by `NOTIFICATIONS_V2` flag, cut over after 30-day parity soak.

**Architecture:** New package `backend/internal/notifications/v2/` with eleven sub-packages (domain, producer, broadcast, broker, relay, pipeline, rules, templates, dispatchers, audit, prefs, handler, parity). Eleven new tables in `vector_artefacts` (all `_v2` suffix permanent, column-prefix HARD RULE compliant). One new infra dep (Redis for debounce/digest ZSET). RabbitMQ topic exchange `notifications`, routing key `<domain>.<action>.<channel>`.

**Tech Stack:** Go 1.23, pgx/v5, chi router, amqp091-go, go-redis/v9, Next.js 14 (frontend), existing `realtime.Hub` for SSE. No new TS deps.

**Source spec:** [../specs/2026-05-26-notifications-v2-design.md](../specs/2026-05-26-notifications-v2-design.md). Read it FIRST. Every story is judged against it.

**Validator handover:** `handovers/notifications-v2-validator.md` — the validator agent's persistent memory.

---

## Orchestration model

This PLA is executed by a multi-agent system:
- **Master agent** (main conversation thread) — orchestrates dispatch, tracks waves, escalates blockers to user
- **Global validator** (long-lived Opus agent, single instance via persistent handover) — sole git authority for the run (local commits only — no push, no HEAD manipulation), validates every story against the per-story checklist
- **Worker agents** (Sonnet, spawned per story) — implement one story end-to-end against its plan doc

Workers report to Master. Master forwards to Validator. Validator commits validated work to `feature/notifications-v2`.

Per-story validation gate covers:
1. Spec adherence
2. Column-prefix HARD RULE
3. Sentinel clamp where applicable
4. Tests pass
5. Lints pass (existing + any new rule needed for this story — see linter discipline amendment)
6. Security review (no secrets, no auth bypass, no SQL injection, validates at boundaries)
7. Scalability (no N+1, indexes match access patterns)
8. No hacks-as-fixes
9. Vector_Scope.md entry appended in the same commit (scope discipline amendment)

---

## Wave plan

| Wave | Stories | Parallel? | Critical path? |
|---|---|---|---|
| Wave 1 | S01, S04 | Yes (no deps) | S01 yes |
| Wave 2 | S02, S03, S05, S07, S08 | Yes (all need only S01 + S04) | S05 yes |
| Wave 3 | S06 | No (sequential, biggest story) | Yes |
| Wave 4 | S09, S12 | Yes | S09 yes |
| Wave 5 | S10, S11 | Yes | S10 yes |
| Wave 6 | S13 → S14 → S15 → S16 | Sequential | Yes |

The Master stops at every wave boundary for user sign-off before kicking the next wave. The Master also stops immediately on any validator FAIL.

---

## Story list

| # | Title | Plan doc (TBD = just-in-time) | Est | Wave |
|---|---|---|---|---|
| **S01** | Schema migrations (11 migs, 12 tables, seeds, indexes, CHECKs) | [s01-schema](./2026-05-26-notifications-v2-s01-schema.md) | 5 | 1 |
| **S02** | Domain types + `Producer` interface + `dbproducer` impl | TBD | 5 | 2 |
| **S03** | Inverse-Sentinel `Resolver` + `broadcast.Service` | TBD | 8 | 2 |
| **S04** | RabbitMQ broker wrapper + exchange/queue declarations | [s04-broker](./2026-05-26-notifications-v2-s04-broker.md) | 3 | 1 |
| **S05** | Relay + outbox drain + stuck-claim sweeper | TBD | 5 | 2 |
| **S06** | Pipeline: enrich → filter → router | TBD | 13 | 3 |
| **S07** | Rules engine — real `matchConditions` | TBD | 8 | 2 |
| **S08** | Templates: DB-backed lookup + interpolation + seed templates | TBD | 5 | 2 |
| **S09** | Dispatchers: interface + in_app + sse + email (real) + audit writer | TBD | 8 | 4 |
| **S10** | Handler (read side) + sentinel clamps + frontend rewire | TBD | 8 | 5 |
| **S11** | Broadcast handlers + admin UIs + preview-count | TBD | 13 | 5 |
| **S12** | PendingStore (Redis) + debounce + digest cron + Redis in dev swarm | TBD | 13 | 4 |
| **S13** | Producers: mention rewire + 5 artefact lifecycle producers | TBD | 8 | 6 |
| **S14** | Parity harness + dev page | TBD | 5 | 6 |
| **S15** | Cutover smoke + flip flag + 30-day soak (manual) | TBD | 3 | 6 |
| **S16** | v1 deletion (post-soak) | TBD | 5 | 6 |

Plan docs are written **just-in-time** at the start of each wave. The detail in S02 depends on what S01 produced; writing it upfront wastes effort. Wave-1 plans (S01, S04) are written now; remaining plans are written by the Master before the wave they belong to is dispatched.

---

## DEP1 (external)

**Dev sending domain + provider API key** — owner: user. Out-of-band procurement task (~30 min real-world: register `dev.<root>` subdomain, set MX/SPF/DKIM/DMARC records via your email provider, generate a sandbox API key, drop into `backend/.env.dev`).

Blocks S09 email-channel QA only. Other stories proceed without it.

---

## Branch model

- `main` — only carries the spec doc + final integration merge (no push during run; merge is user-driven at end)
- `feature/notifications-v2` — long-lived integration branch
- `feature/notifications-v2/sNN-<slug>` — one per story, validator merges into integration after PASS

---

## Process discipline (worker-facing)

Every worker must follow these or the validator will FAIL the story:

1. **Read the spec section** for your story before writing any code
2. **Inspect `git diff --cached --stat`** before every commit (HARD RULE)
3. **Stage only files relevant to this story** — explicit path adds, never `git add -A`
4. **Sentinel clamp** on any handler that touches tenant tables — `sentinel.FromCtx(ctx)`, not `auth.UserFromCtx` alone
5. **Column-prefix HARD RULE** — every column on every new table is `<full_table_name>_<col>`
6. **Tests-first** where the story spec calls for TDD; tests-alongside otherwise
7. **No hacks-as-fixes** — if a symptom is "X exceeds Y", fix why X grew, do not raise Y
8. **Append a Vector_Scope.md entry** in the same commit as the story's code (one line under the NV1 section)
9. **New lint rule** if the story introduces an architectural constraint not already enforced — wire it before claiming PASS
10. **TD entries** in `docs/c_tech_debt.md` for any deferred work, with trigger condition

---

## Self-review (Master, before dispatch)

- [x] Spec coverage: all 17 spec decisions traceable to one or more stories
- [x] Story dependencies match the spec's sequencing section
- [x] No placeholders in this index doc
- [x] Per-story plan docs deferred to just-in-time (rationale documented above)

Ready for Wave 1 plan dispatch.
