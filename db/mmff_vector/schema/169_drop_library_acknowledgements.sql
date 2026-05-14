-- mmff_vector: drop library_acknowledgements
-- 2026-05-13 — PLA-0023 P1 (mmff_vector → vector_artefacts consolidation)
--
-- Pre-drop verification (run from psql on 2026-05-13):
--   • source rows in mmff_vector.library_acknowledgements: 0
--   • target rows in vector_artefacts.library_acknowledgements: 0 (created by
--     artefacts_schema/049 on this date)
--   • incoming FKs to library_acknowledgements in mmff_vector: none
--   • Go writers/readers repointed: librarydb.{ListReleasesSinceAck,
--     loadAckedSet, AckRelease, CountOutstandingForSubscription} now take
--     acksPool; libraryreleases.Service + Reconciler hold acksPool and are
--     swapped to vaPool via SetAcksPool() once vaPool init succeeds in
--     backend/cmd/server/main.go (audit.Logger pattern).
--
-- Cross-DB note: subscription_id and acknowledged_by_user_id remain
-- app-enforced FKs (no DB-level FKs ever existed — see artefacts_schema/049).

BEGIN;

DROP TABLE IF EXISTS library_acknowledgements;

COMMIT;
