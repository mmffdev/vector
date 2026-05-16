-- RF1.4.2.subscriptions — rename subscription_* + entity_stakeholders.
-- entity_stakeholders → subscriptions_stakeholders (root re-anchored).
-- subscription_sequence → subscriptions_sequence (pluralised).
-- subscription_item_type_icons → subscriptions_item_type_icons.
-- subscriptions itself is already correctly named (§2.6 root family).
BEGIN;

-- ── 1. subscription_sequence → subscriptions_sequence ───────────────
ALTER TABLE subscription_sequence RENAME TO subscriptions_sequence;
ALTER TABLE subscriptions_sequence RENAME COLUMN subscription_id TO subscriptions_sequence_id_subscription;
ALTER TABLE subscriptions_sequence RENAME COLUMN scope           TO subscriptions_sequence_scope;
ALTER TABLE subscriptions_sequence RENAME COLUMN next_num        TO subscriptions_sequence_next_num;
ALTER TABLE subscriptions_sequence RENAME COLUMN updated_at      TO subscriptions_sequence_updated_at;

DROP TRIGGER IF EXISTS trg_tenant_sequence_updated_at ON subscriptions_sequence;
DROP TRIGGER IF EXISTS trg_subscription_sequence_updated_at ON subscriptions_sequence;

CREATE OR REPLACE FUNCTION subscriptions_sequence_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.subscriptions_sequence_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscriptions_sequence_set_updated_at
    BEFORE UPDATE ON subscriptions_sequence
    FOR EACH ROW EXECUTE FUNCTION subscriptions_sequence_set_updated_at();

-- ── 2. subscription_item_type_icons → subscriptions_item_type_icons ─
ALTER TABLE subscription_item_type_icons RENAME TO subscriptions_item_type_icons;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN id              TO subscriptions_item_type_icons_id;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN subscription_id TO subscriptions_item_type_icons_id_subscription;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN item_type       TO subscriptions_item_type_icons_item_type;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN icon_id         TO subscriptions_item_type_icons_id_icon;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN set_by          TO subscriptions_item_type_icons_id_user_setter;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN created_at      TO subscriptions_item_type_icons_created_at;
ALTER TABLE subscriptions_item_type_icons RENAME COLUMN updated_at      TO subscriptions_item_type_icons_updated_at;

ALTER INDEX idx_siti_sub RENAME TO subscriptions_item_type_icons_id_subscription_idx;

DO $$
DECLARE
    iv_check text;
    su_uniq  text;
BEGIN
    SELECT conname INTO iv_check FROM pg_constraint
        WHERE conrelid='subscriptions_item_type_icons'::regclass AND contype='c'
          AND conname = 'siti_item_type_valid';
    SELECT conname INTO su_uniq FROM pg_constraint
        WHERE conrelid='subscriptions_item_type_icons'::regclass AND contype='u'
          AND conname = 'siti_sub_type_unique';
    IF iv_check IS NOT NULL THEN
        EXECUTE format('ALTER TABLE subscriptions_item_type_icons RENAME CONSTRAINT %I TO subscriptions_item_type_icons_item_type_valid', iv_check);
    END IF;
    IF su_uniq IS NOT NULL THEN
        EXECUTE format('ALTER TABLE subscriptions_item_type_icons RENAME CONSTRAINT %I TO subscriptions_item_type_icons_id_subscription_item_type_key', su_uniq);
    END IF;
END $$;

-- ── 3. entity_stakeholders → subscriptions_stakeholders ─────────────
-- Polymorphic-dispatch trigger must be re-bound to the new column names.
ALTER TABLE entity_stakeholders RENAME TO subscriptions_stakeholders;

ALTER TABLE subscriptions_stakeholders RENAME COLUMN id              TO subscriptions_stakeholders_id;
ALTER TABLE subscriptions_stakeholders RENAME COLUMN subscription_id TO subscriptions_stakeholders_id_subscription;
ALTER TABLE subscriptions_stakeholders RENAME COLUMN entity_kind     TO subscriptions_stakeholders_entity_kind;
ALTER TABLE subscriptions_stakeholders RENAME COLUMN entity_id       TO subscriptions_stakeholders_entity_id;
ALTER TABLE subscriptions_stakeholders RENAME COLUMN user_id         TO subscriptions_stakeholders_id_user;
ALTER TABLE subscriptions_stakeholders RENAME COLUMN role            TO subscriptions_stakeholders_role;
ALTER TABLE subscriptions_stakeholders RENAME COLUMN created_at      TO subscriptions_stakeholders_created_at;

ALTER INDEX idx_stakeholders_subscription_id RENAME TO subscriptions_stakeholders_id_subscription_idx;
ALTER INDEX idx_stakeholders_entity          RENAME TO subscriptions_stakeholders_entity_kind_entity_id_idx;
DO $$
DECLARE
    uq_name text;
    ek_check text;
BEGIN
    SELECT conname INTO uq_name FROM pg_constraint
        WHERE conrelid='subscriptions_stakeholders'::regclass AND contype='u'
          AND conname IN ('stakeholder_unique','entity_stakeholders_unique');
    SELECT conname INTO ek_check FROM pg_constraint
        WHERE conrelid='subscriptions_stakeholders'::regclass AND contype='c';
    IF uq_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE subscriptions_stakeholders RENAME CONSTRAINT %I TO subscriptions_stakeholders_entity_role_key', uq_name);
    END IF;
    IF ek_check IS NOT NULL THEN
        EXECUTE format('ALTER TABLE subscriptions_stakeholders RENAME CONSTRAINT %I TO subscriptions_stakeholders_entity_kind_check', ek_check);
    END IF;
END $$;

-- Re-bind the polymorphic-dispatch trigger function to the new columns.
DROP TRIGGER IF EXISTS trg_entity_stakeholders_dispatch ON subscriptions_stakeholders;

CREATE OR REPLACE FUNCTION trg_subscriptions_stakeholders_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_tenant UUID;
    parent_archived TIMESTAMPTZ;
BEGIN
    SELECT parent_tenant_id, parent_archived_at
      INTO parent_tenant, parent_archived
      FROM dispatch_polymorphic_parent(NEW.subscriptions_stakeholders_entity_kind,
                                       NEW.subscriptions_stakeholders_entity_id);

    IF parent_tenant IS DISTINCT FROM NEW.subscriptions_stakeholders_id_subscription THEN
        RAISE EXCEPTION 'cross-tenant polymorphic write rejected: subscriptions_stakeholders.subscriptions_stakeholders_id_subscription=% does not match parent (% / %).tenant_id=%',
            NEW.subscriptions_stakeholders_id_subscription,
            NEW.subscriptions_stakeholders_entity_kind,
            NEW.subscriptions_stakeholders_entity_id,
            parent_tenant
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF parent_archived IS NOT NULL THEN
        RAISE EXCEPTION 'polymorphic write to archived parent rejected: subscriptions_stakeholders → (% / %) archived_at=%',
            NEW.subscriptions_stakeholders_entity_kind,
            NEW.subscriptions_stakeholders_entity_id,
            parent_archived
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS trg_entity_stakeholders_dispatch();

CREATE TRIGGER trg_subscriptions_stakeholders_dispatch
    BEFORE INSERT OR UPDATE OF
        subscriptions_stakeholders_entity_kind,
        subscriptions_stakeholders_entity_id,
        subscriptions_stakeholders_id_subscription
    ON subscriptions_stakeholders
    FOR EACH ROW
    EXECUTE FUNCTION trg_subscriptions_stakeholders_dispatch();

COMMIT;
