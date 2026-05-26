-- DOWN counterpart of 118_p2_add_all_fks.sql
--
-- Drops every FK constraint installed by the up. Constraint names
-- match the up exactly. ALTER TABLE ... DROP CONSTRAINT IF EXISTS
-- keeps this resilient to partial roll-forwards.

BEGIN;

-- FKs to subscriptions
ALTER TABLE public.admin_api_keys             DROP CONSTRAINT IF EXISTS admin_api_keys_id_subscription_fkey;
ALTER TABLE public.cost_centres               DROP CONSTRAINT IF EXISTS cost_centres_id_subscription_fkey;
ALTER TABLE public.master_record_workspaces   DROP CONSTRAINT IF EXISTS master_record_workspaces_id_subscription_fkey;
ALTER TABLE public.notifications_outbox       DROP CONSTRAINT IF EXISTS notifications_outbox_notifications_outbox_id_subscription_fkey;
ALTER TABLE public.pages                       DROP CONSTRAINT IF EXISTS pages_id_subscription_fkey;
ALTER TABLE public.subscriptions_sequence     DROP CONSTRAINT IF EXISTS subscription_sequence_subscription_id_fkey;
ALTER TABLE public.subscriptions_stakeholders DROP CONSTRAINT IF EXISTS entity_stakeholders_subscription_id_fkey;
ALTER TABLE public.users                       DROP CONSTRAINT IF EXISTS users_id_subscription_fkey;
ALTER TABLE public.users_custom_pages         DROP CONSTRAINT IF EXISTS users_custom_pages_id_subscription_fkey;
ALTER TABLE public.users_mentions             DROP CONSTRAINT IF EXISTS users_mentions_users_mentions_id_subscription_fkey;
ALTER TABLE public.users_nav_prefs            DROP CONSTRAINT IF EXISTS users_nav_prefs_id_subscription_fkey;
ALTER TABLE public.users_nav_profiles         DROP CONSTRAINT IF EXISTS users_nav_profiles_id_subscription_fkey;
ALTER TABLE public.users_notification_rules   DROP CONSTRAINT IF EXISTS users_notification_rules_users_notification_rules_id_subsc_fkey;
ALTER TABLE public.users_notifications        DROP CONSTRAINT IF EXISTS users_notifications_users_notifications_id_subscription_fkey;
ALTER TABLE public.users_roles                 DROP CONSTRAINT IF EXISTS users_roles_id_subscription_fkey;
ALTER TABLE public.users_roles_workspaces     DROP CONSTRAINT IF EXISTS users_roles_workspaces_id_subscription_fkey;
ALTER TABLE public.users_tab_order            DROP CONSTRAINT IF EXISTS users_tab_order_id_subscription_fkey;

-- FKs to users
ALTER TABLE public.admin_api_keys             DROP CONSTRAINT IF EXISTS admin_api_keys_id_user_creator_fkey;
ALTER TABLE public.master_record_workspaces   DROP CONSTRAINT IF EXISTS master_record_workspaces_id_user_archived_by_fkey;
ALTER TABLE public.master_record_workspaces   DROP CONSTRAINT IF EXISTS master_record_workspaces_id_user_created_by_fkey;
ALTER TABLE public.notifications_outbox       DROP CONSTRAINT IF EXISTS notifications_outbox_notifications_outbox_id_user_recipien_fkey;
ALTER TABLE public.pages                       DROP CONSTRAINT IF EXISTS pages_id_user_creator_fkey;
ALTER TABLE public.pages_help                  DROP CONSTRAINT IF EXISTS pages_help_id_user_updater_fkey;
ALTER TABLE public.subscriptions_stakeholders DROP CONSTRAINT IF EXISTS entity_stakeholders_user_id_fkey;
ALTER TABLE public.users_custom_pages         DROP CONSTRAINT IF EXISTS users_custom_pages_id_user_fkey;
ALTER TABLE public.users_mentions             DROP CONSTRAINT IF EXISTS users_mentions_users_mentions_id_user_author_fkey;
ALTER TABLE public.users_mentions             DROP CONSTRAINT IF EXISTS users_mentions_users_mentions_id_user_mentioned_fkey;
ALTER TABLE public.users_nav_groups           DROP CONSTRAINT IF EXISTS users_nav_groups_id_user_fkey;
ALTER TABLE public.users_nav_prefs            DROP CONSTRAINT IF EXISTS users_nav_prefs_id_user_fkey;
ALTER TABLE public.users_nav_profiles         DROP CONSTRAINT IF EXISTS users_nav_profiles_id_user_fkey;
ALTER TABLE public.users_notification_rules   DROP CONSTRAINT IF EXISTS users_notification_rules_users_notification_rules_id_user_fkey;
ALTER TABLE public.users_notifications        DROP CONSTRAINT IF EXISTS users_notifications_users_notifications_id_user_fkey;
ALTER TABLE public.users_notifications_prefs  DROP CONSTRAINT IF EXISTS users_notifications_prefs_users_notifications_prefs_id_use_fkey;
ALTER TABLE public.users_password_resets      DROP CONSTRAINT IF EXISTS users_password_resets_id_user_fkey;
ALTER TABLE public.users_reauth_nonces        DROP CONSTRAINT IF EXISTS users_reauth_nonces_users_reauth_nonces_id_user_fkey;
ALTER TABLE public.users_roles                 DROP CONSTRAINT IF EXISTS users_roles_id_user_created_by_fkey;
ALTER TABLE public.users_roles_permissions    DROP CONSTRAINT IF EXISTS users_roles_permissions_id_user_granted_by_fkey;
ALTER TABLE public.users_roles_workspaces     DROP CONSTRAINT IF EXISTS users_roles_workspaces_id_user_fkey;
ALTER TABLE public.users_roles_workspaces     DROP CONSTRAINT IF EXISTS users_roles_workspaces_id_user_granted_by_fkey;
ALTER TABLE public.users_roles_workspaces     DROP CONSTRAINT IF EXISTS users_roles_workspaces_id_user_revoked_by_fkey;
ALTER TABLE public.users_sessions             DROP CONSTRAINT IF EXISTS users_sessions_id_user_fkey;
ALTER TABLE public.users_tab_order            DROP CONSTRAINT IF EXISTS users_tab_order_id_user_fkey;

-- Other intra-cluster FKs
ALTER TABLE public.users                       DROP CONSTRAINT IF EXISTS users_id_active_nav_profile_fkey;
ALTER TABLE public.users                       DROP CONSTRAINT IF EXISTS users_id_cost_centre_fkey;
ALTER TABLE public.users                       DROP CONSTRAINT IF EXISTS users_id_role_fkey;
ALTER TABLE public.cost_centres               DROP CONSTRAINT IF EXISTS cost_centres_id_parent_fkey;
ALTER TABLE public.page_entity_refs           DROP CONSTRAINT IF EXISTS page_entity_refs_id_page_fkey;
ALTER TABLE public.pages                       DROP CONSTRAINT IF EXISTS pages_tag_enum_fkey;
ALTER TABLE public.pages_addressables         DROP CONSTRAINT IF EXISTS pages_addressables_id_parent_fkey;
ALTER TABLE public.pages_help                  DROP CONSTRAINT IF EXISTS pages_help_id_library_help_default_fkey;
ALTER TABLE public.pages_help                  DROP CONSTRAINT IF EXISTS pages_help_id_pages_addressable_fkey;
ALTER TABLE public.users_custom_page_views    DROP CONSTRAINT IF EXISTS users_custom_page_views_id_page_fkey;
ALTER TABLE public.users_nav_prefs            DROP CONSTRAINT IF EXISTS users_nav_prefs_id_group_fkey;
ALTER TABLE public.users_nav_prefs            DROP CONSTRAINT IF EXISTS users_nav_prefs_id_profile_fkey;
ALTER TABLE public.users_nav_profile_groups   DROP CONSTRAINT IF EXISTS users_nav_profile_groups_id_group_fkey;
ALTER TABLE public.users_nav_profile_groups   DROP CONSTRAINT IF EXISTS users_nav_profile_groups_id_profile_fkey;
ALTER TABLE public.users_nav_profile_groups   DROP CONSTRAINT IF EXISTS users_nav_profile_groups_tag_enum_fkey;
ALTER TABLE public.users_notifications        DROP CONSTRAINT IF EXISTS users_notifications_users_notifications_id_outbox_fkey;
ALTER TABLE public.users_notifications        DROP CONSTRAINT IF EXISTS users_notifications_users_notifications_id_rule_fkey;
ALTER TABLE public.users_roles_pages          DROP CONSTRAINT IF EXISTS users_roles_pages_id_page_fkey;
ALTER TABLE public.users_roles_pages          DROP CONSTRAINT IF EXISTS users_roles_pages_id_role_fkey;
ALTER TABLE public.users_roles_permissions    DROP CONSTRAINT IF EXISTS users_roles_permissions_id_permission_fkey;
ALTER TABLE public.users_roles_permissions    DROP CONSTRAINT IF EXISTS users_roles_permissions_id_role_fkey;
ALTER TABLE public.users_roles_workspaces     DROP CONSTRAINT IF EXISTS users_roles_workspaces_id_workspace_fkey;

COMMIT;
