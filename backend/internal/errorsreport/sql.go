// Package errorsreport SQL constants.
//
// PLA-0048 / RF1.2.15. Cross-DB validate-then-write: libRO checks the
// error_codes catalogue in mmff_library; vectorPool writes error_events
// (vector_artefacts post-PLA-0023-P1).
package errorsreport

// sqlSelectErrorCodeExists is the catalogue probe against mmff_library.
const sqlSelectErrorCodeExists = `SELECT 1 FROM error_codes WHERE code = $1`

// sqlInsertErrorEvent persists one event row.
const sqlInsertErrorEvent = `
		INSERT INTO error_events (subscription_id, user_id, code, context, request_id)
		VALUES ($1, $2, $3, $4, $5)
	`
