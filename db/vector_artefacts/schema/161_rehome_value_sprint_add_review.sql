-- ============================================================
-- 161_rehome_value_sprint_add_review.sql
--
-- (1) Move the existing 'value-sprint' page from the 'value' bucket
--     into the 'planning' bucket. Slot it at the end of planning by
--     setting pages_default_order = MAX(planning order) + 1 so it
--     drops after milestones/sprints/releases without colliding.
--
-- (2) Insert a NEW system page 'value-sprint-review' under the
--     'value' bucket at default_order = 1 (filling the gap vacated
--     by value-sprint). Mirrors the shape of the original value
--     bucket seeds in mmff_vector/schema/245_value_nav_bucket.sql
--     translated to the post-fold prefixed-column schema used in
--     vector_artefacts (see 159_milestones_page.sql for the
--     canonical example of the current pages-row INSERT shape).
--
-- DATE:   2026-05-29
-- AUTHOR: Claude on behalf of MMFFDev
--
-- WHY:
--   The Sprint page conceptually belongs with the other planning
--   surfaces (milestones, sprints, releases, backlog). The Value
--   bucket gets a new 'Sprint Review' page in its place to keep
--   the bucket coherent around value-stream / inspect-and-adapt
--   surfaces.
--
-- DB / POOL:
--   vector_artefacts (vaPool) — the pages table was folded into
--   vector_artefacts during the 2026-05-26 three-pillar refactor.
--
-- IDEMPOTENCY:
--   - UPDATE is safe to re-run (sets fields to fixed target values).
--   - INSERT uses the same partial-unique-index ON CONFLICT clause
--     as 159_milestones_page.sql.
--   - Role grants use ON CONFLICT (composite PK) DO NOTHING.
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/161_rehome_value_sprint_add_review_DOWN.sql
--   The DOWN deletes the new value-sprint-review row and restores
--   value-sprint to pages_tag_enum='value', pages_default_order=1
--   (the original literal from migration 245 line 41).
-- ============================================================

BEGIN;

-- ── 1. Move 'value-sprint' from 'value' bucket to 'planning' bucket. ──
--     Slot at end of planning via MAX(order)+1 over current planning rows
--     so it lands after milestones/sprints/releases without hardcoding.
UPDATE pages
   SET pages_tag_enum      = 'planning',
       pages_default_order = (
           SELECT COALESCE(MAX(pages_default_order), 0) + 1
             FROM pages
            WHERE pages_tag_enum = 'planning'
       )
 WHERE pages_key_enum         = 'value-sprint'
   AND pages_id_subscription  IS NULL
   AND pages_id_user_creator  IS NULL;

-- ── 2. Insert the new 'value-sprint-review' system page. ──────────────
--     Mirrors the seed shape used for the original 4 value pages in
--     migration 245, translated to the post-fold pages_* column names.
INSERT INTO pages (
    pages_key_enum,
    pages_label,
    pages_href,
    pages_icon,
    pages_tag_enum,
    pages_kind,
    pages_pinnable,
    pages_default_pinned,
    pages_default_order
) VALUES (
    'value-sprint-review',
    'Sprint Review',
    '/value-sprint-review',
    'sprint',
    'value',
    'static',
    TRUE,
    TRUE,
    1
)
ON CONFLICT (pages_key_enum) WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL DO NOTHING;

-- ── 3. Grant the new page to the same group-roles as the other Value pages.
--     Mirrors the grant pattern in 245 (and the milestones grant in 159).
INSERT INTO users_roles_pages (
    users_roles_pages_id_page,
    users_roles_pages_id_role
)
SELECT
    p.pages_id,
    r.users_roles_id
FROM pages p
CROSS JOIN users_roles r
WHERE p.pages_key_enum         = 'value-sprint-review'
  AND p.pages_id_subscription  IS NULL
  AND p.pages_id_user_creator  IS NULL
  AND r.users_roles_code       IN ('grp_global','grp_portfolio','grp_product','grp_stakeholder','grp_team_lead','grp_team_member')
  AND r.users_roles_is_system  = TRUE
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

COMMIT;
