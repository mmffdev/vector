-- db/schema/131_rename_workspaces_to_master_record_workspaces.sql
--
-- Rename workspaces -> master_record_workspaces to align with the
-- master_record_* family (master_record_tenant, master_record_portfolio).
--
-- The master_record_* prefix marks tenant-scoped canonical anchor rows:
--   - master_record_tenant       PK=subscription_id  (1 per tenant)
--   - master_record_workspaces   PK=id, FK subscription_id (N per tenant) ← this rename
--   - master_record_portfolio    PK=workspace_id     (1 per workspace)
--
-- Pure rename — no data movement, no FK target breakage. Postgres updates
-- FK target references automatically; FK *constraint names* on dependent
-- tables (e.g. org_nodes_workspace_id_fkey) keep their literal names —
-- harmless. Indexes / trigger / check constraint are renamed for clarity.
--
-- The legacy singular table `workspace` (older, mostly empty) is NOT
-- touched by this migration.

BEGIN;

-- 1. Table
ALTER TABLE workspaces RENAME TO master_record_workspaces;

-- 2. Indexes (PK auto-renames its index implicitly only on column rename, not
--    table rename — so the PK index needs an explicit rename for consistency.)
ALTER INDEX workspaces_pkey
    RENAME TO master_record_workspaces_pkey;
ALTER INDEX workspaces_subscription_slug_live
    RENAME TO master_record_workspaces_subscription_slug_live;
ALTER INDEX workspaces_subscription_idx
    RENAME TO master_record_workspaces_subscription_idx;

-- 3. Check constraint
ALTER TABLE master_record_workspaces
    RENAME CONSTRAINT workspaces_archived_pair
    TO master_record_workspaces_archived_pair;

-- 4. Trigger (PG 14+ supports ALTER TRIGGER … RENAME)
ALTER TRIGGER trg_workspaces_updated_at ON master_record_workspaces
    RENAME TO trg_master_record_workspaces_updated_at;

-- 5. Comment
COMMENT ON TABLE master_record_workspaces IS
    'Tenant-scoped workspace anchor rows (master_record_* family). One row '
    'per workspace; subscription_id is the tenant FK so a tenant can hold '
    'N workspaces. Sole writer: backend/internal/workspaces. archived_at = '
    'limbo; slug is unique only among live rows. Renamed from "workspaces" '
    'in migration 131 to align with master_record_tenant / '
    'master_record_portfolio naming.';

COMMIT;
