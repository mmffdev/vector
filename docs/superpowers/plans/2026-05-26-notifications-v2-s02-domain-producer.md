# S02 — Domain types + Producer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the v2 `domain/` package (zero-dep types — `Event`, `Priority`, `FanoutMode`, `Channel`, `EventType`, `DeliveryInput`, `DeliveryReceipt`, `DeliveryStatus`) and the `producer/` package (`Producer` interface + `dbproducer` Postgres impl that writes to `notifications_events_v2` + `notifications_event_recipients` atomically, with idempotency on `(subscription_id, event_key)`).

**Story estimate:** 5

**Wave:** 2 (parallel-safe with S03, S05, S07, S08)

**Branch:** `notif-v2-s02` (flat — no slash — to avoid the parent-ref conflict that broke Wave 1)

**Worktree:** Your agent runner spun up an isolated worktree for this story. All file paths in this plan are relative to the worktree root, which mirrors the main repo structure. Your worktree is on its own branch from `feature/notifications-v2`.

---

## Read first (REQUIRED)

1. **Spec sections** in [../specs/2026-05-26-notifications-v2-design.md](../specs/2026-05-26-notifications-v2-design.md):
   - "Interfaces" → `producer.Producer`
   - "Architecture" → package layout for `v2/domain/` and `v2/producer/`
   - "End-to-end flow" → step 1 PRODUCER (shows producer.EnqueueTx call pattern)
   - "Data model" → `notifications_events_v2` and `notifications_event_recipients` (DDL you write against)
   - Locked decision #1 (event_id semantics — UUID PK + event_key idempotency)
   - Locked decision #2 (scope: subscription_id required except platform, workspace_id optional)
   - Locked decision #3 (event type naming: `<domain>.<action>`)

2. **Master plan index:** [2026-05-26-notifications-v2-index.md](./2026-05-26-notifications-v2-index.md)

3. **Existing schema (already on disk from S01):**
   - `db/vector_artefacts/schema/120_notif_v2_events.sql`
   - `db/vector_artefacts/schema/121_notif_v2_event_recipients.sql`
   - Verify your understanding of the columns + CHECK constraints from these files before writing Go code

4. **v1 producer reference (read-only, NEVER IMPORT):** `backend/internal/notifications/notifier.go` and `backend/internal/notifications/dbnotifier.go` — see how v1 wires `EnqueueTx` for the mention producer. Match the shape; v2 must be standalone.

5. **HARD RULES:**
   - Strangler-fig: NO imports from v1 notifications package
   - Inspect `git diff --cached --stat` before EVERY commit
   - Explicit-path `git add` only

---

## File structure

| # | File | Purpose |
|---|---|---|
| 1 | `backend/internal/notifications/v2/domain/event.go` | `Event`, `Priority`, `FanoutMode`, `Channel`, `EventType` + helpers |
| 2 | `backend/internal/notifications/v2/domain/delivery.go` | `DeliveryInput`, `DeliveryReceipt`, `DeliveryStatus` |
| 3 | `backend/internal/notifications/v2/domain/event_test.go` | Unit tests for `EventType` parser, constants, validation helpers |
| 4 | `backend/internal/notifications/v2/producer/producer.go` | `Producer` interface |
| 5 | `backend/internal/notifications/v2/producer/dbproducer.go` | Postgres impl: `Enqueue` + `EnqueueTx` |
| 6 | `backend/internal/notifications/v2/producer/dbproducer_test.go` | Integration test (real DB): enqueue + idempotency + direct fanout writes 1 recipient row |

---

## Task 1: Branch & verify worktree

- [ ] **Step 1.1**: Confirm current branch (your runner cut a new branch off `feature/notifications-v2`):

```bash
git branch --show-current
```

Expected: `notif-v2-s02` (or whatever the runner named it — accept and continue if it's clearly your story's branch off the integration branch).

- [ ] **Step 1.2**: Confirm `notifications_events_v2` exists in the dev DB (your worktree shares the same dev DB as main):

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "\d notifications_events_v2" 2>&1 | head -20
```

Expected: column list. If missing, STOP — S01 schema isn't applied; that's a blocker.

---

## Task 2: Write `domain/event.go`

- [ ] **Step 2.1**: Create the file with the types below. Spec section "Interfaces" → "Domain types — `v2/domain/event.go`" has the canonical struct shape; **copy from spec verbatim** with these specifics:
  - `package domain`
  - Imports: `time`, `github.com/google/uuid` (no others; this package is zero-dep)
  - Enums use string-typed constants (Go idiomatic): `type Priority string`, `type FanoutMode string`, `type Channel string`
  - Constants: `PriorityLow / PriorityMedium / PriorityHigh / PriorityCritical`; `FanoutDirect / FanoutWorkspace / FanoutTopologyNode / FanoutTopologySubtree / FanoutTenant / FanoutPlatform`; `ChannelInApp / ChannelSSE / ChannelEmail / ChannelPush / ChannelSlack / ChannelSMS`
  - `EventType struct { Domain, Action string }` with `String()` and `ParseEventType(s string) (EventType, error)` (split on first `.`; error if missing dot or empty parts)
  - `Event struct` with pointer fields for optional scope (`*uuid.UUID` for SubscriptionID, WorkspaceID, TopologyNodeID, RecipientUserID, SentByUserID) — `nil` means unset, matching the DB's NULL semantics
  - `ID uuid.UUID` and `CreatedAt time.Time` are populated by producer.Enqueue, not by callers

- [ ] **Step 2.2**: Add a validation helper `Event.Validate() error` that enforces the CHECK constraints from the DDL at the Go level (fail-fast before DB hits):
  - `priority IN ('low','medium','high','critical')` → check Priority is one of the constants
  - `fanout_mode = 'direct' ⇒ id_recipient_user IS NOT NULL` → if FanoutDirect, RecipientUserID must be non-nil
  - `fanout_mode = 'platform' ⇒ id_subscription IS NULL` → if FanoutPlatform, SubscriptionID must be nil
  - `fanout_mode IN ('topology_node','topology_subtree') ⇒ id_topology_node IS NOT NULL`
  - `sent_by_system = true ⇒ id_sent_by_user IS NULL`
  - All other modes (workspace, tenant) require `SubscriptionID != nil`
  - `EventKey` must not be empty (idempotency key required)

- [ ] **Step 2.3**: Compile:

```bash
cd backend && go build ./internal/notifications/v2/domain/...
```

Expected: no errors.

- [ ] **Step 2.4**: Stage + inspect + commit:

```bash
git add backend/internal/notifications/v2/domain/event.go
git diff --cached --stat
```

Expected: ONLY `event.go` staged.

```bash
git commit -m "$(cat <<'EOF'
feat(notif-v2): domain types — Event, Priority, FanoutMode, Channel, EventType

Zero-dep types module. Pointer fields on Event for optional scope
(nil → DB NULL). Event.Validate() enforces the CHECK constraints
from migration 120 at the Go level (fail-fast). EventType parses
"<domain>.<action>" form per locked decision #3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write `domain/delivery.go`

- [ ] **Step 3.1**: Create with the `DeliveryInput`, `DeliveryReceipt`, `DeliveryStatus` types from spec section "Interfaces" → "Dispatcher interface". They're used by dispatchers + audit but defined here so domain is the central type module.

```go
type DeliveryStatus string

const (
    DeliveryQueued     DeliveryStatus = "queued"
    DeliverySent       DeliveryStatus = "sent"
    DeliveryDelivered  DeliveryStatus = "delivered"
    DeliveryBounced    DeliveryStatus = "bounced"
    DeliveryFailed     DeliveryStatus = "failed"
    DeliverySuppressed DeliveryStatus = "suppressed"
)

type DeliveryInput struct {
    EventID         uuid.UUID
    OutboxID        uuid.UUID
    RecipientUserID uuid.UUID
    Channel         Channel
    Title           string
    Body            string
    Priority        Priority
    Data            map[string]any
    AttemptNumber   int
}

type DeliveryReceipt struct {
    Status            DeliveryStatus
    ProviderMessageID string
    ProviderResponse  map[string]any
    LatencyMS         int
    ErrorClass        string
}
```

- [ ] **Step 3.2**: Compile.

- [ ] **Step 3.3**: Commit:

```bash
git add backend/internal/notifications/v2/domain/delivery.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(notif-v2): domain — DeliveryInput, DeliveryReceipt, DeliveryStatus

Used by dispatchers + audit. Six DeliveryStatus values matching
migration 123's CHECK constraint exactly (queued/sent/delivered/
bounced/failed/suppressed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write `domain/event_test.go`

- [ ] **Step 4.1**: Unit tests (no DB, no infra):

```go
package domain_test

import (
    "testing"
    "github.com/google/uuid"
    "github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

func TestParseEventType(t *testing.T) {
    cases := []struct{
        in       string
        wantD    string
        wantA    string
        wantErr  bool
    }{
        {"artefact.blocked", "artefact", "blocked", false},
        {"mention.created", "mention", "created", false},
        {"users.password_changed", "users", "password_changed", false},
        {"invalid", "", "", true},
        {"", "", "", true},
        {".action", "", "", true},
        {"domain.", "", "", true},
    }
    for _, c := range cases {
        et, err := domain.ParseEventType(c.in)
        if c.wantErr {
            if err == nil { t.Errorf("ParseEventType(%q): want error, got nil", c.in) }
            continue
        }
        if err != nil { t.Errorf("ParseEventType(%q): unexpected error: %v", c.in, err); continue }
        if et.Domain != c.wantD || et.Action != c.wantA {
            t.Errorf("ParseEventType(%q): got %+v, want {%q,%q}", c.in, et, c.wantD, c.wantA)
        }
        // round-trip
        if et.String() != c.in {
            t.Errorf("EventType.String() round-trip: got %q want %q", et.String(), c.in)
        }
    }
}

func TestEventValidate(t *testing.T) {
    subID := uuid.New()
    userID := uuid.New()
    wsID := uuid.New()
    nodeID := uuid.New()
    
    cases := []struct{
        name    string
        ev      domain.Event
        wantErr bool
    }{
        {"valid direct", domain.Event{
            EventKey: "k1", Priority: domain.PriorityMedium, FanoutMode: domain.FanoutDirect,
            SubscriptionID: &subID, RecipientUserID: &userID,
        }, false},
        {"direct missing recipient", domain.Event{
            EventKey: "k2", Priority: domain.PriorityMedium, FanoutMode: domain.FanoutDirect,
            SubscriptionID: &subID,
        }, true},
        {"valid workspace", domain.Event{
            EventKey: "k3", Priority: domain.PriorityMedium, FanoutMode: domain.FanoutWorkspace,
            SubscriptionID: &subID, WorkspaceID: &wsID,
        }, false},
        {"platform with subscription set", domain.Event{
            EventKey: "k4", Priority: domain.PriorityCritical, FanoutMode: domain.FanoutPlatform,
            SubscriptionID: &subID,
        }, true},
        {"valid platform", domain.Event{
            EventKey: "k5", Priority: domain.PriorityCritical, FanoutMode: domain.FanoutPlatform,
            SentBySystem: true,
        }, false},
        {"topology_subtree missing node", domain.Event{
            EventKey: "k6", Priority: domain.PriorityHigh, FanoutMode: domain.FanoutTopologySubtree,
            SubscriptionID: &subID,
        }, true},
        {"valid topology_subtree", domain.Event{
            EventKey: "k7", Priority: domain.PriorityHigh, FanoutMode: domain.FanoutTopologySubtree,
            SubscriptionID: &subID, TopologyNodeID: &nodeID,
        }, false},
        {"sent_by_system with user", domain.Event{
            EventKey: "k8", Priority: domain.PriorityHigh, FanoutMode: domain.FanoutPlatform,
            SentBySystem: true, SentByUserID: &userID,
        }, true},
        {"missing event_key", domain.Event{
            Priority: domain.PriorityMedium, FanoutMode: domain.FanoutDirect,
            SubscriptionID: &subID, RecipientUserID: &userID,
        }, true},
        {"invalid priority", domain.Event{
            EventKey: "k9", Priority: domain.Priority("bogus"), FanoutMode: domain.FanoutDirect,
            SubscriptionID: &subID, RecipientUserID: &userID,
        }, true},
    }
    for _, c := range cases {
        t.Run(c.name, func(t *testing.T) {
            err := c.ev.Validate()
            if c.wantErr && err == nil { t.Errorf("want error, got nil") }
            if !c.wantErr && err != nil { t.Errorf("unexpected error: %v", err) }
        })
    }
}
```

- [ ] **Step 4.2**: Run:

```bash
go test ./internal/notifications/v2/domain/...
```

Expected: PASS.

- [ ] **Step 4.3**: Commit:

```bash
git add backend/internal/notifications/v2/domain/event_test.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
test(notif-v2): domain — EventType parser + Event.Validate

Table-driven coverage of EventType parsing (valid + 4 invalid
forms with round-trip via String()) and Event.Validate across
all six fanout modes including the CHECK invariants from mig 120.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write `producer/producer.go` — interface

- [ ] **Step 5.1**:

```go
// Package producer is the v2 doorway for firing notifications.
// External code (mentions service, artefact lifecycle, auth) calls
// Producer.Enqueue or .EnqueueTx; it never touches the outbox or
// broker directly.
//
// Idempotency: Producer is idempotent on (subscription_id, event_key).
// Re-firing the same event with the same key returns the original
// event ID — no duplicate row.
package producer

import (
    "context"
    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    "github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

type Producer interface {
    // Enqueue writes the event to notifications_events_v2 in its own
    // transaction. For direct events also writes the single
    // notifications_event_recipients row. Returns the event ID.
    Enqueue(ctx context.Context, e domain.Event) (uuid.UUID, error)
    
    // EnqueueTx writes inside the caller's transaction. Use this when
    // the event must be atomic with a domain write (e.g. mention
    // creation atomic with users_mentions INSERT).
    EnqueueTx(ctx context.Context, tx pgx.Tx, e domain.Event) (uuid.UUID, error)
}
```

(Replace the import path with the actual module — `head -1 backend/go.mod` shows it.)

- [ ] **Step 5.2**: Compile.

- [ ] **Step 5.3**: Commit:

```bash
git add backend/internal/notifications/v2/producer/producer.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(notif-v2): Producer interface

Two methods: Enqueue (own tx) + EnqueueTx (caller's tx for
atomic domain writes). Idempotent on (subscription_id, event_key).
Only doorway for external code firing v2 events.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Write `producer/dbproducer.go` — Postgres impl

- [ ] **Step 6.1**: Implement `dbProducer` struct holding a `*pgxpool.Pool`. Methods:

  - `NewDBProducer(pool *pgxpool.Pool) *dbProducer` constructor
  - `Enqueue(ctx, event)`:
    - Calls `event.Validate()`; return error on invalid
    - Opens a `pool.BeginTx(ctx, pgx.TxOptions{})`
    - Calls `EnqueueTx(ctx, tx, event)` to do the inserts
    - Commits on success, rolls back on error
    - Returns event ID
  - `EnqueueTx(ctx, tx, event)`:
    - Calls `event.Validate()`
    - Generates `uuid.New()` for event ID (assign to `event.ID`)
    - Sets `event.CreatedAt = time.Now()`
    - **Idempotency check first**: query `SELECT notifications_events_v2_id FROM notifications_events_v2 WHERE notifications_events_v2_id_subscription = $1 AND notifications_events_v2_event_key = $2` with subscription_id + event_key. If a row exists, return the existing ID (idempotent path — DO NOT insert).
    - For platform events (subscription_id is nil), the idempotency query must use `IS NULL` not `= NULL`. Handle this branch explicitly.
    - INSERT into `notifications_events_v2` with all spec columns. Convert `event.Data` to JSON bytes via `json.Marshal` for the jsonb column. For nullable pointer fields use `pgtype.UUID{Valid: ptr != nil}` or pass nil interface.
    - **If FanoutMode == FanoutDirect**: also INSERT into `notifications_event_recipients` (one row, reason='direct', resolved_at=now()) AND `UPDATE notifications_events_v2 SET notifications_events_v2_resolved_at = now(), notifications_events_v2_recipient_count = 1 WHERE notifications_events_v2_id = <id>`.
    - For all OTHER fanout modes: do NOT write recipient rows here (the broadcast service or the relay handles fan-out resolution). Leave `resolved_at` and `recipient_count` NULL.
    - Return the event ID.

- [ ] **Step 6.2**: Compile. Run `go vet ./internal/notifications/v2/producer/...`. Expected: clean.

- [ ] **Step 6.3**: Commit:

```bash
git add backend/internal/notifications/v2/producer/dbproducer.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(notif-v2): dbProducer — Postgres impl of Producer

Validate() check before insert. Idempotency lookup by
(subscription_id, event_key) returns existing ID without
duplicate row. Direct events also write a single
notifications_event_recipients row + resolve event atomically;
broadcasts leave resolved_at NULL for the relay/broadcast
service to handle fan-out separately.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Write `producer/dbproducer_test.go` — integration (real DB)

- [ ] **Step 7.1**: Integration test against the dev DB. Tag `//go:build integration` per Wave 1 lesson (split tagged file = separate file from any unit tests; this one is purely integration).

Test cases:
- `TestEnqueue_DirectEvent_WritesEventAndRecipient` — fire a direct event; assert one row in events_v2 + one in event_recipients + resolved_at IS NOT NULL + recipient_count=1
- `TestEnqueue_Idempotent` — call Enqueue twice with same (subscription_id, event_key); second call returns same ID, only one row in events_v2
- `TestEnqueue_Broadcast_NoRecipientYet` — fire a workspace broadcast; assert event row present, recipient_count IS NULL, no rows in event_recipients yet
- `TestEnqueue_ValidationFailure` — fire a `FanoutDirect` with nil RecipientUserID; assert error returned, no rows written
- `TestEnqueueTx_RollbackOnCallerError` — open a tx, EnqueueTx, then ROLLBACK; assert no rows in events_v2

Use a fresh `event_key` per test (e.g. `t.Name() + uuid.NewString()`) to avoid cross-test pollution. Cleanup: each test deletes its own event rows in `t.Cleanup(...)` to keep the dev DB tidy.

Connection: read `DATABASE_URL` from env, fall back to `t.Skip()` if unset, matching Wave 1's pattern.

- [ ] **Step 7.2**: Run:

```bash
cd backend && export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.dev | cut -d= -f2-)
go test -tags=integration ./internal/notifications/v2/producer/... -v
```

Expected: 5 PASS.

- [ ] **Step 7.3**: Commit:

```bash
git add backend/internal/notifications/v2/producer/dbproducer_test.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
test(notif-v2): dbProducer integration — Enqueue + Idempotency + Validation + Tx rollback

Real-DB integration test against vector_artefacts. Five cases:
direct write atomicity, idempotency by event_key, broadcast
leaves recipient_count NULL, validation fail-fast, caller-tx
rollback semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Lint discipline

S02 introduces a new architectural rule worth enforcing: **external code must use producer.Producer, never the outbox table directly**. This is exactly the kind of rule the validator's linter-discipline amendment requires.

- [ ] **Step 8.1**: Write `dev/scripts/lint_no_direct_outbox_write.sh`:

```bash
#!/usr/bin/env bash
# lint:no-direct-outbox-write
# Fails if any code OUTSIDE backend/internal/notifications/v2/ writes
# directly to notifications_outbox_v2 or notifications_events_v2.
# External producers must use the producer.Producer surface.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEARCH="$ROOT/backend/internal"

# Look for SQL INSERTs against the v2 tables outside the v2 package.
VIOLATIONS=$(grep -rln --include="*.go" \
    -E "INSERT INTO notifications_(events_v2|outbox_v2|event_recipients)" \
    "$SEARCH" 2>/dev/null \
    | grep -v "/notifications/v2/" \
    || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo "[lint:no-direct-outbox-write] FAIL"
    echo "Code outside backend/internal/notifications/v2/ writes directly"
    echo "to v2 notification tables. External producers must use"
    echo "producer.Producer.Enqueue / EnqueueTx. Files:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "[lint:no-direct-outbox-write] PASS"
```

- [ ] **Step 8.2**: `chmod +x` it. Run it; expect PASS (nothing writes to v2 tables yet outside the v2 package).

- [ ] **Step 8.3**: Add ledger entry in `docs/c_c_lint_rules.md` (one row, match existing table format):

```markdown
- **`lint:no-direct-outbox-write`** → [`dev/scripts/lint_no_direct_outbox_write.sh`](../dev/scripts/lint_no_direct_outbox_write.sh) — code outside `backend/internal/notifications/v2/` must use `producer.Producer`, not raw INSERTs into `notifications_events_v2`/`notifications_outbox_v2`/`notifications_event_recipients`.
```

- [ ] **Step 8.4**: If the project's lint runner script (e.g. `lint_all.sh`) exists, add this lint to it. Check `dev/scripts/`.

- [ ] **Step 8.5**: Commit:

```bash
git add dev/scripts/lint_no_direct_outbox_write.sh docs/c_c_lint_rules.md
# also include the lint runner if you modified it
git diff --cached --stat
git commit -m "$(cat <<'EOF'
chore(lint): add lint:no-direct-outbox-write

External producers must use producer.Producer surface; raw
INSERTs into v2 notification tables outside the v2 package
fail this lint. Grep-based scanner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification

- [ ] **Step 9.1**: Full build + vet:

```bash
cd backend && go build ./internal/notifications/v2/... && go vet ./internal/notifications/v2/...
```

Expected: clean.

- [ ] **Step 9.2**: Unit tests:

```bash
go test ./internal/notifications/v2/domain/... ./internal/notifications/v2/producer/...
```

Expected: PASS.

- [ ] **Step 9.3**: Integration tests:

```bash
export DATABASE_URL=$(grep -E '^DATABASE_URL=' .env.dev | cut -d= -f2-)
go test -tags=integration ./internal/notifications/v2/producer/...
```

Expected: PASS.

- [ ] **Step 9.4**: Lint:

```bash
bash dev/scripts/lint_no_direct_outbox_write.sh
bash dev/scripts/lint_no_v1_broker_imports.sh   # also confirms no v1 broker import; our code shouldn't trigger it
```

Expected: both PASS.

- [ ] **Step 9.5**: Confirm DB state after running integration tests:

```bash
psql -h localhost -p 5435 -U postgres -d vector_artefacts -c "SELECT COUNT(*) FROM notifications_events_v2;"
```

Expected: 0 (cleanup ran in t.Cleanup).

---

## Task 10: Report to Master

- [ ] **Step 10.1**: Produce:

```
S02 WORKER — STATUS: READY FOR VALIDATION

Branch: notif-v2-s02 (worktree)
Commits (oldest first):
  <sha-1> feat(notif-v2): domain types — Event, Priority, FanoutMode, Channel, EventType
  <sha-2> feat(notif-v2): domain — DeliveryInput, DeliveryReceipt, DeliveryStatus
  <sha-3> test(notif-v2): domain — EventType parser + Event.Validate
  <sha-4> feat(notif-v2): Producer interface
  <sha-5> feat(notif-v2): dbProducer — Postgres impl of Producer
  <sha-6> test(notif-v2): dbProducer integration — Enqueue + Idempotency + Validation + Tx rollback
  <sha-7> chore(lint): add lint:no-direct-outbox-write

Spec sections covered:
- "Interfaces" → producer.Producer
- "Architecture" → v2/domain/ and v2/producer/ packages
- "End-to-end flow" → step 1 PRODUCER
- "Data model" → INSERTs against notifications_events_v2 + notifications_event_recipients per DDL

Lints landed: lint:no-direct-outbox-write
No imports from v1: confirmed
Vector_Scope.md: NOT touched by worker (per Wave 1 lesson; consolidated scope commit handled by validator)

Open questions for validator: <list or "none">
Tech debt logged: <list, or "none">
```

---

## Definition of Done

S02 is DONE when:

1. All 6 files exist under `backend/internal/notifications/v2/domain/` and `.../v2/producer/`
2. `go build` + `go vet` clean
3. All unit tests PASS
4. All integration tests PASS against real dev DB
5. `lint:no-direct-outbox-write` defined, wired, PASSES
6. No imports from v1 notifications package
7. 7 clean commits on `notif-v2-s02` (each commit single-purpose, inspected with `git diff --cached --stat` before finalising)
8. Validator PASS verdict received
9. Branch merged into `feature/notifications-v2` by the Validator (NOT the worker)

---

## Risks

| Risk | Mitigation |
|---|---|
| pgx jsonb encoding for `Data map[string]any` | `json.Marshal(event.Data)` produces `[]byte`; pass that to pgx — Postgres accepts it for jsonb columns |
| pgtype.UUID vs pointer-to-uuid | pgx v5: pass `*uuid.UUID` directly; nil pointers become NULL automatically. Or use `pgtype.UUID{Bytes: u, Valid: true}` for explicit clarity. Pick one style and use consistently |
| Idempotency race | Two concurrent Enqueue calls with same (sub, key) could both miss the existence check then both INSERT. UNIQUE constraint on (id_subscription, event_key) protects us — on second INSERT, get UniqueViolation, re-run the SELECT to fetch the winner's ID. Implement this catch-and-recover path |
| Platform event idempotency (NULL subscription_id) | `WHERE subscription_id = $1 AND event_key = $2` won't match NULL. Use `WHERE subscription_id IS NOT DISTINCT FROM $1 AND event_key = $2` or branch on `if event.SubscriptionID == nil` |
| Direct event recipient_count update | The update should be in the same tx as the INSERTs. Atomicity matters |
