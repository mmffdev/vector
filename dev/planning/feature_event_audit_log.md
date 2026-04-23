# Feature — Event audit log (per-tenant append-only history)

Status: **proposal / partially committed.** Full design captured 2026-04-23. Portfolio-stack lifecycle work (migration 017 onwards) creates a minimal `events` table as a placeholder — just enough columns to record stack `proposed`/`rejected`/`locked`/`support_unlocked` events — with the full hash-chain / WORM / verifier build landing additively in a later phase. Events written before hash-chain rollout will be re-hashed in a one-time pass.

The shape under consideration: a single per-tenant append-only `events` table that records every meaningful change in the system (work item updates, status transitions, role changes, page edits, etc.), with polymorphic references back to the affected entity. Reading an entity's history is a filter on that entity's `(kind, id)`. The model is borrowed from event sourcing / Datomic, but implemented in plain Postgres.

## Why we're considering it

- Audit ("who changed this when") is naturally an append-only problem; modelling it as scattered `*_history` tables per entity is glue code that rots.
- A single stream enables cross-entity queries cheaply (activity feed, "everything in this portfolio in the last week").
- Datomic-style time-travel ("what did this look like last quarter") is a credible v2 capability if the event corpus exists.
- The schema cost is small; the discipline cost (writing events on every state change) is the real commitment.

## Regulatory framing (load-bearing requirement)

Vector targets finance and banking, where audit is **not a feature, it is a regulatory obligation.** Relevant regimes — SOX §802, MiFID II Art. 16(7), FINRA Rule 4511, BCBS 239, GDPR Art. 30, and most national equivalents — require:

- **Lifetime retention** of records relating to financial decisions, controls, and access. Five to ten years is the *minimum* in most regimes; some require permanent retention. **Deletion is not an operational lever — it is a compliance violation.**
- **Tamper evidence.** It must be demonstrable that records have not been altered since written. "Trust us, we don't update the table" is not sufficient — auditors expect cryptographic proof.
- **Time integrity.** Event timestamps must come from a trusted, monotonic source — not a wall clock that can drift, jump, or be reset.
- **Demonstrable completeness.** It must be possible to prove no events are missing, not just that the events present are correct. A gap in a sequence is itself a finding.
- **Access control + e-discovery readiness.** Auditors must be able to retrieve a tenant's complete history on demand, in a form admissible as evidence.

This rules out otherwise-attractive options and re-orders the rest. **Lossy compression (Option E) is off the table** — keeping less than everything is non-compliant. **Hot/cold tiering (Option C) becomes a v1-or-v2 priority, not a year-3 luxury** — it's the only way to bound hot-path storage without ever discarding data. **Tamper evidence (hash chains, write-once cold storage) is a v1 concern**, not a "nice to have."

Practical consequence: **the design assumes events are kept forever, never deleted, never rewritten.** Anywhere this paper previously implied otherwise has been corrected.

## The size question, grounded in numbers

Row size for a typical event (`id`, `tenant_id`, `entity_kind`, `entity_id`, `actor_id`, `event_type`, `occurred_at`, `payload jsonb` with a small diff) is around **300 bytes on disk**.

| Events / day / tenant | Tenants | Per year | Per 10 years | Disk |
|---|---|---|---|---|
| 100 | 100 | 3.6M | 36M | ~11 GB |
| 1,000 | 100 | 36M | 360M | ~110 GB |
| 1,000 | 1,000 | 360M | 3.6B | ~1.1 TB |
| 10,000 | 1,000 | 3.6B | 36B | ~11 TB |

Vector at realistic launch scale lives in the top one or two rows: tens of GB over a decade, comfortably handled by a single Postgres table. "Endless" is real but the line where the simple shape stops working is *much* further out than intuition suggests.

## Spectrum of solutions, simplest to fanciest

### Option A — Single Postgres `events` table

The boring answer that gets ten years of runway:

- One table per cluster.
- Indexes:
  - `(tenant_id, entity_kind, entity_id, occurred_at DESC)` — hot path for "fetch this entity's history newest-first."
  - `(tenant_id, occurred_at DESC)` — activity-feed queries.
  - **BRIN** on `occurred_at` — almost free, lets the planner skip swathes of the table for time-bounded scans.
- JSONB payload stores the **changeset diff**, not before+after — 5–10× smaller rows.

Scales comfortably to **hundreds of millions of rows**. Hot data (recent activity) tends to fit in Postgres's buffer cache regardless of total table size.

### Option B — Postgres native declarative partitioning by month

What "split by month" instinctively reaches for, but properly engineered:

- Logical single table; physically one child table per month under the hood (Postgres v10+).
- Query planner only scans relevant partitions for time-bounded queries.
- **Dropping old months is instant** — `DROP TABLE events_2024_06` is metadata-only, no row-by-row delete, no vacuum storm.
- Application code unchanged — same `INSERT` and `SELECT`; the planner picks partitions.
- Partition creation can be automated (`pg_partman` or a tiny cron).

**Recommended from day one** if any chance of high-volume events. Migrating an unpartitioned table to partitioned later is annoying but not catastrophic — still cheaper to do up-front.

### Option C — Hot/cold tiering

For multi-TB corpora:

- **Hot:** last 90–365 days, fully indexed, fast disk. Postgres.
- **Cold:** older than the hot window, compressed columnar (Parquet on S3, or Postgres `cstore_fdw`/Citus columnar). Less aggressive indexing.
- `events_all` view UNIONs both for transparent querying.

Real engineering. Don't reach for it unless the partitioned hot table is hurting in measurable ways.

### Option D — Per-entity history blob alongside the entity

Different shape entirely:

- `work_item_history (work_item_id, events jsonb)` — one row per entity, JSONB array of events.
- Per-entity history reads = O(1) row fetch.
- Cross-entity queries become hard ("show portfolio activity today" requires touching every entity's row).

Useful as a **cache layer** in front of an event table, not a replacement for one.

### Option E — Snapshots + deltas (lossy compression) — **DISALLOWED**

Originally a pragmatic compromise: keep raw events for N days, then collapse older history into periodic snapshots + deltas. Documented here for completeness, but **incompatible with the regulatory framing above** — it discards individual event records that the regulator may require produced verbatim. Snapshots are still useful as a *read-side acceleration* (precomputed projections), but they may never replace the underlying raw events.

### Option F — Dedicated event store (Kafka, NATS JetStream, EventStoreDB)

The "real" architecture for high-volume event sourcing:

- Genuinely scales to billions of events.
- Native subscriptions — services react to events without polling.
- Heavy: another piece of infra to run, monitor, back up, and reason about.
- Per-entity reads need projections built and maintained.

For Vector, years away if ever.

## Recommendation by horizon

**Today (proposed v1):**
- Option A + Option B from day one. Single `events` table, partitioned by month, three indexes (two btree, one BRIN).
- Polymorphic `(entity_kind, entity_id)` reference — same shape as `entity_stakeholders`, reuse the cleanup discipline already documented in `docs/c_polymorphic_writes.md`.
- Write events synchronously in the same transaction as the state change. Outbox pattern is correct but premature for v1; sync-write is fine until measured latency pain.
- JSONB payload, store the **diff** not before+after.
- **Hash chain from day one.** Each event row carries a `prev_hash` and `row_hash` such that any tampering breaks the chain. See "Tamper evidence" section below. Cheap at write time, impossible to retrofit credibly.
- **Trusted timestamp source.** Use server-side `clock_timestamp()` inside the transaction, not a client-supplied timestamp. NTP-disciplined; monotonic. Optionally add a separate monotonic sequence column as an integrity belt-and-braces.

**Year 1 — operational hardening for compliance:**
- Automatic monthly partition creation (`pg_partman` or cron) — failure mode of "no new partition exists" is a write outage, which is a compliance incident.
- **WORM (write-once-read-many) cold archive** of partitions older than 90 days, written to object storage with object-lock enabled (S3 Object Lock, GCS Bucket Lock, Azure Immutable Blob). Object-lock is what makes the storage *legally* tamper-evident, not just technically.
- Daily integrity verification job: re-walks the hash chain, alerts on any break.
- **Backups are themselves write-once** — audit DB backups to immutable storage, separate cadence and retention from operational backups.

**Year 2+ — hot/cold tiering (Option C) as soon as warranted:**
- Hot partitions remain in Postgres for fast querying (typically last 12–24 months).
- Cold partitions live in WORM object storage as compressed Parquet, queryable via federated query (DuckDB, Athena, or `parquet_fdw`).
- Old partitions are *moved*, never deleted. The hot Postgres table shrinks; the audit corpus grows forever.
- This is **the load-bearing design choice** for a regulatory-grade lifetime audit log. Postgres alone can't credibly hold 50 years of history; object storage can, cheaply.

**Year 3+ if winning big:**
- Hot/cold tiering matures (separate retention policies per tenant for jurisdictional reasons).
- Cross-region replication of the cold archive for disaster-recovery.
- Optional: dedicated event store (Option F) if real-time subscriptions become important.

Options D and E remain skipped — D is a useful read-side cache only; E is non-compliant.

## Tamper evidence and integrity

The regulatory framing demands that we can *prove* the audit log has not been altered. Three mechanisms working together:

**Hash chain (write-time, in Postgres).** Each event row carries:
- `row_hash` — `sha256(tenant_id || prev_hash || occurred_at || actor_id || event_type || entity_kind || entity_id || payload || sequence_no)`
- `prev_hash` — the `row_hash` of the immediately previous event for the same tenant (or genesis sentinel for the first).
- `sequence_no` — monotonic per-tenant integer, gap-detectable.

A trigger on insert recomputes `row_hash` server-side (don't trust client). UPDATE/DELETE on the table is rejected by trigger and revoked at the role level. Any retrospective edit breaks the chain at the edited row and every row after it — and the daily verifier surfaces it within 24 hours.

**Trusted timestamps (write-time).** `occurred_at` is set to `clock_timestamp()` inside the writing transaction; never client-supplied. The DB host runs a hardened NTP/chrony configuration with monitored drift. For the highest-assurance posture, periodically anchor the chain head to an external trusted timestamp authority (RFC 3161) — a single signed receipt per day proves the chain existed at-or-before that wall-clock time, even if the DB clock is later compromised.

**WORM cold archive (storage-time).** Once a partition is sealed (no more writes possible — i.e. the month has ended plus a small grace window), it is exported to object storage with **object-lock in compliance mode**: legally immutable for a configured retention period, not even by the account root. This is what makes the storage *demonstrably* tamper-evident to a regulator — Postgres alone cannot, because a DBA with sufficient privilege can theoretically bypass triggers.

**Daily integrity verifier.** A scheduled job walks the chain for each tenant, recomputes hashes, compares to stored values, and checks the sequence has no gaps. Any mismatch raises an incident — and the incident itself is an event in the log.

## On the original "NoSQL file persistence by month" instinct

The ideas behind that proposal are exactly right:
- Append-only writes — yes.
- Partitioned by time — yes.
- Old partitions drop cheap or move to colder storage — yes.
- Indexed for entity-keyed lookup — yes.

The only thing wrong is the **implementation**. Postgres declarative partitioning + good indexes provides every one of those properties with **zero new infrastructure**. Rolling a custom NoSQL-files-by-month scheme means reinventing indexing, atomicity, replication, backup, query language, and the partition manager. Postgres has all of that already; partition syntax is barely more than a normal `CREATE TABLE`.

Reach for a separate store only when a partitioned Postgres table is genuinely outgrown — which, given Vector's data shape, is years away.

## Details worth getting right early

Cheap to build in from day one, expensive to retrofit:

- **`tenant_id` on every row, indexed first.** Multi-tenant isolation at the event-log level matters; one chatty tenant must not slow another.
- **`event_version` column.** Event schemas evolve; version column lets old events be read with the right interpreter.
- **Idempotency key.** Unique constraint on `(tenant_id, idempotency_key)` so retried writes don't double-up. Cheap insurance.
- **Causation + correlation IDs.** Optional `caused_by_event_id` lets you trace "this event happened because of that one." Free at write time, invaluable when debugging.
- **Hash-chain columns from day one.** `prev_hash`, `row_hash`, `sequence_no` (per-tenant monotonic). Trigger-computed server-side. UPDATE/DELETE rejected by trigger and revoked at the role level. Retrofitting these later means a re-hash pass over the entire corpus, plus a discontinuity that auditors will treat as suspicious.
- **Server-side timestamping only.** `occurred_at = clock_timestamp()` inside the transaction; never accept a client-supplied timestamp. NTP-disciplined host clock; drift monitored.
- **PII policy decided up-front (GDPR Art. 17 vs lifetime retention).** GDPR's right-to-erasure conflicts with the "keep forever" rule. Resolve at design time by **tokenising PII** — store an opaque `subject_token` in the event, with a separate (mutable, non-audit) `pii_lookup` table mapping token → real PII. Erasure becomes a delete from the lookup; events keep the token but lose resolvability. Never embed names, emails, or free-text user content directly in `payload`.
- **Audit the audit system.** Material changes to the audit pipeline are themselves audit events: cold-archive bucket configuration changed, WORM retention period altered, verifier schedule modified, role grants on `events` table touched, trigger replaced. Emit these as a reserved `audit.config.*` event-type family written to the same chain. The auditor's first question is usually "who can change the audit system?" — having the answer in the log itself is the only credible response.

## Phasing

- **Phase 0 — schema + write side + tamper-evidence baseline.** Migration creates the partitioned `events` table with `prev_hash`, `row_hash`, `sequence_no` columns and the insert trigger that computes the chain server-side. UPDATE/DELETE triggers reject all attempts; role grants explicitly omit UPDATE/DELETE on the table. `RecordEvent(tx, ...)` helper in Go. PII tokenisation table + helper. Pick the first three event types to record (e.g. `item.created`, `item.status_changed`, `item.assigned`). Wire writes from the relevant handlers. **Hash chaining is non-negotiable for Phase 0** — adding it later means a re-hash of the corpus and a credibility hit with auditors.
- **Phase 1 — read side + integrity verifier.** "Activity" panel on entity detail pages reads `WHERE entity_kind = … AND entity_id = … ORDER BY occurred_at DESC LIMIT 50`. Tenant-wide activity feed at `/admin/activity`. **Daily integrity verification job** walks each tenant's chain, asserts hash continuity and sequence completeness, raises an incident on mismatch.
- **Phase 2 — coverage expansion + WORM cold archive.** Add event recording to remaining state-changing handlers; each handler's PR includes the matching event types. **Stand up WORM cold archive**: monthly partitions older than the configured grace window are exported to object storage with object-lock in compliance mode (S3 Object Lock / GCS Bucket Lock / Azure Immutable Blob). Cold-archive integrity verification runs against the archived copy too.
- **Phase 3 — operational polish.** Automated partition creation (`pg_partman` or cron — partition-creation failure is a write outage and a compliance incident). Hot/cold federated query (DuckDB / Athena / `parquet_fdw`). BRIN tuning if needed. **External RFC 3161 timestamp anchoring** for the daily chain head.
- **Phase 4 (optional, much later) — time-travel queries + tenant-export tooling.** "View this entity as of date X" by replaying events up to that point. E-discovery export tool: produce a tenant's complete audit corpus on demand, in a tamper-evident bundle (events + chain + signed manifest) suitable for handing to auditors or regulators.

## Open decisions

- **Synchronous or async write?** v1 sync (simpler, ACID with the state change, no risk of in-flight events lost in a worker queue — material for compliance). Move to outbox + worker only if measured latency hurts *and* the outbox itself is durable & monitored for backlog.
- **Partition cadence — monthly or quarterly?** Monthly is finer-grained for cold-archive sealing; quarterly has fewer partitions to plan across. Monthly probably right.
- **Cold-storage technology — S3 Object Lock vs GCS Bucket Lock vs Azure Immutable Blob.** All three meet SEC 17a-4(f) / FINRA WORM requirements when configured in compliance mode. Choice driven by where Vector deploys (single-cloud vs portable). On-prem deployments need an equivalent — MinIO with object-lock, or a dedicated WORM appliance.
- **Geo-redundancy of the cold archive.** Cloud object storage is multi-AZ within a region by default; cross-region replication is opt-in and roughly doubles storage cost. Single-region is fine for most jurisdictions; cross-region matters when (a) a regulator requires DR continuity for the audit trail itself, or (b) data-residency rules force a specific second region. Decide per deployment, default to single-region with documented DR runbook for v1.
- **Retention period on the WORM lock.** Object-lock requires a fixed retention period at write time. Options: a long fixed period (e.g. 30 years matching the longest regulatory regime) vs configurable per-tenant for jurisdictional differences. Per-tenant is more correct, more code; default to a long fixed period for v1.
- **External timestamp authority — needed for v1, or v3+?** RFC 3161 anchoring is belt-and-braces; useful for the highest-assurance customers but probably not gating v1 launch. Decide based on first regulated customer's specific ask.
- **Where does the global activity feed live?** A dev-only page first, or first-class admin UI?
- **Event-type vocabulary — free-form strings or enum?** Enum + CHECK constraint is safer (auditors prefer a closed vocabulary); free-form is more flexible. Recommend enum with a clear extension process documented per migration.
- **Tenant-level export format for e-discovery.** JSON-lines with chain manifest? CSV plus signature? Defer until first regulator asks, but keep the option open by ensuring the chain is reconstructable from the exported rows alone.

## Risk register

Compliance-grade audit raises several risks to **S1** (regulatory non-compliance is existential for a finance-sector product, not just a feature gap):

- **S1 — missing events (silent under-recording).** A handler that mutates state without calling `RecordEvent` produces a non-compliant gap that may never be detected. Mitigation: write-side review checklist; integration tests that assert "every state mutation emits an event"; periodic completeness audits comparing event volume against state-mutation metrics. Trigger: any new handler PR.
- **S1 — chain break undetected.** If the daily verifier is silently broken (cron not running, alert miswired), tampering goes undetected for arbitrary time. Mitigation: verifier emits a heartbeat event on every successful run; absence of heartbeat for >36 hours pages oncall. Trigger: Phase 1 onwards.
- **S1 — time-source compromise.** If the DB host clock is compromised or drifts unmonitored, `occurred_at` values become unreliable as audit evidence. Mitigation: NTP/chrony with multiple stratum-1 sources, drift monitoring, alert on >100ms skew. RFC 3161 anchoring as belt-and-braces. Trigger: Phase 0 onwards (clock monitoring is gating).
- **S1 — WORM cold archive misconfiguration.** Object-lock not set, set in governance (overridable) instead of compliance mode, or retention period too short → archive is not legally tamper-evident. Mitigation: configuration test that verifies bucket is in compliance mode with expected retention; runs on every deploy. Trigger: Phase 2 onwards.
- **S1 — backup channel weakens guarantees.** Standard pg_dump backups are mutable; if a restore from backup overwrites an extant audit log, history is rewritten. Mitigation: audit DB backups go to immutable storage on a separate cadence; restore procedure forbidden from touching the events table. Trigger: any backup/restore tooling change.
- **S2 — write amplification.** Every state-change handler now does double the work (state row + event row + hash compute). Performance impact is measurable; for v1 it should be invisible. Trigger: latency monitoring shows event writes dominating handler time.
- **S2 — event schema drift.** Without `event_version` discipline, old payloads can no longer be parsed by new code. Audit value of unparseable old events is reduced. Mitigation: version column from day one; old interpreters retained indefinitely. Trigger: any change to a payload shape.
- **S2 — PII leak via append-only.** A naive `payload` capture might include passwords, tokens, free-text user content that can never be erased. Mitigation: tokenisation of all PII via lookup table; explicit allowlist of fields per event type; never pass raw request bodies. Trigger: any event type carrying user-supplied content.
- **S2 — GDPR vs lifetime-retention conflict.** Right-to-erasure requests cannot delete audit rows. Mitigation: tokenisation + delete from lookup table renders historical PII unresolvable; documented as the GDPR response procedure. Trigger: first erasure request.
- **S2 — partition management forgotten.** No new partition created for next month → inserts fail → state mutations fail or events are lost. Mitigation: `pg_partman` or scheduled job; alert on partition existence with 14-day lead time. Trigger: Phase 1 onwards.
- **S3 — buffer cache blow-out at scale.** If hot data exceeds RAM, query latency degrades sharply. Mitigation: hot/cold tiering moves cold partitions to object storage. Trigger: shared_buffers hit ratio below 95% on the events table.
- **S3 — verifier cost grows with corpus.** Daily full-chain re-walk becomes expensive after years of growth. Mitigation: incremental verification (re-walk only the new tail per day; periodic full re-walk monthly/quarterly). Trigger: verifier runtime exceeds 1 hour.

## Pointers

- Polymorphic FK pattern (use the same shape for `entity_kind` + `entity_id`): `docs/c_polymorphic_writes.md`.
- Existing audit-adjacent fields: `created_at`, `updated_at`, `archived_at` on most tables (per `docs/c_schema.md`).
- Datomic / time-travel context that motivated this exploration: see prior session 2026-04-23.
- Regulatory references (external, for designer's homework — verify current text before quoting):
  - **SOX** §802 — record retention for issuers and auditors, criminal penalties for tampering.
  - **SEC Rule 17a-4(f)** / **FINRA Rule 4511** — broker-dealer record retention; defines WORM storage requirements adopted as the de-facto industry standard.
  - **MiFID II** Art. 16(7) + RTS 6 — record-keeping of orders, communications, and decisions for 5–7 years.
  - **BCBS 239** — risk-data aggregation principles, including completeness and integrity of the audit trail.
  - **GDPR** Art. 17 (erasure) and Art. 30 (records of processing) — primary tension between erasure and lifetime audit; tokenisation is the standard reconciliation.
  - **RFC 3161** — Time-Stamp Protocol for the optional external timestamp anchoring.

## AWS build checklist (reference implementation)

If we're hosting on AWS, this is the end-to-end mapping from the design above to specific AWS services, with the docs to actually open. Six phases, in build order.

### 1. Read the attestation first (no code yet)
Confirms S3 Object Lock meets SEC 17a-4(f) / FINRA 4511. The PDF is what an auditor will eventually ask for.
- **Cohasset 17a-4(f) / FINRA 4511 assessment** (linked from): https://aws.amazon.com/compliance/financial-services/
- **AWS Artifact portal** (download the report itself; free, requires AWS login): https://aws.amazon.com/artifact/

### 2. WORM bucket (cold archive)
The non-negotiable piece. **Compliance mode**, not governance — governance is overridable, compliance is not.
- **S3 Object Lock overview:** https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-overview.html
- **Storage class chooser** (sealed monthly partitions → Glacier Instant Retrieval or Deep Archive): https://aws.amazon.com/s3/storage-classes/
- **S3 pricing:** https://aws.amazon.com/s3/pricing/

### 3. Hot tier (operational events table)
Aurora PostgreSQL — storage scales independently of compute, native S3 export.
- **Aurora PostgreSQL features:** https://aws.amazon.com/rds/aurora/postgresql-features/
- **Aurora pricing:** https://aws.amazon.com/rds/aurora/pricing/
- **Native Aurora → S3 Parquet export** (the sealed-partition pipeline): https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/USER_ExportSnapshot.html

### 4. Lock the backup channel (the often-missed second hole)
Backups must be as immutable as the primary, or restoring overwrites history.
- **AWS Backup Vault Lock** (compliance-mode immutability for backups): https://docs.aws.amazon.com/aws-backup/latest/devguide/vault-lock.html
- **AWS Backup pricing:** https://aws.amazon.com/backup/pricing/

### 5. Cold-tier query path (e-discovery + verifier reads)
So you can answer "show me tenant X's history from 2027" without rehydrating Glacier.
- **Athena overview:** https://docs.aws.amazon.com/athena/latest/ug/what-is.html
- **Athena pricing** (~$5/TB scanned; partition pruning makes most queries cents): https://aws.amazon.com/athena/pricing/

### 6. Encryption + monitoring (low priority, do last)
- **KMS** (customer-managed keys for bucket + RDS): https://aws.amazon.com/kms/pricing/
- **CloudWatch alarms** for verifier-heartbeat absence, clock skew, partition-creation failure: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html

### Build order (week-by-week)
1. **Week 1** — Read Cohasset PDF, set up Artifact access, model costs in https://calculator.aws/.
2. **Week 2** — Provision S3 bucket with Object Lock compliance mode + KMS key.
3. **Week 3** — Aurora PostgreSQL up; schema + triggers + hash chain in place.
4. **Week 4** — Export pipeline (Aurora snapshot → Parquet → WORM bucket).
5. **Week 5** — Athena workgroup + verifier job + CloudWatch alarms.
6. **Week 6** — AWS Backup Vault Lock for the audit DB itself.

### Account hygiene
Audit infrastructure lives in a **separate AWS account** from app infrastructure — blast-radius separation, and an auditor will expect it.
- **AWS Organizations:** https://docs.aws.amazon.com/organizations/latest/userguide/orgs_introduction.html

### Do not use
- **AWS QLDB** (Quantum Ledger Database) — closed to new customers July 2024, EOL 31 July 2025. Tempting because of native hash-chain, but a dead-end. Roll our own chain in Postgres instead.
