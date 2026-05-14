-- ============================================================
-- 075 — page_help + library_help_defaults
--
-- Help bodies move off the string paneId key (table 071) and onto
-- the addressable UUID from page_addressables (table 074). One
-- page_help row per (addressable_id, locale) live tuple.
--
-- library_help_defaults provides canonical help copy seeded into
-- page_help on first registration of an addressable, keyed by
-- (kind, name_pattern, locale). When a build/runtime register call
-- creates a new addressable row, the addressables service looks up
-- the longest matching name_pattern for the kind+locale and stamps
-- the body into page_help with seeded_from='library' and
-- library_ref pointing at the source row.
--
-- Library churn does NOT auto-propagate: once page_help has a row,
-- it is independent until an editor explicitly resets it. This is
-- the "lazy library seed" rule from the plan.
--
-- ON DELETE RESTRICT on the addressable FK is deliberate: page_help
-- rows must be soft_archived first so we never lose authored copy
-- when a registry row is GC'd by mistake.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS library_help_defaults (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT        NOT NULL,
    name_pattern    TEXT        NOT NULL,
    locale          TEXT        NOT NULL DEFAULT 'en',
    body_html       TEXT        NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS library_help_defaults_lookup
    ON library_help_defaults (kind, name_pattern, locale);

CREATE TABLE IF NOT EXISTS page_help (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    addressable_id      UUID        NOT NULL REFERENCES page_addressables(id) ON DELETE RESTRICT,
    locale              TEXT        NOT NULL DEFAULT 'en',
    body_html           TEXT        NOT NULL DEFAULT '',
    seeded_from         TEXT        CHECK (seeded_from IN ('library', 'manual', 'sdk_manifest')),
    library_ref         UUID        REFERENCES library_help_defaults(id) ON DELETE SET NULL,
    soft_archived       BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live (addressable, locale) tuple at a time; archived rows don't block re-creation.
CREATE UNIQUE INDEX IF NOT EXISTS page_help_addressable_locale
    ON page_help (addressable_id, locale)
    WHERE soft_archived = FALSE;

-- Read path for /api/page-help/:addressable_id (single-addressable resolve).
CREATE INDEX IF NOT EXISTS page_help_addressable_idx
    ON page_help (addressable_id)
    WHERE soft_archived = FALSE;

-- updated_at triggers
CREATE OR REPLACE FUNCTION page_help_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_help_updated_at ON page_help;
CREATE TRIGGER page_help_updated_at
    BEFORE UPDATE ON page_help
    FOR EACH ROW EXECUTE FUNCTION page_help_set_updated_at();

DROP TRIGGER IF EXISTS library_help_defaults_updated_at ON library_help_defaults;
CREATE TRIGGER library_help_defaults_updated_at
    BEFORE UPDATE ON library_help_defaults
    FOR EACH ROW EXECUTE FUNCTION page_help_set_updated_at();

-- ============================================================
-- Seed canonical defaults for the three first-class kinds.
-- name_pattern '*' is the wildcard (longest-match wins at lookup).
-- Per-kind specific patterns can be inserted later by the gadmin
-- editor (story 00253) without altering this seed.
-- ============================================================
INSERT INTO library_help_defaults (kind, name_pattern, locale, body_html) VALUES
    ('panel',      '*', 'en',
     '<p>This panel groups related controls and information for the surrounding section. Hover any element to see its address; click the help hexagon to open this popover.</p>'),
    ('table',      '*', 'en',
     '<p>This table lists records you can sort, filter, and act on. Column headers sort; row actions appear in the rightmost column or via right-click.</p>'),
    ('navigation', '*', 'en',
     '<p>This navigation block lets you move between sections. Pinned items render above custom navigation; drag to reorder in your preferences.</p>')
ON CONFLICT (kind, name_pattern, locale) DO NOTHING;

COMMIT;
