-- ============================================================
-- MMFFDev - Vector: Icon catalogue + per-subscription item-type icon map
-- Migration 067
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 067_icon_catalogue.sql
--
-- Two tables:
--
--   vector_icons
--     Global catalogue of every icon available in the UI. No subscription_id.
--     Seeded at deploy time with Vector's built-in defaults.
--     pack:  react-icons sub-pack identifier (fa6 | md | bs | tb | ri)
--     name:  the export name from that pack (e.g. MdOutlineBugReport)
--     label: human-readable display name for padmin picker UI
--
--   subscription_item_type_icons
--     Per-subscription override: padmin selects an icon for each item_type.
--     item_type: text discriminator matching o_artefacts_execution_work_items.item_type
--                CHECK in (epic | story | task | defect)
--     Falls back to vector_icons WHERE is_default = TRUE for the item_type
--     when no override row exists.
--
-- Onboarding behaviour:
--   vector_icons is seeded once globally (this migration).
--   subscription_item_type_icons rows are written during workspace onboarding
--   (not in this migration — deferred to onboarding flow).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Global icon catalogue
-- ============================================================

CREATE TABLE vector_icons (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pack        TEXT        NOT NULL,
    name        TEXT        NOT NULL,
    label       TEXT        NOT NULL,
    is_default  BOOL        NOT NULL DEFAULT FALSE,
    default_for TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT vi_pack_valid CHECK (pack IN ('fa6','md','bs','tb','ri')),
    CONSTRAINT vi_name_nonempty CHECK (length(btrim(name)) > 0),
    CONSTRAINT vi_label_nonempty CHECK (length(btrim(label)) > 0),
    CONSTRAINT vi_pack_name_unique UNIQUE (pack, name),
    CONSTRAINT vi_default_for_valid CHECK (
        default_for IS NULL OR
        default_for IN ('epic','story','task','defect')
    )
);

-- At most one default icon per item type
CREATE UNIQUE INDEX idx_vi_default_for
    ON vector_icons (default_for)
    WHERE is_default = TRUE AND default_for IS NOT NULL;

-- Fast lookup by pack
CREATE INDEX idx_vi_pack ON vector_icons (pack);

-- ============================================================
-- 2. Per-subscription item-type icon overrides
-- ============================================================

CREATE TABLE subscription_item_type_icons (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    item_type       TEXT        NOT NULL,
    icon_id         UUID        NOT NULL REFERENCES vector_icons(id) ON DELETE RESTRICT,
    set_by          UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT siti_item_type_valid CHECK (
        item_type IN ('epic','story','task','defect')
    ),
    CONSTRAINT siti_sub_type_unique UNIQUE (subscription_id, item_type)
);

CREATE INDEX idx_siti_sub ON subscription_item_type_icons (subscription_id);

CREATE TRIGGER trg_siti_updated_at
    BEFORE UPDATE ON subscription_item_type_icons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. Seed Vector default icons
--    These are the four work-item type defaults chosen in design.
--    Additional icons can be added to vector_icons at any time
--    for the padmin picker to offer; this seeds only defaults.
-- ============================================================

INSERT INTO vector_icons (pack, name, label, is_default, default_for) VALUES
    ('md', 'MdOutlineCreateNewFolder', 'Epic',      TRUE, 'epic'),
    ('md', 'MdOutlineFolder',          'Story',     TRUE, 'story'),
    ('md', 'MdChecklist',              'Task',      TRUE, 'task'),
    ('md', 'MdOutlineBugReport',       'Defect',    TRUE, 'defect');

COMMIT;
