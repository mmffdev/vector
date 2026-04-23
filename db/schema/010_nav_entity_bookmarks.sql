-- ============================================================
-- MMFFDev - Vector: Entity bookmarks (nav phase 3)
-- Migration 010 — applied on top of 009_page_registry.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 010_nav_entity_bookmarks.sql
--
-- Lets users pin specific portfolios and products into a "Bookmarks"
-- group that sits above all static groups in the sidebar. Reuses the
-- existing pages registry — bookmarks are just rows with kind='entity'.
--
-- New table:
--   page_entity_refs — polymorphic backlink (page → portfolio|product)
--
-- New tag group:
--   bookmarks — display "Bookmarks", default_order = 0, sits above Personal
--
-- Cap change:
--   user_nav_prefs cap raised from 20 → 50 to accommodate entity pins
--   alongside static pinned items. Cap lives in app code (nav.MaxPinned),
--   no schema column to change.
-- ============================================================

BEGIN;

-- ============================================================
-- New tag group: bookmarks
-- Insert with default_order = -1 first, then normalise so bookmarks
-- ends up at 0 and the previously-existing groups shift up by 1.
-- This keeps fresh installs (which apply 009 then 010 sequentially)
-- in the same final state as a hypothetical combined seed.
-- ============================================================
INSERT INTO page_tags (tag_enum, display_name, default_order, is_admin_menu) VALUES
    ('bookmarks', 'Bookmarks', -1, FALSE);

UPDATE page_tags SET default_order = default_order + 1
  WHERE tag_enum != 'bookmarks';

UPDATE page_tags SET default_order = 0
  WHERE tag_enum = 'bookmarks';

-- ============================================================
-- TABLE: page_entity_refs
-- One-to-one with pages.id for kind='entity' rows. Polymorphic FK
-- pattern (entity_kind + entity_id) — same shape as entity_stakeholders
-- in 004. The application is responsible for ensuring entity_id
-- references a real row of the named kind.
--
-- UNIQUE (entity_kind, entity_id) means we get one shared pages row
-- per real-world entity, even if many users bookmark it. Each user
-- still has their own user_nav_prefs row pointing at the same page.
-- ============================================================
CREATE TABLE page_entity_refs (
    page_id      UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    entity_kind  TEXT NOT NULL CHECK (entity_kind IN ('portfolio', 'product')),
    entity_id    UUID NOT NULL,
    UNIQUE (entity_kind, entity_id)
);

CREATE INDEX idx_page_entity_refs_lookup ON page_entity_refs(entity_kind, entity_id);

COMMIT;
