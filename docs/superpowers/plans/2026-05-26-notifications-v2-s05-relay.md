# S05 — Relay + outbox drain + stuck-claim sweeper — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Land `v2/relay/` package — the drain loop that picks unclaimed `notifications_outbox_v2` rows, publishes to the v2 RabbitMQ broker, and the stuck-claim sweeper that recovers rows where a previous claim crashed mid-publish.

**NOTE:** S05 builds the relay **skeleton**. It cannot fully exercise end-to-end because the **pipeline (S06)** is the package that WRITES rows into `notifications_outbox_v2` — until S06 lands, the outbox stays empty in normal flow. S05 ships the drain machinery + a test that manually inserts an outbox row and asserts the relay drains it.

**Story estimate:** 5

**Wave:** 2 — parallel-safe with S02, S03, S07, S08

**Branch:** `notif-v2-s05`

---

## Read first (REQUIRED)

1. **Spec sections:**
   - "Architecture" → `v2/relay/` package layout (relay.go, claim.go, sweeper.go)
   - "End-to-end flow" → step 4 OUTBOX DRAIN (claim batch query, publish to RabbitMQ)
   - "Failure modes" → "Relay crashes after claim, before publish" → SKIP LOCKED + stuck-claim sweeper
   - Spec mentions LISTEN/NOTIFY for low-latency drain wakeup

2. **Existing on disk:**
   - `db/vector_artefacts/schema/122_notif_v2_outbox.sql` — your drain query targets this. Note the partial index `WHERE claimed_at IS NULL AND delivered_at IS NULL AND attempts < 100`.
   - `backend/internal/notifications/v2/broker/` — your relay's only outbound dep. Use `broker.Broker.Publish` and the routing-key helpers from `topology.go`.
   - `backend/internal/notifications/v2/domain/` — types for the envelope marshalling.
   - **v1 relay reference:** `backend/internal/notifications/relay.go` — read for the claim/publish/mark pattern. Mirror the shape; do NOT import.

3. **HARD RULES:** strangler-fig (no v1 imports), inspect-index, explicit-path adds.

---

## File structure

| File | Purpose |
|---|---|
| `backend/internal/notifications/v2/relay/relay.go` | `Relay` struct + `Run(ctx)` loop. Polls every 5s or wakes on `notifications_outbox_v2_inserted` LISTEN. Each tick: claim batch → publish → mark delivered/failed. |
| `backend/internal/notifications/v2/relay/claim.go` | `claimBatch(ctx, tx, limit) ([]outboxRow, error)` — the SKIP LOCKED query. Returns claimed rows + sets `claimed_at`. |
| `backend/internal/notifications/v2/relay/sweeper.go` | `Sweeper.Run(ctx)` — every 60s, reset `claimed_at` to NULL for rows where `claimed_at < now() - 5min` (stuck claim). |
| `backend/internal/notifications/v2/relay/relay_test.go` | Integration test: insert outbox row manually, run relay one tick, assert published to broker + `delivered_at IS NOT NULL`. |
| `backend/internal/notifications/v2/relay/sweeper_test.go` | Integration test: insert outbox row with stale `claimed_at`, run sweeper one tick, assert `claimed_at IS NULL`. |

---

## Tasks

### Task 1 — Worktree confirm + read schema

- [ ] **1.1** `git branch --show-current` → `notif-v2-s05`
- [ ] **1.2** Read `db/vector_artefacts/schema/122_notif_v2_outbox.sql` in full; pay attention to:
  - Exact column names (column-prefix HARD RULE: every column starts with `notifications_outbox_v2_`)
  - The partial index condition
  - Default values (e.g. `attempts INT NOT NULL DEFAULT 0`)
  - Whether there's a `pg_notify` trigger on insert (look for `CREATE TRIGGER`). If yes, the channel name is your LISTEN target.

### Task 2 — `claim.go`

- [ ] **2.1** Define `outboxRow` struct mirroring the table columns (only the ones the relay needs: id, id_event, id_recipient_user, channel, rendered_title, rendered_body, scheduled_for, attempts).

- [ ] **2.2** Write `claimBatch(ctx context.Context, tx pgx.Tx, limit int) ([]outboxRow, error)`. SQL:
  ```sql
  UPDATE notifications_outbox_v2
  SET notifications_outbox_v2_claimed_at = now()
  WHERE notifications_outbox_v2_id IN (
      SELECT notifications_outbox_v2_id
      FROM notifications_outbox_v2
      WHERE notifications_outbox_v2_claimed_at IS NULL
        AND notifications_outbox_v2_delivered_at IS NULL
        AND notifications_outbox_v2_scheduled_for <= now()
        AND notifications_outbox_v2_attempts < 100
      ORDER BY notifications_outbox_v2_created_at
      FOR UPDATE SKIP LOCKED
      LIMIT $1
  )
  RETURNING notifications_outbox_v2_id, notifications_outbox_v2_id_event, ...
  ```
  Returns the claimed rows. The SKIP LOCKED + FOR UPDATE inside the subquery is the contention-safe primitive.

- [ ] **2.3** Compile + commit.

### Task 3 — `relay.go`

- [ ] **3.1** `Relay` struct holding `*pgxpool.Pool`, `broker.Broker`, logger, batch size, tick interval.

- [ ] **3.2** Constructor `NewRelay(pool, broker, ...opts) *Relay`. Default batch=50, tick=5s.

- [ ] **3.3** `Run(ctx context.Context) error`:
  - Start a goroutine that does LISTEN `notifications_outbox_v2_inserted` (if the trigger exists per schema check; otherwise skip and rely on tick).
  - For loop: select on `ctx.Done()`, ticker, OR LISTEN notification — call `drainOnce(ctx)` on each non-cancel signal.

- [ ] **3.4** `drainOnce(ctx)`:
  - Open tx
  - `rows := claimBatch(ctx, tx, batch)`
  - Commit tx (releases the row lock, claimed_at is now persisted — visible to other workers/sweeper)
  - For each row, in own goroutine (or sequentially for simplicity in v1):
    - Build `broker.Envelope{MessageID: rowID, RoutingKey: <domain>.<action>.<channel>, OutboxID: rowID, Payload: <JSON of DeliveryInput-shaped struct>}`
    - Determine `<domain>.<action>` from `id_event`'s row in `notifications_events_v2` (one extra query per row — or pre-join in the claim query for efficiency. v1 reference shows the approach to use.)
    - Call `broker.Publish(ctx, env)`
    - On success: `UPDATE notifications_outbox_v2 SET delivered_at = now() WHERE id = $1`
    - On failure: `UPDATE notifications_outbox_v2 SET attempts = attempts + 1, claimed_at = NULL, last_error = $2 WHERE id = $1` (un-claim so it retries; bump attempts)

- [ ] **3.5** Compile + commit.

### Task 4 — `sweeper.go`

- [ ] **4.1** `Sweeper` struct holding `*pgxpool.Pool`, logger, tick interval (default 60s), stale threshold (default 5min).

- [ ] **4.2** `Run(ctx)`:
  - Ticker; on each tick:
    ```sql
    UPDATE notifications_outbox_v2
    SET notifications_outbox_v2_claimed_at = NULL,
        notifications_outbox_v2_last_error = COALESCE(notifications_outbox_v2_last_error, '') || ' [stuck-claim-recovered]'
    WHERE notifications_outbox_v2_claimed_at IS NOT NULL
      AND notifications_outbox_v2_claimed_at < now() - interval '5 minutes'
      AND notifications_outbox_v2_delivered_at IS NULL
    RETURNING notifications_outbox_v2_id;
    ```
  - Log the count of recovered rows. If > 0, this is a signal — log at WARN level.

- [ ] **4.3** Compile + commit.

### Task 5 — `relay_test.go`

- [ ] **5.1** Integration tagged. Setup:
  - Create a test event in `notifications_events_v2` (use S02's producer? — but S02 may not be merged yet. Insert raw SQL in the test setup.)
  - Insert a recipient row in `notifications_event_recipients`
  - Insert an outbox row pointing at the event, channel=in_app, rendered_title="test", scheduled_for=now()

- [ ] **5.2** Build a mock broker that captures `Publish` calls into a channel. Inject it into `NewRelay`.

- [ ] **5.3** Run `relay.drainOnce(ctx)` once. Assert:
  - Mock broker received exactly one envelope
  - Envelope's RoutingKey matches `<event.type.domain>.<event.type.action>.in_app`
  - Outbox row's `delivered_at IS NOT NULL` after drain
  - `claimed_at` is set (from when we claimed it — depending on implementation, may be set or may have been cleared after delivery; verify against your impl choice)

- [ ] **5.4** Second test: mock broker.Publish returns an error. Assert:
  - Outbox row's `claimed_at IS NULL` after the attempt (un-claimed for retry)
  - `attempts = 1`
  - `last_error` populated

- [ ] **5.5** Commit.

### Task 6 — `sweeper_test.go`

- [ ] **6.1** Setup: insert an outbox row with `claimed_at = now() - interval '10 minutes'` (clearly stale).

- [ ] **6.2** Run `sweeper.runOnce(ctx)`. Assert:
  - `claimed_at IS NULL` after sweep
  - `last_error` contains the `[stuck-claim-recovered]` marker

- [ ] **6.3** Second test: outbox row with `claimed_at = now() - interval '1 minute'` (NOT stale). After sweep: `claimed_at` unchanged.

- [ ] **6.4** Commit.

### Task 7 — Lint discipline

- [ ] **7.1** No new architectural rule. Verify existing lints still pass.

### Task 8 — Final verification

- [ ] **8.1** Build + vet + tests as standard. Real RabbitMQ NOT needed for these tests (mock broker is used); leave the rabbit untouched.

### Task 9 — Report

```
S05 WORKER — STATUS: READY FOR VALIDATION
Branch: notif-v2-s05
Files: relay.go, claim.go, sweeper.go, relay_test.go, sweeper_test.go
Commits: ~5 (one per file)
Drain loop verified: 1 outbox row → 1 broker.Publish call → delivered_at set
Stuck-claim sweeper verified: stale claimed_at → cleared; fresh claimed_at → untouched
LISTEN/NOTIFY wakeup: <wired-yes-if-trigger-exists | tick-only-since-no-trigger>
```

---

## Definition of Done

1. 5 files exist under `backend/internal/notifications/v2/relay/`
2. Build + vet clean
3. Tests PASS
4. No imports from v1
5. Validator PASS

---

## Risks

| Risk | Mitigation |
|---|---|
| LISTEN trigger may not exist yet in migration 122 | Read the schema file; if absent, ship tick-only and log TD entry to add the trigger later. Don't add a migration here — that's S01's job (S01 closed; trigger is a TD followup) |
| Routing-key construction needs event_type lookup | Either pre-join in `claimBatch` query (preferred for perf), or one-extra-query per row. Match v1 pattern |
| Mock broker for tests | Define a small mock that implements `broker.Broker` interface; capture Publish calls in a slice. Don't try to use real RabbitMQ for these tests — S04's broker_integration_test already proves the broker works |
| Concurrent draining (2 relay instances) | SKIP LOCKED handles this at DB level. Run two instances in tests if you want to be paranoid — but standard tests are single-instance |
| Attempt count > 100 = parked | Spec says park after 100. Sweeper does NOT recover these. Verify the partial index condition `attempts < 100` is what excludes them from claim |
