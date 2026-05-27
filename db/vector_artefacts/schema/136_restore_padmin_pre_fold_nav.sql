-- ============================================================
-- 136_restore_padmin_pre_fold_nav.sql
--
-- Restore padmin@mmffdev.com's user-created custom pages, nav
-- profiles, profile groups, and bookmarks that did not survive
-- the Pillar-2 fold (2026-05-26) from the mmff_vector DB into
-- vector_artefacts.
--
-- Source of truth: backup MMFFDev - Vector Assets/db-backups/
--                  mmff_vector_20260513_053809.dump
--                  (restored to scratch DB on 2026-05-28 for
--                   forensic extraction).
--
-- Scope (padmin user_id = 6cabe266-b2f4-43f9-879c-06020c789a0b):
--   1. users_custom_pages    — 3 rows (Megans Test Page 001/002/003)
--   2. users_nav_profiles    — 3 rows (Themes, Megans Group, New Group)
--                              The old Default profile is NOT re-inserted;
--                              padmin already has a fresh Default
--                              (cf5a76fb-…) seeded by the fold.
--   3. users_nav_profile_groups — 12 rows (4 tag-based groups per profile:
--                                bookmarks, personal, planning, strategic)
--   4. users_nav_prefs       — 40 rows total across the 3 profiles,
--                              filtered to drop 8 stale item_keys whose
--                              pages no longer exist post-fold:
--                                planning/sprints, planning/releases,
--                                topology, user-management, workspace-admin,
--                                ws-organisation.
--                              The 2 favourites-parented rows
--                              (custom:0980b2ae… and custom:df41f0d9…)
--                              are inserted with is_bookmark = TRUE,
--                              re-linking the 2 bookmarks to the restored
--                              custom pages.
--
-- ORIGINAL UUIDS PRESERVED to keep the bookmarks (which reference
-- custom:<page_uuid> as item_key) pointing at the right pages.
-- All target UUIDs were pre-flighted against live and found absent.
--
-- IDEMPOTENCY:
--   Every INSERT uses ON CONFLICT DO NOTHING. Re-apply is safe.
--
-- ROLLBACK:
--   See db/vector_artefacts/schema/down/136_restore_padmin_pre_fold_nav.sql
--
-- TD register:
--   No TD entry — this is a clean restore, not a workaround.
--   The underlying PLA064 fold gap (user-content migration was not
--   carried over for user_custom_pages / user_nav_profiles /
--   user_nav_profile_groups / user_nav_prefs) is a separate finding;
--   if other users were affected, a follow-up audit + restore is
--   needed before that data ages out beyond the 2026-05-13 backup
--   window.
-- ============================================================

BEGIN;

-- ---- 1. Custom pages (parent of bookmark item_keys) ----

INSERT INTO users_custom_pages (
    users_custom_pages_id,
    users_custom_pages_id_user,
    users_custom_pages_id_subscription,
    users_custom_pages_label,
    users_custom_pages_icon,
    users_custom_pages_created_at,
    users_custom_pages_updated_at
) VALUES
    ('19f62bcc-82c0-44b2-b878-388041ff7b5d', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', 'Megans Test Page 001', 'folder', '2026-04-28 08:47:42.924883+00', '2026-04-28 08:47:42.924883+00'),
    ('0980b2ae-c2e0-44cd-be16-05f156ded545', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', 'Megans Test Page 002', 'folder', '2026-04-28 08:48:01.621157+00', '2026-04-28 08:48:01.621157+00'),
    ('df41f0d9-ed1d-43bf-8cbe-c36cfb789380', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', 'Megans Test Page 003', 'folder', '2026-04-28 08:48:06.354794+00', '2026-04-28 08:48:06.354794+00')
ON CONFLICT (users_custom_pages_id) DO NOTHING;

-- ---- 2. Nav profiles (Themes, Megans Group, New Group) ----
-- Default profile is NOT re-inserted (live cf5a76fb-… is current Default).
-- Position re-numbered to start at 1 to avoid clashing with live position 0.

INSERT INTO users_nav_profiles (
    users_nav_profiles_id,
    users_nav_profiles_id_user,
    users_nav_profiles_id_subscription,
    users_nav_profiles_label,
    users_nav_profiles_position,
    users_nav_profiles_is_default,
    users_nav_profiles_start_page_key,
    users_nav_profiles_created_at,
    users_nav_profiles_updated_at
) VALUES
    ('77df245f-7b05-4d52-90d4-956bd23b1d4f', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', 'Themes',       1, FALSE, NULL, '2026-04-28 06:12:31.199335+00', '2026-04-28 06:12:31.199335+00'),
    ('4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', 'Megans Group', 2, FALSE, NULL, '2026-04-28 08:48:47.439637+00', '2026-04-28 08:48:47.439637+00'),
    ('3b0cd57b-779e-4a96-ac4f-91242286ebcf', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', 'New Group',    3, FALSE, NULL, '2026-05-02 02:05:22.136775+00', '2026-05-02 02:05:22.136775+00')
ON CONFLICT (users_nav_profiles_id) DO NOTHING;

-- ---- 3. Profile groups (tag-enum based) ----

-- Note: users_nav_profile_groups has only deferrable unique constraints,
-- which cannot be used as ON CONFLICT arbiters. We guard with
-- WHERE NOT EXISTS to keep the insert idempotent.
-- Original dump had tag 'strategic' but live vocab uses 'strategy'
-- (verified via pages_tags). Substituted at restore time.

INSERT INTO users_nav_profile_groups (
    users_nav_profile_groups_id_profile,
    users_nav_profile_groups_id_group,
    users_nav_profile_groups_position,
    users_nav_profile_groups_tag_enum,
    users_nav_profile_groups_icon_override
)
SELECT v.profile_id, NULL, v.position, v.tag_enum, NULL
FROM (VALUES
    -- Themes
    ('77df245f-7b05-4d52-90d4-956bd23b1d4f'::uuid, 0, 'bookmarks'),
    ('77df245f-7b05-4d52-90d4-956bd23b1d4f'::uuid, 1, 'personal'),
    ('77df245f-7b05-4d52-90d4-956bd23b1d4f'::uuid, 3, 'planning'),
    ('77df245f-7b05-4d52-90d4-956bd23b1d4f'::uuid, 4, 'strategy'),
    -- Megans Group
    ('4c0505f9-c9dd-47aa-b7d3-030d27d20c0f'::uuid, 0, 'bookmarks'),
    ('4c0505f9-c9dd-47aa-b7d3-030d27d20c0f'::uuid, 1, 'personal'),
    ('4c0505f9-c9dd-47aa-b7d3-030d27d20c0f'::uuid, 3, 'planning'),
    ('4c0505f9-c9dd-47aa-b7d3-030d27d20c0f'::uuid, 4, 'strategy'),
    -- New Group
    ('3b0cd57b-779e-4a96-ac4f-91242286ebcf'::uuid, 0, 'bookmarks'),
    ('3b0cd57b-779e-4a96-ac4f-91242286ebcf'::uuid, 1, 'personal'),
    ('3b0cd57b-779e-4a96-ac4f-91242286ebcf'::uuid, 3, 'planning'),
    ('3b0cd57b-779e-4a96-ac4f-91242286ebcf'::uuid, 4, 'strategy')
) AS v(profile_id, position, tag_enum)
WHERE NOT EXISTS (
    SELECT 1 FROM users_nav_profile_groups upg
    WHERE upg.users_nav_profile_groups_id_profile = v.profile_id
      AND upg.users_nav_profile_groups_tag_enum   = v.tag_enum
);

-- ---- 4. Nav prefs (50 rows across the 3 profiles) ----
-- Stale item_keys dropped: planning/sprints, planning/releases, topology,
-- user-management, workspace-admin, ws-organisation. The 2 favourites-
-- parented bookmarks get is_bookmark=TRUE.

INSERT INTO users_nav_prefs (
    users_nav_prefs_id,
    users_nav_prefs_id_user,
    users_nav_prefs_id_subscription,
    users_nav_prefs_id_profile,
    users_nav_prefs_item_key,
    users_nav_prefs_position,
    users_nav_prefs_is_start_page,
    users_nav_prefs_parent_item_key,
    users_nav_prefs_id_group,
    users_nav_prefs_icon_override,
    users_nav_prefs_is_bookmark
) VALUES
    -- ---- Megans Group (4c0505f9) ----
    ('556e6074-14b8-4f8e-a4a2-035352e4eb8f', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'custom:0980b2ae-c2e0-44cd-be16-05f156ded545',  0, FALSE, 'favourites', NULL, NULL, TRUE),
    ('9ae6ca37-eab7-4acc-8973-4e4eb52c16ec', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'dashboard',                                    0, FALSE, NULL, NULL, NULL, FALSE),
    ('106bcedf-f849-4877-a9a3-e26569920d43', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'custom:df41f0d9-ed1d-43bf-8cbe-c36cfb789380',  1, FALSE, 'favourites', NULL, NULL, TRUE),
    ('467a7c59-cec5-4d46-b666-c67f4b68d8fb', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'my-vista',                                     1, FALSE, NULL, NULL, NULL, FALSE),
    ('7f8e8e69-b682-407c-828e-dc63b3a82469', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'favourites',                                   2, FALSE, NULL, NULL, NULL, FALSE),
    ('115e3f20-cab9-4f79-acee-e0dd696a3b62', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'theme',                                        3, FALSE, NULL, NULL, NULL, FALSE),
    ('e849140b-1a17-414c-9a0e-38b1b14e6aea', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'portfolio-settings',                           4, FALSE, NULL, NULL, NULL, FALSE),
    ('444a4be9-73d1-4732-ac77-b8ae44722024', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'portfolio',                                    5, FALSE, NULL, NULL, NULL, FALSE),
    ('3393faab-cd29-4ac4-ac51-d769b33b8fc1', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'portfolio-items',                              6, FALSE, NULL, NULL, NULL, FALSE),
    ('bd61bf9e-aeec-4257-8a68-c0008f285f76', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'work-items',                                   7, FALSE, NULL, NULL, NULL, FALSE),
    ('67d2b80f-54d1-4a79-b06f-0efe9cdce618', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'planning',                                     8, FALSE, NULL, NULL, NULL, FALSE),
    ('33848cfb-06dc-458b-a323-c5619455f70e', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'backlog',                                      9, FALSE, NULL, NULL, NULL, FALSE),
    ('ef5c90fb-67f1-4979-b060-86f9d5f35908', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'scope',                                       10, FALSE, NULL, NULL, 'clipboard', FALSE),
    ('d12a8a70-ab72-4e34-a139-8afc4ca2ae3b', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'risk',                                        14, FALSE, NULL, NULL, NULL, FALSE),
    ('2fbcd0eb-3107-49c9-9205-d8a51ccbeed5', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'um-permissions',                              17, FALSE, NULL, NULL, NULL, FALSE),
    ('3f6de419-1a47-447b-a3b0-ec5397a098ae', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-artefact-types',                           18, FALSE, NULL, NULL, NULL, FALSE),
    ('25ae4b74-b14b-4995-a8ca-d78c00d7bdb5', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-custom-fields',                            19, FALSE, NULL, NULL, NULL, FALSE),
    ('3ed85cf1-1fb2-44d2-921c-76f6c21548e2', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-flow-states',                              20, FALSE, NULL, NULL, NULL, FALSE),
    ('56f5002c-b632-4b94-87a8-911d92abdab0', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-flow-states-v2',                           21, FALSE, NULL, NULL, NULL, FALSE),
    ('83a79a3b-e75a-40b6-bfe4-5743c08951f0', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-portfolio-model',                          23, FALSE, NULL, NULL, NULL, FALSE),
    ('814aeb0b-77a9-49cf-9405-54ebfced366c', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-transition-rules',                         24, FALSE, NULL, NULL, NULL, FALSE),
    ('09e5c5e0-ec0c-4883-a64a-3e05bcbc2e9a', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f', 'ws-workspaces',                               25, FALSE, NULL, NULL, NULL, FALSE),

    -- ---- Themes (77df245f) ----
    ('a9c166ff-8ef3-4b8c-b640-38aea9581adb', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'portfolio-items',                              0, FALSE, NULL, NULL, NULL, FALSE),
    ('f772d9d3-6f0f-4edf-9718-ce7124fe8b41', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'um-permissions',                               6, FALSE, NULL, NULL, NULL, FALSE),
    ('114322a9-a308-4088-819d-0089c569dd02', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-artefact-types',                            7, FALSE, NULL, NULL, NULL, FALSE),
    ('4d61c312-10f6-41a6-8334-02927ad17de8', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-custom-fields',                             8, FALSE, NULL, NULL, NULL, FALSE),
    ('60477ee4-5925-426f-95e3-1a4a7f520c9f', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-flow-states',                               9, FALSE, NULL, NULL, NULL, FALSE),
    ('74394bdd-0ae8-4053-8711-119079212730', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-flow-states-v2',                           10, FALSE, NULL, NULL, NULL, FALSE),
    ('065180ef-6edf-49bb-ba0a-68e3c3b40372', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-portfolio-model',                          12, FALSE, NULL, NULL, NULL, FALSE),
    ('0554ee1d-a53b-470f-b5f1-1c2f6c22c06e', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-transition-rules',                         13, FALSE, NULL, NULL, NULL, FALSE),
    ('9b97c175-51ec-4b8c-a9f3-106e3fce67b6', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '77df245f-7b05-4d52-90d4-956bd23b1d4f', 'ws-workspaces',                               14, FALSE, NULL, NULL, NULL, FALSE),

    -- ---- New Group (3b0cd57b) ----
    ('683a639a-1ca3-4525-9aed-d517345d22fc', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'portfolio-items',                              0, FALSE, NULL, NULL, NULL, FALSE),
    ('eb2d7f40-8237-46fb-8f24-82af831a60d4', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'um-permissions',                               6, FALSE, NULL, NULL, NULL, FALSE),
    ('3eab6579-f8ae-489e-9229-c8084df94930', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-artefact-types',                            7, FALSE, NULL, NULL, NULL, FALSE),
    ('473281c9-664c-4741-b232-a7c9d7204893', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-custom-fields',                             8, FALSE, NULL, NULL, NULL, FALSE),
    ('e27a42ce-0c61-4508-bb00-a62702d98710', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-flow-states',                               9, FALSE, NULL, NULL, NULL, FALSE),
    ('e97cf8b7-5eb9-4bdf-a186-0e7662840368', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-flow-states-v2',                           10, FALSE, NULL, NULL, NULL, FALSE),
    ('097dc85c-7f57-49f8-b3e6-c6db8547a083', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-portfolio-model',                          12, FALSE, NULL, NULL, NULL, FALSE),
    ('7d68a9f2-90b1-4096-9753-f1de1c56811f', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-transition-rules',                         13, FALSE, NULL, NULL, NULL, FALSE),
    ('3fa42d1d-55f9-46d1-8654-5277e3673183', '6cabe266-b2f4-43f9-879c-06020c789a0b', '00000000-0000-0000-0000-000000000001', '3b0cd57b-779e-4a96-ac4f-91242286ebcf', 'ws-workspaces',                               14, FALSE, NULL, NULL, NULL, FALSE)
ON CONFLICT (users_nav_prefs_id) DO NOTHING;

-- ---- Verification (commented; run manually post-apply) ----
-- SELECT
--   (SELECT COUNT(*) FROM users_custom_pages   WHERE users_custom_pages_id_user='6cabe266-b2f4-43f9-879c-06020c789a0b') AS custom_pages,
--   (SELECT COUNT(*) FROM users_nav_profiles   WHERE users_nav_profiles_id_user='6cabe266-b2f4-43f9-879c-06020c789a0b') AS profiles,
--   (SELECT COUNT(*) FROM users_nav_profile_groups
--      WHERE users_nav_profile_groups_id_profile IN
--        ('77df245f-7b05-4d52-90d4-956bd23b1d4f',
--         '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f',
--         '3b0cd57b-779e-4a96-ac4f-91242286ebcf')) AS profile_groups,
--   (SELECT COUNT(*) FROM users_nav_prefs WHERE users_nav_prefs_id_user='6cabe266-b2f4-43f9-879c-06020c789a0b' AND users_nav_prefs_is_bookmark=TRUE) AS bookmarks;
-- Expected: 3, 4 (incl. live Default), 12, 2

COMMIT;
