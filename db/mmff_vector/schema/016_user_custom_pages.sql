-- ============================================================
-- MMFFDev - Vector: user custom pages + views
-- Migration 016 — applied on top of 015_user_nav_icon_override.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 016_user_custom_pages.sql
--
-- A "custom page" is a user-authored container (think Jira "plan").
-- Inside it live one or more views — timeline, board, list, etc. —
-- selected by ?vid=<view_id>. The page itself has no content; it's
-- just a labelled holder that owns its views and answers to one URL.
--
-- Catalogue surface:
--   item_key = "custom:<page.id>"   kind = "user_custom"
--   href     = "/p/<page.id>"
-- The frontend resolves ?vid= against user_custom_page_views.
--
-- Tenant-scoped per-user. Hard delete cascades from page → views.
-- Soft-archive can be added later if we ever need it; not now.
-- ============================================================

BEGIN;

CREATE TABLE user_custom_pages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT 'folder',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_custom_pages_label_nonempty CHECK (length(btrim(label)) > 0),
    CONSTRAINT user_custom_pages_label_unique
        UNIQUE (user_id, tenant_id, label)
);

CREATE INDEX idx_user_custom_pages_owner
    ON user_custom_pages (user_id, tenant_id);

CREATE TRIGGER trg_user_custom_pages_updated_at
    BEFORE UPDATE ON user_custom_pages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A view is a render mode within a page. The default view is
-- the one with position = 0 (and there must be exactly one
-- per page — enforced by the unique-position constraint plus
-- the "at least one view" rule the API enforces on delete).
CREATE TYPE custom_view_kind AS ENUM ('timeline', 'board', 'list');

CREATE TABLE user_custom_page_views (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id     UUID NOT NULL REFERENCES user_custom_pages(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    kind        custom_view_kind NOT NULL,
    position    INT  NOT NULL,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT user_custom_page_views_label_nonempty CHECK (length(btrim(label)) > 0),
    CONSTRAINT user_custom_page_views_unique_position
        UNIQUE (page_id, position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT user_custom_page_views_unique_label
        UNIQUE (page_id, label)
);

CREATE INDEX idx_user_custom_page_views_page
    ON user_custom_page_views (page_id, position);

CREATE TRIGGER trg_user_custom_page_views_updated_at
    BEFORE UPDATE ON user_custom_page_views
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
