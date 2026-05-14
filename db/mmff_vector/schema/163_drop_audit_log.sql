-- MMFFDev - Vector: drop audit_log from mmff_vector
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P1
--
-- audit_log relocated to vector_artefacts (db/artefacts_schema/047_create_audit_log.sql).
-- 3676 rows copied via CSV snapshot at 2026-05-13 04:41 UTC; backend repointed
-- via audit.Logger.SetPool(vaPool) inside the vaPool init block in
-- backend/cmd/server/main.go. Post-restart verification: new auth.login_failed
-- audit row landed on vector_artefacts.audit_log at 04:47:31, mmff_vector.audit_log
-- received zero writes after the cutover. Safe to drop.
--
-- Cross-DB FKs that previously lived on this table (user_id, subscription_id)
-- are now app-enforced — see vector_artefacts mig 047 comment.
--
-- Restoration path: 770K backup at
-- "MMFFDev - Vector Assets/db-backups/mmff_vector_20260513_053809.dump".

BEGIN;

DROP TABLE IF EXISTS audit_log;

COMMIT;
