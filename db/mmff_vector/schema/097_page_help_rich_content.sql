-- ============================================================
-- MMFFDev - Vector: Page help rich content (PLA-0008 / 00323)
-- Migration 097
--
-- Extends page_help (created in 075) with the three columns the
-- Page Help Library MVP needs beyond a single body_html:
--
--   title         — optional display heading shown above the body
--                   in the popover and as the <h1> on /help/<id>.
--   video_embeds  — ordered JSON array of YouTube embeds.
--                   Each element: {url, title?, position}.
--                   Validated app-side: only youtube.com / youtu.be
--                   URLs are accepted (XSS surface).
--   image_urls    — ordered JSON array of image references.
--                   Each element: {url, alt?, caption?, position}.
--                   Validated app-side: http/https only.
--
-- Rationale for JSONB over sidecar tables:
--   - Help docs are read-heavy, low-volume, and always loaded as a
--     single bundle for one addressable. The N+1 cost of joining
--     two child tables for every panel popover open is not worth
--     the relational tidiness.
--   - The ordering + per-element metadata is small and stable;
--     no cross-document queries need to filter on these fields.
--   - Both columns default to '[]'::jsonb so existing rows stay
--     valid without backfill.
--
-- All other fields the plan called for already exist in 075:
--   body_html, locale, updated_at, updated_by_user_id, soft_archived,
--   seeded_from, library_ref, addressable_id FK, updated_at trigger.
--
-- This migration is additive and safe to run on a populated table.
-- ============================================================

BEGIN;

ALTER TABLE page_help
    ADD COLUMN IF NOT EXISTS title         TEXT,
    ADD COLUMN IF NOT EXISTS video_embeds  JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS image_urls    JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE library_help_defaults
    ADD COLUMN IF NOT EXISTS title         TEXT,
    ADD COLUMN IF NOT EXISTS video_embeds  JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS image_urls    JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
