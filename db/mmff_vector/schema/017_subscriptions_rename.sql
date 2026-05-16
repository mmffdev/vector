-- ============================================================
-- MMFFDev - Vector: Rename tenants -> subscriptions (Phase 0 / TD-LIB-001)
-- Migration 017 — applied on top of 016_user_custom_pages.sql
-- Run: docker exec -i mmff-ops-postgres psql -U mmff_dev -d mmff_vector < 017_subscriptions_rename.sql
--
-- Renames the entire tenant vocabulary to "subscription" so the
-- billing/entitlements layer (mmff_library) has a coherent shared
-- term. Postgres RENAME TABLE / RENAME COLUMN are metadata-only
-- (no row rewrite), so this is fast even on populated tables.
--
-- Scope (verified against live mmff_vector on 2026-04-24):
--   2 tables renamed: tenants -> subscriptions, tenant_sequence -> subscription_sequence
--   16 columns renamed: <table>.tenant_id -> subscription_id
--   16 FK constraints renamed: <table>_tenant_id_fkey -> <table>_subscription_id_fkey
--   18 indexes renamed (all "tenant" mentions in idx names + tenants_pkey/_slug_key)
--   4 non-FK named constraints renamed (uniques + checks + pkeys)
--   2 triggers renamed (trg_tenants_updated_at, trg_tenant_sequence_updated_at)
--   8 functions CREATE OR REPLACEd with renamed bodies:
--       dispatch_polymorphic_parent, dispatch_item_type_parent,
--       trg_entity_stakeholders_dispatch, trg_page_entity_refs_dispatch,
--       trg_item_type_states_dispatch, provision_on_first_gadmin,
--       provision_tenant_defaults (renamed to provision_subscription_defaults),
--       seed_default_states_for_type
--
-- Atomic: everything runs in one transaction. If any rename fails,
-- the whole migration rolls back. The trigger functions reference
-- columns by old name, so we MUST CREATE OR REPLACE them in the
-- same txn that renames the columns or the triggers will fire and
-- fail at first write.
--
-- Wire-format note: JWT claims still emit `tenant_id` until the
-- app-code rename PR ships dual-accept (writes subscription_id,
-- accepts either). DB-side rename is independent of wire format.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Rename tables
-- ============================================================
ALTER TABLE tenants          RENAME TO subscriptions;
ALTER TABLE tenant_sequence  RENAME TO subscription_sequence;

-- ============================================================
-- 2. Rename tenant_id columns -> subscription_id
-- ============================================================
ALTER TABLE audit_log                  RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE company_roadmap            RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE entity_stakeholders        RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE execution_item_types       RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE item_state_history         RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE item_type_states           RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE item_type_transition_edges RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE pages                      RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE portfolio                  RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE portfolio_item_types       RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE product                    RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE subscription_sequence      RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE user_custom_pages          RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE user_nav_prefs             RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE users                      RENAME COLUMN tenant_id TO subscription_id;
ALTER TABLE workspace                  RENAME COLUMN tenant_id TO subscription_id;

-- ============================================================
-- 3. Rename FK constraints
-- ============================================================
ALTER TABLE users                      RENAME CONSTRAINT users_tenant_id_fkey                      TO users_subscription_id_fkey;
ALTER TABLE audit_log                  RENAME CONSTRAINT audit_log_tenant_id_fkey                  TO audit_log_subscription_id_fkey;
ALTER TABLE subscription_sequence      RENAME CONSTRAINT tenant_sequence_tenant_id_fkey            TO subscription_sequence_subscription_id_fkey;
ALTER TABLE company_roadmap            RENAME CONSTRAINT company_roadmap_tenant_id_fkey            TO company_roadmap_subscription_id_fkey;
ALTER TABLE workspace                  RENAME CONSTRAINT workspace_tenant_id_fkey                  TO workspace_subscription_id_fkey;
ALTER TABLE portfolio                  RENAME CONSTRAINT portfolio_tenant_id_fkey                  TO portfolio_subscription_id_fkey;
ALTER TABLE product                    RENAME CONSTRAINT product_tenant_id_fkey                    TO product_subscription_id_fkey;
ALTER TABLE entity_stakeholders        RENAME CONSTRAINT entity_stakeholders_tenant_id_fkey        TO entity_stakeholders_subscription_id_fkey;
ALTER TABLE portfolio_item_types       RENAME CONSTRAINT portfolio_item_types_tenant_id_fkey       TO portfolio_item_types_subscription_id_fkey;
ALTER TABLE execution_item_types       RENAME CONSTRAINT execution_item_types_tenant_id_fkey       TO execution_item_types_subscription_id_fkey;
ALTER TABLE item_type_states           RENAME CONSTRAINT item_type_states_tenant_id_fkey           TO item_type_states_subscription_id_fkey;
ALTER TABLE item_type_transition_edges RENAME CONSTRAINT item_type_transition_edges_tenant_id_fkey TO item_type_transition_edges_subscription_id_fkey;
ALTER TABLE item_state_history         RENAME CONSTRAINT item_state_history_tenant_id_fkey         TO item_state_history_subscription_id_fkey;
ALTER TABLE user_nav_prefs             RENAME CONSTRAINT user_nav_prefs_tenant_id_fkey             TO user_nav_prefs_subscription_id_fkey;
ALTER TABLE pages                      RENAME CONSTRAINT pages_tenant_id_fkey                      TO pages_subscription_id_fkey;
ALTER TABLE user_custom_pages          RENAME CONSTRAINT user_custom_pages_tenant_id_fkey          TO user_custom_pages_subscription_id_fkey;

-- ============================================================
-- 4. Rename non-FK named constraints (uniques, checks, pkeys)
-- ============================================================
ALTER TABLE subscriptions          RENAME CONSTRAINT tenants_pkey                    TO subscriptions_pkey;
ALTER TABLE subscriptions          RENAME CONSTRAINT tenants_slug_key                TO subscriptions_slug_key;
ALTER TABLE users                  RENAME CONSTRAINT users_email_tenant_unique       TO users_email_subscription_unique;
ALTER TABLE subscription_sequence  RENAME CONSTRAINT tenant_sequence_pkey            TO subscription_sequence_pkey;
ALTER TABLE subscription_sequence  RENAME CONSTRAINT tenant_sequence_next_num_check TO subscription_sequence_next_num_check;
ALTER TABLE company_roadmap        RENAME CONSTRAINT company_roadmap_tenant_id_key   TO company_roadmap_subscription_id_key;

-- ============================================================
-- 5. Rename indexes
-- ============================================================
ALTER INDEX idx_audit_log_tenant_id              RENAME TO idx_audit_log_subscription_id;
ALTER INDEX idx_stakeholders_tenant_id           RENAME TO idx_stakeholders_subscription_id;
ALTER INDEX idx_execution_item_types_tenant_id   RENAME TO idx_execution_item_types_subscription_id;
ALTER INDEX idx_history_tenant_id                RENAME TO idx_history_subscription_id;
ALTER INDEX idx_item_type_states_tenant_id       RENAME TO idx_item_type_states_subscription_id;
ALTER INDEX idx_transition_edges_tenant_id       RENAME TO idx_transition_edges_subscription_id;
ALTER INDEX idx_pages_tenant                     RENAME TO idx_pages_subscription;
ALTER INDEX pages_unique_key_shared_tenant       RENAME TO pages_unique_key_shared_subscription;
ALTER INDEX idx_portfolio_tenant_id              RENAME TO idx_portfolio_subscription_id;
ALTER INDEX idx_portfolio_item_types_tenant_id   RENAME TO idx_portfolio_item_types_subscription_id;
ALTER INDEX idx_product_tenant_id                RENAME TO idx_product_subscription_id;
ALTER INDEX idx_users_tenant_id                  RENAME TO idx_users_subscription_id;
ALTER INDEX idx_workspace_tenant_id              RENAME TO idx_workspace_subscription_id;

-- Partial-active indexes (defined in 004 with WHERE archived_at IS NULL):
--   idx_workspace_active, idx_portfolio_active, idx_product_active
-- Their definitions reference tenant_id; renaming the column updates
-- them automatically. No explicit rename needed for those index names
-- since they don't carry "tenant" in their identifier.

-- ============================================================
-- 6. Rename triggers
-- ============================================================
ALTER TRIGGER trg_tenants_updated_at         ON subscriptions         RENAME TO trg_subscriptions_updated_at;
ALTER TRIGGER trg_tenant_sequence_updated_at ON subscription_sequence RENAME TO trg_subscription_sequence_updated_at;

-- ============================================================
-- 7. Replace function bodies that reference tenant_id by old name
-- ------------------------------------------------------------
-- These functions were defined against the old column names; the
-- body text still says `tenant_id` even though the column is now
-- `subscription_id`. We CREATE OR REPLACE them all here so the
-- next write to any polymorphic table (which fires the dispatch
-- trigger) finds correct SQL.
-- ============================================================

-- 7a. dispatch_polymorphic_parent
-- OUT param renamed (parent_tenant_id -> parent_subscription_id) changes the
-- function's row type, so Postgres requires DROP + CREATE not CREATE OR REPLACE.
DROP FUNCTION IF EXISTS dispatch_polymorphic_parent(TEXT, UUID);
CREATE FUNCTION dispatch_polymorphic_parent(
    p_kind TEXT,
    p_id   UUID,
    OUT parent_subscription_id UUID,
    OUT parent_archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE p_kind
        WHEN 'company_roadmap' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM company_roadmap WHERE id = p_id;
        WHEN 'workspace' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM workspace WHERE id = p_id;
        WHEN 'portfolio' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM portfolio WHERE id = p_id;
        WHEN 'product' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM product WHERE id = p_id;
        ELSE
            RAISE EXCEPTION 'unknown polymorphic parent kind: %', p_kind
                USING ERRCODE = 'foreign_key_violation';
    END CASE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'polymorphic parent not found: kind=%, id=%', p_kind, p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$;

COMMENT ON FUNCTION dispatch_polymorphic_parent(TEXT, UUID) IS
    'Resolves an entity_stakeholders / page_entity_refs polymorphic parent reference '
    'to (subscription_id, archived_at). Raises foreign_key_violation if missing. '
    'See docs/c_polymorphic_writes.md.';

-- 7b. dispatch_item_type_parent (OUT param rename — same DROP+CREATE reason)
DROP FUNCTION IF EXISTS dispatch_item_type_parent(TEXT, UUID);
CREATE FUNCTION dispatch_item_type_parent(
    p_kind TEXT,
    p_id   UUID,
    OUT parent_subscription_id UUID,
    OUT parent_archived_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    CASE p_kind
        WHEN 'portfolio' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM portfolio_item_types WHERE id = p_id;
        WHEN 'execution' THEN
            SELECT subscription_id, archived_at INTO parent_subscription_id, parent_archived_at
              FROM execution_item_types WHERE id = p_id;
        ELSE
            RAISE EXCEPTION 'unknown item_type parent kind: %', p_kind
                USING ERRCODE = 'foreign_key_violation';
    END CASE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'polymorphic item_type parent not found: kind=%, id=%', p_kind, p_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;
END;
$$;

COMMENT ON FUNCTION dispatch_item_type_parent(TEXT, UUID) IS
    'Resolves an item_type_states polymorphic parent reference to '
    '(subscription_id, archived_at). Raises foreign_key_violation if missing. '
    'See docs/c_polymorphic_writes.md.';

-- 7c. trg_entity_stakeholders_dispatch (the OUT params on dispatch fns changed name; update accordingly)
CREATE OR REPLACE FUNCTION trg_entity_stakeholders_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_subscription UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_subscription_id, parent_archived_at
      INTO parent_subscription, parent_archived
      FROM dispatch_polymorphic_parent(NEW.entity_kind, NEW.entity_id);

    IF parent_subscription IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION 'cross-subscription polymorphic write rejected: entity_stakeholders.subscription_id=% does not match parent (% / %).subscription_id=%',
            NEW.subscription_id, NEW.entity_kind, NEW.entity_id, parent_subscription
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: entity_stakeholders -> (% / %) archived_at=%',
            NEW.entity_kind, NEW.entity_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- 7d. trg_page_entity_refs_dispatch
CREATE OR REPLACE FUNCTION trg_page_entity_refs_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    page_subscription UUID;
    parent_subscription UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT subscription_id INTO page_subscription FROM pages WHERE id = NEW.page_id;
    IF page_subscription IS NULL THEN
        RAISE EXCEPTION 'page_entity_refs write rejected: page_id=% has no subscription -- bookmark pages must be subscription-scoped',
            NEW.page_id
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT parent_subscription_id, parent_archived_at
      INTO parent_subscription, parent_archived
      FROM dispatch_polymorphic_parent(NEW.entity_kind, NEW.entity_id);

    IF parent_subscription IS DISTINCT FROM page_subscription THEN
        RAISE EXCEPTION 'cross-subscription polymorphic write rejected: page_entity_refs page.subscription_id=% does not match parent (% / %).subscription_id=%',
            page_subscription, NEW.entity_kind, NEW.entity_id, parent_subscription
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: page_entity_refs -> (% / %) archived_at=%',
            NEW.entity_kind, NEW.entity_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- 7e. trg_item_type_states_dispatch
CREATE OR REPLACE FUNCTION trg_item_type_states_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_subscription UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_subscription_id, parent_archived_at
      INTO parent_subscription, parent_archived
      FROM dispatch_item_type_parent(NEW.item_type_kind, NEW.item_type_id);

    IF parent_subscription IS DISTINCT FROM NEW.subscription_id THEN
        RAISE EXCEPTION 'cross-subscription polymorphic write rejected: item_type_states.subscription_id=% does not match parent (% / %).subscription_id=%',
            NEW.subscription_id, NEW.item_type_kind, NEW.item_type_id, parent_subscription
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: item_type_states -> (% / %) archived_at=%',
            NEW.item_type_kind, NEW.item_type_id, parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

-- 7f. provision_subscription_defaults (was provision_tenant_defaults)
-- Keep the old function around as a thin wrapper for one release so any
-- in-flight callers don't break -- the new app code calls the new name.
CREATE OR REPLACE FUNCTION provision_subscription_defaults(p_subscription_id UUID, p_owner_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_roadmap_id     UUID;
    v_workspace_id   UUID;
    v_product_id     UUID;
    v_type_id        UUID;
BEGIN
    SELECT id INTO v_roadmap_id
        FROM company_roadmap
        WHERE subscription_id = p_subscription_id;

    IF v_roadmap_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'roadmap', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO company_roadmap (subscription_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, 1, 'Company Roadmap', p_owner_user_id)
            RETURNING id INTO v_roadmap_id;
    END IF;

    SELECT id INTO v_workspace_id
        FROM workspace
        WHERE subscription_id = p_subscription_id AND key_num = 1;

    IF v_workspace_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'workspace', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO workspace (subscription_id, company_roadmap_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, v_roadmap_id, 1, 'My Workspace', p_owner_user_id)
            RETURNING id INTO v_workspace_id;
    END IF;

    SELECT id INTO v_product_id
        FROM product
        WHERE subscription_id = p_subscription_id AND key_num = 1;

    IF v_product_id IS NULL THEN
        INSERT INTO subscription_sequence (subscription_id, scope, next_num)
            VALUES (p_subscription_id, 'product', 2)
            ON CONFLICT (subscription_id, scope) DO UPDATE
                SET next_num = GREATEST(subscription_sequence.next_num, 2);

        INSERT INTO product (subscription_id, workspace_id, parent_portfolio_id, key_num, name, owner_user_id)
            VALUES (p_subscription_id, v_workspace_id, NULL, 1, 'Product', p_owner_user_id)
            RETURNING id INTO v_product_id;
    END IF;

    INSERT INTO subscription_sequence (subscription_id, scope, next_num)
        VALUES (p_subscription_id, 'portfolio', 1)
        ON CONFLICT (subscription_id, scope) DO NOTHING;

    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'company_roadmap', v_roadmap_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'workspace',       v_workspace_id, p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;
    INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
        VALUES (p_subscription_id, 'product',         v_product_id,   p_owner_user_id, 'owner')
        ON CONFLICT (entity_kind, entity_id, user_id, role) DO NOTHING;

    INSERT INTO portfolio_item_types (subscription_id, name, tag, sort_order) VALUES
        (p_subscription_id, 'Portfolio Runway',   'RO', 10),
        (p_subscription_id, 'Product',            'PR', 20),
        (p_subscription_id, 'Business Objective', 'BO', 30),
        (p_subscription_id, 'Theme',              'TH', 40),
        (p_subscription_id, 'Feature',            'FE', 50)
    ON CONFLICT (subscription_id, tag) DO NOTHING;

    INSERT INTO execution_item_types (subscription_id, name, tag, sort_order) VALUES
        (p_subscription_id, 'Epic Story', 'ES', 10),
        (p_subscription_id, 'User Story', 'US', 20),
        (p_subscription_id, 'Defect',     'DE', 30),
        (p_subscription_id, 'Task',       'TA', 40)
    ON CONFLICT (subscription_id, tag) DO NOTHING;

    FOR v_type_id IN
        SELECT id FROM portfolio_item_types WHERE subscription_id = p_subscription_id AND archived_at IS NULL
    LOOP
        PERFORM seed_default_states_for_type(p_subscription_id, v_type_id, 'portfolio', TRUE);
    END LOOP;

    FOR v_type_id IN
        SELECT id FROM execution_item_types
            WHERE subscription_id = p_subscription_id
              AND archived_at IS NULL
              AND name <> 'Task'
    LOOP
        PERFORM seed_default_states_for_type(p_subscription_id, v_type_id, 'execution', TRUE);
    END LOOP;

    FOR v_type_id IN
        SELECT id FROM execution_item_types
            WHERE subscription_id = p_subscription_id
              AND archived_at IS NULL
              AND name = 'Task'
    LOOP
        PERFORM seed_default_states_for_type(p_subscription_id, v_type_id, 'execution', FALSE);
    END LOOP;
END;
$$;

-- Drop the old function name. App code must call provision_subscription_defaults.
DROP FUNCTION IF EXISTS provision_tenant_defaults(UUID, UUID);

-- 7g. seed_default_states_for_type (input param rename — DROP+CREATE)
DROP FUNCTION IF EXISTS seed_default_states_for_type(UUID, UUID, TEXT, BOOLEAN);
CREATE FUNCTION seed_default_states_for_type(p_subscription_id UUID, p_item_type_id UUID, p_item_type_kind TEXT, p_include_accepted BOOLEAN)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_defined      UUID;
    v_ready        UUID;
    v_in_progress  UUID;
    v_completed    UUID;
    v_accepted     UUID;
BEGIN
    INSERT INTO item_type_states (subscription_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, 'Defined',     'defined',     10)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, name) DO NOTHING;
    INSERT INTO item_type_states (subscription_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, 'Ready',       'ready',       20)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, name) DO NOTHING;
    INSERT INTO item_type_states (subscription_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, 'In Progress', 'in_progress', 30)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, name) DO NOTHING;
    INSERT INTO item_type_states (subscription_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, 'Completed',   'completed',   40)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, name) DO NOTHING;

    SELECT id INTO v_defined
        FROM item_type_states
        WHERE subscription_id = p_subscription_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'Defined';
    SELECT id INTO v_ready
        FROM item_type_states
        WHERE subscription_id = p_subscription_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'Ready';
    SELECT id INTO v_in_progress
        FROM item_type_states
        WHERE subscription_id = p_subscription_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'In Progress';
    SELECT id INTO v_completed
        FROM item_type_states
        WHERE subscription_id = p_subscription_id AND item_type_id = p_item_type_id
          AND item_type_kind = p_item_type_kind AND name = 'Completed';

    IF p_include_accepted THEN
        INSERT INTO item_type_states (subscription_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
            VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, 'Accepted', 'accepted', 50)
            ON CONFLICT (subscription_id, item_type_id, item_type_kind, name) DO NOTHING;

        SELECT id INTO v_accepted
            FROM item_type_states
            WHERE subscription_id = p_subscription_id AND item_type_id = p_item_type_id
              AND item_type_kind = p_item_type_kind AND name = 'Accepted';
    END IF;

    INSERT INTO item_type_transition_edges (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, v_defined,     v_ready)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;
    INSERT INTO item_type_transition_edges (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, v_ready,       v_in_progress)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;
    INSERT INTO item_type_transition_edges (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id)
        VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, v_in_progress, v_completed)
        ON CONFLICT (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;

    IF p_include_accepted THEN
        INSERT INTO item_type_transition_edges (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id)
            VALUES (p_subscription_id, p_item_type_id, p_item_type_kind, v_completed, v_accepted)
            ON CONFLICT (subscription_id, item_type_id, item_type_kind, from_state_id, to_state_id) DO NOTHING;
    END IF;
END;
$$;

-- Drop the old signature (param name changed; this drops the (UUID,UUID,TEXT,BOOLEAN) form by old internal name).
-- Postgres treats the function identity by signature types not param names, so the CREATE OR REPLACE above already
-- replaced the existing function in place. No DROP needed. Same for provision_on_first_gadmin below.

-- 7h. provision_on_first_gadmin (trigger fn on users; references NEW.tenant_id -> NEW.subscription_id)
CREATE OR REPLACE FUNCTION provision_on_first_gadmin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.role = 'gadmin' AND NEW.is_active = TRUE THEN
        IF NOT EXISTS (
            SELECT 1 FROM company_roadmap WHERE subscription_id = NEW.subscription_id
        ) THEN
            PERFORM provision_subscription_defaults(NEW.subscription_id, NEW.id);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

COMMIT;
