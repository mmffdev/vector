# S06 — Pipeline: enrich → filter → router — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Land `backend/internal/notifications/v2/pipeline/` — the orchestration layer that loads one v2 event, walks its resolved recipients, enriches event data, applies prefs/rules/platform policy, renders templates, and writes `notifications_outbox_v2` rows for relay.

**NOTE:** S06 ships the `PendingStore` interface plus an in-memory fake for tests. The Valkey ZSET implementation is deferred to S12. Valkey is the BSD-3 Redis-protocol-compatible fork chosen over Redis after the March 2024 Redis Inc. SGPL/RSAL licence change; `go-redis` works against it unchanged.

**Story estimate:** 13

**Wave:** 3 — sequential; biggest backend integration story

**Branch:** `notif-v2-s06`

---

## Read first (REQUIRED)

1. **Spec sections:**
   - "Architecture" → `v2/pipeline/` package layout
   - "End-to-end flow" → Direct event and Broadcast event, especially steps 3-6
   - "Interfaces" → `pipeline.PendingStore`
   - "Testing Strategy" → Layer 1 unit tests, Layer 4 Valkey-down critical scenario

2. **Existing v2 packages on this branch:**
   - `backend/internal/notifications/v2/domain/` — typed `Event`, `Priority`, `Channel`, `DeliveryInput`
   - `backend/internal/notifications/v2/producer/` — writes events + direct recipient rows
   - `backend/internal/notifications/v2/broadcast/` — writes broadcast recipient rows
   - `backend/internal/notifications/v2/relay/` — drains `notifications_outbox_v2`; S06 must write rows in the shape relay expects
   - `backend/internal/notifications/v2/rules/` — `Evaluator.MatchEvent(ctx, domain.Event) ([]rules.Rule, error)`
   - `backend/internal/notifications/v2/templates/` — `Service.Render` / `RenderOverride`

3. **Schemas to read in full:**
   - `120_notif_v2_events.sql`
   - `121_notif_v2_event_recipients.sql`
   - `122_notif_v2_outbox.sql`
   - `123_notif_v2_delivery_attempts.sql`
   - `124_notif_v2_users_settings.sql`
   - `125_notif_v2_users_prefs.sql`
   - `126_notif_v2_prefs_defaults.sql`
   - `128_notif_v2_rules.sql`
   - `130_notif_v2_platform_channels.sql`

4. **Hard boundaries:**
   - No imports from v1 notifications.
   - Pipeline does not publish to RabbitMQ; relay owns publish.
   - Pipeline does not deliver to channel providers; dispatchers own delivery in S09.
   - S06 must not require Valkey to run. Use `PendingStore` interface + memory fake only.

---

## File structure

| File | Purpose |
|---|---|
| `backend/internal/notifications/v2/pipeline/types.go` | `Processor`, `EventLoader`, `Recipient`, `Decision`, `Result`, sentinel errors |
| `backend/internal/notifications/v2/pipeline/pipeline.go` | `Processor.ProcessEvent(ctx, eventID)` orchestration: load → enrich → recipients → filter/router per recipient |
| `backend/internal/notifications/v2/pipeline/enrich.go` | Pure enrichment helpers; guarantees base data map and canonical metadata fields |
| `backend/internal/notifications/v2/pipeline/prefs.go` | 3-tier pref resolution: user → subscription tier → system fallback |
| `backend/internal/notifications/v2/pipeline/filter.go` | Critical bypass, prefs, rules, quiet hours, platform kill switch |
| `backend/internal/notifications/v2/pipeline/router.go` | Template render + outbox insert + digest PendingStore push |
| `backend/internal/notifications/v2/pipeline/pending.go` | `PendingStore`, `PendingEntry`, `ErrPendingUnavailable` |
| `backend/internal/notifications/v2/pipeline/pending_memory.go` | Test-only/in-process PendingStore implementation for S06 |
| `backend/internal/notifications/v2/pipeline/suppression.go` | Writes suppression audit rows using a non-deliverable outbox row |
| `backend/internal/notifications/v2/pipeline/*_test.go` | Unit + integration tests for each stage |

---

## Implementation shape

### Processor surface

```go
type Processor interface {
    ProcessEvent(ctx context.Context, eventID uuid.UUID) (Result, error)
}
```

`ProcessEvent` is called by the relay side that resolves events into outbox rows. It loads the event row and all rows in `notifications_event_recipients` for that event, then evaluates each recipient independently.

### Candidate channels

Start from configured prefs/defaults, then apply matching rules:

1. User pref rows for `(user, event_type, channel)`.
2. Tier defaults for `(subscription_tier, event_type, channel)`.
3. System defaults for `(event_type, channel)`.
4. If all three tiers are missing, hard fallback for v1: `in_app` and `sse` enabled with `low` floor; `email` enabled with `medium` floor; `push/slack/sms` disabled because they are unimplemented in `notifications_platform_channels`.

The hard fallback must be isolated in one function and covered by tests. Add a TD entry only if the validator wants system defaults seeded instead.

### Suppression audit

`notifications_delivery_attempts` requires `notifications_delivery_attempts_id_outbox`. For suppressions, create a companion outbox row with:

- `notifications_outbox_v2_delivered_at = now()` so relay will not publish it
- `notifications_outbox_v2_rendered_title = 'suppressed'`
- `notifications_outbox_v2_rendered_body = ''`

Then insert the delivery attempt with `status='suppressed'` and a specific `error_class` such as:

- `prefs_disabled`
- `priority_below_floor`
- `quiet_hours`
- `channel_disabled_platform`
- `template_missing`
- `pending_store_unavailable`

Critical events bypass prefs and quiet hours for `in_app` + `email`; record `bypass_reason='critical_priority'` where useful.

---

## Tasks

### Task 1 — Worktree confirm + schema read

- [ ] **1.1** `git branch --show-current` → `notif-v2-s06`
- [ ] **1.2** Read every schema listed above. Do not invent column names.
- [ ] **1.3** Confirm S02/S05/S07/S08 packages are merged on the branch before implementation starts.

### Task 2 — Types and constructor

- [ ] **2.1** Create `pipeline/types.go`.
- [ ] **2.2** Define `Processor`, `Result`, `Recipient`, `Decision`, `ChannelDecision`, and sentinel errors:
  - `ErrEventNotFound`
  - `ErrNoRecipients`
  - `ErrTemplateMissing`
  - `ErrPendingUnavailable`
- [ ] **2.3** Constructor `NewProcessor(pool, rulesEvaluator, templatesService, pendingStore, opts...) Processor`.
- [ ] **2.4** Keep deps as interfaces wherever possible; tests should inject fakes for rules/templates/pending.

### Task 3 — Event + recipient loading

- [ ] **3.1** `loadEvent(ctx, eventID)` scans `notifications_events_v2` into `domain.Event`.
- [ ] **3.2** `loadRecipients(ctx, eventID)` scans `notifications_event_recipients` into `[]Recipient`.
- [ ] **3.3** If there are zero recipients, return `ErrNoRecipients` and do not write outbox rows.
- [ ] **3.4** Integration test: seeded event + two recipients loads correctly.

### Task 4 — Enrichment

- [ ] **4.1** `enrichEvent(ctx, event domain.Event) (domain.Event, error)` guarantees `event.Data != nil`.
- [ ] **4.2** Add canonical metadata into `event.Data` when missing:
  - `event_id`
  - `event_type`
  - `priority`
  - `subscription_id`
  - `workspace_id`
  - `topology_node_id`
  - `sent_by_user_id`
  - `sent_by_system`
- [ ] **4.3** Do not perform broad domain hydration in S06 unless the required FK data is already obvious and cheap. Missing rich labels are a producer responsibility or future enrichment story.
- [ ] **4.4** Unit tests: nil data, prefilled data is not overwritten, optional UUIDs handled.

### Task 5 — Pref resolution

- [ ] **5.1** Create `prefs.go` with a small resolver local to pipeline.
- [ ] **5.2** Resolve per `(recipient_user_id, event_type, channel)`:
  - user pref from `users_notifications_prefs_v2`
  - tier default from `notifications_prefs_tier_defaults`
  - system default from `notifications_prefs_system_defaults`
  - hard fallback if no DB row exists
- [ ] **5.3** Subscription tier source: inspect existing subscription schema/service. If tier is not available in current DB shape, document and use system/default fallback only.
- [ ] **5.4** Priority floor comparison helper with order `low < medium < high < critical`.
- [ ] **5.5** Tests: user override beats tier/system; disabled pref suppresses; priority floor suppresses low-priority event; critical bypass overrides prefs for `in_app` + `email`.

### Task 6 — Rule application

- [ ] **6.1** Call `rules.Evaluator.MatchEvent(ctx, event)` once per event, not once per recipient.
- [ ] **6.2** Apply matching rules to candidate decisions:
  - `Channels` adds/replaces candidate channels per S07 rule semantics
  - `PriorityOverride` changes effective priority for routing
  - `TemplateOverrideID` chooses `templates.RenderOverride`
  - `Schedule` controls immediate / next quiet hours end / digest
- [ ] **6.3** Deterministic conflict handling: apply rules in evaluator order; later rule wins for priority/template/schedule, channel set is unioned.
- [ ] **6.4** Tests: one matching rule adds email; priority override raises low→high; template override ID is carried to router.

### Task 7 — Quiet hours + platform channel kill switch

- [ ] **7.1** Quiet hours read from `users_notifications_settings`.
- [ ] **7.2** Non-critical events inside quiet hours with schedule `next_quiet_hours_end` are scheduled for the end of the quiet window.
- [ ] **7.3** Critical events bypass quiet hours for `in_app` + `email`.
- [ ] **7.4** Platform channel state read from `notifications_platform_channels`; `enabled=false` suppresses the channel except no code path should disable the in-app floor.
- [ ] **7.5** Tests: quiet hours defer; platform-disabled email suppresses; unimplemented push/slack/sms suppress.

### Task 8 — Router and outbox writes

- [ ] **8.1** `router.go` renders title/body through `templates.Service`.
- [ ] **8.2** Immediate and scheduled decisions insert `notifications_outbox_v2` rows with:
  - event ID
  - recipient user ID
  - channel
  - rendered title/body
  - scheduled_for
- [ ] **8.3** `rules.ScheduleDigest` pushes `PendingEntry` to `PendingStore` instead of inserting immediate outbox.
- [ ] **8.4** If PendingStore is unavailable, critical events fall back to immediate outbox; non-critical events get suppression audit with `error_class='pending_store_unavailable'`.
- [ ] **8.5** Tests: immediate outbox row, scheduled outbox row, digest push to fake store, pending failure fallback.

### Task 9 — Suppression audit

- [ ] **9.1** `suppression.go` helper writes the non-deliverable outbox row and matching `notifications_delivery_attempts` row in one transaction.
- [ ] **9.2** Suppression reasons are stable strings; do not free-text every call site.
- [ ] **9.3** Tests: prefs suppression writes one attempt row; platform channel suppression writes one attempt row; relay ignores suppression outbox row because delivered_at is populated.

### Task 10 — Process orchestration

- [ ] **10.1** `ProcessEvent` wraps each recipient decision in a transaction so one recipient failure does not corrupt another.
- [ ] **10.2** Result counts include:
  - recipients seen
  - outbox rows written
  - pending entries pushed
  - suppressions written
  - errors
- [ ] **10.3** Idempotency: repeated `ProcessEvent(eventID)` must not duplicate outbox rows for the same `(event, user, channel, scheduled_for)` if rows already exist. If schema lacks a unique index, implement existence check before insert and add TD for DB-level uniqueness.
- [ ] **10.4** Integration test: one event + two recipients produces expected outbox/suppression counts.

### Task 11 — PendingStore fake

- [ ] **11.1** `pending.go` defines the interface exactly as the spec shape:
  ```go
  type PendingStore interface {
      Push(ctx context.Context, entry PendingEntry) error
      PopDue(ctx context.Context, limit int) ([]PendingEntry, error)
      PeekDigestBucket(ctx context.Context, userID uuid.UUID, bucket string) ([]PendingEntry, error)
  }
  ```
- [ ] **11.2** `pending_memory.go` implements it for unit/integration tests only. It is not a production substitute for Valkey.
- [ ] **11.3** Tests cover Push/PopDue/Peek ordering by due time.

### Task 12 — Lint and TD discipline

- [ ] **12.1** No new lint unless implementation introduces a new architectural constraint.
- [ ] **12.2** Add a TD row for any fallback that should become data-driven (for example missing system pref seeds or outbox uniqueness).
- [ ] **12.3** Update `Vector_Scope.md` under NV1 in the same commit as code.

### Task 13 — Verification

- [ ] **13.1** `go test ./backend/internal/notifications/v2/pipeline/...` or package-local equivalent.
- [ ] **13.2** Run affected v2 package tests:
  - `domain`
  - `rules`
  - `templates`
  - `relay`
- [ ] **13.3** Integration tests should skip cleanly when DB tunnel is unavailable; do not silently hit staging/prod.
- [ ] **13.4** Confirm no v1 notification imports:
  ```bash
  rg 'internal/notifications"' backend/internal/notifications/v2/pipeline
  ```
  Expected: no matches.

### Task 14 — Report

```
S06 WORKER — STATUS: READY FOR VALIDATION
Branch: notif-v2-s06
Files: pipeline/{types,pipeline,enrich,prefs,filter,router,pending,pending_memory,suppression}.go + tests
Consumers used: S02 domain/producer rows, S05 relay outbox shape, S07 rules evaluator, S08 templates service
PendingStore: interface + memory fake only; Valkey impl deferred to S12
Critical bypass: verified
Suppression audit: verified
Outbox writes: immediate + scheduled verified
Digest path: fake PendingStore verified
```

---

## Definition of Done

1. `backend/internal/notifications/v2/pipeline/` package exists and compiles.
2. `ProcessEvent` can transform event + recipients into outbox rows, pending entries, or suppression audit rows.
3. Critical-priority bypass behavior is covered by tests.
4. Platform channel kill switch is covered by tests.
5. No v1 notification imports.
6. S12 remains the only story that adds `pending_valkey.go` / external Valkey client wiring.
7. Validator PASS verdict.

---

## Risks

| Risk | Mitigation |
|---|---|
| Pipeline grows beyond 13 points | Split mid-flight into S06a filter/router and S06b prefs/suppression; do not half-land untested orchestration |
| Suppression audit schema needs outbox FK | Use non-deliverable outbox row with `delivered_at=now()`; add TD if validator wants schema changed later |
| System defaults not seeded | Use isolated hard fallback with tests; add TD or seed migration if validator requires data-driven defaults |
| Rule conflicts are ambiguous | Deterministic order: evaluator order, later scalar override wins, channels union |
| Valkey unavailable during S06 | No production Valkey dependency in S06; memory fake only. S12 owns Valkey implementation and failure injection |
