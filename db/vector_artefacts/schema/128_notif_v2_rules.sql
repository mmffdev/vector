-- ============================================================
-- 128_notif_v2_rules.sql
--
-- Notifications v2 — routing and suppression rules.
--
-- Rules evaluated by the pipeline filter after prefs resolution.
-- Can: add channels, override priority, override template, set schedule.
-- Scoped to subscription (required) + optional workspace + optional user.
-- logical_op (AND/OR) determines how conditions combine.
-- template_override_id FK references notifications_templates (mig 127).
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N+8 — notifications_rules_v2".
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_rules_v2 (
    notifications_rules_v2_id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_rules_v2_id_subscription      uuid        NOT NULL
        REFERENCES subscriptions(subscriptions_id) ON DELETE CASCADE,
    notifications_rules_v2_id_workspace         uuid        NULL
        REFERENCES master_record_workspaces(master_record_workspaces_id) ON DELETE CASCADE,
    notifications_rules_v2_id_user              uuid        NULL
        REFERENCES users(users_id) ON DELETE CASCADE,
    notifications_rules_v2_name                 text        NOT NULL,
    notifications_rules_v2_event_type           text        NOT NULL,
    notifications_rules_v2_logical_op           text        NOT NULL DEFAULT 'AND',
    notifications_rules_v2_conditions           jsonb       NOT NULL DEFAULT '[]'::jsonb,
    notifications_rules_v2_channels             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    notifications_rules_v2_priority_override    text        NULL,
    notifications_rules_v2_template_override_id uuid        NULL
        REFERENCES notifications_templates(notifications_templates_id) ON DELETE SET NULL,
    notifications_rules_v2_schedule             text        NOT NULL DEFAULT 'immediate',
    notifications_rules_v2_enabled              boolean     NOT NULL DEFAULT true,
    notifications_rules_v2_created_at           timestamptz NOT NULL DEFAULT now(),
    notifications_rules_v2_updated_at           timestamptz NOT NULL DEFAULT now(),

    -- CHECK: logical_op must be AND or OR
    CONSTRAINT notifications_rules_v2_logical_op_check
        CHECK (notifications_rules_v2_logical_op IN ('AND', 'OR')),

    -- CHECK: schedule must be a known value
    CONSTRAINT notifications_rules_v2_schedule_check
        CHECK (notifications_rules_v2_schedule IN ('immediate', 'next_quiet_hours_end', 'digest'))
);

-- Per-subscription rules by event_type and enabled state
CREATE INDEX notifications_rules_v2_sub_type_enabled_idx
    ON notifications_rules_v2 (
        notifications_rules_v2_id_subscription,
        notifications_rules_v2_event_type,
        notifications_rules_v2_enabled
    );

-- Per-user rules (null user = admin-scoped; non-null = user-specific)
CREATE INDEX notifications_rules_v2_user_type_enabled_idx
    ON notifications_rules_v2 (
        notifications_rules_v2_id_user,
        notifications_rules_v2_event_type,
        notifications_rules_v2_enabled
    );

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_rules_v2_user_type_enabled_idx;
-- DROP INDEX IF EXISTS notifications_rules_v2_sub_type_enabled_idx;
-- DROP TABLE IF EXISTS notifications_rules_v2;

COMMIT;
