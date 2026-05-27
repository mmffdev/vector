# S04 — RabbitMQ broker wrapper (v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a v2-namespaced RabbitMQ broker wrapper at `backend/internal/notifications/v2/broker/` that declares the v2 exchange `notifications` (already named the same in v1 — verify; if so, share or version it), one durable queue per channel (`notifications.v2.in_app`, `notifications.v2.sse`, `notifications.v2.email`, plus unimplemented placeholders for push/slack/sms), and binds each queue with the routing-key pattern `<domain>.<action>.<channel>`. Provide a working `Publish` + `Consume` + `Close` surface. Mirror v1's interface shape but DO NOT import v1.

**Story estimate:** 3 (Fibonacci)

**Wave:** 1 (parallel-safe with S01; depends on nothing)

---

## Read first (REQUIRED)

1. **Spec — sections "Architecture" and "End-to-end flow"** at [../specs/2026-05-26-notifications-v2-design.md](../specs/2026-05-26-notifications-v2-design.md) — note that the broker is at `v2/broker/` and the routing key pattern is `<domain>.<action>.<channel>` (extends v1's `<kind>.<channel>` by separating domain from action). Confirm.

2. **v1 broker code** at [backend/internal/notifications/broker/broker.go](../../../backend/internal/notifications/broker/broker.go), [rabbit.go](../../../backend/internal/notifications/broker/rabbit.go), [noop.go](../../../backend/internal/notifications/broker/noop.go) — **read these in full**. The interface design is good; v2 should mirror the same shape (Publish, Consume, Close, Envelope, Handler, NoopBroker fallback). Strangler-fig RULE: **do NOT import v1**. Re-define the types in `v2/broker/` so the v2 package is fully standalone.

3. **Swarm config** at [infra/swarm/vector-dev-stack.yml](../../../infra/swarm/vector-dev-stack.yml) — confirm RabbitMQ service exists, port 5672 exposed locally.

4. **Connection string source** at `backend/.env.dev` — `AMQP_URL` env var holds the dev RabbitMQ creds (mmff_dev user, password from docker secret). DO NOT log the URL; redact in any log statement.

5. **Index doc** for orchestration context: [2026-05-26-notifications-v2-index.md](./2026-05-26-notifications-v2-index.md).

---

## File structure

You will create FIVE Go files in `backend/internal/notifications/v2/broker/`:

| # | File | Purpose |
|---|---|---|
| 1 | `broker.go` | `Broker` interface, `Envelope` type, `Handler` type, `ErrBrokerUnavailable` sentinel, doc comment for the package |
| 2 | `rabbit.go` | `RabbitBroker` impl — connects, declares exchange + 6 queues, Publish, Consume, Close |
| 3 | `noop.go` | `NoopBroker` impl — returns `ErrBrokerUnavailable` from Publish; Consume no-ops with a warning log |
| 4 | `topology.go` | Constants for the v2 exchange + queue names + routing patterns. Single source of truth for "what does v2 talk to RMQ as?" |
| 5 | `broker_test.go` | Integration test (real RabbitMQ): publishes one envelope, consumes it from the right queue, asserts payload round-trip |

---

## Key design decisions (lock these before writing code)

### Decision 1: Share the exchange `notifications` with v1, or use a v2-specific name?

**Spec says** "Single topic exchange `notifications`" (carried over from v1). v1 uses the same name. **Decision: share the exchange name.** Both v1 and v2 publish to `notifications`; consumers bind queues with different routing patterns so the messages don't collide.

| Concern | Resolution |
|---|---|
| Cross-pollution between v1 and v2 messages | v1 routing pattern is `<kind>.<channel>`; v2 routing pattern is `<domain>.<action>.<channel>` (three segments vs two). A v1 consumer pattern `*.in_app` will NOT match v2's `artefact.blocked.in_app` (because `*` only matches one segment). v2 patterns like `*.*.in_app` will NOT match v1's `mention.in_app`. Clean separation by segment count. |
| If the exchange properties differ (durable / auto-delete / type) | v1 declares it `topic`, `durable`, `auto-delete=false`. v2 declares the same. Redeclaring with identical properties is a no-op in RabbitMQ. |

### Decision 2: Queue naming

v2 queues are namespaced. **Pattern: `notifications.v2.<channel>`.** Six queues total: `notifications.v2.in_app`, `notifications.v2.sse`, `notifications.v2.email`, `notifications.v2.push`, `notifications.v2.slack`, `notifications.v2.sms`. The latter three are declared but no consumer binds to them in v1 of the PLA — they're placeholders so the topology exists.

**Why declare unused queues?** Idempotent `QueueDeclare` is cheap; future dispatchers (push.go, slack.go, sms.go) won't need a separate broker change to start consuming. And the audit narrative is cleaner — "every channel has a queue, every queue exists, here's the inventory."

### Decision 3: Routing key pattern

`<domain>.<action>.<channel>` per spec. Each consumer binds with pattern `*.*.<channel>` so it catches every event for that channel regardless of domain/action.

Examples:
- `mention.created.in_app` → routed to `notifications.v2.in_app` queue
- `artefact.blocked.email` → routed to `notifications.v2.email` queue
- `users.password_changed.sse` → routed to `notifications.v2.sse` queue

### Decision 4: NoopBroker fallback

When `AMQP_URL` is empty (CI rig, test env without rabbit), v2 must still let the backend boot — `NoopBroker` returns `ErrBrokerUnavailable` from Publish so the relay can log and retry later. Mirror v1's pattern exactly.

---

## Task ordering rationale

Write `topology.go` first (constants are pulled by everything). Then `broker.go` (interface, types). Then `noop.go` (smallest impl, no rabbit). Then `rabbit.go` (the real work). Then `broker_test.go` (TDD-style: real rabbit, asserts round-trip). Each file gets its own commit.

---

## Task 1: Cut the story sub-branch

**Files:** none (git op)

- [ ] **Step 1.1**: Confirm you are on `feature/notifications-v2`:

```bash
git branch --show-current
```

Expected: `feature/notifications-v2`. If not, STOP and ask the Master.

- [ ] **Step 1.2**: Cut the story sub-branch:

```bash
git checkout -b feature/notifications-v2/s04-broker
git branch --show-current
```

Expected: `feature/notifications-v2/s04-broker`.

---

## Task 2: Write `topology.go` — the names + patterns

**Files:**
- Create: `backend/internal/notifications/v2/broker/topology.go`

- [ ] **Step 2.1**: Write the file:

```go
// Package broker is the v2 message-broker seam for the notifications
// system. v2 is intentionally namespaced separately from v1's broker
// (no shared imports) so the strangler-fig cutover can flip without
// any code coupling between versions.
//
// Exchange is shared with v1 (RabbitMQ exchange "notifications") but
// routing-key patterns and queue names are versioned. v1 uses
// "<kind>.<channel>"; v2 uses "<domain>.<action>.<channel>". The
// three-segment v2 pattern cannot collide with v1's two-segment
// pattern because "*" wildcards bind to exactly one segment.
package broker

// Exchange name shared with v1 — same topic exchange.
const ExchangeName = "notifications"

// Channel identifiers. These are the queue suffixes and the third
// segment of every v2 routing key.
const (
    ChannelInApp = "in_app"
    ChannelSSE   = "sse"
    ChannelEmail = "email"
    ChannelPush  = "push"
    ChannelSlack = "slack"
    ChannelSMS   = "sms"
)

// AllChannels is the canonical inventory. Every queue in v2 corresponds
// to one entry here; every dispatcher binds against one of these.
var AllChannels = []string{
    ChannelInApp,
    ChannelSSE,
    ChannelEmail,
    ChannelPush,
    ChannelSlack,
    ChannelSMS,
}

// QueueName builds the v2 queue name for a channel. Pattern is
// "notifications.v2.<channel>", namespacing v2 traffic apart from v1.
func QueueName(channel string) string {
    return "notifications.v2." + channel
}

// BindingPattern is the routing-key pattern a consumer for the given
// channel must use. v2 routing keys are "<domain>.<action>.<channel>",
// so each consumer binds "*.*.<channel>" to catch every event for its
// channel regardless of domain/action.
func BindingPattern(channel string) string {
    return "*.*." + channel
}

// RoutingKey builds a v2 routing key. Producers (the relay) call this
// when publishing.
func RoutingKey(domain, action, channel string) string {
    return domain + "." + action + "." + channel
}
```

- [ ] **Step 2.2**: Verify it compiles:

```bash
cd backend && go build ./internal/notifications/v2/broker/...
```

Expected: no errors.

- [ ] **Step 2.3**: Commit:

```bash
git add backend/internal/notifications/v2/broker/topology.go
git diff --cached --stat
```

Expected: ONLY that file staged.

```bash
git commit -m "$(cat <<'EOF'
feat(notif-v2): broker topology constants

Exchange name (shared with v1), channel inventory, queue-name
builder ("notifications.v2.<channel>"), routing-key builder
("<domain>.<action>.<channel>"), binding-pattern builder
("*.*.<channel>"). No imports from v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Write `broker.go` — interface + types

**Files:**
- Create: `backend/internal/notifications/v2/broker/broker.go`

- [ ] **Step 3.1**: Write the file (mirrors v1's broker.go but standalone — no imports from v1):

```go
package broker

import (
    "context"
    "encoding/json"
    "errors"
)

// ErrBrokerUnavailable is returned by NoopBroker for any operation
// the caller would have expected to succeed. Callers can sentinel-
// check this to differentiate "broker is intentionally off" from
// "broker is configured but failing".
var ErrBrokerUnavailable = errors.New("v2 broker unavailable (AMQP_URL not set)")

// Envelope is the wire-level structure that wraps every event v2
// publishes. Payload is the producer's raw event marshalled to JSON;
// the headers outside it (MessageID + RoutingKey + OutboxID) are
// what dispatchers route on.
type Envelope struct {
    MessageID  string          `json:"message_id"`
    RoutingKey string          `json:"routing_key"`
    OutboxID   string          `json:"outbox_id,omitempty"`
    Payload    json.RawMessage `json:"payload"`
}

// Handler is the dispatcher callback. Return nil to ack (broker
// considers it delivered); return non-nil to nack (broker re-queues
// or dead-letters per its policy).
type Handler func(ctx context.Context, env Envelope) error

// Broker is the v2 surface dispatchers + relay talk to. All methods
// safe for concurrent use.
type Broker interface {
    // Publish sends one envelope. Returns ErrBrokerUnavailable when
    // the impl is the noop fallback so the relay can log + retry.
    Publish(ctx context.Context, env Envelope) error

    // Consume binds a queue to the given routing-key pattern and
    // invokes handler for each delivered envelope. Blocks until ctx
    // is cancelled. Each consumer should run in its own goroutine.
    Consume(ctx context.Context, queueName, routingKeyPattern string, handler Handler) error

    // Close shuts the underlying transport down cleanly. Called once
    // at server shutdown.
    Close() error
}
```

- [ ] **Step 3.2**: Verify it compiles:

```bash
cd backend && go build ./internal/notifications/v2/broker/...
```

- [ ] **Step 3.3**: Commit:

```bash
git add backend/internal/notifications/v2/broker/broker.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(notif-v2): Broker interface + Envelope + Handler

Mirrors v1's surface (Publish/Consume/Close) but v2-namespaced
and standalone — no imports from v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Write `noop.go` — fallback impl

**Files:**
- Create: `backend/internal/notifications/v2/broker/noop.go`

- [ ] **Step 4.1**: Write the file:

```go
package broker

import (
    "context"
    "log/slog"
)

// NoopBroker is the fallback used when AMQP_URL is empty. Returns
// ErrBrokerUnavailable from Publish so the relay can log + park
// rows for later retry. Consume blocks on ctx but never calls the
// handler — useful for letting the server boot in test rigs.
type NoopBroker struct {
    logger *slog.Logger
}

// NewNoopBroker constructs a NoopBroker. logger may be nil.
func NewNoopBroker(logger *slog.Logger) *NoopBroker {
    if logger == nil {
        logger = slog.Default()
    }
    return &NoopBroker{logger: logger}
}

func (n *NoopBroker) Publish(ctx context.Context, env Envelope) error {
    n.logger.Debug("v2 noop broker: publish dropped",
        "routing_key", env.RoutingKey,
        "message_id", env.MessageID,
    )
    return ErrBrokerUnavailable
}

func (n *NoopBroker) Consume(ctx context.Context, queueName, pattern string, handler Handler) error {
    n.logger.Warn("v2 noop broker: consume disabled — AMQP_URL not set",
        "queue", queueName,
        "pattern", pattern,
    )
    <-ctx.Done()
    return ctx.Err()
}

func (n *NoopBroker) Close() error {
    return nil
}
```

- [ ] **Step 4.2**: Verify it compiles.

- [ ] **Step 4.3**: Commit:

```bash
git add backend/internal/notifications/v2/broker/noop.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(notif-v2): NoopBroker fallback

Returns ErrBrokerUnavailable when AMQP_URL unset. Lets the backend
boot in environments without RabbitMQ (CI, test rigs). Mirrors v1
NoopBroker pattern.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Write `rabbit.go` — the real impl

**Files:**
- Create: `backend/internal/notifications/v2/broker/rabbit.go`

- [ ] **Step 5.1**: Confirm the project's amqp library by checking `go.mod`:

```bash
grep -E "amqp091|streadway/amqp" "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend/go.mod"
```

Expected: shows one of the two. The v1 `rabbit.go` will use the same — match its choice exactly.

- [ ] **Step 5.2**: Read v1's `rabbit.go` carefully for: how it parses AMQP_URL, how it handles reconnects (if any), how it declares the exchange, how it declares queues, how it binds, how Consume sets up the delivery channel, how the Handler is invoked, how acks/nacks are wired. Match that code shape — it has already passed production review.

- [ ] **Step 5.3**: Write `rabbit.go` with:
  - `RabbitBroker` struct holding the connection + channel
  - `NewRabbitBroker(ctx, amqpURL, logger) (*RabbitBroker, error)` constructor that:
    - dials the AMQP URL
    - opens a channel
    - declares the exchange `notifications` as `topic`, `durable=true`, `autoDelete=false`, `internal=false`, `noWait=false`, no args
    - declares every queue in `AllChannels` (using `QueueName(ch)`) as `durable=true`, `autoDelete=false`, `exclusive=false`, `noWait=false`, no args
    - binds every queue to the exchange with `BindingPattern(ch)`, `noWait=false`, no args
    - returns the broker
  - `Publish(ctx, env)`:
    - marshals envelope to JSON
    - calls `channel.PublishWithContext(ctx, ExchangeName, env.RoutingKey, mandatory=false, immediate=false, amqp.Publishing{ContentType: "application/json", Body: payload, MessageId: env.MessageID, DeliveryMode: amqp.Persistent})`
    - returns any error
  - `Consume(ctx, queueName, pattern, handler)`:
    - call `channel.Qos(prefetch=10, 0, false)` — caps unacked messages per consumer to prevent runaway
    - call `channel.Consume(queueName, consumerTag="", autoAck=false, exclusive=false, noLocal=false, noWait=false, args=nil)`
    - for-range over deliveries; on each delivery: unmarshal Body into Envelope, call handler(ctx, env); on nil error call delivery.Ack(false); on non-nil call delivery.Nack(false, requeue=true) AND log the error
    - stops on ctx.Done()
  - `Close()`:
    - closes channel
    - closes connection
    - returns any error

- [ ] **Step 5.4**: Verify it compiles.

- [ ] **Step 5.5**: Commit:

```bash
git add backend/internal/notifications/v2/broker/rabbit.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
feat(notif-v2): RabbitBroker — declare exchange + 6 queues + bind

Declares topic exchange "notifications" (shared with v1, idempotent
re-declare with identical properties). Declares all 6 channel queues
("notifications.v2.<channel>", durable, non-auto-delete). Binds each
queue to "*.*.<channel>" pattern. Publish + Consume + Close mirror
v1 shape; QoS prefetch=10 per consumer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Write `broker_test.go` — real-rabbit integration test

**Files:**
- Create: `backend/internal/notifications/v2/broker/broker_test.go`

Per spec Layer 2 testing decision: real RabbitMQ for integration tests, no in-process mocks.

- [ ] **Step 6.1**: Write the test:

```go
//go:build integration

package broker_test

import (
    "context"
    "encoding/json"
    "fmt"
    "os"
    "sync"
    "testing"
    "time"

    "github.com/google/uuid"
    "yourproject/backend/internal/notifications/v2/broker"
    // Replace the import path above with the project's actual module path.
)

// rabbitURL pulls AMQP_URL from env. If unset, the test SKIPS (not fails) —
// per spec, integration tests gracefully no-op when infra isn't available.
func rabbitURL(t *testing.T) string {
    t.Helper()
    url := os.Getenv("AMQP_URL")
    if url == "" {
        t.Skip("AMQP_URL not set — skipping real-rabbit integration test")
    }
    return url
}

func TestRabbitBroker_PublishConsumeRoundtrip(t *testing.T) {
    url := rabbitURL(t)
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    b, err := broker.NewRabbitBroker(ctx, url, nil)
    if err != nil {
        t.Fatalf("NewRabbitBroker: %v", err)
    }
    defer b.Close()

    // Random message ID so we don't conflict with other test runs.
    msgID := "test-" + uuid.NewString()
    payload, _ := json.Marshal(map[string]string{"hello": msgID})
    env := broker.Envelope{
        MessageID:  msgID,
        RoutingKey: broker.RoutingKey("test", "roundtrip", broker.ChannelInApp),
        Payload:    payload,
    }

    // Start consumer in a goroutine BEFORE publish, so we don't race the
    // first message into a queue with no listener (though durable queue
    // would buffer it; the explicit ordering removes ambiguity).
    received := make(chan broker.Envelope, 1)
    var consumeErr error
    var wg sync.WaitGroup
    wg.Add(1)
    consumeCtx, consumeCancel := context.WithCancel(ctx)
    go func() {
        defer wg.Done()
        consumeErr = b.Consume(consumeCtx, broker.QueueName(broker.ChannelInApp),
            broker.BindingPattern(broker.ChannelInApp),
            func(_ context.Context, e broker.Envelope) error {
                if e.MessageID == msgID {
                    received <- e
                    return nil
                }
                // Not our message — nack so something else can pick it up
                // (or the queue keeps it for the next consumer). For test
                // we ack to drain the queue cleanly.
                return nil
            })
    }()

    // Give consumer a beat to start.
    time.Sleep(200 * time.Millisecond)

    if err := b.Publish(ctx, env); err != nil {
        consumeCancel()
        t.Fatalf("Publish: %v", err)
    }

    select {
    case got := <-received:
        if got.MessageID != msgID {
            t.Errorf("MessageID mismatch: got %q want %q", got.MessageID, msgID)
        }
        if string(got.Payload) != string(payload) {
            t.Errorf("Payload mismatch: got %q want %q", got.Payload, payload)
        }
    case <-time.After(5 * time.Second):
        t.Fatal("timed out waiting for message round-trip")
    }

    consumeCancel()
    wg.Wait()
    if consumeErr != nil && consumeErr != context.Canceled {
        t.Errorf("consume returned: %v", consumeErr)
    }
}

func TestNoopBroker_PublishReturnsUnavailable(t *testing.T) {
    b := broker.NewNoopBroker(nil)
    err := b.Publish(context.Background(), broker.Envelope{
        MessageID:  "x",
        RoutingKey: "x.x.x",
        Payload:    []byte("{}"),
    })
    if err != broker.ErrBrokerUnavailable {
        t.Errorf("expected ErrBrokerUnavailable, got %v", err)
    }
}

func TestTopologyHelpers(t *testing.T) {
    cases := []struct {
        channel  string
        wantQ    string
        wantBind string
    }{
        {broker.ChannelInApp, "notifications.v2.in_app", "*.*.in_app"},
        {broker.ChannelSSE, "notifications.v2.sse", "*.*.sse"},
        {broker.ChannelEmail, "notifications.v2.email", "*.*.email"},
        {broker.ChannelPush, "notifications.v2.push", "*.*.push"},
    }
    for _, c := range cases {
        if got := broker.QueueName(c.channel); got != c.wantQ {
            t.Errorf("QueueName(%q): got %q want %q", c.channel, got, c.wantQ)
        }
        if got := broker.BindingPattern(c.channel); got != c.wantBind {
            t.Errorf("BindingPattern(%q): got %q want %q", c.channel, got, c.wantBind)
        }
    }

    if got := broker.RoutingKey("artefact", "blocked", broker.ChannelEmail); got != "artefact.blocked.email" {
        t.Errorf("RoutingKey: got %q want %q", got, "artefact.blocked.email")
    }
    _ = fmt.Sprint(broker.AllChannels)
}
```

- [ ] **Step 6.2**: Run the test against the real dev RabbitMQ:

```bash
cd backend
export AMQP_URL=$(grep -E '^AMQP_URL=' .env.dev | cut -d= -f2-)
go test -tags integration -v -run TestRabbitBroker_PublishConsumeRoundtrip ./internal/notifications/v2/broker/...
```

Expected: PASS. Round-trip latency typically <500ms.

Also run the unit tests (no tag):

```bash
go test -v -run "TestNoopBroker|TestTopologyHelpers" ./internal/notifications/v2/broker/...
```

Expected: both PASS.

- [ ] **Step 6.3**: Commit:

```bash
git add backend/internal/notifications/v2/broker/broker_test.go
git diff --cached --stat
git commit -m "$(cat <<'EOF'
test(notif-v2): broker round-trip + noop + topology unit tests

Integration test (build tag "integration") publishes one envelope
and consumes it back from the in_app queue, asserting MessageID +
Payload round-trip. Skips cleanly if AMQP_URL is unset. Unit tests
cover NoopBroker.Publish behaviour and topology-helper purity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Linter discipline check

S04 introduces a new architectural rule: **v2 broker code must NOT import v1 broker code**. This is enforceable.

- [ ] **Step 7.1**: Check existing project lints in `docs/c_c_lint_rules.md` for a similar "no-v1-import" pattern. If something like `lint:no-old-context-imports` (mentioned in CLAUDE.md) exists, that's the model — `lint:no-v1-broker-imports` follows the same pattern.

- [ ] **Step 7.2**: Write a small grep-based lint script at `dev/scripts/lint_no_v1_broker_imports.sh`:

```bash
#!/usr/bin/env bash
# lint:no-v1-broker-imports
# Fails if any file under backend/internal/notifications/v2/ imports
# the v1 broker package "backend/internal/notifications/broker".
# Strangler-fig hard rule — v2 must be standalone until v1 deletion.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="$ROOT/backend/internal/notifications/v2"

if [[ ! -d "$TARGET" ]]; then
    echo "[lint:no-v1-broker-imports] target dir $TARGET does not exist — skipping"
    exit 0
fi

# Look for imports of the v1 broker path. Match the actual module
# path used in this project (read backend/go.mod for the module name).
MODULE=$(grep -E '^module ' "$ROOT/backend/go.mod" | awk '{print $2}')
V1_IMPORT_PATH="$MODULE/internal/notifications/broker"

VIOLATIONS=$(grep -rln "\"$V1_IMPORT_PATH\"" "$TARGET" 2>/dev/null || true)

if [[ -n "$VIOLATIONS" ]]; then
    echo "[lint:no-v1-broker-imports] FAIL"
    echo "v2 code imports the v1 broker package. The strangler-fig"
    echo "design requires v2 to be standalone. Files:"
    echo "$VIOLATIONS"
    exit 1
fi

echo "[lint:no-v1-broker-imports] PASS"
```

- [ ] **Step 7.3**: Make it executable + run it:

```bash
chmod +x dev/scripts/lint_no_v1_broker_imports.sh
bash dev/scripts/lint_no_v1_broker_imports.sh
```

Expected: PASS.

- [ ] **Step 7.4**: Add a one-line entry to `docs/c_c_lint_rules.md`. Match the existing format (read the file, find the table or list of lints, append following same style):

```markdown
- **`lint:no-v1-broker-imports`** → [`dev/scripts/lint_no_v1_broker_imports.sh`](../dev/scripts/lint_no_v1_broker_imports.sh) — v2 notifications code must not import the v1 broker package (strangler-fig isolation).
```

- [ ] **Step 7.5**: If the project wires lints into CI via a "run all lints" script, add this lint to that script. Check `dev/scripts/` for something like `lint_all.sh` or `precommit.sh`.

- [ ] **Step 7.6**: Commit lint additions:

```bash
git add dev/scripts/lint_no_v1_broker_imports.sh docs/c_c_lint_rules.md
git diff --cached --stat
git commit -m "$(cat <<'EOF'
chore(lint): add lint:no-v1-broker-imports

Strangler-fig isolation — v2 broker code must not import v1.
Grep-based lint script + docs entry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If you added to a lint runner script, include it in this commit.

---

## Task 8: Vector_Scope.md scope-discipline entry

- [ ] **Step 8.1**: Open `Vector_Scope.md`, find the `NV1. Notifications v2 — PLA build (orchestrated)` section.

- [ ] **Step 8.2**: Append six lines (one per commit you made in S04):

```
> Commit <sha-topology> (2026-05-26): feat(notif-v2): broker topology constants
> Commit <sha-broker> (2026-05-26): feat(notif-v2): Broker interface + Envelope + Handler
> Commit <sha-noop> (2026-05-26): feat(notif-v2): NoopBroker fallback
> Commit <sha-rabbit> (2026-05-26): feat(notif-v2): RabbitBroker — declare exchange + 6 queues + bind
> Commit <sha-tests> (2026-05-26): test(notif-v2): broker round-trip + noop + topology unit tests
> Commit <sha-lint> (2026-05-26): chore(lint): add lint:no-v1-broker-imports
```

Get SHAs from `git log --oneline -8 feature/notifications-v2/s04-broker | head -8`.

- [ ] **Step 8.3**: Stage ONLY `Vector_Scope.md` and inspect:

```bash
git add Vector_Scope.md
git diff --cached --stat
```

Expected: ONLY `Vector_Scope.md` staged.

If pre-existing dirty state interferes, STOP and report.

- [ ] **Step 8.4**: Commit:

```bash
git commit -m "$(cat <<'EOF'
chore(notif-v2): scope entries for S04 broker

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification

- [ ] **Step 9.1**: Confirm exchange declared in RabbitMQ:

```bash
docker exec $(docker ps --filter ancestor=rabbitmq --format '{{.ID}}' | head -1) \
    rabbitmqctl list_exchanges name type durable | grep -E "^notifications\s"
```

Expected: `notifications	topic	true`

If you cannot find the rabbit container with that filter, look at the swarm stack file for the service name.

- [ ] **Step 9.2**: Confirm all six v2 queues exist:

```bash
docker exec $(docker ps --filter ancestor=rabbitmq --format '{{.ID}}' | head -1) \
    rabbitmqctl list_queues name | grep -E "notifications.v2\."
```

Expected: six rows — `notifications.v2.in_app`, `notifications.v2.sse`, `notifications.v2.email`, `notifications.v2.push`, `notifications.v2.slack`, `notifications.v2.sms`.

Note: these queues only exist AFTER `NewRabbitBroker` has been called at least once (e.g. by the test in Task 6). If your verification shows zero queues, run the test in Task 6 first, then re-verify.

- [ ] **Step 9.3**: Confirm bindings:

```bash
docker exec $(docker ps --filter ancestor=rabbitmq --format '{{.ID}}' | head -1) \
    rabbitmqctl list_bindings source_name routing_key destination_name | grep "notifications.v2"
```

Expected: six binding rows, each `notifications  *.*.<channel>  notifications.v2.<channel>`.

- [ ] **Step 9.4**: Build the whole v2 broker package:

```bash
cd backend && go build ./internal/notifications/v2/broker/...
go vet ./internal/notifications/v2/broker/...
```

Expected: zero errors, zero warnings.

- [ ] **Step 9.5**: Run all v2 broker tests:

```bash
export AMQP_URL=$(grep -E '^AMQP_URL=' .env.dev | cut -d= -f2-)
go test -v -tags integration ./internal/notifications/v2/broker/...
go test -v ./internal/notifications/v2/broker/...
```

Expected: all PASS.

- [ ] **Step 9.6**: Lint pass:

```bash
bash dev/scripts/lint_no_v1_broker_imports.sh
```

Expected: PASS.

---

## Task 10: Report to Master

- [ ] **Step 10.1**: Produce the report:

```
S04 WORKER — STATUS: READY FOR VALIDATION

Branch: feature/notifications-v2/s04-broker
Commits (oldest first):
  <sha-1> feat(notif-v2): broker topology constants
  <sha-2> feat(notif-v2): Broker interface + Envelope + Handler
  <sha-3> feat(notif-v2): NoopBroker fallback
  <sha-4> feat(notif-v2): RabbitBroker — declare exchange + 6 queues + bind
  <sha-5> test(notif-v2): broker round-trip + noop + topology unit tests
  <sha-6> chore(lint): add lint:no-v1-broker-imports
  <sha-7> chore(notif-v2): scope entries for S04 broker

RabbitMQ exchange "notifications" declared: yes (topic, durable)
Queues declared: 6/6 (notifications.v2.{in_app,sse,email,push,slack,sms})
Bindings declared: 6/6 (*.*.<channel> each)
Integration test passes against real rabbit: yes (<latency>ms round-trip)
Unit tests pass: yes (Noop + topology helpers)
Lint:no-v1-broker-imports defined + wired + passes: yes
No imports from v1 broker package: confirmed
Vector_Scope.md additive only, pre-existing dirty preserved: yes

Spec sections covered:
- "Architecture" — v2/broker/ package layout
- "End-to-end flow" — broker layer at step 4 (outbox drain → publish)

Open questions for validator: <list or "none">
Tech debt logged: <list, or "none">
```

---

## Definition of Done

S04 is DONE when:

1. All five files exist in `backend/internal/notifications/v2/broker/`.
2. Package builds (`go build`) and vets (`go vet`) clean.
3. Integration test passes against real RabbitMQ from dev swarm.
4. Unit tests pass without rabbit (NoopBroker + topology helpers).
5. Exchange `notifications` declared in RabbitMQ.
6. Six v2 queues declared + bound with correct patterns.
7. `lint:no-v1-broker-imports` defined, wired, passes.
8. No v1 imports anywhere in v2/broker/.
9. `Vector_Scope.md` has six new lines under NV1.
10. Validator PASS verdict received.
11. Branch merged into `feature/notifications-v2` by the Validator.

---

## Risks for the worker to watch

| Risk | Mitigation |
|---|---|
| AMQP library mismatch with v1 | Read `backend/go.mod` for the library; match v1's import path |
| Connection-reuse vs per-publish | Match v1's pattern; if v1 holds a single connection + channel, do the same. Do NOT introduce a connection pool you haven't validated |
| QoS prefetch value | v1 may use a different prefetch; mirror it. The plan says 10 — change to match v1 if v1 differs |
| Module path in lint script | The grep needs the actual Go module path; read `backend/go.mod` to get it |
| Test running without rabbit container | Test SKIPS not FAILS — verified by setting `AMQP_URL=""` and re-running |
| Rabbit container discovery | The docker exec commands assume a single rabbitmq container; if dev runs multiple (e.g. cluster), adjust the filter |
| Vector_Scope.md merge conflict | If you can't cleanly add lines without bundling pre-existing dirty hunks, STOP and report |
