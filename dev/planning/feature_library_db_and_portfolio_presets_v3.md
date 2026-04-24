# Feature plan — `mmff_library` DB + Portfolio Model bundles (v3.2)

> Status: DRAFT — open decisions resolved (2026-04-24)
> Supersedes: v3.1 (gap-closed) and v3 (original)
> Confidence to ship: target 95% — see Section 16
> Last verified: 2026-04-24
> **Hosting scope: hosted only.** On-prem is not on the roadmap. If a customer asks, scope it as a fresh project — see Section 14.

## 1. Problem

`mmff_vector` mixes three kinds of data:

1. **Tenant data** — workspaces, portfolios, work items, grants, users.
2. **Per-tenant catalogue instances** — e.g. `portfolio_item_types` rows seeded per tenant.
3. **Implicit MMFF-authored content** — the seed values themselves that define the MMFF portfolio model.

(3) is content we author, version, and update. It belongs in a library we control.

A **portfolio model** is a complete setup bundle: layer hierarchy + per-layer metadata + workflows + workflow transitions + enabled artifacts (board/sprint/PI) + terminology overrides + feature flags + instructions. Examples: MMFF, SAFe, Jira, Rally, Kanban.

Tenants want to **share their model**. MMFF wants to **push updates** without flooding the userbase — only affected gadmins should be notified.

## 2. Proposal

Two databases on the same Postgres cluster:

### `mmff_vector` — tenant data (existing)

Read/write under tenant-bounded role. Backed up per-tenant.

### `mmff_library` — MMFF-authored / shared content (new)

Read-only to the app at runtime. Updated only by release artifacts under `mmff_library_admin`. Contains:

- **Portfolio model bundles** — `portfolio_models` (spine) + `portfolio_model_layers`, `portfolio_model_workflows`, `portfolio_model_workflow_transitions`, `portfolio_model_artifacts`, `portfolio_model_terminology`.
- **Sharing** — `portfolio_model_shares`.
- **Release channel** — `library_releases`, `library_release_actions`, `library_acknowledgements`, `library_release_log`.
- (future) `field_catalogues`, `report_templates`, `role_presets`, `icon_libraries`, `terminology_packs`.

## 3. Why "model bundle", not "table per model"

User instinct: one physical table per model. We're not doing that:

- **Adding a model = a migration.** New release artifact has to `CREATE TABLE` and seed it.
- **No uniform query surface.** "List all models" becomes `pg_class` introspection.
- **Bundle has 6 shapes.** Per-model means 6+ tables × N models.

Instead: **`model_family_id` (UUID) is the stable identity across versions; `(model_family_id, version)` is the unique key.** Each new version is a new row set (immutable per version) — see Section 5 on identity.

## 4. Naming and 017 compatibility

Migration 017 renames `tenants → subscriptions`. **All new schema in this plan uses the post-017 names**: `subscription_id`, `subscriptions(id)`. Phase 1 of this plan **blocks on 017 landing**. Open Q5 in v3 is closed: not orthogonal.

## 5. Identity model

```
portfolio_models row
  id              UUID  -- per-version row id (changes each version)
  model_family_id UUID  -- stable across versions; what adopters track
  version         INT   -- monotonic per family
  UNIQUE (model_family_id, version)
  UNIQUE (owner_subscription_id, key, version)
```

- Adopters stamp `model_family_id` + `model_version`.
- Library releases reference `affects_model_family_id`.
- `owner_subscription_id, key, version` is unique to allow tenants to publish their own models without family-id collisions on key.
- A new version of a system model is a new row with the same `model_family_id`, new `id`, `version + 1`, and a new bundle row set keyed off the new `id`.

## 6. Schemas — library DB

All tables get `archived_at TIMESTAMPTZ`, `created_at`, `updated_at` with a trigger.

### 6.1 `portfolio_models` — spine

```sql
CREATE TABLE portfolio_models (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_family_id        UUID        NOT NULL,
    key                    TEXT        NOT NULL,
    name                   TEXT        NOT NULL,
    description            TEXT,
    instructions_md        TEXT,
    scope                  TEXT        NOT NULL CHECK (scope IN ('system','tenant','shared')),
    owner_subscription_id  UUID,
    visibility             TEXT        NOT NULL DEFAULT 'private'
                           CHECK (visibility IN ('private','public','invite')),
    feature_flags          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    default_view           TEXT,
    icon                   TEXT,
    version                INT         NOT NULL DEFAULT 1,
    library_version        TEXT,
    archived_at            TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_family_id, version),
    UNIQUE (owner_subscription_id, key, version),
    CONSTRAINT scope_owner_consistency CHECK (
      (scope = 'system' AND owner_subscription_id IS NULL)
      OR (scope <> 'system' AND owner_subscription_id IS NOT NULL)
    )
);
CREATE INDEX idx_portfolio_models_family ON portfolio_models(model_family_id);
CREATE INDEX idx_portfolio_models_owner ON portfolio_models(owner_subscription_id) WHERE owner_subscription_id IS NOT NULL;
```

### 6.2 `portfolio_model_layers`

```sql
CREATE TABLE portfolio_model_layers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id        UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    name            TEXT        NOT NULL,
    tag             TEXT        NOT NULL CHECK (length(tag) BETWEEN 2 AND 4),
    sort_order      INT         NOT NULL DEFAULT 0,
    parent_layer_id UUID        REFERENCES portfolio_model_layers(id) ON DELETE RESTRICT,
    icon            TEXT,
    colour          TEXT,
    description_md  TEXT,
    help_md         TEXT,
    allows_children BOOLEAN     NOT NULL DEFAULT TRUE,
    is_leaf         BOOLEAN     NOT NULL DEFAULT FALSE,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_id, name),
    UNIQUE (model_id, tag)
);
CREATE INDEX idx_portfolio_model_layers_model ON portfolio_model_layers(model_id);
```

### 6.3 `portfolio_model_workflows` (states per layer)

```sql
CREATE TABLE portfolio_model_workflows (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id    UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    layer_id    UUID        NOT NULL REFERENCES portfolio_model_layers(id) ON DELETE CASCADE,
    state_key   TEXT        NOT NULL,
    state_label TEXT        NOT NULL,
    sort_order  INT         NOT NULL DEFAULT 0,
    is_initial  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_terminal BOOLEAN     NOT NULL DEFAULT FALSE,
    colour      TEXT,
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (layer_id, state_key)
);
CREATE INDEX idx_portfolio_model_workflows_model ON portfolio_model_workflows(model_id);
```

### 6.4 `portfolio_model_workflow_transitions` — NEW (was deferred in v3)

Mirrors tenant DB's `item_type_transition_edges` (migration 006). Adopting a model without explicit transitions would silently downgrade enforcement.

```sql
CREATE TABLE portfolio_model_workflow_transitions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id        UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    from_state_id   UUID        NOT NULL REFERENCES portfolio_model_workflows(id) ON DELETE CASCADE,
    to_state_id     UUID        NOT NULL REFERENCES portfolio_model_workflows(id) ON DELETE CASCADE,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (from_state_id, to_state_id)
);
CREATE INDEX idx_portfolio_model_transitions_model ON portfolio_model_workflow_transitions(model_id);
```

### 6.5 `portfolio_model_artifacts`

```sql
CREATE TABLE portfolio_model_artifacts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id     UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    artifact_key TEXT        NOT NULL,
    enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    config       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    archived_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_id, artifact_key)
);
CREATE INDEX idx_portfolio_model_artifacts_model ON portfolio_model_artifacts(model_id);
```

### 6.6 `portfolio_model_terminology`

```sql
CREATE TABLE portfolio_model_terminology (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id    UUID        NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    key         TEXT        NOT NULL,
    value       TEXT        NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (model_id, key)
);
CREATE INDEX idx_portfolio_model_terminology_model ON portfolio_model_terminology(model_id);
```

### 6.7 `portfolio_model_shares`

```sql
CREATE TABLE portfolio_model_shares (
    model_id                  UUID NOT NULL REFERENCES portfolio_models(id) ON DELETE CASCADE,
    grantee_subscription_id   UUID NOT NULL,            -- app-enforced FK to mmff_vector.subscriptions
    granted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by_user_id        UUID NOT NULL,            -- app-enforced FK to mmff_vector.users
    revoked_at                TIMESTAMPTZ,              -- soft-revoke
    revoked_by_user_id        UUID,
    PRIMARY KEY (model_id, grantee_subscription_id)
);
CREATE INDEX idx_portfolio_model_shares_grantee
  ON portfolio_model_shares(grantee_subscription_id) WHERE revoked_at IS NULL;
```

### 6.8 Trigger boilerplate

```sql
CREATE OR REPLACE FUNCTION trg_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- Apply to every table:
CREATE TRIGGER trg_portfolio_models_updated
  BEFORE UPDATE ON portfolio_models
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
-- … repeat for each library table
```

## 7. Schemas — tenant DB additions

```sql
ALTER TABLE portfolio_item_types
  ADD COLUMN adopted_from_model_family_id UUID,
  ADD COLUMN adopted_from_model_version   INT,
  ADD COLUMN adopted_from_library_version TEXT,
  ADD COLUMN source_layer_tag             TEXT;        -- for three-way merge

CREATE TABLE subscription_portfolio_model_state (
    subscription_id      UUID PRIMARY KEY REFERENCES subscriptions(id) ON DELETE RESTRICT,
    model_family_id      UUID NOT NULL,
    model_version        INT  NOT NULL,
    library_version      TEXT,
    feature_flags        JSONB NOT NULL DEFAULT '{}'::jsonb,
    default_view         TEXT,
    adopted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscription_portfolio_workflows (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    layer_type_id     UUID NOT NULL REFERENCES portfolio_item_types(id) ON DELETE CASCADE,
    state_key         TEXT NOT NULL,
    source_state_key  TEXT,                         -- merge basis; NULL if user-added
    state_label       TEXT NOT NULL,
    sort_order        INT  NOT NULL DEFAULT 0,
    is_initial        BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal       BOOLEAN NOT NULL DEFAULT FALSE,
    colour            TEXT,
    tenant_modified   BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (layer_type_id, state_key)
);
CREATE INDEX idx_sub_portfolio_workflows_sub ON subscription_portfolio_workflows(subscription_id);

CREATE TABLE subscription_portfolio_artifacts (
    subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    artifact_key      TEXT NOT NULL,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    config            JSONB NOT NULL DEFAULT '{}'::jsonb,
    tenant_modified   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subscription_id, artifact_key)
);

CREATE TABLE subscription_portfolio_terminology (
    subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key               TEXT NOT NULL,
    source_value      TEXT,                         -- library default at adoption time
    value             TEXT NOT NULL,
    tenant_modified   BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subscription_id, key)
);

-- Trigger: any UPDATE flips tenant_modified=TRUE on the three editable mirrors
CREATE OR REPLACE FUNCTION trg_mark_tenant_modified() RETURNS trigger AS $$
BEGIN NEW.tenant_modified := TRUE; NEW.updated_at := NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
-- Applied to subscription_portfolio_workflows, _artifacts, _terminology
```

`tenant_modified` + `source_*_key` give the three-way merge UI (Section 11) a basis to diff library default vs tenant edit vs new library value.

## 8. Cross-DB integrity (app-enforced)

Postgres has no cross-DB FKs. App-enforced refs:

| From | → | To | Enforcement point |
|---|---|---|---|
| `mmff_library.portfolio_models.owner_subscription_id` | → | `mmff_vector.subscriptions.id` | publish handler |
| `mmff_library.portfolio_model_shares.grantee_subscription_id` | → | `mmff_vector.subscriptions.id` | share handler |
| `mmff_library.portfolio_model_shares.granted_by_user_id` | → | `mmff_vector.users.id` | share handler |
| `mmff_vector.portfolio_item_types.adopted_from_model_family_id` | → | `mmff_library.portfolio_models.model_family_id` | adoption handler |
| `mmff_vector.subscription_portfolio_model_state.model_family_id` | → | `mmff_library.portfolio_models.model_family_id` | adoption handler |
| `mmff_library.library_acknowledgements.subscription_id` | → | `mmff_vector.subscriptions.id` | ack handler |

**Cross-DB cleanup saga** — Postgres-backed queue (decided over RabbitMQ; see Section 17.1 rationale).

Queue table in `mmff_vector` so enqueue is atomic with the originating tx. **Shipped in migration 019 (Phase 0)** — final shape below differs from the original draft (which used `dead_letter BOOLEAN` + `completed_at TIMESTAMPTZ` and a single `archive_subscription` job_kind):

```sql
CREATE TABLE pending_library_cleanup_jobs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    job_kind        TEXT        NOT NULL CHECK (job_kind IN (
                        'preset_archive_propagation',
                        'template_instance_unlink',
                        'library_mirror_purge'
                    )),
    payload         JSONB       NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','dead')),
    attempts        INT         NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts    INT         NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
    last_error      TEXT,
    visible_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_pending_library_cleanup_jobs_claimable
    ON pending_library_cleanup_jobs (visible_at) WHERE status = 'pending';
CREATE INDEX idx_pending_library_cleanup_jobs_dead
    ON pending_library_cleanup_jobs (subscription_id, updated_at DESC) WHERE status = 'dead';
```

Notable changes from the draft: explicit `subscription_id` FK with `ON DELETE RESTRICT` (subscription cannot be hard-deleted while cleanup is outstanding); `status TEXT` rather than `dead_letter BOOLEAN`; DELETE-on-success rather than `completed_at`; `visible_at` rather than `next_attempt_at`. The job_kind vocabulary is the operations the worker actually needs to perform on adoption-derived entities; `archive_subscription` was a draft placeholder that turned out to compose from the three concrete kinds.

**Enqueue** (in the same transaction as the originating archive/unlink/purge):
```sql
BEGIN;
-- ... originating change, e.g. UPDATE portfolio_item_types SET archived_at = NOW() WHERE id = $1 ...
INSERT INTO pending_library_cleanup_jobs (subscription_id, job_kind, payload)
  VALUES ($sub, 'preset_archive_propagation', jsonb_build_object('item_type_id', $1));
COMMIT;
```

**Worker** (`backend/internal/library/cleanup_worker.go`, in-process Go ticker, 30s interval):
1. `SELECT * FROM pending_library_cleanup_jobs WHERE status='pending' AND visible_at <= NOW() FOR UPDATE SKIP LOCKED LIMIT 10`.
2. For each job: open library tx, run cleanup steps for the job_kind, commit.
3. On success: `DELETE FROM pending_library_cleanup_jobs WHERE id = $1`.
4. On failure: `UPDATE … SET attempts = attempts + 1, last_error = $err, visible_at = NOW() + (2^attempts) * interval '30 seconds'`. Once `attempts >= max_attempts`, set `status = 'dead'`.

**Cleanup steps** (per job_kind):
- `preset_archive_propagation` — when a tenant archives an adopted item type, decrement library-side adoption counters / mark mirror state stale.
- `template_instance_unlink` — when a tenant deletes a portfolio template instance, drop the cross-DB lineage row.
- `library_mirror_purge` — when an adoption is fully removed, delete the tenant-side mirror rows that referenced the library bundle.

**Defence in depth** — publish and share handlers also check `subscriptions.archived_at IS NULL` so a job retry delay can't allow a publish race.

**Operator surface** — `SELECT * FROM pending_library_cleanup_jobs WHERE status = 'dead'` answers "what's stuck?" Surface this in `<dev>` admin tooling.

**Nightly reconciler** (separate from the queue worker): scans `mmff_library.portfolio_models.owner_subscription_id` and `mmff_library.portfolio_model_shares.grantee_subscription_id` against `mmff_vector.subscriptions`; logs orphans for operator review (don't auto-archive — operator decision).

## 9. Connection strategy and roles (split for B3)

`backend/.env.local`:

```
# Tenant DB
DB_HOST=localhost
DB_PORT=5434
DB_NAME=mmff_vector
DB_USER=mmff_dev
DB_PASSWORD=…

# Library — read pool (every request)
LIBRARY_DB_HOST=localhost
LIBRARY_DB_PORT=5434
LIBRARY_DB_NAME=mmff_library
LIBRARY_DB_USER=mmff_library_ro
LIBRARY_DB_PASSWORD=…

# Library — publish pool (publish + share endpoints only)
LIBRARY_PUBLISH_DB_USER=mmff_library_publish
LIBRARY_PUBLISH_DB_PASSWORD=…

# Library — ack pool (acknowledgement handler only)
LIBRARY_ACK_DB_USER=mmff_library_ack
LIBRARY_ACK_DB_PASSWORD=…
```

| Role | Grants | Used by |
|---|---|---|
| `mmff_library_admin` | ALL on every table | release artifacts via `psql -f` only |
| `mmff_library_ro` | SELECT on every table | request-path read pool |
| `mmff_library_publish` | INSERT/UPDATE on `portfolio_models`, `portfolio_model_layers`, `portfolio_model_workflows`, `portfolio_model_workflow_transitions`, `portfolio_model_artifacts`, `portfolio_model_terminology`, `portfolio_model_shares`. No DELETE. No access to `library_releases*` or `library_acknowledgements`. | publish + share endpoints, separate pool |
| `mmff_library_ack` | INSERT on `library_acknowledgements` only. SELECT on `library_releases`, `library_release_actions`, `library_acknowledgements`. | ack endpoint + reconciler, separate pool |

**CI assertion** (`backend/tests/library_role_grants_test.go`): on every CI run, query `information_schema.role_table_grants` and assert exact match of the matrix above. Drift = test fail.

## 10. Cross-DB transaction cookbook (closes B1)

**Rule**: a single Postgres transaction cannot span two DBs. Every cross-DB operation follows the snapshot pattern.

### Adoption (Section 11) reference implementation

```go
// 1. Library snapshot under REPEATABLE READ
libTx, _ := libRoPool.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
defer libTx.Rollback()

model := loadModelByFamilyVersion(libTx, familyID, version)
if model.ArchivedAt != nil { return ErrModelArchived }
bundle := loadBundle(libTx, model.ID)        // layers, workflows, transitions, artifacts, terminology
libVersion := model.LibraryVersion
libTx.Commit()                                // snapshot done

// 2. Tenant write under SERIALIZABLE (Section 11 details)
tenTx, _ := tenantPool.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
defer tenTx.Rollback()
softArchiveExisting(tenTx, subID)
insertItemTypes(tenTx, subID, bundle.Layers, model.FamilyID, model.Version, libVersion)
insertWorkflows(tenTx, subID, bundle.Workflows)
insertTransitions(tenTx, subID, bundle.Transitions)
insertArtifacts(tenTx, subID, bundle.Artifacts)
insertTerminology(tenTx, subID, bundle.Terminology)
upsertModelState(tenTx, subID, model)
tenTx.Commit()

// 3. Re-validate library row didn't archive between steps 1 and 2
if isArchivedNow(libRoPool, model.ID) {
    // Compensating action: roll forward by re-marking adoption as stale; gadmin notified
    enqueueStaleAdoptionCheck(subID, model.ID)
}
```

**Race outcomes documented:**
- Library row archived between snapshot and tenant commit → adoption succeeds with stale row; reconciler flags it; gadmin gets a "model archived since adoption" notification.
- Tenant subscription archived mid-adoption → tenant tx fails on `subscriptions.archived_at` check (added to adoption handler precondition).
- Two concurrent adoptions for same subscription → SERIALIZABLE serialises; one retries.

Same pattern applies to publish (snapshot tenant, write library) and three-way merge upgrade.

## 11. Adoption flow (user-facing)

1. Gadmin opens **Settings → Portfolio model**.
2. UI lists visible models from `mmff_library_ro`:
   ```
   system: scope='system' AND archived_at IS NULL
   own:    scope='tenant' AND owner_subscription_id = $me AND archived_at IS NULL
   shared: scope='shared' AND archived_at IS NULL AND
           (visibility='public' OR id IN (SELECT model_id FROM portfolio_model_shares
                                          WHERE grantee_subscription_id=$me AND revoked_at IS NULL))
   ```
   Each shows preview (hierarchy + artifacts + terminology samples + `instructions_md`).
3. Gadmin picks → backend runs Section 10 cookbook.
4. After commit, gadmin can edit freely. Edits flip `tenant_modified=TRUE` on the touched row.

### Upgrade path (when notified by Section 12)

Three-way merge UI:
- For each row in `subscription_portfolio_*` with `tenant_modified=TRUE`, show: **library old** (from old `library_version`) | **tenant edit** | **library new**.
- Default action: keep tenant edit, apply library new only where `tenant_modified=FALSE`.
- Gadmin can override per-row.

The merge basis is `source_state_key` / `source_value` / `source_layer_tag` (Section 7). Without these, no diff is possible.

## 12. Release notification channel

### 12.1 `library_releases`

```sql
CREATE TABLE library_releases (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    library_version          TEXT        NOT NULL,
    title                    TEXT        NOT NULL,
    summary_md               TEXT        NOT NULL,
    body_md                  TEXT,
    severity                 TEXT        NOT NULL CHECK (severity IN ('info','action','breaking')),
    audience_tier            TEXT[],                          -- NULL = all tiers
    audience_subscription_ids UUID[],                         -- NULL = all subscriptions; targeted rollouts
    affects_model_family_id  UUID,
    released_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at               TIMESTAMPTZ,
    archived_at              TIMESTAMPTZ,
    UNIQUE (library_version, title)         -- idempotency key for ON CONFLICT
);
CREATE INDEX idx_library_releases_active
  ON library_releases(released_at DESC) WHERE archived_at IS NULL;
```

### 12.2 `library_release_actions`

```sql
CREATE TABLE library_release_actions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id  UUID        NOT NULL REFERENCES library_releases(id) ON DELETE CASCADE,
    action_key  TEXT        NOT NULL CHECK (action_key IN
                  ('upgrade_model','review_terminology','enable_flag','dismissed')),
    label       TEXT        NOT NULL,
    payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    sort_order  INT         NOT NULL DEFAULT 0,
    UNIQUE (release_id, action_key)
);
```

### 12.3 `library_acknowledgements`

```sql
CREATE TABLE library_acknowledgements (
    release_id              UUID NOT NULL REFERENCES library_releases(id) ON DELETE CASCADE,
    subscription_id         UUID NOT NULL,
    acknowledged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by_user_id UUID NOT NULL,
    action_taken            TEXT NOT NULL CHECK (action_taken IN
                              ('upgrade_model','review_terminology','enable_flag','dismissed')),
    PRIMARY KEY (release_id, subscription_id)
);
CREATE INDEX idx_library_acks_subscription ON library_acknowledgements(subscription_id);
```

### 12.4 `library_release_log` — audit of who applied what

```sql
CREATE TABLE library_release_log (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    library_version TEXT        NOT NULL,
    file_name       TEXT        NOT NULL,
    applied_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_by      TEXT        NOT NULL DEFAULT current_user,
    sha256          TEXT        NOT NULL                  -- file checksum
);
```

Every release file ends with an `INSERT` into this table — gives an audit trail of who ran what and verifies the artifact wasn't tampered with.

### 12.5 Reconciler — explicit run-site

Lives at `backend/internal/library/reconciler.go`. Triggered:
- **In-process Go ticker, every 15 min.** `time.NewTicker(15 * time.Minute)` started in `cmd/server/main.go`. Dies with the backend process; restarts with it. Logs `reconciler.tick.duration_ms` and `reconciler.notifications_emitted` for cadence tuning.
- **On gadmin login**, synchronously, so a fresh-logged-in gadmin sees current state.
- **On every page load of `/settings/portfolio-model`** when there's an unacknowledged `action` or `breaking` release for this subscription. (Cheap: indexed anti-join.)

```go
func Reconcile(ctx, subID) ([]Notification, error) {
    // Load tier from tenant DB
    sub, _ := tenantPool.QueryRow(ctx,
        `SELECT tier FROM subscriptions WHERE id = $1`, subID)

    // Query library DB for unacknowledged + audience-matching releases
    rows, _ := libRoPool.Query(ctx, `
        SELECT r.* FROM library_releases r
        LEFT JOIN library_acknowledgements a
          ON a.release_id = r.id AND a.subscription_id = $1
        WHERE  a.release_id IS NULL
          AND  r.archived_at IS NULL
          AND  (r.expires_at IS NULL OR r.expires_at > NOW())
          AND  (r.audience_subscription_ids IS NULL OR $1 = ANY(r.audience_subscription_ids))
          AND  (r.audience_tier IS NULL OR $2 = ANY(r.audience_tier))
        ORDER BY r.released_at DESC`, subID, sub.Tier)
    // …
}
```

**Required column**: `subscriptions.tier TEXT NOT NULL DEFAULT 'pro'`. **Phase 0** adds this if not present post-017 (it's load-bearing for billing too, not just notifications). `industry` deferred — release-targeting by industry is speculative for v1; the `audience_subscription_ids` array handles targeted rollouts in the meantime.

### 12.6 Severity rendering

- **info**: dismissable banner, no action required. Auto-acknowledged with `action_taken='dismissed'` on dismiss.
- **action**: persistent badge until acknowledged; offers actions from `library_release_actions`.
- **breaking**: blocks `/settings/portfolio-model` until acknowledged.

## 13. Library release lifecycle

`library/releases/NNNN_<name>.sql`:

```sql
BEGIN;

INSERT INTO portfolio_models (model_family_id, key, name, scope, version, library_version, …)
VALUES (...)
ON CONFLICT (model_family_id, version) DO NOTHING;

-- bundle children …

INSERT INTO library_releases (library_version, title, severity, summary_md, …)
VALUES (...)
ON CONFLICT (library_version, title) DO NOTHING;

INSERT INTO library_release_log (library_version, file_name, sha256)
VALUES ('2026.05.0001', '0002_add_safe.sql', 'a3f9...');

COMMIT;
```

Applied via:
```
PGPASSWORD=… psql -h … -p … -U mmff_library_admin -d mmff_library \
  -v ON_ERROR_STOP=1 -f library/releases/0002_add_safe.sql
```

## 14. Phase plan

Hosted only. No on-prem phase. If on-prem is ever requested by a paying customer, it becomes a separate project with its own scoping (signing infra, key custody, install tooling, support model) — not a deferred phase of this work.

| Phase | Scope | Blocks on |
|---|---|---|
| **0** | Migration 017 (`tenants → subscriptions`) lands. Add `subscriptions.tier TEXT NOT NULL DEFAULT 'pro'` if missing. Add `pending_library_cleanup_jobs` table. | — |
| **1** | Library scaffolding: DB + four roles (`mmff_library_admin/_ro/_publish/_ack`) + bundle tables + triggers + CI grant assertion. Seed MMFF model bundle. | Phase 0 |
| **2** | App reads from library: read pool wired, `GET /api/portfolio-models`, Settings preview (read-only). | Phase 1 |
| **3** | Notification channel: `library_releases*` tables, reconciler (15-min ticker + login + page-load), gadmin notification UI, severity rendering. | Phase 1 |
| **4** | Adoption: tenant-side mirror tables, three-way merge basis columns, `POST /api/portfolio-models/:family/:version/adopt`, cross-DB cookbook (Section 10) implemented. Cleanup worker (Section 8) running. | Phase 2 + 3 |
| **5** | Publish/share: `mmff_library_publish` pool, publish UI, `POST /api/portfolio-models/:id/shares`. Defence-in-depth `archived_at` checks in publish/share handlers. | Phase 4 |
| **6** | System models: SAFe, Jira, Rally, Kanban as data-only releases via `library/releases/0002`–`0005`. | Phase 5 |

**Ordering rationale**: Phase 3 (notifications) precedes Phase 4 (adoption) so day-one adopters have an upgrade path. Phase 6 (system models) ships last so we ship-test the channel against MMFF's own model first — if the upgrade flow is buggy, only MMFF is the affected adopter.

## 15. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Cross-DB FK drift (orphaned `adopted_from_model_family_id`) | S2 | Soft-archive only; nightly orphan reconciler (Section 8) |
| 2 | Tenant publishes a model with PII | S2 | Publish UI shows preview; PII pattern strip; docs warn |
| 3 | Library role drift | S1 | CI grant-matrix assertion (Section 9) |
| 4 | Release artifact half-applied | S2 | `BEGIN; … COMMIT;` + `-v ON_ERROR_STOP=1` + `library_release_log` checksum |
| 5 | Multi-version model drift | S3 | `model_family_id` + version + Section 12 reconciler-driven upgrade |
| 6 | Bundle update breaks tenant overrides | S2 | Three-way merge UI (Section 11) backed by `source_*` + `tenant_modified` columns |
| 7 | Feature flag drift (model says `pi_planning=true` but UI not built) | S2 | `backend/internal/library/flags.go` typed whitelist `map[FlagKey]FlagSpec`; adoption rejects unknown flags |
| 8 | Cross-DB race in adoption | S1 | Section 10 cookbook: snapshot pattern + post-commit re-validation |
| 9 | `mmff_library_publish` role leaking to non-publish handlers | S1 | Three roles, three pools, CI assertion (Section 9) |
| 10 | Subscription archived mid-adoption | S2 | Adoption precondition checks `subscriptions.archived_at IS NULL`; saga in Section 8 |
| 11 | Reconciler fires before `tier`/`industry` exist | S2 | Phase 0 schema audit; Phase 3 unit test |

## 16. Confidence verdict

- v3 stood at ~65%.
- v3.1 closed B1–B6 (cross-DB cookbook, `model_family_id`, role split, archive saga, 017 alignment, soft-archive on all tables) and S1–S10 (triggers, merge basis, reconciler run-site, flag whitelist location, mirror-table FKs, indexes, idempotency keys). Estimated 92–94%.
- v3.2 resolves the four open decisions (Section 17): Postgres-queue saga (concrete schema + worker), tier-only audience, no on-prem phase, 15-min reconciler ticker. Replaces handwave with implementable detail.

**Estimated confidence: 95%.** The remaining gap is implementation proof — the role-grant CI assertion has to actually catch drift, the saga's exponential backoff has to be observed under load, and the three-way merge UI has to be usable when a real release ships. Those are Phase 1–4 deliverables, not plan gaps.

## 17. Resolved decisions (rationale recorded so we don't re-litigate)

### 17.1 Archive saga uses Postgres queue, not RabbitMQ

**Decision**: `pending_library_cleanup_jobs` table in `mmff_vector` with in-process Go worker (Section 8). RabbitMQ is *not* used for this job, even though it's already running on the cluster.

**Why not RabbitMQ**:
- **Dual-write problem.** `BEGIN; UPDATE subscriptions; PUBLISH-TO-RABBIT; COMMIT;` has a window where the publish succeeds and the commit fails (or vice versa). Standard fix is the outbox pattern — a table that buffers messages until a relay publishes them. But once you have an outbox table, you've built half the Postgres queue; RabbitMQ becomes a delivery layer with no benefit for this workload.
- **Wrong fit.** RabbitMQ shines for push delivery, fanout, and high volume. Subscription archives are rare (a tenant churns weekly at most), have one consumer, are not latency-sensitive, and must be transactional with a tenant-DB write. This is the exact workload where Postgres queues win.
- **Atomicity.** `INSERT INTO pending_library_cleanup_jobs` happens inside the same transaction as `UPDATE subscriptions SET archived_at` — either both happen or neither. No outbox needed.

**When RabbitMQ does earn its keep on this project**: cross-service event fanout, email/notification distribution, Selenium grid coordination, anything with multiple consumers or push semantics. Different problems, different tools.

**Reversibility**: if subscription-archive volume ever grows past polling-friendly territory, swap the worker for an outbox-and-publish relay. The schema doesn't change.

### 17.2 `subscriptions.tier` shipped in Phase 0; `.industry` dropped

**Decision**: Phase 0 adds `subscriptions.tier TEXT NOT NULL DEFAULT 'pro'`. `industry` is not added.

**Why tier**: it's real data with multiple downstream uses (pricing, feature gates, support SLA, release targeting). Shipping it costs one column.

**Why not industry**: speculative for v1. Requires a UX (gadmin self-selects on signup), data hygiene (free-text vs enum vocabulary), and a business decision about which industries we target. None of that is in this plan's scope. The `audience_subscription_ids` array handles targeted rollouts until industry becomes a real product concept.

### 17.3 No on-prem phase

**Decision**: Phase 7 removed entirely. Plan is hosted-only. On-prem is not on the roadmap.

**Why**: signing infra (key custody, rotation, customer-side verification, revocation) is a multi-week subsystem with its own product decisions. Reserving "Phase 7" as a deferred slot reads like a roadmap commitment when there is no paying customer driving it. If one shows up, scope it as a fresh project — possibly as professional services rather than core product.

### 17.4 Reconciler cadence: 15-min in-process ticker + login + page-load

**Decision**: in-process Go ticker every 15 min, plus synchronous reconcile on gadmin login and on `/settings/portfolio-model` page load when an unacknowledged `action`/`breaking` release exists.

**Why**:
- 15 min is the right tradeoff: load is trivial (one indexed query per active subscription per tick), and worst-case staleness for a breaking release is 15 min if the gadmin happens to be already logged in.
- In-process ticker is the simplest thing that works. No external cron infra. Restarts with the backend process.
- Login reconcile catches gadmins who weren't logged in when a release dropped.
- Page-load reconcile on the Portfolio Model settings page makes "breaking" releases feel responsive when the gadmin is actively about to do something the release affects.

**Metrics emitted**: `reconciler.tick.duration_ms`, `reconciler.notifications_emitted`. Tune cadence later if these tell us 15 min is wrong in practice.

## 18. Relationship to `feature_portfolio_presets.md`

v1/v2 kept presets in `mmff_vector` as hierarchy rows only. v3 split DBs and expanded to bundles. v3.1 closed the cross-DB semantics, identity model, role isolation, and archive races, and shipped transitions + notifications in the right order. v3.2 resolves the four open decisions with concrete implementation choices (Postgres-queue saga, tier-only audience, hosted-only scope, 15-min reconciler). Everything in v2 about `fn_user_access_level`, time-boxed grants, and two-party lock is unchanged.
