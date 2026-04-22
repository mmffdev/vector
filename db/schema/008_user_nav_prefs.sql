-- ============================================================
-- MMFFDev - Vector: user_nav_prefs (personalised navigation)
-- Migration 008 — applied on top of 007_rename_permissions.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 008_user_nav_prefs.sql
--
-- Stores a user's pinned sidebar items and start page, scoped by tenant.
-- Governing rule at render time is permitted ∩ pinned — this table
-- only decides what the user WANTS to see, never what they CAN see.
--
-- profile_id is reserved for Phase 5 "named navigation profiles"
-- (e.g. testing / planning contexts). MVP always writes NULL.
--
-- item_key is a stable catalogue key, not an FK:
--   - static pages:   "dashboard", "my-vista", "portfolio", …
--   - dynamic items:  "item:<uuid>", "workspace:<uuid>", …
-- Validation happens in the API layer against the shared catalogue.
--
-- Hard-delete on unpin. No tombstones, no cleanup job.
-- ============================================================

BEGIN;

CREATE TABLE user_nav_prefs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    profile_id      UUID,
    item_key        TEXT NOT NULL,
    position        INT  NOT NULL,
    is_start_page   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_nav_prefs_unique_item
        UNIQUE (user_id, tenant_id, profile_id, item_key),

    CONSTRAINT user_nav_prefs_unique_position
        UNIQUE (user_id, tenant_id, profile_id, position)
        DEFERRABLE INITIALLY DEFERRED
);

-- Only one start page per (user, tenant, profile)
CREATE UNIQUE INDEX user_nav_prefs_one_start_page
    ON user_nav_prefs (user_id, tenant_id, profile_id)
    WHERE is_start_page = TRUE;

-- Hot path: load a user's prefs for the current tenant in order
CREATE INDEX idx_user_nav_prefs_lookup
    ON user_nav_prefs (user_id, tenant_id, profile_id, position);

-- Reuse the standard updated_at trigger function (defined in 001_init.sql)
CREATE TRIGGER trg_user_nav_prefs_updated_at
    BEFORE UPDATE ON user_nav_prefs
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
