-- RF1.4.2.admin — api_keys → admin_api_keys + column-prefix.
BEGIN;

ALTER TABLE api_keys RENAME TO admin_api_keys;

ALTER TABLE admin_api_keys RENAME COLUMN id                TO admin_api_keys_id;
ALTER TABLE admin_api_keys RENAME COLUMN subscription_id   TO admin_api_keys_id_subscription;
ALTER TABLE admin_api_keys RENAME COLUMN prefix            TO admin_api_keys_prefix;
ALTER TABLE admin_api_keys RENAME COLUMN hash              TO admin_api_keys_hash;
ALTER TABLE admin_api_keys RENAME COLUMN scopes            TO admin_api_keys_scopes;
ALTER TABLE admin_api_keys RENAME COLUMN rate_limit_config TO admin_api_keys_rate_limit_config;
ALTER TABLE admin_api_keys RENAME COLUMN created_at        TO admin_api_keys_created_at;
ALTER TABLE admin_api_keys RENAME COLUMN expires_at        TO admin_api_keys_expires_at;
ALTER TABLE admin_api_keys RENAME COLUMN revoked_at        TO admin_api_keys_revoked_at;
ALTER TABLE admin_api_keys RENAME COLUMN last_used_at      TO admin_api_keys_last_used_at;
ALTER TABLE admin_api_keys RENAME COLUMN created_by        TO admin_api_keys_id_user_creator;

ALTER INDEX idx_api_keys_subscription_id RENAME TO idx_admin_api_keys_id_subscription;
ALTER INDEX idx_api_keys_prefix          RENAME TO idx_admin_api_keys_prefix;
ALTER INDEX idx_api_keys_revoked_at      RENAME TO idx_admin_api_keys_revoked_at;
ALTER INDEX idx_api_keys_expires_at      RENAME TO idx_admin_api_keys_expires_at;

-- Auto-named UNIQUE + FK constraints — locate dynamically and rename.
DO $$
DECLARE
    prefix_uq text;
    hash_uq   text;
    sub_fk    text;
    user_fk   text;
BEGIN
    SELECT conname INTO prefix_uq FROM pg_constraint
        WHERE conrelid='admin_api_keys'::regclass AND contype='u'
          AND pg_get_constraintdef(oid) LIKE '%(admin_api_keys_prefix)%';
    SELECT conname INTO hash_uq FROM pg_constraint
        WHERE conrelid='admin_api_keys'::regclass AND contype='u'
          AND pg_get_constraintdef(oid) LIKE '%(admin_api_keys_hash)%';
    SELECT conname INTO sub_fk FROM pg_constraint
        WHERE conrelid='admin_api_keys'::regclass AND contype='f'
          AND pg_get_constraintdef(oid) LIKE '%(admin_api_keys_id_subscription)%';
    SELECT conname INTO user_fk FROM pg_constraint
        WHERE conrelid='admin_api_keys'::regclass AND contype='f'
          AND pg_get_constraintdef(oid) LIKE '%(admin_api_keys_id_user_creator)%';

    IF prefix_uq IS NOT NULL THEN EXECUTE format('ALTER TABLE admin_api_keys RENAME CONSTRAINT %I TO admin_api_keys_prefix_key', prefix_uq); END IF;
    IF hash_uq   IS NOT NULL THEN EXECUTE format('ALTER TABLE admin_api_keys RENAME CONSTRAINT %I TO admin_api_keys_hash_key',   hash_uq);   END IF;
    IF sub_fk    IS NOT NULL THEN EXECUTE format('ALTER TABLE admin_api_keys RENAME CONSTRAINT %I TO admin_api_keys_id_subscription_fkey', sub_fk);  END IF;
    IF user_fk   IS NOT NULL THEN EXECUTE format('ALTER TABLE admin_api_keys RENAME CONSTRAINT %I TO admin_api_keys_id_user_creator_fkey',  user_fk); END IF;
END $$;

COMMIT;
