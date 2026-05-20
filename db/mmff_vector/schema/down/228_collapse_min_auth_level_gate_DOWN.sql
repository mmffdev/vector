-- Down for migration 228 — restore the tier gate.
--
-- Restores NOT NULL + DEFAULT 3 + CHECK (1..3) on pages_tags_min_auth_level
-- and re-seeds the four admin tags to the values migration 221 set. The
-- code that consumes the column must also be reverted separately.

BEGIN;

-- Re-seed any NULLs back to defaults so NOT NULL can land safely.
UPDATE pages_tags SET pages_tags_min_auth_level = 3
 WHERE pages_tags_min_auth_level IS NULL;

UPDATE pages_tags
   SET pages_tags_min_auth_level = 1
 WHERE pages_tags_tag_enum IN ('vector_admin', 'user_management', 'dev_tools');

UPDATE pages_tags
   SET pages_tags_min_auth_level = 2
 WHERE pages_tags_tag_enum = 'workspace_admin';

ALTER TABLE pages_tags
    ALTER COLUMN pages_tags_min_auth_level SET DEFAULT 3,
    ALTER COLUMN pages_tags_min_auth_level SET NOT NULL,
    ADD CONSTRAINT pages_tags_min_auth_level_check
        CHECK (pages_tags_min_auth_level BETWEEN 1 AND 3);

COMMIT;
