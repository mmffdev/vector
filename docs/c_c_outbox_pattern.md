# Transactional outbox + projection worker — Vector's read-side seam

> **Standing pattern.** When a write needs to fan out to a different read shape, an async consumer, or a cross-system delivery, use the outbox pattern below. Do NOT introduce ad-hoc background goroutines that watch tables; do NOT couple the write path synchronously to the consumer; do NOT skip the idempotency key. This doc names the shape, lists the three current uses, and names the rungs above it on the CQRS-for-reads ladder so future work doesn't paint itself into a corner.

## When to use it

Use the outbox when:

- The read shape differs from the write shape (e.g. fulltext index, embedding vector, per-channel inbox row, denormalised summary).
- The write needs to fan out to an async consumer (worker, queue, external system).
- Cross-system delivery needs at-least-once guarantees (RabbitMQ publish, webhook fire, email queue).
- A lifecycle cleanup needs to fire when a target row dies (polymorphic FK cascade).

Do NOT use the outbox when:

- The read shape is the write shape — just query the source table.
- The consumer can be a synchronous in-process call with no cross-tx guarantees needed.
- The data is read-after-write-critical (e.g. the user just hit Save and the next render must show their change). The sentinel clamp + audit timeline requirements in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) HARD RULES assume read-time evaluation, not projection-time evaluation.

## Canonical shape

```
┌─────────────────┐    same tx    ┌────────────────┐
│  source table   │──────────────▶│  outbox table  │
│  (authoritative)│               │  (pending row) │
└─────────────────┘               └────────┬───────┘
                                           │ pg_notify('channel')
                                           ▼
                                  ┌────────────────┐
                                  │  worker loop   │
                                  │ SKIP LOCKED    │
                                  │ at-least-once  │
                                  │ idempotent     │
                                  └────────┬───────┘
                                           ▼
                                  ┌────────────────┐
                                  │  read shape    │
                                  │  (projection)  │
                                  └────────────────┘
```

Non-negotiables:

1. **Atomic write.** Source row + outbox row commit in the same transaction. Either both land or neither does. No "I wrote the source row, then I wrote the outbox row in a separate tx" — that loses messages on crash between the two.
2. **`pg_notify` fast wake-up + polling fallback.** The trigger on the source table fires `pg_notify('<channel>', row_id)` so the worker drains within milliseconds; a ticker (5s is the convention) catches anything missed while the `LISTEN` connection was down.
3. **`FOR UPDATE SKIP LOCKED` claim.** Multiple worker instances are safe; Postgres lock prevents double-processing. Each claim sets `claimed_at = now()` so a sweeper can recover abandoned rows.
4. **Idempotency on the consumer side.** The consumer MUST tolerate the same outbox row being processed twice (at-least-once means at-least-once). The shape varies per seam — `ON CONFLICT DO NOTHING` for tsvector updates, `UNIQUE (event_id, recipient_id, channel)` for outbox-to-inbox, version checks for projections.
5. **Sentinel clamp at read time, NEVER at projection time.** This is the procurement-narrative anchor. The clamp is evaluated when the user reads, not when the worker projects, because user scope changes mid-flight. See [`backend/internal/search/service.go:78-104`](../backend/internal/search/service.go) for the canonical example.
6. **Column-prefix lint on the outbox table.** Outbox tables follow the same full-table-name prefix rule as every other tenant table — see HARD RULE in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md).

## Three current uses

### 1. Search index — `artefacts_search_outbox`

- **Source table:** [`artefacts`](../db/vector_artefacts/schema/035_search_outbox.sql) (title, description columns).
- **Outbox:** `artefacts_search_outbox` — one row per pending artefact, unique-by-artefact while unclaimed.
- **Trigger:** `artefacts_search_enqueue` fires on `INSERT OR UPDATE OF title, description`, inserts an outbox row (`ON CONFLICT DO NOTHING` collapses bursts), and `pg_notify('search_index_queue', NEW.id)`.
- **Worker:** [`backend/internal/searchworker/worker.go`](../backend/internal/searchworker/worker.go) — drains via `FOR UPDATE SKIP LOCKED`, at-least-once, max 5 attempts.
- **Read shape:** `artefacts.search_index` (TSVECTOR) + `artefacts.content_embedding` (pgvector(768)).
- **Read site:** [`backend/internal/search/service.go`](../backend/internal/search/service.go) — sentinel clamp re-applied at request time via `sentinel.SubtreeClause(ctx, "a", args, n)`.

### 2. Notifications v2 — `notifications_outbox_v2`

- **Source table:** `notifications_events_v2` + `notifications_event_recipients` (mig 120, 121).
- **Outbox:** [`notifications_outbox_v2`](../db/vector_artefacts/schema/122_notif_v2_outbox.sql) — one row per (recipient × channel). `scheduled_for` enables quiet-hours deferral; `UNIQUE (event_id, recipient_id, channel)` is the idempotency key.
- **Command handler:** [`backend/internal/notifications/v2/pipeline/`](../backend/internal/notifications/v2/pipeline/) — `ProcessEvent` does enrich → filter → router; this is the "command handler" in CQRS vocabulary.
- **Projection drain:** [`backend/internal/notifications/v2/relay/relay.go`](../backend/internal/notifications/v2/relay/relay.go) — claims batches of 50 via SKIP LOCKED, publishes envelopes to RabbitMQ via [`broker`](../backend/internal/notifications/v2/broker/).
- **Projection bus:** RabbitMQ (per-channel routing keys).
- **Read shape:** `notifications_users_inbox` (mig 129) for in-app + per-channel external delivery (email, push, etc. — dispatchers, S09, in flight).

### 3. polymorphicrefs — lifecycle cleanup registry

- **Source:** any service that creates a polymorphic FK (artefact ↔ type, page ↔ nav-group, custom-page ↔ owner).
- **Registry:** [`backend/internal/polymorphicrefs/sql.go`](../backend/internal/polymorphicrefs/sql.go) — sole-writer pattern; the table catalogues every polymorphic reference + its cleanup rule.
- **Trigger:** synchronous cascade in the deleting transaction (no separate worker; the cleanup is fast and must be atomic with the delete).
- **Canary:** boot-time check in [`polymorphicrefs.Service`](../backend/internal/polymorphicrefs/service.go) verifies every registered ref-type has a reachable cleanup.

This third case is the simplest variant — outbox-as-registry without a background worker — but it follows the same sole-writer principle.

## CQRS vocabulary (notifications v2 only)

The notifications v2 subsystem **is** CQRS in shape. Using the precise vocabulary in package docs lets the next reader recognise the pattern instead of re-deriving it. Apply only inside [`backend/internal/notifications/v2/`](../backend/internal/notifications/v2/) — do not retrofit elsewhere; the other two seams (search, polymorphicrefs) read cleanly without it.

| CQRS term | Vector code |
|---|---|
| Command | the event row in `notifications_events_v2` (the write that initiates the flow) |
| Command handler | [`pipeline.ProcessEvent`](../backend/internal/notifications/v2/pipeline/pipeline.go) — enrich → filter → router |
| Projection | the outbox row in `notifications_outbox_v2` |
| Projection drain | [`relay.Run`](../backend/internal/notifications/v2/relay/relay.go) |
| Projection bus | [`broker.Broker`](../backend/internal/notifications/v2/broker/broker.go) (RabbitMQ) |
| Read model | `notifications_users_inbox` + per-channel external sinks |
| Dispatcher | per-channel consumer that reads from the bus and writes the read model (S09, in flight) |

## The ladder — where this pattern leads at scale

The transactional outbox is **rung 1** of a longer ladder. The next rungs are not needed today but are named here so when the trigger condition fires, the playbook is known.

### Rung 2 — Sidecar caches with broadcast invalidation

The pattern Atlassian's TCS runs at 32 billion req/day ([engineering post, 2024](https://www.atlassian.com/blog/atlassian-engineering/atlassian-critical-services-above-six-nines-of-availability)). Each service node runs a sidecar process with an L1 in-memory cache of the canonical read shape; the projection layer broadcasts invalidations (region-isolated queues, batched ~1s); sidecars cross-announce their cache contents so peers can pre-warm.

- **When to climb to rung 2.** Two triggers: (a) Vector serves ≥2 tenants on shared infra and one tenant's read load starts to affect another's latency; (b) catalogue-style metadata (workspace catalogue, artefact-type catalogue, flow-state catalogue) gets read at rates that exceed the budget even with indexes + read replicas.
- **What changes.** The outbox rows feeding the projection become an invalidation broadcast in addition to populating the projection. Sidecars subscribe per-region. Read-side handlers query the sidecar instead of Postgres.
- **What stays.** The source-of-truth row in `vector_artefacts` is still authoritative. The outbox row is still the audit-grade record of the projection event. Sentinel clamp is still re-applied at request time.

### Rung 3 — Read replicas with topology-aware routing

Pure Postgres-tier scaling, no code change to the read-side service. Read replicas added behind a routing layer; read-only services (`search`, `devreports`, list endpoints) route to replicas; write services stay on primary.

- **When to climb to rung 3.** Read load exceeds primary's budget but per-tenant isolation is not yet the bottleneck.
- **What changes.** `main.go` wiring gets a second pool; read-only services accept the replica pool. No domain-level change.
- **What stays.** Everything.

These rungs compose — rung 3 sits below rung 2 in many production stacks (replicas feed the sidecars), but Vector can adopt either without prejudicing the other.

## Procurement-grade controls — poisoned-cache defence

When (and only when) Vector adopts rung 2, the read-side cache becomes a defence-in-depth surface. Three controls, taken directly from the Atlassian TCS playbook:

1. **Anomaly detection on response ratios.** Monitor the 200-vs-404 ratio per cache. Sudden divergence from consensus across nodes means a node is serving poisoned data; mark it untrusted and dump its cache. Procurement reads this as a strong signal.
2. **Dummy "content check" keys.** Maintain keys that MUST exist and keys that MUST NOT exist. Any node that returns the wrong answer for either has a corrupted cache; dump it.
3. **Region-isolated invalidation queues.** Per-region threads + queues so one region's slowdown does not back up another region's invalidation flow.

The principle is: **a poisoned cache is worse than a missing cache.** A missing cache fails closed (read from source); a poisoned cache returns wrong answers without raising an alert.

## Lint surface

| Lint | Protects |
|---|---|
| `lint:column-prefix` | outbox table columns follow full-table-name prefix rule |
| `lint:sentinel-clamp` | read-site handlers re-apply clamp at request time |
| `lint:pipeline-no-direct-dispatcher` (notifications v2 only) | pipeline writes outbox; dispatchers read outbox; no short-circuit |

When adding a fourth outbox seam, extend `lint:sentinel-clamp` scan list to include the new read-site package.

## Anti-patterns to refuse

- **"I'll just write the read shape directly in the same tx."** Couples write latency to read-shape generation cost. Use the outbox.
- **"I'll skip the outbox and have a goroutine watch the source table."** No at-least-once guarantee; loses work on crash; no idempotency key. Use the outbox.
- **"I'll evaluate the sentinel clamp at projection time so reads are cheap."** Freezes the user's scope at projection time; user-scope-change-mid-flight bug; defeats the procurement narrative. Always clamp at read time.
- **"I'll just add a CQRS command bus."** Not until the write-side complexity justifies it (sustained pressure on a single service.go past ~3000 LoC, multiple invariants, long-running sagas). The outbox alone gets you the read-side benefit without the indirection cost. See [`RES061`](/dev/reporting) for the full evaluation.

## References

- [`RES061 — Does CQRS make sense for Vector?`](/dev/reporting) — the research paper this pattern doc operationalises.
- Chris Richardson, *Microservices Patterns* (2018), ch. 3 — canonical transactional-outbox literature.
- Vaughn Vernon, *Implementing Domain-Driven Design* (2013), ch. 8 — domain events + projection cost/benefit.
- [Atlassian Engineering: Six nines availability via TCS](https://www.atlassian.com/blog/atlassian-engineering/atlassian-critical-services-above-six-nines-of-availability) — rung 2 playbook (sidecars + broadcast invalidation + poisoned-cache defence).
