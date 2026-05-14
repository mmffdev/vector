-- RF1.4.2.users (Wave A — user_* nav/prefs/pages tables).
-- Auth core (roles, permissions, sessions, password_resets, roles_*)
-- is in a follow-up commit (Wave B) — those are high-risk and warrant
-- a focused round.
--
-- This wave: user_nav_prefs, user_nav_profiles, user_nav_groups,
-- user_nav_profile_groups, user_tab_order, user_custom_pages,
-- user_custom_page_views.
-- Table-name pluralise only; column-prefix on these tables also
-- deferred to a follow-up to keep the rename-then-bake cycle tight.
BEGIN;

ALTER TABLE user_nav_prefs           RENAME TO users_nav_prefs;
ALTER TABLE user_nav_profiles        RENAME TO users_nav_profiles;
ALTER TABLE user_nav_groups          RENAME TO users_nav_groups;
ALTER TABLE user_nav_profile_groups  RENAME TO users_nav_profile_groups;
ALTER TABLE user_tab_order           RENAME TO users_tab_order;
ALTER TABLE user_custom_pages        RENAME TO users_custom_pages;
ALTER TABLE user_custom_page_views   RENAME TO users_custom_page_views;

COMMIT;
