-- ============================================================
-- MMFFDev - Vector: Workflow state model
-- Migration 006 — applied on top of 005_item_types.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 006_states.sql
--
-- Three-table state model + append-only history:
--
--   1. canonical_states       — seeded vocabulary (SoW §3):
--                               defined, ready, in_progress,
--                               completed, accepted
--   2. item_type_states       — per-type bespoke states mapping
--                               back to a canonical_code. Lets a
--                               team add UX/UI/Dev/Testing columns
--                               that all roll up to in_progress.
--   3. item_type_transition_edges — explicit (from,to) edges.
--                               Not implicit — a team chooses which
--                               moves are legal.
--   4. item_state_history     — append-only. Source of truth for
--                               cycle/lead time and WIP charts.
--
-- `clock_role` on canonical_states drives metrics:
--   lead_start  → lead_stop   = lead time   (ready  → accepted)
--   cycle_active→ cycle_stop  = cycle time  (in_progress → completed)
-- Per-column cycle time = sum of time spent in each non-`defined`
-- bespoke state (user spec).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. canonical_states
-- Tenant-independent. Seeded once here. The application never
-- writes to this table at runtime.
-- ============================================================
CREATE TABLE canonical_states (
    code        TEXT        PRIMARY KEY,
    label       TEXT        NOT NULL,
    clock_role  TEXT        NOT NULL CHECK (
                    clock_role IN ('none','lead_start','cycle_active','cycle_stop','lead_stop')
                ),
    sort_order  INT         NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO canonical_states (code, label, clock_role, sort_order) VALUES
    ('defined',     'Defined',     'none',         10),
    ('ready',       'Ready',       'lead_start',   20),
    ('in_progress', 'In Progress', 'cycle_active', 30),
    ('completed',   'Completed',   'cycle_stop',   40),
    ('accepted',    'Accepted',    'lead_stop',    50);

-- ============================================================
-- 2. item_type_states
-- Per-(tenant, item_type) bespoke states. `item_type_kind`
-- discriminates whether item_type_id points at
-- portfolio_item_types or execution_item_types (same pattern as
-- entity_stakeholders.entity_kind in 004). FK to the target type
-- table is enforced in application code.
--
-- Every bespoke state maps back to a canonical_code so metrics
-- engines always know which clock role applies.
-- ============================================================
CREATE TABLE item_type_states (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    item_type_id    UUID        NOT NULL,
    item_type_kind  TEXT        NOT NULL CHECK (
                        item_type_kind IN ('portfolio','execution')
                    ),
    name            TEXT        NOT NULL,
    canonical_code  TEXT        NOT NULL REFERENCES canonical_states(code) ON DELETE RESTRICT,
    sort_order      INT         NOT NULL DEFAULT 0,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT item_type_states_unique UNIQUE (tenant_id, item_type_id, item_type_kind, name)
);

CREATE INDEX idx_item_type_states_tenant_id     ON item_type_states(tenant_id);
CREATE INDEX idx_item_type_states_type          ON item_type_states(item_type_id, item_type_kind);
CREATE INDEX idx_item_type_states_canonical     ON item_type_states(canonical_code);
CREATE INDEX idx_item_type_states_active        ON item_type_states(tenant_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_item_type_states_updated_at
    BEFORE UPDATE ON item_type_states
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. item_type_transition_edges
-- Explicit (from_state_id, to_state_id) pairs. Both endpoints
-- must belong to the SAME (item_type_id, item_type_kind) — that
-- invariant is enforced in application code (cross-type moves
-- are nonsensical).
-- ============================================================
CREATE TABLE item_type_transition_edges (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    item_type_id    UUID        NOT NULL,
    item_type_kind  TEXT        NOT NULL CHECK (
                        item_type_kind IN ('portfolio','execution')
                    ),
    from_state_id   UUID        NOT NULL REFERENCES item_type_states(id) ON DELETE RESTRICT,
    to_state_id     UUID        NOT NULL REFERENCES item_type_states(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT edge_no_self_loop CHECK (from_state_id <> to_state_id),
    CONSTRAINT edge_unique        UNIQUE (tenant_id, item_type_id, item_type_kind, from_state_id, to_state_id)
);

CREATE INDEX idx_transition_edges_tenant_id ON item_type_transition_edges(tenant_id);
CREATE INDEX idx_transition_edges_type      ON item_type_transition_edges(item_type_id, item_type_kind);
CREATE INDEX idx_transition_edges_from      ON item_type_transition_edges(from_state_id);
CREATE INDEX idx_transition_edges_to        ON item_type_transition_edges(to_state_id);

-- ============================================================
-- 4. item_state_history
-- Append-only. Every state change on every work item writes one
-- row. The `item_id` column points at a row in whichever item
-- table the item lives in (user_story, task, feature, ...); the
-- item tables don't exist yet (blocked on OKR placement — SoW
-- §11) so there is no FK constraint here. Application layer
-- enforces referential integrity until item tables land.
--
-- All cycle time / lead time / WIP / CFD queries read from here.
-- ============================================================
CREATE TABLE item_state_history (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    item_id           UUID        NOT NULL,
    item_type_id      UUID        NOT NULL,
    item_type_kind    TEXT        NOT NULL CHECK (
                          item_type_kind IN ('portfolio','execution')
                      ),
    from_state_id     UUID        REFERENCES item_type_states(id) ON DELETE RESTRICT,
    to_state_id       UUID        NOT NULL REFERENCES item_type_states(id) ON DELETE RESTRICT,
    transitioned_by   UUID        REFERENCES users(id) ON DELETE RESTRICT,
    transitioned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT history_no_self_loop CHECK (from_state_id IS NULL OR from_state_id <> to_state_id)
);

CREATE INDEX idx_history_tenant_id      ON item_state_history(tenant_id);
CREATE INDEX idx_history_item_timeline  ON item_state_history(item_id, transitioned_at);
CREATE INDEX idx_history_wip            ON item_state_history(tenant_id, to_state_id, transitioned_at);
CREATE INDEX idx_history_type           ON item_state_history(item_type_id, item_type_kind);

-- Append-only guard: reject UPDATE and DELETE on history rows.
-- Bypass is a DBA-only operation (requires disabling the trigger).
CREATE OR REPLACE FUNCTION item_state_history_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'item_state_history is append-only (op=%, id=%)',
        TG_OP, COALESCE(OLD.id, NEW.id)
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_state_history_no_update
    BEFORE UPDATE ON item_state_history
    FOR EACH ROW EXECUTE FUNCTION item_state_history_append_only();

CREATE TRIGGER trg_item_state_history_no_delete
    BEFORE DELETE ON item_state_history
    FOR EACH ROW EXECUTE FUNCTION item_state_history_append_only();

COMMIT;
