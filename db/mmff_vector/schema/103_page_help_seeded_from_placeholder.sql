-- ============================================================
-- MMFFDev - Vector: page_help.seeded_from += 'placeholder' (PLA-0008 / 00325)
-- Migration 103
--
-- Extends the seeded_from CHECK on page_help (added in 075) to admit
-- a fourth value: 'placeholder'. Used by the auto-seed fallback in
-- internal/addressables.Service.seedLibraryDefault when no
-- library_help_defaults row matches the addressable's (kind, name) —
-- so every newly registered addressable always carries a discoverable,
-- gadmin-editable help row from the moment it first registers, even
-- when the kind has no library default authored yet.
--
-- Existing values: 'library', 'manual', 'sdk_manifest'. Adding
-- 'placeholder' is additive only — no row rewrites, no defaults
-- changed, no triggers replaced. Existing rows remain valid.
--
-- The constraint is a stand-alone CHECK rather than a generated enum
-- type so future seed-source values can be added without ALTER TYPE
-- chains; this is the same pattern story 00323's 097 used.
-- ============================================================

BEGIN;

ALTER TABLE page_help
    DROP CONSTRAINT IF EXISTS page_help_seeded_from_check;

ALTER TABLE page_help
    ADD CONSTRAINT page_help_seeded_from_check
    CHECK (seeded_from IN ('library', 'manual', 'sdk_manifest', 'placeholder'));

COMMIT;
