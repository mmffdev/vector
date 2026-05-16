-- MMFFDev - Vector: drop error_events from mmff_vector
-- 2026-05-13 — mmff_vector → vector_artefacts consolidation, P1
--
-- error_events relocated to vector_artefacts (db/artefacts_schema/048_create_error_events.sql).
-- 18 rows copied via CSV snapshot at 2026-05-13; backend repointed at:
--   • errorsreport.NewService — main.go:501-505 selects vaPool when present
--   • portfoliomodels.Orchestrator.ErrorsPool — defaults to vaPool in NewOrchestrator
-- Post-restart verification: vaPool init logged "vector_artefacts pool connected";
-- both writer surfaces now bypass mmff_vector entirely.
--
-- Cross-DB FKs that previously lived on this table:
--   • subscription_id REFERENCES subscriptions(id) ON DELETE RESTRICT
--   • user_id REFERENCES users(id) ON DELETE SET NULL
-- Both become app-enforced — see vector_artefacts mig 048 comment. Append-only
-- trigger + indexes preserved on VA.
--
-- Restoration path: 770K backup at
-- "MMFFDev - Vector Assets/db-backups/mmff_vector_20260513_053809.dump".

BEGIN;

-- Trigger function is shared at function-level (not table-level); drop the
-- triggers explicitly so the DROP TABLE is clean, then drop the function.
DROP TABLE IF EXISTS error_events;
DROP FUNCTION IF EXISTS error_events_append_only();

COMMIT;
