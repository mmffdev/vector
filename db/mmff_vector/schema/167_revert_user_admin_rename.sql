-- ============================================================
-- MMFFDev - Vector: REVERT migration 166 — restore 'User Management' label
-- Migration 167
--
-- Migration 166 renamed 'User Management' → 'User Admin' in
-- user_nav_groups. This caused the rail to lose all sections at
-- runtime because the Go nav service in service.go has a self-heal
-- routine that hard-codes the label 'User Management' (line 177)
-- and re-seeds + rebuilds page→group bindings against that exact
-- string. With both labels present, the rebuild path produced
-- inconsistent state and the frontend rendered nothing.
--
-- Reverting the rename here keeps prod-data integrity. The proper
-- way to rename a bucket is to update the Go seed simultaneously,
-- which is a coordinated backend+DB change — to be done as a
-- separate plan/story rather than a stand-alone DB rename.
-- ============================================================

BEGIN;

UPDATE user_nav_groups
   SET label = 'User Management'
 WHERE LOWER(label) = 'user admin';

COMMIT;
