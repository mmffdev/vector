-- ============================================================
-- PLA064 / CUT1.2.1 — Merged master_record_workspaces target schema
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
-- Today there are TWO tables called master_record_workspaces, in
-- different databases, with overlapping schemas:
--
--   1. mmff_vector.master_record_workspaces (the REGISTRY)
--      — origin: db/mmff_vector/schema/098_workspaces.sql (CREATE TABLE
--        workspaces) + db/mmff_vector/schema/131 (renamed to
--        master_record_workspaces). 10 columns:
--          id, subscription_id, name, slug, description, created_by,
--          created_at, updated_at, archived_at, archived_by.
--
--   2. vector_artefacts.master_record_workspaces (the SIDECAR)
--      — origin: db/vector_artefacts/schema/036_master_record_tenant.sql
--        (CREATE TABLE master_record_tenant, workspace-keyed) →
--        renamed plural in 060 → column-prefixed in 063 → renamed
--        to master_record_workspaces in 067. 17 columns (prefixed
--        master_record_workspaces_*):
--          id_workspace (PK), name, description, id_user_owner,
--          primary_contact_email, data_region, timezone, date_format,
--          datetime_format, workdays, week_start, rank_method,
--          build_changeset_tracking, notes, created_at, updated_at,
--          archived_at.
--
-- The OVERLAP is the smoking gun: name, description, created_at,
-- updated_at, archived_at exist on BOTH tables. The VA sidecar
-- duplicates the registry's identity fields as a denormalisation
-- workaround for the cross-DB join cost. After PLA064 puts both
-- endpoints in vector_artefacts, there is no reason to keep the
-- duplication. The two tables COLLAPSE into one.
--
-- ============================================================
-- COLUMN-MERGE POLICY (per CUT1.2.1 AC)
-- ============================================================
--
-- For duplicate fields: registry wins.
--   - name             → from registry (sidecar's was a stale copy)
--   - description      → from registry
--   - created_at       → from registry (true creation time)
--   - updated_at       → from registry
--   - archived_at      → from registry
--
-- Registry-only fields preserved as-is:
--   - subscription_id  → kept (parent FK; later becomes a real FK
--                        when Phase 5 installs the constraint)
--   - slug             → kept (uniqueness constraint per-subscription
--                        among live workspaces — see below)
--   - created_by       → kept (FK to users.id, becomes real in Phase 5)
--   - archived_by      → kept (FK to users.id, becomes real in Phase 5)
--
-- Sidecar-only fields absorbed (settings columns — these have no
-- registry equivalent):
--   - id_user_owner             → workspace-level owner; can differ from created_by
--   - primary_contact_email     → tenant contact
--   - data_region               → use1/euw1/etc. region code
--   - timezone                  → Europe/London etc.
--   - date_format               → DD/MM/YYYY etc.
--   - datetime_format           → DD/MM/YYYY HH:mm etc.
--   - workdays                  → text[] of mon/tue/...
--   - week_start                → mon | sun
--   - rank_method               → manual | dragdrop
--   - build_changeset_tracking  → boolean
--   - notes                     → free-text
--
-- Settings columns absorbed as NULLABLE so workspaces that never had
-- a sidecar row (legitimately — the sidecar was lazy-seeded) don't
-- need defaults invented. Application reads continue to COALESCE to
-- schema defaults at query time, matching today's sql.go convention
-- (see tenantmasterrecord/sql.go:sqlSelectTenantSettings for the
-- precedent: "PLA-0051 mig 070 dropped NOT NULL on the inheritable
-- tenant columns so the workspacemasterrecord COALESCE merge can
-- distinguish 'tenant has no opinion' from 'tenant says X'").
--
-- ============================================================
-- THE MERGED SCHEMA
-- ============================================================
--
-- Naming: `master_record_workspaces` (final post-rename). During the
-- Phase 3 ETL window the temp name `master_record_workspaces_v2` is
-- used to avoid colliding with the live sidecar; once the sidecar is
-- dropped + the registry replication finishes, _v2 is renamed to the
-- final name. Column prefix is `master_record_workspaces_*` end-to-end
-- per RF1.4.4 (the naming-conventions HARD RULE — every column on a
-- root-family table carries the table-name prefix).
--
-- This schema is REFERENCE ONLY. The Phase 3 migration that creates
-- this table is responsible for: (a) preserving all data per the
-- merge policy above, (b) installing the appropriate indexes, (c)
-- running pre-/post-ETL row-count checks per the Phase 3 AC.

CREATE TABLE IF NOT EXISTS master_record_workspaces (
    -- Identity (from registry; primary key matches the legacy
    -- mmff_vector.master_record_workspaces.id UUIDs verbatim so
    -- every soft-FK reference in vector_artefacts continues to
    -- resolve through Phase 4 without rewriting any foreign-table
    -- UUID value).
    master_record_workspaces_id                              UUID            PRIMARY KEY,

    -- Parent (from registry; becomes a real FK in Phase 5 once
    -- subscriptions also lives in vector_artefacts).
    master_record_workspaces_id_subscription                 UUID            NOT NULL,

    -- Registry identity fields (duplicates from sidecar dropped):
    master_record_workspaces_name                            TEXT            NOT NULL
        CHECK (length(trim(master_record_workspaces_name)) > 0),

    master_record_workspaces_slug                            TEXT            NOT NULL
        CHECK (
            length(trim(master_record_workspaces_slug)) > 0
            AND master_record_workspaces_slug ~ '^[a-z0-9][a-z0-9-]*$'
        ),

    master_record_workspaces_description                     TEXT,

    -- Audit (registry-side; becomes real FKs to users in Phase 5).
    master_record_workspaces_id_user_creator                 UUID            NOT NULL,
    master_record_workspaces_created_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    master_record_workspaces_updated_at                      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Archive pair (registry; both NULL or both set).
    master_record_workspaces_archived_at                     TIMESTAMPTZ,
    master_record_workspaces_id_user_archiver                UUID,

    CONSTRAINT master_record_workspaces_archived_pair CHECK (
        (master_record_workspaces_archived_at IS NULL AND master_record_workspaces_id_user_archiver IS NULL)
        OR (master_record_workspaces_archived_at IS NOT NULL AND master_record_workspaces_id_user_archiver IS NOT NULL)
    ),

    -- ─── ABSORBED FROM SIDECAR (settings) ──────────────────────────
    -- All nullable. Readers COALESCE to schema defaults at query time.
    master_record_workspaces_id_user_owner                   UUID,
    master_record_workspaces_primary_contact_email           TEXT,

    master_record_workspaces_data_region                     TEXT
        CHECK (master_record_workspaces_data_region IS NULL OR master_record_workspaces_data_region IN (
            'use1','use2','usw1','usw2','cac1','caw1','sae1',
            'euw1','euw2','euw3','euc1','eun1',
            'mec1','mes1','afs1',
            'aps1','apse1','apse2','apne1','apne2','ape1'
        )),

    master_record_workspaces_timezone                        TEXT,
    master_record_workspaces_date_format                     TEXT
        CHECK (master_record_workspaces_date_format IS NULL OR master_record_workspaces_date_format IN (
            'DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD','DD-MMM-YYYY','D MMMM YYYY','MMMM D, YYYY'
        )),
    master_record_workspaces_datetime_format                 TEXT
        CHECK (master_record_workspaces_datetime_format IS NULL OR master_record_workspaces_datetime_format IN (
            'DD/MM/YYYY HH:mm','MM/DD/YYYY hh:mm a','YYYY-MM-DD HH:mm','D MMM YYYY, HH:mm'
        )),

    master_record_workspaces_workdays                        TEXT[],
    master_record_workspaces_week_start                      TEXT
        CHECK (master_record_workspaces_week_start IS NULL OR master_record_workspaces_week_start IN ('mon','sun')),

    master_record_workspaces_rank_method                     TEXT
        CHECK (master_record_workspaces_rank_method IS NULL OR master_record_workspaces_rank_method IN ('manual','dragdrop')),

    master_record_workspaces_build_changeset_tracking        BOOLEAN,

    master_record_workspaces_notes                           TEXT
);

-- Slug uniqueness only among LIVE workspaces in a subscription.
-- Archived workspaces release their slug for re-use.
CREATE UNIQUE INDEX IF NOT EXISTS master_record_workspaces_subscription_slug_live
    ON master_record_workspaces (master_record_workspaces_id_subscription, master_record_workspaces_slug)
    WHERE master_record_workspaces_archived_at IS NULL;

-- Subscription scan index (every artefact filter joins through this).
CREATE INDEX IF NOT EXISTS master_record_workspaces_subscription_id
    ON master_record_workspaces (master_record_workspaces_id_subscription);

COMMENT ON TABLE master_record_workspaces IS
    'PLA064 CUT1.3.3 merged target. Replaces the cross-DB registry+sidecar pair. Registry fields canonical; settings fields nullable (lazy-seeded historically).';

-- ============================================================
-- CROSS-DB SIDECAR AUDIT QUERY (per CUT1.2.1 AC)
-- ============================================================
--
-- Verify the VA sidecar is 1:1 with the mmff_vector registry. Run
-- this BEFORE any migration; non-empty result = data-quality issue
-- that blocks the merge.
--
-- Expected: zero rows. If any rows return, the sidecar has a row
-- whose parent registry row was deleted without cleanup — likely
-- dev-tenant cleanup debt (same class as the 508 orphans the
-- CUT1.0.2 cron surfaced). Remediate per CUT1.5.0 before CUT1.3.3.
--
--   SELECT s.master_record_workspaces_id_workspace
--     FROM vector_artefacts.master_record_workspaces s
--    WHERE s.master_record_workspaces_id_workspace NOT IN (
--             SELECT id FROM mmff_vector.master_record_workspaces
--          );
--
-- (Postgres can't actually run cross-DB queries; the cron query
-- shape uses two pool connections + an EXCEPT in application code.
-- See dev/scripts/cron_cross_db_orphan_audit.py for the pattern.)
--
-- ============================================================
-- READER CATALOGUE FOR PHASE 4 REDIRECTION
-- ============================================================
--
-- Every reader of the existing VA sidecar settings columns (must be
-- redirected from `master_record_workspaces.*` reads to the merged
-- table reads in CUT1.4.2). Captured 2026-05-25 via grep on
-- master_record_workspaces_id_workspace/_name/_id_user_owner/
-- _timezone/_data_region (and the prefixed siblings). The list is
-- short because workspacemasterrecord is the sole writer:
--
--   backend/internal/workspacemasterrecord/sql.go        — read + write surface
--   backend/internal/workspacemasterrecord/service.go    — service layer
--   backend/internal/workspacemasterrecord/service_inheritance_test.go
--   backend/internal/portfoliomodels/sql.go              — joins for portfolio context
--
-- After CUT1.3.3 lands, every read of `master_record_workspaces_id_workspace`
-- becomes a read of `master_record_workspaces_id` (the merged PK column).
-- The settings-column reads keep their `master_record_workspaces_*` names
-- but point at the merged table.
--
-- Post-cutover the workspacemasterrecord PACKAGE itself is slated for
-- deletion in CUT1.6.1 — the merged table is read via the workspaces
-- service since "workspace registry + settings" is one concept now.

COMMENT ON COLUMN master_record_workspaces.master_record_workspaces_id IS
    'PK preserved from mmff_vector.master_record_workspaces.id; every soft-FK reference in vector_artefacts resolves through Phase 4 without UUID rewrites.';

COMMENT ON COLUMN master_record_workspaces.master_record_workspaces_id_user_owner IS
    'Workspace-level owner. Nullable. Distinct from id_user_creator (who created the registry row). Absorbed from the pre-merge sidecar where it was named master_record_workspaces_id_user_owner.';
