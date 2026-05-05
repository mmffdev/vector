-- ============================================================
-- MMFFDev - Vector: Auto-seed default flow on portfolio_item_types insert
-- Migration 111 — applied on top of 110_seed_remaining_flows.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 111_portfolio_item_type_flow_seed_trigger.sql
--
-- WHY ----------------------------------------------------------
-- A tenant can build their own strategy hierarchy at any time —
-- 2 layers, 3 layers, 6 layers — each layer being one row in
-- portfolio_item_types. Every layer needs its own independent flow
-- in o_flow_tenant; without one, a layer renders without states.
--
-- This trigger guarantees that EVERY insert into portfolio_item_types
-- (whether from Go, SQL provisioning, or future admin UI) auto-seeds
-- the default 5-state flow into o_flow_tenant for that subscription
-- and that portfolio_item_type. The default mirrors what migration 110
-- already wrote for existing portfolio_item_types rows:
--   1. Backlog   → backlog
--   2. Ready     → ready
--   3. Doing     → doing
--   4. Completed → completed
--   5. Accepted  → accepted
--
-- A gadmin can later customise per-layer flows via o_flow_tenant
-- (rename "Backlog" → "Stakeholder Review", reorder, archive states,
-- etc.) — the seed only fires once on initial insert, never again.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION seed_default_flow_for_portfolio_item_type()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO o_flow_tenant
        (subscription_id, portfolio_item_type_id, flow_position, name, canonical_code, description)
    VALUES
        (NEW.subscription_id, NEW.id, 1, 'Backlog',   'backlog',   'Captured but not yet ready to start.'),
        (NEW.subscription_id, NEW.id, 2, 'Ready',     'ready',     'Acceptance criteria met; ready for someone to pick up.'),
        (NEW.subscription_id, NEW.id, 3, 'Doing',     'doing',     'Actively being worked on.'),
        (NEW.subscription_id, NEW.id, 4, 'Completed', 'completed', 'Work finished; awaiting acceptance.'),
        (NEW.subscription_id, NEW.id, 5, 'Accepted',  'accepted',  'Reviewed and accepted by the requester.')
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_portfolio_item_types_seed_flow
    AFTER INSERT ON portfolio_item_types
    FOR EACH ROW
    EXECUTE FUNCTION seed_default_flow_for_portfolio_item_type();

COMMIT;
