-- ============================================================
-- 161_rehome_value_sprint_add_review_DOWN.sql
--
-- Reverse of 161_rehome_value_sprint_add_review.sql.
--   (1) Drop the role grants for 'value-sprint-review'.
--   (2) Delete the 'value-sprint-review' page row.
--   (3) Restore 'value-sprint' to pages_tag_enum='value' with its
--       original pages_default_order=1 (the literal seeded by
--       mmff_vector/schema/245_value_nav_bucket.sql line 41).
--
-- DATE:   2026-05-29
-- AUTHOR: Claude on behalf of MMFFDev
-- ============================================================

BEGIN;

-- ── 1. Drop role grants for the system 'value-sprint-review' page. ──
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
    SELECT pages_id FROM pages
     WHERE pages_key_enum        = 'value-sprint-review'
       AND pages_id_subscription IS NULL
       AND pages_id_user_creator IS NULL
 );

-- ── 2. Remove pinned rows referencing this key (item_key is text, not FK). ──
DELETE FROM users_nav_pinned
 WHERE users_nav_pinned_item_key = 'value-sprint-review';

-- ── 3. Delete the 'value-sprint-review' page row. ─────────────────────
DELETE FROM pages
 WHERE pages_key_enum        = 'value-sprint-review'
   AND pages_id_subscription IS NULL
   AND pages_id_user_creator IS NULL;

-- ── 4. Restore 'value-sprint' to its original bucket + order. ─────────
--     Original literal values from migration 245 line 41:
--       pages_tag_enum = 'value', pages_default_order = 1.
UPDATE pages
   SET pages_tag_enum      = 'value',
       pages_default_order = 1
 WHERE pages_key_enum         = 'value-sprint'
   AND pages_id_subscription  IS NULL
   AND pages_id_user_creator  IS NULL;

COMMIT;
