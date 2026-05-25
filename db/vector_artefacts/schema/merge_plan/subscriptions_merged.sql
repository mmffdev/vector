-- ============================================================
-- PLA064 / CUT1.2.2 — Merged subscriptions target schema
--
-- NON-EXECUTABLE planning artefact. Phase 3 (CUT1.3.3) applies the
-- actual migration that creates this table in vector_artefacts and
-- ETL-merges the registry + sidecar rows into it. This file documents
-- the target schema so the Phase 3 migration has a clear target.
--
-- ============================================================
-- WHAT THIS REPLACES
-- ============================================================
--
-- Today there are TWO tables describing the same entity (the
-- subscription / tenant), in different databases, with overlapping
-- schemas:
--
--   1. mmff_vector.subscriptions (the REGISTRY, 83 rows)
--      — origin: db/mmff_vector/schema/001_init.sql (CREATE TABLE
--        tenants) → db/mmff_vector/schema/017_subscriptions_rename.sql
--        (renamed tenants → subscriptions) → 018 (added tier column).
--        7 columns:
--          id, name, slug, is_active, tier, created_at, updated_at.
--
--   2. vector_artefacts.master_record_tenants (the SIDECAR, 33 rows)
--      — origin: db/vector_artefacts/schema/036_master_record_tenant.sql
--        → column-prefixed in 063 → tier column added in 068.
--        Keyed on master_record_tenants_id_subscription (PK).
--        17 columns (all prefixed master_record_tenants_*):
--          id_subscription (PK), name, description,
--          primary_contact_email, data_region, timezone, date_format,
--          datetime_format, workdays, week_start, rank_method,
--          build_changeset_tracking, notes, created_at, updated_at,
--          archived_at.
--
-- The OVERLAP: name, created_at, updated_at exist on both. The VA
-- sidecar's `name` was added because cross-DB joins to fetch the
-- subscription name from mmff_vector for VA-side reads was an
-- ergonomic + performance burden — same denormalisation-as-workaround
-- pattern as master_record_workspaces.
--
-- Note the asymmetry between this pair and the workspaces pair:
-- workspace-side, the registry-row-count = sidecar-row-count (every
-- live workspace has a settings row, lazy-seeded on first read).
-- Subscription-side, only 33 of the 83 live subscriptions have a
-- settings row — the other 50 are pre-PLA-0050 subscriptions that
-- never had master_record_tenants seeded for them. The merge MUST
-- handle this: every registry row becomes a merged row; sidecar
-- columns are NULL for the 50 subscriptions that never had settings.
--
-- ============================================================
-- COLUMN-MERGE POLICY (per CUT1.2.2 AC)
-- ============================================================
--
-- For duplicate fields: registry wins.
--   - name             → from registry (sidecar's was a stale duplicate)
--   - created_at       → from registry
--   - updated_at       → from registry
--
-- Registry-only fields preserved:
--   - slug             → kept; uniqueness constraint preserved
--   - is_active        → kept; sidecar had no equivalent
--   - tier             → kept; sidecar 068 mig added an equivalent
--                        column but the registry is authoritative
--                        (registry was added 2026-04-24, sidecar's
--                        was added 2026-04-25 as a denormalised copy
--                        for VA-side reads — same workaround pattern)
--
-- Sidecar-only fields absorbed (settings + identity expansion):
--   - description               → not on registry; absorbed nullable
--   - primary_contact_email     → tenant contact
--   - data_region               → use1/euw1/etc.
--   - timezone                  → Europe/London etc.
--   - date_format               → DD/MM/YYYY etc.
--   - datetime_format           → DD/MM/YYYY HH:mm etc.
--   - workdays                  → text[]
--   - week_start                → mon | sun
--   - rank_method               → manual | dragdrop
--   - build_changeset_tracking  → boolean
--   - notes                     → free-text
--   - archived_at               → sidecar-side archival flag (the
--                                 registry has no soft-archive concept
--                                 for subscriptions — when a subscription
--                                 ends, it's hard-deleted by billing).
--                                 Drop this column from the merge —
--                                 it was never read in production paths
--                                 (verify via grep before final merge).
--
-- Absorbed settings columns are NULLABLE because 50 of the 83
-- subscriptions never had a sidecar row. Readers continue to
-- COALESCE to schema defaults at query time — the existing pattern
-- in backend/internal/tenantmasterrecord/sql.go:sqlSelectTenantSettings
-- (the precedent for the workspaces merge too).
--
-- ============================================================
-- THE MERGED SCHEMA
-- ============================================================
--
-- Naming: `subscriptions` (final post-rename). Phase 3 ETL uses
-- temp name `subscriptions_v2` to avoid colliding with the sidecar
-- during the ETL window. Column prefix `subscriptions_*` per RF1.4.4
-- naming convention.

CREATE TABLE IF NOT EXISTS subscriptions (
    -- Identity (from registry; PK preserved verbatim so every
    -- soft-FK reference in vector_artefacts resolves through
    -- Phase 4 without rewriting any foreign-table UUID value).
    subscriptions_id                                UUID            PRIMARY KEY,

    -- Registry identity fields:
    subscriptions_name                              TEXT            NOT NULL,
    subscriptions_slug                              TEXT            NOT NULL UNIQUE,

    -- Lifecycle:
    subscriptions_is_active                         BOOLEAN         NOT NULL DEFAULT TRUE,

    -- Entitlement tier (registry; sidecar duplicate dropped):
    subscriptions_tier                              TEXT            NOT NULL DEFAULT 'pro'
        CHECK (subscriptions_tier IN ('free','pro','enterprise')),

    subscriptions_created_at                        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    subscriptions_updated_at                        TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- ─── ABSORBED FROM SIDECAR (settings) ──────────────────────────
    -- All nullable. 50 of the 83 subscriptions will start NULL on
    -- these columns because they never had a sidecar row. Readers
    -- COALESCE to defaults at query time.
    subscriptions_description                       TEXT,
    subscriptions_primary_contact_email             TEXT
        CHECK (subscriptions_primary_contact_email IS NULL
            OR subscriptions_primary_contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),

    subscriptions_data_region                       TEXT
        CHECK (subscriptions_data_region IS NULL OR subscriptions_data_region IN (
            'use1','use2','usw1','usw2','cac1','caw1','sae1',
            'euw1','euw2','euw3','euc1','eun1',
            'mec1','mes1','afs1',
            'aps1','apse1','apse2','apne1','apne2','ape1'
        )),

    subscriptions_timezone                          TEXT,
    subscriptions_date_format                       TEXT
        CHECK (subscriptions_date_format IS NULL OR subscriptions_date_format IN (
            'DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD-MMM-YYYY','D MMMM YYYY','MMMM D, YYYY'
        )),
    subscriptions_datetime_format                   TEXT
        CHECK (subscriptions_datetime_format IS NULL OR subscriptions_datetime_format IN (
            'DD/MM/YYYY HH:mm','MM/DD/YYYY hh:mm a','YYYY-MM-DD HH:mm','D MMM YYYY, HH:mm'
        )),

    subscriptions_workdays                          TEXT[],
    subscriptions_week_start                        TEXT
        CHECK (subscriptions_week_start IS NULL OR subscriptions_week_start IN ('mon','sun')),

    subscriptions_rank_method                       TEXT
        CHECK (subscriptions_rank_method IS NULL OR subscriptions_rank_method IN ('manual','dragdrop')),

    subscriptions_build_changeset_tracking          BOOLEAN,

    subscriptions_notes                             TEXT
);

COMMENT ON TABLE subscriptions IS
    'PLA064 CUT1.3.3 merged target. Replaces the cross-DB subscriptions registry + master_record_tenants sidecar pair. Registry identity + tier canonical; sidecar settings fields nullable (50 of 83 subscriptions never had a sidecar row historically).';

-- ============================================================
-- CROSS-DB SIDECAR AUDIT QUERY (per CUT1.2.2 AC)
-- ============================================================
--
-- Verify the VA sidecar is a subset of the mmff_vector registry —
-- every sidecar row's id_subscription should exist as a registry
-- id. Non-empty = data-quality issue.
--
--   SELECT s.master_record_tenants_id_subscription
--     FROM vector_artefacts.master_record_tenants s
--    WHERE s.master_record_tenants_id_subscription NOT IN (
--             SELECT id FROM mmff_vector.subscriptions
--          );
--
-- Expected: zero rows. If any rows return, the sidecar row's
-- parent subscription was deleted without cascade cleanup — likely
-- dev-tenant cleanup debt (same class as the 508 orphans the
-- CUT1.0.2 cron surfaced). Remediate per CUT1.5.0 before CUT1.3.3.
--
-- NOTE: the REVERSE direction is expected to return ~50 rows
-- (subscriptions that have no sidecar). This is NOT an orphan —
-- it's the lazy-seed history. The merge handles it by leaving
-- the settings columns NULL.
--
--   -- ~50 subscriptions without a sidecar — NORMAL, not an orphan:
--   SELECT s.id FROM mmff_vector.subscriptions s
--    WHERE s.id NOT IN (
--             SELECT master_record_tenants_id_subscription
--               FROM vector_artefacts.master_record_tenants
--          );
--
-- ============================================================
-- READER CATALOGUE FOR PHASE 4 REDIRECTION
-- ============================================================
--
-- Every reader of the existing VA sidecar (must be redirected from
-- master_record_tenants reads to the merged subscriptions reads in
-- CUT1.4.2). Captured 2026-05-25 via grep on
-- master_record_tenants_* prefixes:
--
--   backend/internal/tenantmasterrecord/sql.go         — read + write surface
--   backend/internal/tenantmasterrecord/service.go     — service layer
--   backend/internal/tenantmasterrecord/service_test.go
--   backend/internal/workspacemasterrecord/sql.go      — JOIN for inheritance
--   backend/internal/workspacemasterrecord/service_inheritance_test.go
--   backend/internal/mentions/sql.go                   — mentions-scope JOIN
--
-- After CUT1.3.3 lands, every read of
-- `master_record_tenants_id_subscription` becomes a read of
-- `subscriptions_id` (the merged PK column). Settings-column reads
-- keep their semantic name but with the `subscriptions_*` prefix.
--
-- Post-cutover the tenantmasterrecord PACKAGE is slated for deletion
-- in CUT1.6.1 — the merged table is read via the subscriptions
-- service (or extracted from the auth service) since "subscription
-- registry + settings" is one concept now.
--
-- ============================================================
-- DEPENDENCY ON CUT1.5.0
-- ============================================================
--
-- The CUT1.0.2 cron's 2026-05-25 first run found ZERO orphans
-- directly attributable to this sidecar (master_record_tenants rows
-- all point at live subscriptions — likely because the 50 missing
-- sidecars never existed in the first place rather than being
-- deleted-and-leaked). But the 21 audit_logs.audit_logs_id_subscription
-- orphans and the 24 artefacts.subscription_id orphans surfaced by
-- the cron WILL block CUT1.5.1 if not remediated first. Those are
-- in scope for CUT1.5.0 and unblock both CUT1.5.1 AND the FK install
-- on the new subscriptions table created by this merge plan.

COMMENT ON COLUMN subscriptions.subscriptions_id IS
    'PK preserved from mmff_vector.subscriptions.id; every soft-FK reference in vector_artefacts resolves through Phase 4 without UUID rewrites.';
