-- DOWN for migration 103 (PLA-0008 / 00325).
--
-- Restore the original three-value CHECK on page_help.seeded_from.
-- WARNING: any rows inserted with seeded_from='placeholder' must be
-- reseeded or deleted before this DOWN can apply (the new CHECK will
-- reject them).

BEGIN;

ALTER TABLE page_help
    DROP CONSTRAINT IF EXISTS page_help_seeded_from_check;

ALTER TABLE page_help
    ADD CONSTRAINT page_help_seeded_from_check
    CHECK (seeded_from IN ('library', 'manual', 'sdk_manifest'));

COMMIT;
