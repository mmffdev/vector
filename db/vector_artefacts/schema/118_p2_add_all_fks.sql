-- ============================================================
-- 118_p2_add_all_fks.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 10 of N. Final migration: install every cross-table
-- FK constraint.
--
-- This migration runs AFTER all 37 tables have landed in VA so it
-- can install FKs without "FK to a table that doesn't exist yet"
-- errors. Each FK below mirrors the corresponding FK on mmff_v
-- with one exception:
--
--   * Constraints landing on the 4 FOLD columns of master_record_workspaces
--     (master_record_workspaces_id_subscription / _id_user_created_by /
--     _id_user_archived_by) are NEW — they target the freshly-folded
--     columns. mmff_v's MRW had these FKs; VA's pre-fold MRW did not
--     (no source columns to FK from). The 1 VA-only orphan row has
--     NULLs on these columns and is implicitly excluded from the
--     constraint check.
--
-- Total: 49 FK constraints. Grouped by target for readability.
-- The trg_subscriptions_stakeholders_dispatch trigger is INTENTIONALLY
-- omitted (see comment in 116).
-- ============================================================

BEGIN;

-- ======================================================================
-- FKs to subscriptions
-- ======================================================================

ALTER TABLE ONLY public.admin_api_keys
    ADD CONSTRAINT admin_api_keys_id_subscription_fkey
    FOREIGN KEY (admin_api_keys_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.cost_centres
    ADD CONSTRAINT cost_centres_id_subscription_fkey
    FOREIGN KEY (cost_centres_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.master_record_workspaces
    ADD CONSTRAINT master_record_workspaces_id_subscription_fkey
    FOREIGN KEY (master_record_workspaces_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_notifications_outbox_id_subscription_fkey
    FOREIGN KEY (notifications_outbox_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id);

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_id_subscription_fkey
    FOREIGN KEY (pages_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.subscriptions_sequence
    ADD CONSTRAINT subscription_sequence_subscription_id_fkey
    FOREIGN KEY (subscriptions_sequence_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.subscriptions_stakeholders
    ADD CONSTRAINT entity_stakeholders_subscription_id_fkey
    FOREIGN KEY (subscriptions_stakeholders_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_subscription_fkey
    FOREIGN KEY (users_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_custom_pages
    ADD CONSTRAINT users_custom_pages_id_subscription_fkey
    FOREIGN KEY (users_custom_pages_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_mentions
    ADD CONSTRAINT users_mentions_users_mentions_id_subscription_fkey
    FOREIGN KEY (users_mentions_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id);

ALTER TABLE ONLY public.users_nav_prefs
    ADD CONSTRAINT users_nav_prefs_id_subscription_fkey
    FOREIGN KEY (users_nav_prefs_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_profiles
    ADD CONSTRAINT users_nav_profiles_id_subscription_fkey
    FOREIGN KEY (users_nav_profiles_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_notification_rules
    ADD CONSTRAINT users_notification_rules_users_notification_rules_id_subsc_fkey
    FOREIGN KEY (users_notification_rules_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id);

ALTER TABLE ONLY public.users_notifications
    ADD CONSTRAINT users_notifications_users_notifications_id_subscription_fkey
    FOREIGN KEY (users_notifications_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id);

ALTER TABLE ONLY public.users_roles
    ADD CONSTRAINT users_roles_id_subscription_fkey
    FOREIGN KEY (users_roles_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_roles_workspaces
    ADD CONSTRAINT users_roles_workspaces_id_subscription_fkey
    FOREIGN KEY (users_roles_workspaces_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_tab_order
    ADD CONSTRAINT users_tab_order_id_subscription_fkey
    FOREIGN KEY (users_tab_order_id_subscription)
    REFERENCES public.subscriptions(subscriptions_id) ON DELETE CASCADE;


-- ======================================================================
-- FKs to users
-- ======================================================================

ALTER TABLE ONLY public.admin_api_keys
    ADD CONSTRAINT admin_api_keys_id_user_creator_fkey
    FOREIGN KEY (admin_api_keys_id_user_creator)
    REFERENCES public.users(users_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.master_record_workspaces
    ADD CONSTRAINT master_record_workspaces_id_user_archived_by_fkey
    FOREIGN KEY (master_record_workspaces_id_user_archived_by)
    REFERENCES public.users(users_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.master_record_workspaces
    ADD CONSTRAINT master_record_workspaces_id_user_created_by_fkey
    FOREIGN KEY (master_record_workspaces_id_user_created_by)
    REFERENCES public.users(users_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_notifications_outbox_id_user_recipien_fkey
    FOREIGN KEY (notifications_outbox_id_user_recipient)
    REFERENCES public.users(users_id);

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_id_user_creator_fkey
    FOREIGN KEY (pages_id_user_creator)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pages_help
    ADD CONSTRAINT pages_help_id_user_updater_fkey
    FOREIGN KEY (pages_help_id_user_updater)
    REFERENCES public.users(users_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.subscriptions_stakeholders
    ADD CONSTRAINT entity_stakeholders_user_id_fkey
    FOREIGN KEY (subscriptions_stakeholders_id_user)
    REFERENCES public.users(users_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_custom_pages
    ADD CONSTRAINT users_custom_pages_id_user_fkey
    FOREIGN KEY (users_custom_pages_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_mentions
    ADD CONSTRAINT users_mentions_users_mentions_id_user_author_fkey
    FOREIGN KEY (users_mentions_id_user_author)
    REFERENCES public.users(users_id);

ALTER TABLE ONLY public.users_mentions
    ADD CONSTRAINT users_mentions_users_mentions_id_user_mentioned_fkey
    FOREIGN KEY (users_mentions_id_user_mentioned)
    REFERENCES public.users(users_id);

ALTER TABLE ONLY public.users_nav_groups
    ADD CONSTRAINT users_nav_groups_id_user_fkey
    FOREIGN KEY (users_nav_groups_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_prefs
    ADD CONSTRAINT users_nav_prefs_id_user_fkey
    FOREIGN KEY (users_nav_prefs_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_profiles
    ADD CONSTRAINT users_nav_profiles_id_user_fkey
    FOREIGN KEY (users_nav_profiles_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_notification_rules
    ADD CONSTRAINT users_notification_rules_users_notification_rules_id_user_fkey
    FOREIGN KEY (users_notification_rules_id_user)
    REFERENCES public.users(users_id);

ALTER TABLE ONLY public.users_notifications
    ADD CONSTRAINT users_notifications_users_notifications_id_user_fkey
    FOREIGN KEY (users_notifications_id_user)
    REFERENCES public.users(users_id);

ALTER TABLE ONLY public.users_notifications_prefs
    ADD CONSTRAINT users_notifications_prefs_users_notifications_prefs_id_use_fkey
    FOREIGN KEY (users_notifications_prefs_id_user)
    REFERENCES public.users(users_id);

ALTER TABLE ONLY public.users_password_resets
    ADD CONSTRAINT users_password_resets_id_user_fkey
    FOREIGN KEY (users_password_resets_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_reauth_nonces
    ADD CONSTRAINT users_reauth_nonces_users_reauth_nonces_id_user_fkey
    FOREIGN KEY (users_reauth_nonces_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_roles
    ADD CONSTRAINT users_roles_id_user_created_by_fkey
    FOREIGN KEY (users_roles_id_user_created_by)
    REFERENCES public.users(users_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users_roles_permissions
    ADD CONSTRAINT users_roles_permissions_id_user_granted_by_fkey
    FOREIGN KEY (users_roles_permissions_id_user_granted_by)
    REFERENCES public.users(users_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users_roles_workspaces
    ADD CONSTRAINT users_roles_workspaces_id_user_fkey
    FOREIGN KEY (users_roles_workspaces_id_user)
    REFERENCES public.users(users_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_roles_workspaces
    ADD CONSTRAINT users_roles_workspaces_id_user_granted_by_fkey
    FOREIGN KEY (users_roles_workspaces_id_user_granted_by)
    REFERENCES public.users(users_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_roles_workspaces
    ADD CONSTRAINT users_roles_workspaces_id_user_revoked_by_fkey
    FOREIGN KEY (users_roles_workspaces_id_user_revoked_by)
    REFERENCES public.users(users_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_id_user_fkey
    FOREIGN KEY (users_sessions_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_tab_order
    ADD CONSTRAINT users_tab_order_id_user_fkey
    FOREIGN KEY (users_tab_order_id_user)
    REFERENCES public.users(users_id) ON DELETE CASCADE;


-- ======================================================================
-- FKs from users (outbound to other tables in the cluster)
-- ======================================================================

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_active_nav_profile_fkey
    FOREIGN KEY (users_id_active_nav_profile)
    REFERENCES public.users_nav_profiles(users_nav_profiles_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_cost_centre_fkey
    FOREIGN KEY (users_id_cost_centre)
    REFERENCES public.cost_centres(cost_centres_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_role_fkey
    FOREIGN KEY (users_id_role)
    REFERENCES public.users_roles(users_roles_id) ON DELETE RESTRICT;


-- ======================================================================
-- FKs to pages / pages_tags / pages_addressables / library_help_defaults
-- (catalogue tables)
-- ======================================================================

ALTER TABLE ONLY public.cost_centres
    ADD CONSTRAINT cost_centres_id_parent_fkey
    FOREIGN KEY (cost_centres_id_parent)
    REFERENCES public.cost_centres(cost_centres_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.page_entity_refs
    ADD CONSTRAINT page_entity_refs_id_page_fkey
    FOREIGN KEY (page_entity_refs_id_page)
    REFERENCES public.pages(pages_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_tag_enum_fkey
    FOREIGN KEY (pages_tag_enum)
    REFERENCES public.pages_tags(pages_tags_tag_enum);

ALTER TABLE ONLY public.pages_addressables
    ADD CONSTRAINT pages_addressables_id_parent_fkey
    FOREIGN KEY (pages_addressables_id_parent)
    REFERENCES public.pages_addressables(pages_addressables_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pages_help
    ADD CONSTRAINT pages_help_id_library_help_default_fkey
    FOREIGN KEY (pages_help_id_library_help_default)
    REFERENCES public.library_help_defaults(library_help_defaults_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.pages_help
    ADD CONSTRAINT pages_help_id_pages_addressable_fkey
    FOREIGN KEY (pages_help_id_pages_addressable)
    REFERENCES public.pages_addressables(pages_addressables_id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.users_custom_page_views
    ADD CONSTRAINT users_custom_page_views_id_page_fkey
    FOREIGN KEY (users_custom_page_views_id_page)
    REFERENCES public.users_custom_pages(users_custom_pages_id) ON DELETE CASCADE;


-- ======================================================================
-- FKs in nav cluster
-- ======================================================================

ALTER TABLE ONLY public.users_nav_prefs
    ADD CONSTRAINT users_nav_prefs_id_group_fkey
    FOREIGN KEY (users_nav_prefs_id_group)
    REFERENCES public.users_nav_groups(users_nav_groups_id) ON DELETE SET NULL;

ALTER TABLE ONLY public.users_nav_prefs
    ADD CONSTRAINT users_nav_prefs_id_profile_fkey
    FOREIGN KEY (users_nav_prefs_id_profile)
    REFERENCES public.users_nav_profiles(users_nav_profiles_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_profile_groups
    ADD CONSTRAINT users_nav_profile_groups_id_group_fkey
    FOREIGN KEY (users_nav_profile_groups_id_group)
    REFERENCES public.users_nav_groups(users_nav_groups_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_profile_groups
    ADD CONSTRAINT users_nav_profile_groups_id_profile_fkey
    FOREIGN KEY (users_nav_profile_groups_id_profile)
    REFERENCES public.users_nav_profiles(users_nav_profiles_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_nav_profile_groups
    ADD CONSTRAINT users_nav_profile_groups_tag_enum_fkey
    FOREIGN KEY (users_nav_profile_groups_tag_enum)
    REFERENCES public.pages_tags(pages_tags_tag_enum) ON DELETE CASCADE;


-- ======================================================================
-- FKs in notifications cluster
-- ======================================================================

ALTER TABLE ONLY public.users_notifications
    ADD CONSTRAINT users_notifications_users_notifications_id_outbox_fkey
    FOREIGN KEY (users_notifications_id_outbox)
    REFERENCES public.notifications_outbox(notifications_outbox_id);

ALTER TABLE ONLY public.users_notifications
    ADD CONSTRAINT users_notifications_users_notifications_id_rule_fkey
    FOREIGN KEY (users_notifications_id_rule)
    REFERENCES public.users_notification_rules(users_notification_rules_id);


-- ======================================================================
-- FKs in roles + workspaces cluster
-- ======================================================================

ALTER TABLE ONLY public.users_roles_pages
    ADD CONSTRAINT users_roles_pages_id_page_fkey
    FOREIGN KEY (users_roles_pages_id_page)
    REFERENCES public.pages(pages_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_roles_pages
    ADD CONSTRAINT users_roles_pages_id_role_fkey
    FOREIGN KEY (users_roles_pages_id_role)
    REFERENCES public.users_roles(users_roles_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_roles_permissions
    ADD CONSTRAINT users_roles_permissions_id_permission_fkey
    FOREIGN KEY (users_roles_permissions_id_permission)
    REFERENCES public.users_permissions(users_permissions_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_roles_permissions
    ADD CONSTRAINT users_roles_permissions_id_role_fkey
    FOREIGN KEY (users_roles_permissions_id_role)
    REFERENCES public.users_roles(users_roles_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.users_roles_workspaces
    ADD CONSTRAINT users_roles_workspaces_id_workspace_fkey
    FOREIGN KEY (users_roles_workspaces_id_workspace)
    REFERENCES public.master_record_workspaces(master_record_workspaces_id) ON DELETE RESTRICT;

COMMIT;
