-- ============================================================
-- MMFFDev - Vector: user_tab_order (per-user, per-page tab ordering)
-- Migration 115 — applied on top of 114_*.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 115_user_tab_order.sql
--
-- Stores a user's preferred tab ordering for any page that uses
-- <SecondaryNavigation reorderable pageId="…">. Mirrors the
-- user_nav_prefs pattern: deferrable position uniqueness so a single
-- transaction can swap two positions; FK CASCADE on user + subscription
-- so account/subscription deletion cleans up automatically.
--
-- subscription_id matches the post-017 rename (tenants → subscriptions).
-- page_id is a stable string catalog key (e.g. "workspace-settings",
-- "theme", "work-items"). It is NOT an FK — pages aren't a database
-- resource. Tab keys not present in the live page catalog are ignored
-- by the read path and decay naturally.
-- ============================================================

BEGIN;

CREATE TABLE user_tab_order (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    page_id         TEXT NOT NULL,
    tab_key         TEXT NOT NULL,
    position        INT  NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_tab_order_unique_tab
        UNIQUE (user_id, subscription_id, page_id, tab_key),

    CONSTRAINT user_tab_order_unique_position
        UNIQUE (user_id, subscription_id, page_id, position)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_user_tab_order_lookup
    ON user_tab_order (user_id, subscription_id, page_id, position);

CREATE TRIGGER trg_user_tab_order_updated_at
    BEFORE UPDATE ON user_tab_order
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
