-- ============================================================
-- MMFFDev - Vector: DOWN for migration 249 (drop 6 placeholder tables)
-- Restores: company_roadmap, workspace, portfolio, product,
--           execution_item_types, subscriptions_item_type_icons
-- Also restores the polymorphic dispatch procs + page_entity_refs trigger.
--
-- NOTE: The schemas here reflect the post-mig-183 state (subscription_id /
-- subscriptions) not the original mig-004/005 tenant_id / tenants names.
-- The dispatch proc bodies also use subscription_id per mig-183.
--
-- This DOWN is a syntactically valid rollback safety net. It has NOT been
-- production-tested; it restores the tables empty (no data recovery).
-- ============================================================

BEGIN;

-- ── 1. Restore tables (root → leaf per FK direction) ─────────────────

CREATE TABLE company_roadmap (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL UNIQUE REFERENCES subscriptions(id) ON DELETE RESTRICT,
    key_num         BIGINT      NOT NULL CHECK (key_num > 0),
    name            TEXT        NOT NULL,
    owner_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT company_roadmap_key_unique UNIQUE (subscription_id, key_num)
);

CREATE TRIGGER trg_company_roadmap_updated_at
    BEFORE UPDATE ON company_roadmap
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE workspace (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id     UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    company_roadmap_id  UUID        NOT NULL REFERENCES company_roadmap(id) ON DELETE RESTRICT,
    key_num             BIGINT      NOT NULL CHECK (key_num > 0),
    name                TEXT        NOT NULL,
    owner_user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT workspace_key_unique UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_workspace_subscription_id     ON workspace(subscription_id);
CREATE INDEX idx_workspace_company_roadmap_id  ON workspace(company_roadmap_id);
CREATE INDEX idx_workspace_active              ON workspace(subscription_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_workspace_updated_at
    BEFORE UPDATE ON workspace
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE portfolio (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    workspace_id    UUID        NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    key_num         BIGINT      NOT NULL CHECK (key_num > 0),
    name            TEXT        NOT NULL,
    owner_user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT portfolio_key_unique UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_portfolio_subscription_id ON portfolio(subscription_id);
CREATE INDEX idx_portfolio_workspace_id    ON portfolio(workspace_id);
CREATE INDEX idx_portfolio_active          ON portfolio(subscription_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_portfolio_updated_at
    BEFORE UPDATE ON portfolio
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id      UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    workspace_id         UUID        NOT NULL REFERENCES workspace(id) ON DELETE RESTRICT,
    parent_portfolio_id  UUID        REFERENCES portfolio(id) ON DELETE RESTRICT,
    key_num              BIGINT      NOT NULL CHECK (key_num > 0),
    name                 TEXT        NOT NULL,
    owner_user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    archived_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT product_key_unique UNIQUE (subscription_id, key_num)
);

CREATE INDEX idx_product_subscription_id      ON product(subscription_id);
CREATE INDEX idx_product_workspace_id         ON product(workspace_id);
CREATE INDEX idx_product_parent_portfolio_id  ON product(parent_portfolio_id);
CREATE INDEX idx_product_active               ON product(subscription_id) WHERE archived_at IS NULL;

CREATE TRIGGER trg_product_updated_at
    BEFORE UPDATE ON product
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE execution_item_types (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    name            TEXT        NOT NULL,
    tag             TEXT        NOT NULL CHECK (length(tag) >= 2 AND length(tag) <= 4),
    sort_order      INT         NOT NULL DEFAULT 0,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT execution_item_types_name_unique UNIQUE (subscription_id, name),
    CONSTRAINT execution_item_types_tag_unique  UNIQUE (subscription_id, tag)
);

CREATE INDEX idx_execution_item_types_subscription_id ON execution_item_types(subscription_id);
CREATE INDEX idx_execution_item_types_active          ON execution_item_types(subscription_id) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION execution_item_types_lock_name()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
        RAISE EXCEPTION 'execution_item_types.name is immutable (id=%, old=%, new=%)',
            OLD.id, OLD.name, NEW.name
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_execution_item_types_lock_name
    BEFORE UPDATE ON execution_item_types
    FOR EACH ROW EXECUTE FUNCTION execution_item_types_lock_name();

CREATE TRIGGER trg_execution_item_types_updated_at
    BEFORE UPDATE ON execution_item_types
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE subscriptions_item_type_icons (
    subscriptions_item_type_icons_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriptions_item_type_icons_id_subscription UUID        NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    subscriptions_item_type_icons_item_type       TEXT        NOT NULL,
    subscriptions_item_type_icons_id_icon         UUID        NOT NULL REFERENCES vector_icons(id) ON DELETE RESTRICT,
    subscriptions_item_type_icons_id_user_setter  UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    subscriptions_item_type_icons_created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    subscriptions_item_type_icons_updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT subscriptions_item_type_icons_item_type_valid
        CHECK (subscriptions_item_type_icons_item_type IN ('epic','story','task','defect')),
    CONSTRAINT subscriptions_item_type_icons_id_subscription_item_type_key
        UNIQUE (subscriptions_item_type_icons_id_subscription, subscriptions_item_type_icons_item_type)
);

CREATE INDEX subscriptions_item_type_icons_id_subscription_idx
    ON subscriptions_item_type_icons(subscriptions_item_type_icons_id_subscription);

CREATE TRIGGER trg_siti_updated_at
    BEFORE UPDATE ON subscriptions_item_type_icons
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 2. Restore dispatch procs (post-mig-183 subscription_id form) ─────

CREATE OR REPLACE FUNCTION dispatch_polymorphic_parent(
    p_kind TEXT,
    p_id   UUID,
    OUT parent_subscription_id UUID,
    OUT parent_archived_at     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE AS $$
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

CREATE OR REPLACE FUNCTION dispatch_item_type_parent(
    p_kind TEXT,
    p_id   UUID,
    OUT parent_subscription_id UUID,
    OUT parent_archived_at     TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE AS $$
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

-- ── 3. Restore trigger function + trigger on page_entity_refs ─────────

CREATE OR REPLACE FUNCTION trg_page_entity_refs_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS trg_page_entity_refs_dispatch ON page_entity_refs;
CREATE TRIGGER trg_page_entity_refs_dispatch
    BEFORE INSERT OR UPDATE OF entity_kind, entity_id, page_id
    ON page_entity_refs
    FOR EACH ROW EXECUTE FUNCTION trg_page_entity_refs_dispatch();

-- ── 4. Remove the schema_migrations row ──────────────────────────────
DELETE FROM schema_migrations WHERE filename = '249_drop_placeholder_tables.sql';

COMMIT;
