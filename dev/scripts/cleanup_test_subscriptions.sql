-- cleanup_test_subscriptions.sql
-- One-time cleanup of integration-test fixtures that leaked into mmff_vector.
--
-- Identify: subscriptions WHERE slug LIKE 'users-test-%'
-- Safe to delete: no pages, no item_state_history, no portfolio, no library data.
--
-- Run (SSH tunnel must be up on :5434):
--   psql -h localhost -p 5434 -U mmff_dev -d mmff_vector -f dev/scripts/cleanup_test_subscriptions.sql
--
-- Verify counts first (dry-run, no changes):
--   psql ... -c "SELECT COUNT(*) FROM subscriptions WHERE slug LIKE 'users-test-%'"

BEGIN;

-- Step 1: capture the IDs to delete
CREATE TEMP TABLE _leaked_subs AS
    SELECT id FROM subscriptions WHERE slug LIKE 'users-test-%';

CREATE TEMP TABLE _leaked_users AS
    SELECT u.id FROM users u JOIN _leaked_subs l ON u.subscription_id = l.id;

-- Step 2: delete leaf tables first (RESTRICT FKs point up the chain)
DELETE FROM item_type_transition_edges WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM item_type_states           WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM entity_stakeholders        WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM execution_item_types       WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM portfolio_item_types       WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM product                    WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM workspace                  WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM company_roadmap            WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM subscription_sequence      WHERE subscription_id IN (SELECT id FROM _leaked_subs);
DELETE FROM users                      WHERE subscription_id IN (SELECT id FROM _leaked_subs);

-- Step 3: delete subscriptions (audit_log rows SET NULL, so no blocker)
DELETE FROM subscriptions WHERE id IN (SELECT id FROM _leaked_subs);

-- Step 4: verify nothing remains
DO $$
DECLARE
    remaining INT;
BEGIN
    SELECT COUNT(*) INTO remaining FROM subscriptions WHERE slug LIKE 'users-test-%';
    IF remaining > 0 THEN
        RAISE EXCEPTION 'cleanup failed: % subscriptions still match users-test-%%', remaining;
    END IF;
    RAISE NOTICE 'cleanup complete: 0 test subscriptions remaining';
END;
$$;

COMMIT;
