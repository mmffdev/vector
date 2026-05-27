-- ============================================================
-- 120_notif_v2_events.sql
--
-- Notifications v2 — canonical event table.
--
-- One row per fired event regardless of fan-out class (direct,
-- workspace, topology_node, topology_subtree, tenant, platform).
-- Idempotency via UNIQUE (id_subscription, event_key) with a
-- 30-day TTL; partial index on unresolved events drives the relay.
--
-- Part of the Notifications v2 PLA (S01 — Schema migrations).
-- See docs/superpowers/specs/2026-05-26-notifications-v2-design.md
-- section "N — notifications_events_v2".
--
-- Column-prefix HARD RULE: every column carries the full table name
-- as prefix per .claude/CLAUDE.md.
--
-- Symmetric DOWN: drops table + indexes (indexes drop implicitly with
-- the table, but listed explicitly here for clarity).
-- ============================================================

BEGIN;

-- ---- UP ----

CREATE TABLE notifications_events_v2 (
    notifications_events_v2_id                  uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    notifications_events_v2_event_key            text            NOT NULL,
    notifications_events_v2_type                 text            NOT NULL,
    notifications_events_v2_priority             text            NOT NULL,
    notifications_events_v2_fanout_mode          text            NOT NULL,
    notifications_events_v2_id_subscription      uuid            NULL
        REFERENCES subscriptions(subscriptions_id) ON DELETE SET NULL,
    notifications_events_v2_id_workspace         uuid            NULL
        REFERENCES master_record_workspaces(master_record_workspaces_id) ON DELETE SET NULL,
    notifications_events_v2_id_topology_node     uuid            NULL
        REFERENCES topology_nodes(topology_nodes_id) ON DELETE SET NULL,
    notifications_events_v2_id_recipient_user    uuid            NULL
        REFERENCES users(users_id) ON DELETE SET NULL,
    notifications_events_v2_id_sent_by_user      uuid            NULL
        REFERENCES users(users_id) ON DELETE SET NULL,
    notifications_events_v2_sent_by_system       boolean         NOT NULL DEFAULT false,
    notifications_events_v2_data                 jsonb           NOT NULL DEFAULT '{}'::jsonb,
    notifications_events_v2_recipient_count      integer         NULL,
    notifications_events_v2_created_at           timestamptz     NOT NULL DEFAULT now(),
    notifications_events_v2_resolved_at          timestamptz     NULL,

    -- CHECK: priority must be one of four values
    CONSTRAINT notifications_events_v2_priority_check
        CHECK (notifications_events_v2_priority IN ('low', 'medium', 'high', 'critical')),

    -- CHECK: fanout_mode must be one of six values
    CONSTRAINT notifications_events_v2_fanout_mode_check
        CHECK (notifications_events_v2_fanout_mode IN (
            'direct', 'workspace', 'topology_node', 'topology_subtree', 'tenant', 'platform'
        )),

    -- CHECK: direct fanout requires a recipient user
    CONSTRAINT notifications_events_v2_direct_requires_recipient
        CHECK (
            notifications_events_v2_fanout_mode <> 'direct'
            OR notifications_events_v2_id_recipient_user IS NOT NULL
        ),

    -- CHECK: platform fanout requires no subscription
    CONSTRAINT notifications_events_v2_platform_no_subscription
        CHECK (
            notifications_events_v2_fanout_mode <> 'platform'
            OR notifications_events_v2_id_subscription IS NULL
        ),

    -- CHECK: topology fanout modes require a topology node
    CONSTRAINT notifications_events_v2_topology_requires_node
        CHECK (
            notifications_events_v2_fanout_mode NOT IN ('topology_node', 'topology_subtree')
            OR notifications_events_v2_id_topology_node IS NOT NULL
        ),

    -- CHECK: system-sent events must not have a human sender
    CONSTRAINT notifications_events_v2_system_no_user_sender
        CHECK (
            NOT notifications_events_v2_sent_by_system
            OR notifications_events_v2_id_sent_by_user IS NULL
        )
);

-- Idempotency: one event_key per subscription
CREATE UNIQUE INDEX notifications_events_v2_sub_key_uidx
    ON notifications_events_v2 (
        notifications_events_v2_id_subscription,
        notifications_events_v2_event_key
    );

-- Tenant timeline: most-recent-first per subscription
CREATE INDEX notifications_events_v2_sub_timeline_idx
    ON notifications_events_v2 (
        notifications_events_v2_id_subscription,
        notifications_events_v2_created_at DESC
    );

-- Relay driver: only unresolved events
CREATE INDEX notifications_events_v2_unresolved_idx
    ON notifications_events_v2 (notifications_events_v2_resolved_at)
    WHERE notifications_events_v2_resolved_at IS NULL;

-- 30-day prune scan
CREATE INDEX notifications_events_v2_created_prune_idx
    ON notifications_events_v2 (notifications_events_v2_created_at);

-- ---- DOWN ----
-- DROP INDEX IF EXISTS notifications_events_v2_created_prune_idx;
-- DROP INDEX IF EXISTS notifications_events_v2_unresolved_idx;
-- DROP INDEX IF EXISTS notifications_events_v2_sub_timeline_idx;
-- DROP INDEX IF EXISTS notifications_events_v2_sub_key_uidx;
-- DROP TABLE IF EXISTS notifications_events_v2;

COMMIT;
