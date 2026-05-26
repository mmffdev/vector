-- ============================================================
-- 262_subscriptions_column_prefix_RF1_5_6.sql
--
-- RF1.5.6 — Pillar 1 wave 5, table 2/2 (mmff_vector side).
--
-- Applies the §2.3 column-prefix convention to mmff_vector.subscriptions
-- (the tenant/subscription registry — holds 93 live rows; FK target
-- for ~17 inbound tables; the canonical tenant-boundary table).
--
-- PK becomes <table>_id per §2.4. All other columns get the
-- standard <table>_<col> prefix.
--
-- Inbound FKs from many tables all reference subscriptions(id) and
-- auto-retarget by Postgres on PK column rename (FKs track column
-- oid, not name). Among those:
--   admin_api_keys.admin_api_keys_id_subscription
--   cost_centres.cost_centres_id_subscription
--   master_record_workspaces.master_record_workspaces_id_subscription
--   subscriptions_stakeholders.subscriptions_stakeholders_id_subscription
--   subscriptions_sequence.subscriptions_sequence_id_subscription
--   notifications_outbox.notifications_outbox_id_subscription
--   pages.pages_id_subscription (renamed in 261 — same wave)
--   users_custom_pages.users_custom_pages_id_subscription
--   users_mentions.users_mentions_id_subscription
--   users_nav_prefs.users_nav_prefs_id_subscription
--   users_nav_profiles.users_nav_profiles_id_subscription
--   users_notification_rules.users_notification_rules_id_subscription
--   users_notifications.users_notifications_id_subscription
--   users_roles.users_roles_id_subscription
--   users_roles_workspaces.users_roles_workspaces_id_subscription
--   users.subscription_id  (NOT YET RENAMED — `users` is wave 6;
--                           the bare column on users keeps its
--                           shape here and auto-retargets to the
--                           new PK column oid.)
--   users_tab_order.users_tab_order_id_subscription
-- All retarget by oid, no FK constraints need rewriting.
--
-- Trigger `trg_subscriptions_updated_at` currently calls the shared
-- `set_updated_at()` function; trigger-function repair happens in
-- migration 263 in this same wave.
-- ============================================================

BEGIN;

-- ---- Column renames ----

ALTER TABLE subscriptions RENAME COLUMN id         TO subscriptions_id;
ALTER TABLE subscriptions RENAME COLUMN name       TO subscriptions_name;
ALTER TABLE subscriptions RENAME COLUMN slug       TO subscriptions_slug;
ALTER TABLE subscriptions RENAME COLUMN is_active  TO subscriptions_is_active;
ALTER TABLE subscriptions RENAME COLUMN created_at TO subscriptions_created_at;
ALTER TABLE subscriptions RENAME COLUMN updated_at TO subscriptions_updated_at;
ALTER TABLE subscriptions RENAME COLUMN tier       TO subscriptions_tier;

-- ---- Index renames ----

-- subscriptions_pkey already matches the <table>_pkey convention.
-- subscriptions_slug_key already matches the <table>_<col>_key
-- convention — left untouched (Postgres' default unique-constraint
-- index naming).

-- ---- Constraint renames ----

ALTER TABLE subscriptions
    RENAME CONSTRAINT subscriptions_tier_check
                  TO subscriptions_tier_chk;

-- subscriptions_slug_key (UNIQUE) already matches convention.

COMMIT;
