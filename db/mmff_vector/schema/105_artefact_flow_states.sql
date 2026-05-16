-- ============================================================
-- MMFFDev - Vector: Artefact flow states (per-type workflow)
-- Migration 105 — applied on top of 104_extend_permission_catalogue.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 105_artefact_flow_states.sql
--
-- WHY ----------------------------------------------------------
-- canonical_states (006) defines the universal workflow vocabulary
-- (defined / ready / in_progress / completed / accepted) and drives
-- cycle/lead-time metrics. But the runtime today reads `status` off
-- a CHECK-constrained TEXT column on each artefact table — a flat,
-- non-tenant-mutable list. This migration introduces the missing
-- tier between canonical_states and the artefact rows: a per-type
-- flow that gadmins can extend, with every bespoke state mapped
-- back to a canonical_code so the metrics engine still works.
--
-- TWO-LAYER MODEL ----------------------------------------------
--   o_artefact_flow_default      — vendor seed. One row per
--                                  (registry_artefact_type, flow_position).
--                                  Maintained by library DB on build.
--   o_subscription_artefact_flow — per-subscription tenant copy.
--                                  Copied from default on subscription
--                                  provisioning. Gadmin-mutable. The
--                                  ONLY table the runtime consults.
--
-- TWO ARTEFACT-TYPE FLAVOURS -----------------------------------
--   1. Registry artefact types (o_artefact_type_registry):
--      execution_work_items, execution_defects, execution_tasks,
--      execution_test_cases, strategic. Stable, vendor-seeded.
--   2. Portfolio item types (portfolio_item_types):
--      Theme / Initiative / Epic / Feature etc. Per-subscription.
--
-- The default table only references registry types (vendor doesn't
-- know tenant UUIDs). The tenant table can attach a flow to either
-- a registry row OR a portfolio_item_types row, via a nullable pair
-- of FKs with an exactly-one CHECK.
--
-- PERMISSIVE MAPPING -------------------------------------------
-- Gadmins create new states via three fields:
--   Flow Position (int) | Flow Tie Back (canonical_code) | Description
-- The canonical_code FK closes the dropdown — gadmins can name a
-- state anything ("Stakeholder Review") but it MUST tie back to one
-- of the five canonical codes. The metrics engine reads canonical_code,
-- not the bespoke name.
--
-- WHAT THIS MIGRATION DOES NOT DO ------------------------------
-- - Does NOT repoint o_artefacts_*.status from CHECK-text to flow FK.
--   That is a separate, larger migration once the flow tables are wired.
-- - Does NOT add subscription provisioning logic (copy default → tenant
--   on subscription create). Backend service work in a follow-up story.
-- - Does NOT define transition edges. canonical_states (006) already
--   has item_type_transition_edges; whether to reuse or replace is a
--   later decision once the runtime reads from flow_tenant.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. Add stable UUID to o_artefact_type_registry
-- scope_key (TEXT) remains the PK — code references unchanged.
-- The new id (UUID) is the FK target for flow tables, so the flow
-- tables don't have to know about scope_key strings.
-- ============================================================
ALTER TABLE o_artefact_type_registry
    ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE o_artefact_type_registry
    ADD CONSTRAINT o_artefact_type_registry_id_unique UNIQUE (id);

-- ============================================================
-- 1. o_artefact_flow_default
-- Vendor-seeded default flow per registry artefact type.
-- One row per (artefact_type_id, flow_position). Library DB
-- updates this on build; runtime never reads it.
-- ============================================================
CREATE TABLE o_artefact_flow_default (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    artefact_type_id  UUID        NOT NULL REFERENCES o_artefact_type_registry(id) ON DELETE CASCADE,
    flow_position     INT         NOT NULL,
    name              TEXT        NOT NULL,
    canonical_code    TEXT        NOT NULL REFERENCES canonical_states(code) ON DELETE RESTRICT,
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT o_afd_position_unique UNIQUE (artefact_type_id, flow_position),
    CONSTRAINT o_afd_name_unique     UNIQUE (artefact_type_id, name),
    CONSTRAINT o_afd_position_positive CHECK (flow_position > 0)
);

CREATE INDEX idx_o_afd_type      ON o_artefact_flow_default (artefact_type_id);
CREATE INDEX idx_o_afd_canonical ON o_artefact_flow_default (canonical_code);

CREATE TRIGGER trg_o_afd_updated_at
    BEFORE UPDATE ON o_artefact_flow_default
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. o_subscription_artefact_flow
-- Per-subscription tenant copy. The ONLY flow table the runtime
-- reads. Copied from o_artefact_flow_default on subscription
-- provisioning, then gadmin-mutable.
--
-- Polymorphic-by-design: a flow attaches to EITHER a registry
-- artefact type OR a portfolio_item_types row, never both.
-- (Vendor seed only attaches to registry types because vendor
-- doesn't know tenant portfolio_item_types UUIDs at build time.)
-- ============================================================
CREATE TABLE o_subscription_artefact_flow (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id          UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    artefact_type_id         UUID                 REFERENCES o_artefact_type_registry(id) ON DELETE CASCADE,
    portfolio_item_type_id   UUID                 REFERENCES portfolio_item_types(id)    ON DELETE CASCADE,
    flow_position            INT         NOT NULL,
    name                     TEXT        NOT NULL,
    canonical_code           TEXT        NOT NULL REFERENCES canonical_states(code) ON DELETE RESTRICT,
    description              TEXT,
    archived_at              TIMESTAMPTZ,
    created_by               UUID                 REFERENCES users(id) ON DELETE SET NULL,
    updated_by               UUID                 REFERENCES users(id) ON DELETE SET NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT o_saf_target_exactly_one CHECK (
        (artefact_type_id IS NOT NULL AND portfolio_item_type_id IS NULL) OR
        (artefact_type_id IS NULL     AND portfolio_item_type_id IS NOT NULL)
    ),
    CONSTRAINT o_saf_position_positive CHECK (flow_position > 0)
);

-- A subscription has one flow per (target, position) and one flow
-- per (target, name). Two partial uniques cover the polymorphic split.
CREATE UNIQUE INDEX o_saf_position_unique_registry
    ON o_subscription_artefact_flow (subscription_id, artefact_type_id, flow_position)
    WHERE artefact_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_saf_position_unique_portfolio
    ON o_subscription_artefact_flow (subscription_id, portfolio_item_type_id, flow_position)
    WHERE portfolio_item_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_saf_name_unique_registry
    ON o_subscription_artefact_flow (subscription_id, artefact_type_id, name)
    WHERE artefact_type_id IS NOT NULL;

CREATE UNIQUE INDEX o_saf_name_unique_portfolio
    ON o_subscription_artefact_flow (subscription_id, portfolio_item_type_id, name)
    WHERE portfolio_item_type_id IS NOT NULL;

CREATE INDEX idx_o_saf_subscription ON o_subscription_artefact_flow (subscription_id) WHERE archived_at IS NULL;
CREATE INDEX idx_o_saf_canonical    ON o_subscription_artefact_flow (canonical_code);
CREATE INDEX idx_o_saf_registry     ON o_subscription_artefact_flow (artefact_type_id)       WHERE artefact_type_id IS NOT NULL;
CREATE INDEX idx_o_saf_portfolio    ON o_subscription_artefact_flow (portfolio_item_type_id) WHERE portfolio_item_type_id IS NOT NULL;

CREATE TRIGGER trg_o_saf_updated_at
    BEFORE UPDATE ON o_subscription_artefact_flow
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. Seed default flow for execution_work_items
-- Five rows mirroring the canonical state vocabulary, with
-- gadmin-friendly bespoke labels.
--   1. Defined    → defined
--   2. To Do      → ready
--   3. Doing      → in_progress
--   4. Completed  → completed
--   5. Accepted   → accepted
-- Other registry types (defects, tasks, test_cases, strategic)
-- get their own seeds in follow-up migrations once their flows
-- are designed — keeping this migration scoped.
-- ============================================================
INSERT INTO o_artefact_flow_default
    (artefact_type_id, flow_position, name, canonical_code, description)
SELECT r.id, v.flow_position, v.name, v.canonical_code, v.description
FROM   o_artefact_type_registry r
CROSS  JOIN (VALUES
    (1, 'Defined',   'defined',     'Captured but not yet ready to start.'),
    (2, 'To Do',     'ready',       'Acceptance criteria met; ready for someone to pick up.'),
    (3, 'Doing',     'in_progress', 'Actively being worked on.'),
    (4, 'Completed', 'completed',   'Work finished; awaiting acceptance.'),
    (5, 'Accepted',  'accepted',    'Reviewed and accepted by the requester.')
) AS v(flow_position, name, canonical_code, description)
WHERE  r.scope_key = 'execution_work_items';

COMMIT;
