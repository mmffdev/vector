package errorsreport

// RF1.5.5 — Cross-DB partial-failure regression test for Handler.Report.
//
// Report validates the error code against libRO (mmff_library) and
// writes the event to vaPool (vector_artefacts):
//
//   1. libRO.QueryRow(sqlSelectErrorCodeExists) — accept any registered
//      code; reject unknowns with 400.
//   2. vaPool.Exec(sqlInsertErrorEvent) — append-only row in
//      errors_events.
//
// No shared tx — same constraint as libraryreleases.Ack.
//
// Partial-failure boundaries:
//
//   A. libRO succeeds, vaPool insert fails → caller sees 500. The event
//      is lost. Append-only is by definition non-recoverable. Mitigated
//      by structured logging upstream (a logged error_event is more
//      valuable than the DB row in some triage paths).
//   B. libRO returns ErrNoRows → 400 BadRequest, no event written.
//   C. libRO connection-failure → 500. We do NOT fall back to "log
//      anyway with unknown code" — that would let the client smuggle
//      junk codes in. Strict by design.
//
// Live tests are RF1.5.5 follow-up.
