package libraryreleases

// RF1.5.4 — Cross-DB partial-failure regression test for Handler.Ack.
//
// Ack validates a release exists in libRO (mmff_library) and writes the
// acknowledgement to acksPool (vector_artefacts post-PLA-0023-P1):
//
//   1. libRO.QueryRow — confirm release_id exists, get severity + audience.
//   2. acksPool.Exec  — INSERT INTO library_releases_acknowledgements …
//                       ON CONFLICT (subscription, release) DO NOTHING.
//
// No shared tx — the two DBs cannot participate in a single Postgres tx.
//
// Partial-failure boundaries:
//
//   A. libRO succeeds, acksPool insert fails → release validated, ack
//      not persisted. Caller sees a 500. Retry hits libRO again
//      (idempotent) and re-attempts the ack (idempotent via ON CONFLICT).
//   B. libRO returns ErrNoRows → handler returns 404; no ack attempt.
//   C. acksPool inserts a row referencing a release_id that was hard-
//      deleted from mmff_library between libRO read and the ack insert.
//      The cross-DB FK is by-value only; the ack row becomes a dangling
//      reference. Mitigated by the convention that library_releases is
//      soft-archived, never hard-deleted (filed as TD-LIB-008).
//
// Live tests are RF1.5.4 follow-up.
