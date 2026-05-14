-- ============================================================
-- MMFFDev - Vector: item_labels and item_tags junction tables
-- Migration 045 — applied on top of 044_defects.sql
--
-- Relational label and tag storage for all item types.
-- Both tables use an entity_kind discriminator so a single
-- table pair serves portfolio_items, user_stories, defects,
-- and any future item type without schema changes.
--
-- item_labels: display/classification labels (e.g. "backend", "auth")
-- item_tags:   taxonomy tags (e.g. "infrastructure", "growth")
--
-- Junction design chosen over JSONB columns to enable indexed
-- lookups: "find all items with label X" is a simple indexed scan.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. item_labels
-- One row per (item, label) pair.
-- ============================================================
CREATE TABLE item_labels (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    item_id         UUID        NOT NULL,
    item_kind       TEXT        NOT NULL,   -- 'portfolio_item', 'user_story', 'defect'
    label           TEXT        NOT NULL CHECK (length(label) > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT item_labels_unique UNIQUE (subscription_id, item_id, item_kind, label)
);

CREATE INDEX idx_item_labels_item        ON item_labels(item_id, item_kind);
CREATE INDEX idx_item_labels_label_scan  ON item_labels(subscription_id, item_kind, label);

-- ============================================================
-- 2. item_tags
-- One row per (item, tag) pair. Same shape as item_labels.
-- ============================================================
CREATE TABLE item_tags (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    item_id         UUID        NOT NULL,
    item_kind       TEXT        NOT NULL,   -- 'portfolio_item', 'user_story', 'defect'
    tag             TEXT        NOT NULL CHECK (length(tag) > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT item_tags_unique UNIQUE (subscription_id, item_id, item_kind, tag)
);

CREATE INDEX idx_item_tags_item       ON item_tags(item_id, item_kind);
CREATE INDEX idx_item_tags_tag_scan   ON item_tags(subscription_id, item_kind, tag);

COMMIT;
