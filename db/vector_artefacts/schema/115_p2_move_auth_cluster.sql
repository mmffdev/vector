-- ============================================================
-- 115_p2_move_auth_cluster.sql
--
-- Pillar 2 (cross-DB merge: mmff_vector → vector_artefacts) —
-- migration 7 of N. Auth + notification surface tables.
--
-- Tables in scope (in safe-order):
--   1. users_password_resets     (5 rows; FK users)
--   2. users_reauth_nonces       (4 rows; FK users)
--   3. users_notification_rules  (1 row; FK users + subscriptions)
--   4. notifications_outbox     (12 rows; FK users + subscriptions;
--                                         AFTER INSERT trigger fires
--                                         pg_notify channel)
--   5. users_notifications      (12 rows; FK outbox + rules + users
--                                         + subscriptions)
--   6. users_notifications_prefs (0 rows; FK users)
--   7. users_mentions            (0 rows; FK users + subscriptions)
--
-- FK constraints deferred to 118_p2_add_all_fks.sql.
-- ============================================================

BEGIN;

-- ======================================================================
-- TABLE 1: users_password_resets
-- ======================================================================

CREATE TABLE public.users_password_resets (
    users_password_resets_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_password_resets_id_user uuid NOT NULL,
    users_password_resets_token_hash text NOT NULL,
    users_password_resets_expires_at timestamp with time zone NOT NULL,
    users_password_resets_used_at timestamp with time zone,
    users_password_resets_requested_ip inet,
    users_password_resets_created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users_password_resets
    ADD CONSTRAINT users_password_resets_pkey PRIMARY KEY (users_password_resets_id);

ALTER TABLE ONLY public.users_password_resets
    ADD CONSTRAINT users_password_resets_token_hash_key UNIQUE (users_password_resets_token_hash);

CREATE INDEX idx_users_password_resets_expires_at
    ON public.users_password_resets USING btree (users_password_resets_expires_at);

CREATE INDEX idx_users_password_resets_id_user
    ON public.users_password_resets USING btree (users_password_resets_id_user);

INSERT INTO public.users_password_resets (
    users_password_resets_id, users_password_resets_id_user,
    users_password_resets_token_hash, users_password_resets_expires_at,
    users_password_resets_used_at, users_password_resets_requested_ip,
    users_password_resets_created_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_password_resets_id, users_password_resets_id_user, users_password_resets_token_hash, users_password_resets_expires_at, users_password_resets_used_at, users_password_resets_requested_ip, users_password_resets_created_at FROM public.users_password_resets')
AS t(
    users_password_resets_id uuid, users_password_resets_id_user uuid,
    users_password_resets_token_hash text,
    users_password_resets_expires_at timestamp with time zone,
    users_password_resets_used_at timestamp with time zone,
    users_password_resets_requested_ip inet,
    users_password_resets_created_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_password_resets', _p2_source_rowcount('users_password_resets'));


-- ======================================================================
-- TABLE 2: users_reauth_nonces
-- ======================================================================

CREATE TABLE public.users_reauth_nonces (
    users_reauth_nonces_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_reauth_nonces_id_user uuid NOT NULL,
    users_reauth_nonces_action_key text NOT NULL,
    users_reauth_nonces_consumed_at timestamp with time zone,
    users_reauth_nonces_expires_at timestamp with time zone NOT NULL,
    users_reauth_nonces_created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.users_reauth_nonces
    ADD CONSTRAINT users_reauth_nonces_pkey PRIMARY KEY (users_reauth_nonces_id);

CREATE INDEX idx_users_reauth_nonces_id_user_expires
    ON public.users_reauth_nonces USING btree (users_reauth_nonces_id_user, users_reauth_nonces_expires_at);

INSERT INTO public.users_reauth_nonces (
    users_reauth_nonces_id, users_reauth_nonces_id_user,
    users_reauth_nonces_action_key, users_reauth_nonces_consumed_at,
    users_reauth_nonces_expires_at, users_reauth_nonces_created_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_reauth_nonces_id, users_reauth_nonces_id_user, users_reauth_nonces_action_key, users_reauth_nonces_consumed_at, users_reauth_nonces_expires_at, users_reauth_nonces_created_at FROM public.users_reauth_nonces')
AS t(
    users_reauth_nonces_id uuid, users_reauth_nonces_id_user uuid,
    users_reauth_nonces_action_key text,
    users_reauth_nonces_consumed_at timestamp with time zone,
    users_reauth_nonces_expires_at timestamp with time zone,
    users_reauth_nonces_created_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_reauth_nonces', _p2_source_rowcount('users_reauth_nonces'));


-- ======================================================================
-- TABLE 3: users_notification_rules
-- ======================================================================

CREATE TABLE public.users_notification_rules (
    users_notification_rules_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_notification_rules_id_subscription uuid NOT NULL,
    users_notification_rules_id_user uuid,
    users_notification_rules_name text NOT NULL,
    users_notification_rules_type text NOT NULL,
    users_notification_rules_target text,
    users_notification_rules_conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    users_notification_rules_enabled boolean DEFAULT true NOT NULL,
    users_notification_rules_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_notification_rules_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    users_notification_rules_id_workspace uuid,
    CONSTRAINT users_notification_rules_name_length CHECK (((char_length(users_notification_rules_name) >= 1) AND (char_length(users_notification_rules_name) <= 100))),
    CONSTRAINT users_notification_rules_type_check CHECK ((users_notification_rules_type = ANY (ARRAY['artefact'::text, 'mention'::text, 'note'::text, 'comment'::text, 'owner_proposed'::text])))
);

ALTER TABLE ONLY public.users_notification_rules
    ADD CONSTRAINT users_notification_rules_pkey PRIMARY KEY (users_notification_rules_id);

CREATE INDEX idx_users_notification_rules_lookup
    ON public.users_notification_rules USING btree (users_notification_rules_id_subscription, users_notification_rules_id_workspace, users_notification_rules_type, users_notification_rules_target)
    WHERE (users_notification_rules_enabled = true);

CREATE INDEX idx_users_notification_rules_owner
    ON public.users_notification_rules USING btree (users_notification_rules_id_user, users_notification_rules_updated_at DESC);

INSERT INTO public.users_notification_rules (
    users_notification_rules_id, users_notification_rules_id_subscription,
    users_notification_rules_id_user, users_notification_rules_name,
    users_notification_rules_type, users_notification_rules_target,
    users_notification_rules_conditions, users_notification_rules_enabled,
    users_notification_rules_created_at, users_notification_rules_updated_at,
    users_notification_rules_id_workspace
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_notification_rules_id, users_notification_rules_id_subscription, users_notification_rules_id_user, users_notification_rules_name, users_notification_rules_type, users_notification_rules_target, users_notification_rules_conditions, users_notification_rules_enabled, users_notification_rules_created_at, users_notification_rules_updated_at, users_notification_rules_id_workspace FROM public.users_notification_rules')
AS t(
    users_notification_rules_id uuid, users_notification_rules_id_subscription uuid,
    users_notification_rules_id_user uuid, users_notification_rules_name text,
    users_notification_rules_type text, users_notification_rules_target text,
    users_notification_rules_conditions jsonb, users_notification_rules_enabled boolean,
    users_notification_rules_created_at timestamp with time zone,
    users_notification_rules_updated_at timestamp with time zone,
    users_notification_rules_id_workspace uuid
);

SELECT _p2_assert_rowcount('users_notification_rules', _p2_source_rowcount('users_notification_rules'));


-- ======================================================================
-- TABLE 4: notifications_outbox
-- ======================================================================

CREATE TABLE public.notifications_outbox (
    notifications_outbox_id uuid DEFAULT gen_random_uuid() NOT NULL,
    notifications_outbox_id_subscription uuid NOT NULL,
    notifications_outbox_id_user_recipient uuid NOT NULL,
    notifications_outbox_kind text NOT NULL,
    notifications_outbox_payload jsonb NOT NULL,
    notifications_outbox_created_at timestamp with time zone DEFAULT now() NOT NULL,
    notifications_outbox_claimed_at timestamp with time zone,
    notifications_outbox_delivered_at timestamp with time zone,
    notifications_outbox_attempts integer DEFAULT 0 NOT NULL,
    notifications_outbox_last_error text,
    CONSTRAINT notifications_outbox_attempts_check CHECK (((notifications_outbox_attempts >= 0) AND (notifications_outbox_attempts <= 100)))
);

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_pkey PRIMARY KEY (notifications_outbox_id);

CREATE INDEX idx_notifications_outbox_recipient
    ON public.notifications_outbox USING btree (notifications_outbox_id_subscription, notifications_outbox_id_user_recipient, notifications_outbox_created_at DESC);

CREATE INDEX idx_notifications_outbox_unclaimed
    ON public.notifications_outbox USING btree (notifications_outbox_created_at)
    WHERE (notifications_outbox_claimed_at IS NULL);

CREATE OR REPLACE FUNCTION public.notifications_outbox_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('notifications_outbox_inserted', NEW.notifications_outbox_id::text);
    RETURN NEW;
END;
$$;

CREATE TRIGGER notifications_outbox_after_insert
    AFTER INSERT ON public.notifications_outbox
    FOR EACH ROW EXECUTE FUNCTION public.notifications_outbox_notify();

-- Disable the trigger for the bulk INSERT to avoid 12 pg_notify
-- messages firing during data copy. Trigger reattaches automatically
-- after the SET LOCAL session_replication_role expires at COMMIT.
SET LOCAL session_replication_role = 'replica';

INSERT INTO public.notifications_outbox (
    notifications_outbox_id, notifications_outbox_id_subscription,
    notifications_outbox_id_user_recipient, notifications_outbox_kind,
    notifications_outbox_payload, notifications_outbox_created_at,
    notifications_outbox_claimed_at, notifications_outbox_delivered_at,
    notifications_outbox_attempts, notifications_outbox_last_error
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT notifications_outbox_id, notifications_outbox_id_subscription, notifications_outbox_id_user_recipient, notifications_outbox_kind, notifications_outbox_payload, notifications_outbox_created_at, notifications_outbox_claimed_at, notifications_outbox_delivered_at, notifications_outbox_attempts, notifications_outbox_last_error FROM public.notifications_outbox')
AS t(
    notifications_outbox_id uuid, notifications_outbox_id_subscription uuid,
    notifications_outbox_id_user_recipient uuid, notifications_outbox_kind text,
    notifications_outbox_payload jsonb,
    notifications_outbox_created_at timestamp with time zone,
    notifications_outbox_claimed_at timestamp with time zone,
    notifications_outbox_delivered_at timestamp with time zone,
    notifications_outbox_attempts integer,
    notifications_outbox_last_error text
);

SET LOCAL session_replication_role = 'origin';

SELECT _p2_assert_rowcount('notifications_outbox', _p2_source_rowcount('notifications_outbox'));


-- ======================================================================
-- TABLE 5: users_notifications
-- ======================================================================

CREATE TABLE public.users_notifications (
    users_notifications_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_notifications_id_subscription uuid NOT NULL,
    users_notifications_id_user uuid NOT NULL,
    users_notifications_kind text NOT NULL,
    users_notifications_title text NOT NULL,
    users_notifications_body text DEFAULT ''::text NOT NULL,
    users_notifications_context_kind text,
    users_notifications_context_id text,
    users_notifications_context_label text,
    users_notifications_id_outbox uuid,
    users_notifications_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_notifications_read_at timestamp with time zone,
    users_notifications_tag text,
    users_notifications_id_rule uuid,
    CONSTRAINT users_notifications_body_length CHECK ((char_length(users_notifications_body) <= 1000)),
    CONSTRAINT users_notifications_title_length CHECK ((char_length(users_notifications_title) <= 200))
);

ALTER TABLE ONLY public.users_notifications
    ADD CONSTRAINT users_notifications_pkey PRIMARY KEY (users_notifications_id);

CREATE INDEX idx_users_notifications_recipient_created
    ON public.users_notifications USING btree (users_notifications_id_user, users_notifications_created_at DESC);

CREATE INDEX idx_users_notifications_recipient_unread
    ON public.users_notifications USING btree (users_notifications_id_user, users_notifications_created_at DESC)
    WHERE (users_notifications_read_at IS NULL);

CREATE INDEX idx_users_notifications_tag
    ON public.users_notifications USING btree (users_notifications_id_user, users_notifications_tag, users_notifications_created_at DESC)
    WHERE (users_notifications_tag IS NOT NULL);

INSERT INTO public.users_notifications (
    users_notifications_id, users_notifications_id_subscription,
    users_notifications_id_user, users_notifications_kind,
    users_notifications_title, users_notifications_body,
    users_notifications_context_kind, users_notifications_context_id,
    users_notifications_context_label, users_notifications_id_outbox,
    users_notifications_created_at, users_notifications_read_at,
    users_notifications_tag, users_notifications_id_rule
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_notifications_id, users_notifications_id_subscription, users_notifications_id_user, users_notifications_kind, users_notifications_title, users_notifications_body, users_notifications_context_kind, users_notifications_context_id, users_notifications_context_label, users_notifications_id_outbox, users_notifications_created_at, users_notifications_read_at, users_notifications_tag, users_notifications_id_rule FROM public.users_notifications')
AS t(
    users_notifications_id uuid, users_notifications_id_subscription uuid,
    users_notifications_id_user uuid, users_notifications_kind text,
    users_notifications_title text, users_notifications_body text,
    users_notifications_context_kind text, users_notifications_context_id text,
    users_notifications_context_label text, users_notifications_id_outbox uuid,
    users_notifications_created_at timestamp with time zone,
    users_notifications_read_at timestamp with time zone,
    users_notifications_tag text, users_notifications_id_rule uuid
);

SELECT _p2_assert_rowcount('users_notifications', _p2_source_rowcount('users_notifications'));


-- ======================================================================
-- TABLE 6: users_notifications_prefs
-- ======================================================================

CREATE TABLE public.users_notifications_prefs (
    users_notifications_prefs_id_user uuid NOT NULL,
    users_notifications_prefs_kind text NOT NULL,
    users_notifications_prefs_channel text NOT NULL,
    users_notifications_prefs_enabled boolean NOT NULL,
    users_notifications_prefs_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_notifications_prefs_channel_check CHECK ((users_notifications_prefs_channel = ANY (ARRAY['in_app'::text, 'email'::text, 'sse'::text])))
);

ALTER TABLE ONLY public.users_notifications_prefs
    ADD CONSTRAINT users_notifications_prefs_pkey
    PRIMARY KEY (users_notifications_prefs_id_user, users_notifications_prefs_kind, users_notifications_prefs_channel);

CREATE INDEX idx_users_notifications_prefs_user
    ON public.users_notifications_prefs USING btree (users_notifications_prefs_id_user);

INSERT INTO public.users_notifications_prefs (
    users_notifications_prefs_id_user, users_notifications_prefs_kind,
    users_notifications_prefs_channel, users_notifications_prefs_enabled,
    users_notifications_prefs_updated_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_notifications_prefs_id_user, users_notifications_prefs_kind, users_notifications_prefs_channel, users_notifications_prefs_enabled, users_notifications_prefs_updated_at FROM public.users_notifications_prefs')
AS t(
    users_notifications_prefs_id_user uuid, users_notifications_prefs_kind text,
    users_notifications_prefs_channel text, users_notifications_prefs_enabled boolean,
    users_notifications_prefs_updated_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_notifications_prefs', _p2_source_rowcount('users_notifications_prefs'));


-- ======================================================================
-- TABLE 7: users_mentions
-- ======================================================================

CREATE TABLE public.users_mentions (
    users_mentions_id uuid DEFAULT gen_random_uuid() NOT NULL,
    users_mentions_id_subscription uuid NOT NULL,
    users_mentions_id_workspace uuid NOT NULL,
    users_mentions_id_user_author uuid NOT NULL,
    users_mentions_id_user_mentioned uuid NOT NULL,
    users_mentions_context_kind text NOT NULL,
    users_mentions_context_id text NOT NULL,
    users_mentions_context_label text NOT NULL,
    users_mentions_snippet text DEFAULT ''::text NOT NULL,
    users_mentions_created_at timestamp with time zone DEFAULT now() NOT NULL,
    users_mentions_read_at timestamp with time zone,
    CONSTRAINT users_mentions_no_self_mention CHECK ((users_mentions_id_user_author <> users_mentions_id_user_mentioned)),
    CONSTRAINT users_mentions_snippet_length CHECK ((char_length(users_mentions_snippet) <= 280))
);

ALTER TABLE ONLY public.users_mentions
    ADD CONSTRAINT users_mentions_pkey PRIMARY KEY (users_mentions_id);

CREATE INDEX idx_users_mentions_author
    ON public.users_mentions USING btree (users_mentions_id_subscription, users_mentions_id_user_author, users_mentions_created_at DESC);

CREATE INDEX idx_users_mentions_recipient_created
    ON public.users_mentions USING btree (users_mentions_id_user_mentioned, users_mentions_created_at DESC);

CREATE INDEX idx_users_mentions_recipient_unread
    ON public.users_mentions USING btree (users_mentions_id_user_mentioned, users_mentions_created_at DESC)
    WHERE (users_mentions_read_at IS NULL);

INSERT INTO public.users_mentions (
    users_mentions_id, users_mentions_id_subscription, users_mentions_id_workspace,
    users_mentions_id_user_author, users_mentions_id_user_mentioned,
    users_mentions_context_kind, users_mentions_context_id, users_mentions_context_label,
    users_mentions_snippet, users_mentions_created_at, users_mentions_read_at
)
SELECT * FROM dblink(_p2_source_conn(),
    'SELECT users_mentions_id, users_mentions_id_subscription, users_mentions_id_workspace, users_mentions_id_user_author, users_mentions_id_user_mentioned, users_mentions_context_kind, users_mentions_context_id, users_mentions_context_label, users_mentions_snippet, users_mentions_created_at, users_mentions_read_at FROM public.users_mentions')
AS t(
    users_mentions_id uuid, users_mentions_id_subscription uuid,
    users_mentions_id_workspace uuid, users_mentions_id_user_author uuid,
    users_mentions_id_user_mentioned uuid, users_mentions_context_kind text,
    users_mentions_context_id text, users_mentions_context_label text,
    users_mentions_snippet text, users_mentions_created_at timestamp with time zone,
    users_mentions_read_at timestamp with time zone
);

SELECT _p2_assert_rowcount('users_mentions', _p2_source_rowcount('users_mentions'));

COMMIT;
