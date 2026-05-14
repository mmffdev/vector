-- ============================================================
-- Add colour column to artefact_types
-- Stores a CSS hex colour (e.g. #3B82F6) used as the type-tag
-- background in the UI. NULL = system default token.
-- Validated by the application on write (7-char #RRGGBB only).
-- ============================================================

BEGIN;

ALTER TABLE artefact_types
    ADD COLUMN colour TEXT
        CHECK (colour IS NULL OR colour ~ '^#[0-9A-Fa-f]{6}$');

COMMENT ON COLUMN artefact_types.colour IS
    'CSS hex colour for the type tag background (e.g. #3B82F6). NULL = system default.';

COMMIT;
