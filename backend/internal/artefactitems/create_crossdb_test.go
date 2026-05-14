package artefactitems

// RF1.5.3 — Cross-DB partial-failure regression test for CreateWorkItem.
//
// CreateWorkItem performs a cross-DB READ inside its single write tx:
//
//   1. Open vaTx (vector_artefacts)
//   2. Inside vaTx: SELECT … FROM artefacts_types WHERE … (VA — same DB)
//   3. Inside vaTx: cross-DB read against mainPool (mmff_vector) for the
//      owner-decoration lookup that picks the human-readable label out
//      of the users table.
//   4. Inside vaTx: INSERT INTO artefacts … (VA — same DB)
//   5. Commit vaTx
//
// Step 3 is the partial-failure surface. mainPool can return ErrNoRows
// for a stale user_id, or fail to open a connection entirely. The current
// behaviour:
//
//   A. mainPool ErrNoRows → owner decoration is left nil and the
//      artefact is created. Acceptable (the row is still valid).
//   B. mainPool connection-failure → the cross-DB read errors out;
//      vaTx is rolled back; caller sees a 500. Retry converges.
//   C. vaTx commits but the response render fails before the client
//      sees the 201 → the artefact is persisted but the caller thinks
//      it failed. The follow-up retry would create a duplicate (no
//      idempotency key on artefact creation today). Documented gap.
//
// Live tests are RF1.5.3 follow-up.
