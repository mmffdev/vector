-- ============================================================
-- MMFFDev - Vector: Rollback for migration 097 (PLA-0008 / 00323)
--
-- Drops the three rich-content columns added in 097 from both
-- page_help and library_help_defaults. Data in these columns is
-- lost; titles, video embeds, and image lists revert to a
-- body_html-only world.
--
-- Safe to run after 097 even if rows have been written, but the
-- caller is responsible for accepting that loss.
-- ============================================================

BEGIN;

ALTER TABLE page_help
    DROP COLUMN IF EXISTS image_urls,
    DROP COLUMN IF EXISTS video_embeds,
    DROP COLUMN IF EXISTS title;

ALTER TABLE library_help_defaults
    DROP COLUMN IF EXISTS image_urls,
    DROP COLUMN IF EXISTS video_embeds,
    DROP COLUMN IF EXISTS title;

COMMIT;
