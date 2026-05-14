package portfoliomodels

// RF1.5.2 — Cross-DB partial-failure regression test for MasterReset.
//
// MasterReset clears tenant data across two DBs in two tx:
//
//   1. masterResetVA(vaPool)        — clears artefacts, types, flows,
//                                      timeboxes, topology, master_record_*,
//                                      adoption state, then re-seeds
//                                      master_record_tenants + root topology
//                                      node + dev strategy artefacts.
//   2. masterResetVector(vectorPool) — clears workspaces + role grants
//                                      in mmff_vector.
//
// Partial-failure boundaries:
//
//   A. masterResetVA tx fails mid-way → tx rolls back, VA is in its
//      pre-reset state. masterResetVector hasn't been called. Caller
//      sees a 500 and retries.
//   B. masterResetVA tx commits, masterResetVector fails → VA is
//      reset but mmff_vector still has workspaces + role grants.
//      Retrying the handler re-runs masterResetVA (no-op on already-
//      reset VA — every DELETE is idempotent, the seed is ON CONFLICT
//      DO UPDATE) and then masterResetVector. So retry converges.
//   C. The dev_strategy_artefacts seed function is only run inside the
//      VA tx — if it fails (e.g. seed function not installed on this
//      DB), the whole VA tx rolls back and the user sees the error.
//      Filed as TD-TOP-001 — dev_reset.go is the topology sole-writer
//      boundary violation.
//
// This file is a doc-only stub for the same reasons as adopt_crossdb_test.go.
// Live tests are RF1.5.2 follow-up.
