package portfoliomodels

// RF1.5.1 — Cross-DB partial-failure regression test for the adoption
// orchestrator.
//
// Adopt is the 3-DB cross-write in the system:
//
//   1. libRO       — read library bundle (mmff_library)
//   2. vectorPool  — workspace lookup + saga state (mmff_vector)
//   3. vaPool      — write artefact_types / flows / master_record_portfolios /
//                    artefacts (vector_artefacts)
//
// Partial-failure boundaries the saga cannot atomically prevent:
//
//   A. libRO read succeeds, vectorPool insert fails → tx rolls back, no
//      saga state row written, idempotent retry works.
//   B. vectorPool insert succeeds (state='in_progress'), then any vaTx
//      write fails → vaTx rolls back, but the state row remains in
//      mmff_vector. The orchestrator's failure path catches this and
//      stamps status='failed' + appends an errors_events row.
//   C. The cross-DB compensation step (markFailed) itself fails — the
//      state row is left as 'in_progress' until the next retry sees
//      it via resetFailedAdoptionStateToInProgress. The retry is
//      idempotent because every vaTx writer uses ON CONFLICT DO NOTHING.
//   D. The post-commit re-validation step (plan §10) detects that the
//      library snapshot was archived between the read and the vaTx
//      commit; the saga emits ADOPT_ROLLBACK_REQUIRED and runs a
//      compensating archive on vector_artefacts.
//
// This file intentionally contains NO live tests yet — the boundary is
// documented above so the next contributor wiring real tests has the
// failure modes catalogued. Adding the tests is its own story (see
// TD-NAME-001 / RF1.5.1 in Vector_Scope.md). Without the test file the
// package is on the lint:cross-db-writer-test exempt list; once tests
// are written, this file goes from a doc-only stub to a real test file
// and the package drops off the ledger.
//
// Skip-on-unreachable discipline (mirrors cross_db_canary_test.go):
// every test added here must skip when any of the three pools can't be
// opened or pinged, so `go test ./...` runs cleanly on a machine
// without the tunnel.
