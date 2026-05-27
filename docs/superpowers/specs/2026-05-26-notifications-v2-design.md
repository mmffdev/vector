# Notifications v2 — Design

**Date:** 2026-05-26
**Status:** Draft for review
**Owner:** Rick (with Claude as implementation partner)
**Supersedes:** `backend/internal/notifications/` (v1, retained during cutover)
**Related:** PLA-0062 (Sentinel), column-prefix HARD RULE (2026-05-26)

---

## Purpose

Replace the current notifications system with one architected for the defence/finance buyer profile (Trust-No-One, SOC 2 Type II). The current v1 system has the right skeleton (transactional outbox, RabbitMQ topic exchange, per-channel dispatchers, SSE bell) but is missing the audit narrative, rule evaluation, debounce/digest, broadcast scopes, and the Sentinel clamp that procurement will demand.

v2 closes those gaps while keeping v1 running side-by-side until parity is proven.

---

## Goals

1. **Auditable.** Every event has a one-row truth in `notifications_events_v2`; every delivery attempt has an immutable row in `notifications_delivery_attempts`, including suppressions and why.
2. **Sentinel-compliant.** Every handler that touches tenant data calls `sentinel.FromCtx(ctx)`. PLA062 lint trio passes on v2 from day one.
3. **Multi-scope.** Events fan out as `direct`, `workspace`, `topology_node`, `topology_subtree`, `tenant`, or `platform` — all six handled by one pipeline.
4. **User-controllable.** Per-(user, event_type, channel) prefs with priority floor; per-user quiet hours; digest cadence. Three-tier fallback: user → subscription_tier → system.
5. **Critical-bypass.** Critical-priority events bypass user prefs and quiet hours; logged with `bypass_reason='critical_priority'`.
6. **Platform kill switch.** Per-channel global enable/disable (gadmin-owned, no UI in v1). Disabling a channel suppresses in-flight work for that channel across all tenants. Critical events do NOT override the platform kill (vendor outage > security priority).
7. **Channel-extensible.** Adding push/slack/sms = one new dispatcher file implementing the `Dispatcher` interface, plus one row in `notifications_platform_channels`. No core changes.

---

## Non-goals (v1 of this PLA)

- Push, Slack, SMS dispatchers (ship as follow-on PLAs).
- gadmin UI for platform-channel kill switch (table + check exist; UI is a follow-on).
- Per-tenant admin UI for tenant broadcasts (handler exists; UI deferred).
- Workspace-admin defaults (the 4-tier resolution chain — YAGNI until workspace admin config primitives exist).
- v1 deletion (separate cleanup PLA after 30-day soak).

---

## Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Event ID: UUID PK + producer-supplied `event_key` (idempotency, UNIQUE on `(subscription_id, event_key)`, 30-day TTL) | Replay-safe producers, stable internal ref, bounded index |
| 2 | Scope: `subscription_id` required EXCEPT platform; `workspace_id` optional | Matches the data — some events legitimately have no workspace |
| 3 | Event type naming: `<domain>.<action>` | RabbitMQ topic conventions; wildcard subscriptions clean (`artefact.*`) |
| 4 | Audit table: flat, one row per delivery attempt, append-only, immutable | Highest signal for billing disputes + non-repudiation; suppression reasons logged |
| 5 | Quiet hours: per-user single window, critical bypasses | Matches the priority table; simple UI |
| 6 | Pref resolution: user → subscription_tier → system | Enterprise tier can default to stricter compliance kinds |
| 7 | Debounce/digest: Valkey sorted set (BSD-3 Redis fork — new infra dep) | Sub-ms ops, room to reuse for rate-limit/session-cache later. Valkey is chosen over Redis after the March 2024 Redis Inc. SGPL/RSAL licence change — procurement-clean for the defence/finance buyer profile. Wire-protocol + command-compatible with Redis 7.2; the `go-redis` client works against it unchanged. |
| 8 | v1 producers: mentions + artefact lifecycle (5 events) | Frontend already routes these context_kinds; bell lights up for real work |
| 9 | Strangler-fig over big-bang refactor | Reversible, story-level verifiable, no audit-shape flux during cutover |
| 10 | `_v2` suffix permanent on new tables | Column-prefix rule satisfied mechanically; no rename pass after cutover |
| 11 | Six fan-out modes (direct, workspace, topology_node, topology_subtree, tenant, platform); five of them are broadcast classes (everything except direct) | Covers every real fan-out shape; inverse-Sentinel resolver bridges to user set for broadcasts |
| 12 | Recipient snapshot at fire-time | Audit certainty — "who got this on date X?" is exact, not time-travel |
| 13 | Inverse Sentinel lives in `v2/broadcast/`, not in sentinel package | Sentinel owns forward clamp; broadcasts own inverse |
| 14 | `bypass_reason` is its own column on `delivery_attempts`, not encoded in `error_class` | Queryable dimension for "every prefs-bypass in 30 days" |
| 15 | Platform channel kill table seeded from S01; UI deferred | Don't retrofit kill switch later |
| 16 | Email channel ships real in S09 via separate dev-scoped key on a `dev.<root>` sending domain | Prod creds never cross dev boundary; recipient allow-list as defence-in-depth |
| 17 | Integration tests use real RabbitMQ from dev swarm | In-process channel mocks miss queue binding / ack / prefetch bugs |
| 18 | Email provider mocked in tests (real SMTP in manual smoke only) | Test isolation + zero risk of test runs sending real mail |

---

## Architecture

### Package layout (backend)

```
backend/internal/notifications/         # v1 — untouched during cutover, deleted by S16
└── (unchanged)

backend/internal/notifications/v2/
├── domain/                              # zero-dep types
│   ├── event.go                         # Event, Priority, FanoutMode, Channel, EventType
│   ├── envelope.go                      # internal routing wrapper
│   └── delivery.go                      # DeliveryInput, DeliveryReceipt, DeliveryStatus
├── producer/
│   ├── producer.go                      # Producer interface
│   └── dbproducer.go                    # Postgres impl (writes events_v2 + recipient row(s))
├── broadcast/
│   ├── service.go                       # BroadcastRequest, Service interface + impl
│   ├── resolver.go                      # Inverse-Sentinel: nodeID → user set
│   └── auth.go                          # gadmin/pAdmin/sub-admin permission checks
├── broker/
│   ├── broker.go                        # Broker interface (publish/subscribe)
│   └── rabbit.go                        # RabbitMQ impl, exchange declarations
├── relay/
│   ├── relay.go                         # Outbox drain (SKIP LOCKED + LISTEN wakeup)
│   ├── claim.go                         # Batch claim
│   └── sweeper.go                       # Stuck-claim sweeper
├── pipeline/
│   ├── pipeline.go                      # enrich → filter → router orchestration
│   ├── enrich.go                        # Hydrate event.data from FKs
│   ├── filter.go                        # Prefs + rules + sentinel + quiet hours + platform kill
│   ├── router.go                        # Channel decisions → outbox / PendingStore
│   ├── pending.go                       # PendingStore interface
│   └── pending_valkey.go                # Valkey ZSET impl (Redis-protocol-compatible; go-redis client)
├── rules/
│   ├── service.go                       # Rule CRUD
│   ├── evaluator.go                     # Real matchConditions (replaces v1 stub)
│   └── operators.go                     # eq, neq, gte, lte, in, contains, exists
├── templates/
│   ├── service.go                       # Lookup by (event_type, channel, locale, version)
│   └── interpolate.go                   # {{ data.X }} substitution
├── dispatchers/
│   ├── dispatcher.go                    # Dispatcher interface
│   ├── inapp.go                         # → notifications_users_inbox_v2
│   ├── sse.go                           # → realtime.Hub
│   ├── email.go                         # → email provider (real)
│   └── email_provider.go                # EmailProvider interface + concrete impl
├── audit/
│   ├── audit.go                         # Append-only writer for delivery_attempts
│   └── reader.go                        # Query API for compliance + dev page
├── prefs/
│   ├── service.go                       # Settings CRUD
│   └── resolver.go                      # 3-tier resolution: user → tier → system
├── handler/
│   ├── handler.go                       # HTTP read endpoints
│   ├── broadcast_handler.go             # Broadcast composer endpoints
│   ├── sentinel.go                      # Clamp wrappers
│   └── routes.go                        # Route mounting at /_site/notifications/v2 + /samantha/v2/notifications
├── parity/                              # CUTOVER-ONLY; deleted by S16
│   ├── harness.go
│   ├── compare.go
│   └── report.go
└── feature_flag.go                      # NOTIFICATIONS_V2 check
```

### Frontend layout

```
app/(admin)/broadcasts/
├── platform/page.tsx                    # gadmin-only composer
├── topology/page.tsx                    # pAdmin composer (node picker + cascade toggle)
└── tenant/page.tsx                      # sub-admin composer

app/(dev)/notifications/parity/
└── page.tsx                             # Parity report viewer; deleted by S16

app/components/NotificationToastHost.tsx # rewired to /notifications/v2/inbox
app/notifications/
└── settings/page.tsx                    # quiet hours, digest cadence, priority floor
```

### Module boundaries

- **`domain/`** — zero-dep types. Every other v2 package imports from here.
- **`producer/`** — the *only* package external producers import. They never touch outbox/broker directly.
- **`broadcast/`** — separate entry point for fan-out events; handles auth + recipient resolution.
- **`pipeline/`** — pure logic given hydrated event + prefs + rules → produces delivery decisions. Highly testable.
- **`dispatchers/`** — channel adapters. One file per channel.
- **`audit/`** — written from pipeline + dispatchers. Read by compliance handler + dev page.
- **`handler/`** — HTTP only. Calls into prefs/service.go and read-side queries.

### Feature flag

`NOTIFICATIONS_V2=true` in `backend/.env.dev` switches:
- Producers write to v2 outbox (in dual-write mode, also to v1 — used during S14/S15).
- v2 relay drains and dispatches.
- Handler reads from v2 tables.
- v1 stays in place but dormant for queries.

---

## Data model

Eleven migrations to add (twelve tables — N+6 bundles two `_defaults` tables). All in `vector_artefacts`. All column-prefix compliant.

### N — `notifications_events_v2`

Canonical event row. One row per fired event regardless of fan-out class.

| Column | Type | Notes |
|---|---|---|
| `notifications_events_v2_id` | uuid PK | `gen_random_uuid()` |
| `notifications_events_v2_event_key` | text NOT NULL | producer-supplied idempotency key |
| `notifications_events_v2_type` | text NOT NULL | `<domain>.<action>` |
| `notifications_events_v2_priority` | text NOT NULL | `low / medium / high / critical` |
| `notifications_events_v2_fanout_mode` | text NOT NULL | `direct / workspace / topology_node / topology_subtree / tenant / platform` |
| `notifications_events_v2_id_subscription` | uuid NULL | FK subscriptions; NULL only for platform |
| `notifications_events_v2_id_workspace` | uuid NULL | FK |
| `notifications_events_v2_id_topology_node` | uuid NULL | FK topology_nodes |
| `notifications_events_v2_id_recipient_user` | uuid NULL | FK users; direct only |
| `notifications_events_v2_id_sent_by_user` | uuid NULL | human author (NULL when sent_by_system) |
| `notifications_events_v2_sent_by_system` | boolean NOT NULL DEFAULT false | |
| `notifications_events_v2_data` | jsonb NOT NULL DEFAULT '{}'::jsonb | hydrated payload |
| `notifications_events_v2_recipient_count` | integer NULL | populated after fan-out |
| `notifications_events_v2_created_at` | timestamptz NOT NULL DEFAULT now() | |
| `notifications_events_v2_resolved_at` | timestamptz NULL | when fan-out completed |

Indexes:
- UNIQUE `(id_subscription, event_key)` — idempotency
- `(id_subscription, created_at DESC)` — tenant timeline
- Partial `(resolved_at)` WHERE `resolved_at IS NULL` — unresolved queue
- `(created_at)` — 30-day prune

CHECK constraints:
- `priority IN ('low','medium','high','critical')`
- `fanout_mode IN ('direct','workspace','topology_node','topology_subtree','tenant','platform')`
- `fanout_mode = 'direct' ⇒ id_recipient_user IS NOT NULL`
- `fanout_mode = 'platform' ⇒ id_subscription IS NULL`
- `fanout_mode IN ('topology_node','topology_subtree') ⇒ id_topology_node IS NOT NULL`
- `sent_by_system = true ⇒ id_sent_by_user IS NULL`

### N+1 — `notifications_event_recipients`

Snapshot of resolved recipients. Doorway from event to pipeline.

| Column | Type | Notes |
|---|---|---|
| `notifications_event_recipients_id` | uuid PK | |
| `notifications_event_recipients_id_event` | uuid NOT NULL FK | |
| `notifications_event_recipients_id_user` | uuid NOT NULL FK | |
| `notifications_event_recipients_resolved_at` | timestamptz NOT NULL DEFAULT now() | |
| `notifications_event_recipients_resolved_reason` | text NOT NULL | `direct / workspace_clamp / topology_node / topology_subtree / tenant_member / platform_member` |

Indexes: UNIQUE `(id_event, id_user)`; `(id_user, resolved_at DESC)`.

### N+2 — `notifications_outbox_v2`

One row per `(recipient × channel)`.

| Column | Type | Notes |
|---|---|---|
| `notifications_outbox_v2_id` | uuid PK | |
| `notifications_outbox_v2_id_event` | uuid NOT NULL FK | |
| `notifications_outbox_v2_id_recipient_user` | uuid NOT NULL FK | |
| `notifications_outbox_v2_channel` | text NOT NULL | |
| `notifications_outbox_v2_scheduled_for` | timestamptz NOT NULL DEFAULT now() | future-dated for quiet-hours defer |
| `notifications_outbox_v2_rendered_title` | text NOT NULL | |
| `notifications_outbox_v2_rendered_body` | text NOT NULL DEFAULT '' | |
| `notifications_outbox_v2_claimed_at` | timestamptz NULL | |
| `notifications_outbox_v2_delivered_at` | timestamptz NULL | |
| `notifications_outbox_v2_attempts` | integer NOT NULL DEFAULT 0 | |
| `notifications_outbox_v2_last_error` | text NULL | |
| `notifications_outbox_v2_created_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes:
- Partial `(scheduled_for, created_at)` WHERE `claimed_at IS NULL AND delivered_at IS NULL AND attempts < 100`
- `(id_recipient_user, channel, created_at DESC)`

### N+3 — `notifications_delivery_attempts`

Append-only audit log.

| Column | Type | Notes |
|---|---|---|
| `notifications_delivery_attempts_id` | uuid PK | |
| `notifications_delivery_attempts_id_event` | uuid NOT NULL FK | |
| `notifications_delivery_attempts_id_outbox` | uuid NOT NULL FK | |
| `notifications_delivery_attempts_id_recipient_user` | uuid NOT NULL FK | |
| `notifications_delivery_attempts_channel` | text NOT NULL | |
| `notifications_delivery_attempts_attempt_number` | integer NOT NULL | 1-indexed |
| `notifications_delivery_attempts_status` | text NOT NULL | `queued / sent / delivered / bounced / failed / suppressed` |
| `notifications_delivery_attempts_bypass_reason` | text NULL | `critical_priority / admin_override / system_event / NULL` |
| `notifications_delivery_attempts_provider_message_id` | text NULL | |
| `notifications_delivery_attempts_provider_response` | jsonb NOT NULL DEFAULT '{}'::jsonb | |
| `notifications_delivery_attempts_latency_ms` | integer NULL | |
| `notifications_delivery_attempts_error_class` | text NULL | `timeout / auth / bounce / provider_5xx / template_missing / recipient_gone / channel_disabled_platform / dev_allowlist_blocked / unknown` |
| `notifications_delivery_attempts_occurred_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes: `(id_event, occurred_at)`, `(id_recipient_user, occurred_at DESC)`, `(channel, status, occurred_at)`.

### N+4 — `users_notifications_settings`

Per-user global settings (quiet hours + digest).

| Column | Type | Notes |
|---|---|---|
| `users_notifications_settings_id` | uuid PK | |
| `users_notifications_settings_id_user` | uuid NOT NULL UNIQUE FK | |
| `users_notifications_settings_quiet_hours_start` | time NULL | local |
| `users_notifications_settings_quiet_hours_end` | time NULL | local |
| `users_notifications_settings_quiet_hours_tz` | text NULL | IANA |
| `users_notifications_settings_digest_cadence` | text NOT NULL DEFAULT 'immediate' | `immediate / hourly / daily_9am / weekly_monday_9am / never` |
| `users_notifications_settings_digest_channel` | text NOT NULL DEFAULT 'email' | |
| `users_notifications_settings_updated_at` | timestamptz NOT NULL DEFAULT now() | |

### N+5 — `users_notifications_prefs_v2`

Per-(user, event_type, channel) prefs.

| Column | Type | Notes |
|---|---|---|
| `users_notifications_prefs_v2_id` | uuid PK | |
| `users_notifications_prefs_v2_id_user` | uuid NOT NULL FK | |
| `users_notifications_prefs_v2_event_type` | text NOT NULL | |
| `users_notifications_prefs_v2_channel` | text NOT NULL | |
| `users_notifications_prefs_v2_enabled` | boolean NOT NULL DEFAULT true | |
| `users_notifications_prefs_v2_priority_floor` | text NOT NULL DEFAULT 'low' | min priority to deliver |
| `users_notifications_prefs_v2_updated_at` | timestamptz NOT NULL DEFAULT now() | |

UNIQUE `(id_user, event_type, channel)`.

### N+6 — `notifications_prefs_tier_defaults` + `notifications_prefs_system_defaults`

Two tables, same shape minus `subscription_tier` on the system one.

`notifications_prefs_tier_defaults`:
- `notifications_prefs_tier_defaults_id` uuid PK
- `notifications_prefs_tier_defaults_subscription_tier` text NOT NULL
- `notifications_prefs_tier_defaults_event_type` text NOT NULL
- `notifications_prefs_tier_defaults_channel` text NOT NULL
- `notifications_prefs_tier_defaults_enabled` boolean NOT NULL
- `notifications_prefs_tier_defaults_priority_floor` text NOT NULL DEFAULT 'low'
- UNIQUE `(subscription_tier, event_type, channel)`

`notifications_prefs_system_defaults`:
- Same minus tier, UNIQUE `(event_type, channel)`

### N+7 — `notifications_templates`

| Column | Type | Notes |
|---|---|---|
| `notifications_templates_id` | uuid PK | |
| `notifications_templates_event_type` | text NOT NULL | |
| `notifications_templates_channel` | text NOT NULL | |
| `notifications_templates_locale` | text NOT NULL DEFAULT 'en-GB' | |
| `notifications_templates_subject` | text NOT NULL | |
| `notifications_templates_body` | text NOT NULL | |
| `notifications_templates_version` | integer NOT NULL DEFAULT 1 | |
| `notifications_templates_active` | boolean NOT NULL DEFAULT true | |
| `notifications_templates_created_at` | timestamptz NOT NULL DEFAULT now() | |
| `notifications_templates_updated_at` | timestamptz NOT NULL DEFAULT now() | |

UNIQUE `(event_type, channel, locale, version)`.

### N+8 — `notifications_rules_v2`

| Column | Type | Notes |
|---|---|---|
| `notifications_rules_v2_id` | uuid PK | |
| `notifications_rules_v2_id_subscription` | uuid NOT NULL FK | |
| `notifications_rules_v2_id_workspace` | uuid NULL FK | NULL = subscription-wide |
| `notifications_rules_v2_id_user` | uuid NULL FK | NULL = admin-scoped |
| `notifications_rules_v2_name` | text NOT NULL | |
| `notifications_rules_v2_event_type` | text NOT NULL | |
| `notifications_rules_v2_logical_op` | text NOT NULL DEFAULT 'AND' | `AND / OR` |
| `notifications_rules_v2_conditions` | jsonb NOT NULL DEFAULT '[]'::jsonb | `[{field, op, value}, ...]` |
| `notifications_rules_v2_channels` | jsonb NOT NULL DEFAULT '[]'::jsonb | string array |
| `notifications_rules_v2_priority_override` | text NULL | |
| `notifications_rules_v2_template_override_id` | uuid NULL FK → notifications_templates | |
| `notifications_rules_v2_schedule` | text NOT NULL DEFAULT 'immediate' | `immediate / next_quiet_hours_end / digest` |
| `notifications_rules_v2_enabled` | boolean NOT NULL DEFAULT true | |
| `notifications_rules_v2_created_at` | timestamptz NOT NULL DEFAULT now() | |
| `notifications_rules_v2_updated_at` | timestamptz NOT NULL DEFAULT now() | |

Indexes: `(id_subscription, event_type, enabled)`, `(id_user, event_type, enabled)`.

### N+9 — `notifications_users_inbox_v2`

In-app bell read-model.

| Column | Type | Notes |
|---|---|---|
| `notifications_users_inbox_v2_id` | uuid PK | |
| `notifications_users_inbox_v2_id_user` | uuid NOT NULL FK | |
| `notifications_users_inbox_v2_id_event` | uuid NOT NULL FK | |
| `notifications_users_inbox_v2_title` | text NOT NULL | |
| `notifications_users_inbox_v2_body` | text NOT NULL DEFAULT '' | |
| `notifications_users_inbox_v2_priority` | text NOT NULL | |
| `notifications_users_inbox_v2_event_type` | text NOT NULL | |
| `notifications_users_inbox_v2_context_kind` | text NULL | |
| `notifications_users_inbox_v2_context_id` | text NULL | |
| `notifications_users_inbox_v2_context_label` | text NULL | |
| `notifications_users_inbox_v2_created_at` | timestamptz NOT NULL DEFAULT now() | |
| `notifications_users_inbox_v2_read_at` | timestamptz NULL | |

Indexes: `(id_user, created_at DESC)`, partial unread `(id_user, created_at DESC) WHERE read_at IS NULL`. UNIQUE `(id_user, id_event)`.

### N+10 — `notifications_platform_channels`

Singleton row per channel; gadmin kill switch.

| Column | Type | Notes |
|---|---|---|
| `notifications_platform_channels_id` | uuid PK | |
| `notifications_platform_channels_channel` | text UNIQUE NOT NULL | |
| `notifications_platform_channels_enabled` | boolean NOT NULL DEFAULT true | |
| `notifications_platform_channels_status` | text NOT NULL DEFAULT 'live' | `live / degraded / disabled / unimplemented` |
| `notifications_platform_channels_disabled_reason` | text NULL | |
| `notifications_platform_channels_disabled_at` | timestamptz NULL | |
| `notifications_platform_channels_disabled_by_user_id` | uuid NULL FK | |
| `notifications_platform_channels_updated_at` | timestamptz NOT NULL DEFAULT now() | |

Seed: `in_app=live`, `sse=live`, `email=live` (after S08 lands DEP1), `push=unimplemented`, `slack=unimplemented`, `sms=unimplemented`.

**Operational note:** `in_app=disabled` should never be set under normal operations. In-app delivery is a DB write into `notifications_users_inbox_v2` with no vendor dependency; disabling it disables the irreducible floor that backs critical-event delivery. The seed marks it `live` and the gadmin UI (future PLA) should treat in_app toggling with a confirmation gate.

---

## Interfaces

### `producer.Producer`

```go
type Producer interface {
    Enqueue(ctx context.Context, e domain.Event) (string, error)
    EnqueueTx(ctx context.Context, tx pgx.Tx, e domain.Event) (string, error)
}
```

The only doorway for external code firing direct events. Idempotent on `(subscription_id, event_key)`.

### `broadcast.Service`

```go
type Service interface {
    Broadcast(ctx context.Context, req BroadcastRequest) (BroadcastResult, error)
    PreviewRecipientCount(ctx context.Context, req BroadcastRequest) (int, error)
}
```

Used by broadcast handlers + composer UIs. Performs auth check before recipient resolution.

### `broadcast.Resolver`

```go
type Resolver interface {
    UsersForTopologyNode(ctx context.Context, nodeID uuid.UUID, subtree bool) ([]uuid.UUID, error)
    UsersForWorkspace(ctx context.Context, workspaceID uuid.UUID) ([]uuid.UUID, error)
    UsersForSubscription(ctx context.Context, subscriptionID uuid.UUID) ([]uuid.UUID, error)
    UsersForPlatform(ctx context.Context) ([]uuid.UUID, error)
}
```

Inverse Sentinel. Lives in `v2/broadcast/`, not in sentinel package.

### `dispatchers.Dispatcher`

```go
type Dispatcher interface {
    Channel() domain.Channel
    Deliver(ctx context.Context, in DeliveryInput) (DeliveryReceipt, error)
}
```

One implementation per channel. Adding push/slack/sms = one new file.

### `pipeline.PendingStore`

```go
type PendingStore interface {
    Push(ctx context.Context, entry PendingEntry) error
    PopDue(ctx context.Context, limit int) ([]PendingEntry, error)
    PeekDigestBucket(ctx context.Context, userID uuid.UUID, bucket string) ([]PendingEntry, error)
}
```

Valkey ZSET impl ships in v1 (BSD-3 Redis fork — Redis-protocol-compatible, `go-redis` client works unchanged). Postgres impl could be added behind the interface later if Valkey becomes a problem.

---

## End-to-end flow

### Direct event

1. **Producer** writes `notifications_events_v2` + 1 row in `notifications_event_recipients` (atomic with caller's domain transaction via `EnqueueTx`).
2. **Relay** drains events where `resolved_at IS NULL`; runs Pipeline per recipient.
3. **Pipeline — Enrich** fills missing fields in `event.data`.
4. **Pipeline — Filter** applies:
   - Sentinel clamp on recipient
   - Prefs resolution (user → tier → system)
   - Priority floor per channel
   - Rules engine (may add channels, override priority, override template, override schedule)
   - Quiet hours (defer non-critical to next window end)
   - Platform channel kill switch (suppress if channel disabled)
5. **Pipeline — Router** writes outbox rows (immediate or scheduled) or pushes to PendingStore (digest).
6. **Template render** happens during router; rendered title + body stored on outbox row.
7. **Outbox drain** claims batch (SKIP LOCKED), publishes to RabbitMQ with routing key `<domain>.<action>.<channel>`.
8. **Dispatcher** consumes, delivers, writes `notifications_delivery_attempts` row.
9. **Frontend** SSE wakes Toast Host, which fetches from `/notifications/v2/inbox`.

### Broadcast event

1. **Handler** auth-checks (gadmin / pAdmin+ownership / sub-admin).
2. **broadcast.Service.Broadcast** resolves recipient set via `Resolver`; writes event row + N recipient rows in one transaction; marks `resolved_at=now()` immediately (snapshot is final).
3. **Relay** picks up event; runs Pipeline per recipient (N parallel walks).
4. Steps 4–9 identical to direct.

### Suppression path

Every suppression writes a `delivery_attempts` row with `status='suppressed'` and `error_class` describing why. The audit trail includes events that *should* have reached a user but didn't.

### Critical-priority bypass

If `event.priority='critical'`:
- Pref filter is bypassed for in_app + email (always deliver).
- Quiet hours ignored.
- Delivery attempt row gets `bypass_reason='critical_priority'`.
- **Platform kill switch is NOT bypassed** — vendor outage wins over event priority. If the targeted channel is killed, the event still delivers via every non-killed channel in the bypass set (in_app + email). If *all* channels in the bypass set are killed, the event lands in `notifications_users_inbox_v2` regardless (in_app is the irreducible floor — backed by the DB, not a vendor) and a `suppressed` attempt row is written for each killed channel with `error_class='channel_disabled_platform'`.

---

## Testing strategy

Seven layers. Layers 1, 2, 5, 6 on every PR. Layer 3 continuous during dual-write. Layers 4, 7 before cutover flip.

### Layer 1 — Unit tests

Per-package, table-driven. Coverage target 80% line, 100% on filter/router/evaluator/resolver.

### Layer 2 — Integration tests (real RabbitMQ)

`backend/internal/notifications/v2/v2_integration_test.go` against real Postgres dev DB + **real RabbitMQ** from the dev swarm. Email provider mocked. Tagged `// +build integration`. Skip (not fail) if swarm not running.

Test cases include: direct mention end-to-end, critical broadcast bypasses pref, platform kill switch, quiet-hours defer, topology subtree broadcast, idempotency, producer crash mid-tx, stuck-claim recovery, rules AND+OR, OR rule fan-out.

### Layer 3 — Parity harness

During dual-write, `v2/parity/` compares v1 and v2 outputs per event_key. Writes `ParityReport` rows to `mmff_dev.dev_reports`. Dev page `/dev/notifications/parity` renders results. Acceptable states: identical, v2-strict-superset.

### Layer 4 — Synthetic load (manual)

Burst (1k direct in 10s), broadcast fan-out (1k users), mixed, Valkey-down + critical. Pass criteria: no stuck rows, all attempt rows accounted for, p99 < 5s.

### Layer 5 — Sentinel clamp lint

`backend/internal/notifications/v2/` added to `sentinel_clamp_test.go` scan list. CI fails on any handler that doesn't call `sentinel.FromCtx`.

### Layer 6 — Frontend tests

Toast host rewire, broadcast composer auth, settings form, parity dev page.

### Layer 7 — Cutover smoke (manual)

Checklist before flipping `NOTIFICATIONS_V2=true`:
- Parity harness shows 30 days of identical/strict-superset reports
- Stuck-claim sweeper running 48h+ with zero alerts
- Critical-bypass path exercised in dev
- Platform kill switch toggled live + verified suppression
- Valkey failure injection: fallback verified
- Sentinel clamp passes
- v1 dispatchers wrapped in feature-flag (no-op when V2 on)
- Audit query returns full history for one event
- Inverse query (event → recipients) returns full set
- One-week internal soak

---

## Sequencing

Sixteen stories. Foundation-first. Strangler-fig with feature flag.

| # | Story | Layer | Est |
|---|---|---|---|
| S01 | Schema migrations (10 tables, indexes, CHECK, seed `notifications_platform_channels`) | DB | 5 |
| S02 | Domain types + Producer interface + dbproducer | Backend | 5 |
| S03 | Inverse-Sentinel Resolver + broadcast.Service | Backend | 8 |
| S04 | RabbitMQ broker wrapper + exchange/queue declarations | Backend + infra | 3 |
| S05 | Relay + outbox drain + stuck-claim sweeper | Backend | 5 |
| S06 | Pipeline: enrich → filter → router | Backend | 13 |
| S07 | Rules engine — real matchConditions | Backend | 8 |
| S08 | Templates: DB-backed lookup + interpolation + seed templates | Backend | 5 |
| S09 | Dispatchers: interface + in_app + sse + email (real) + audit writer | Backend | 8 |
| S10 | Handler (read side) + sentinel clamps + frontend rewire | Backend + frontend | 8 |
| S11 | Broadcast handlers + admin UIs + preview-count | Backend + frontend | 13 |
| S12 | PendingStore (Valkey) + debounce + digest cron + Valkey infra | Backend + infra | 13 |
| S13 | Producers: mention rewire + 5 artefact lifecycle producers | Backend | 8 |
| S14 | Parity harness + dev page | Backend + frontend | 5 |
| S15 | Cutover smoke + flip flag + 30-day soak | Ops | 3 |
| S16 | v1 deletion | Cleanup | 5 |

External: **DEP1** — dev sending domain + provider key. Out-of-band, owner: Rick. Blocks S08/S09 QA only.

### Critical path

S01 → S05 → S06 → S09 → S10 → S13 → S14 → S15.

### Recommended walk order

1. S01 (schema first).
2. S04 in parallel with S01 (broker infra).
3. S02 + S03 + S07 + S08 in parallel (independent islands).
4. S05 (relay; needs S01 + S04).
5. S06 (pipeline; biggest single story; pulls together S07 + S08).
6. S09 (dispatchers + audit; needs S06).
7. S10 (handler + frontend; needs S09).
8. S12 (Valkey + debounce + digest; parallelisable with S10/S11).
9. S11 (broadcast UIs; needs S03 + S09).
10. S13 (producers; needs everything else).
11. S14 (parity).
12. S15 (cutover + 30-day soak).
13. S16 (v1 deletion).

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| S06 (pipeline) grows beyond 13 points during implementation | Decompose mid-flight into S06a/S06b rather than letting it become a 3-week monster |
| Valkey becomes single point of failure | PendingStore is an interface; Postgres impl can be added later. Critical events fall back to immediate scheduling if Valkey is down (with TD-grade warning logged) |
| Parity harness misses a divergence | Layer 7 manual checklist catches what the harness can't (Valkey down + critical, sentinel clamp lint, audit completeness queries) |
| Email channel sends to real customer from dev | Three-layer defence: dev-scoped key, dev sending domain (`dev.<root>`), recipient allow-list enforced in `dispatchers/email.go` when `BACKEND_ENV=dev` |
| pAdmin broadcasts to nodes they don't own | `broadcast/auth.go` calls `sentinel.GrantOnNode` before resolver runs; rejected at handler boundary |
| Workspace user added after broadcast resolved | Snapshot at fire-time is the locked decision; new users do NOT retroactively receive |
| Stuck claim from crashed relay | Sweeper resets `claimed_at` for rows where `claimed_at < now() - 5min` |
| Template missing | Filter catches pre-outbox; suppressed audit row with `error_class=template_missing`; alarms |
| Producer crash mid-transaction | `EnqueueTx` is inside caller's tx; rollback is atomic |

---

## Open questions

None blocking. Documented:

- **DEP1 sending domain** — Rick to provision out-of-band. Update `.env.dev` with `NOTIFICATIONS_EMAIL_FROM` + provider API key. Blocks S08/S09 QA only.

---

## Out of scope

Tracked here for the future PLA backlog:

- Push channel (iOS APNS, Android FCM)
- Slack/Teams channel
- SMS channel
- gadmin UI for platform channel kill switch
- per-tenant admin UI for tenant broadcasts
- Workspace-admin defaults (4-tier resolution)
- Notification analytics dashboard (provider deliverability, channel health, p99 by event_type)
- Replay tool (re-fire historical event for a recipient subset)

---

## References

- v1 system audit: this conversation's earlier "Notifications system — current state" report
- Column-prefix HARD RULE: `.claude/CLAUDE.md`
- PLA062 Sentinel: `docs/Security/Sentinel/sentinel_docs.md`
- Transport segregation: `docs/c_c_transport_segregation.md`
- DB routing: `docs/c_c_db_routing.md`
- User profile / buyer profile: `context/USER.md`
