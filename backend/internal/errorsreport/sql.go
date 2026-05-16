// Package errorsreport SQL constants.
//
// PLA-0048 / RF1.2.15 (consts) + RF1.4.2.errors (column-prefix rule,
// migrations 013 lib + 057 VA). Cross-DB validate-then-write: libRO
// checks errors_codes in mmff_library; vaPool writes errors_events in
// vector_artefacts.
package errorsreport

// sqlSelectErrorCodeExists is the catalogue probe against mmff_library.
const sqlSelectErrorCodeExists = `SELECT 1 FROM errors_codes WHERE errors_codes_code = $1`

// sqlInsertErrorEvent persists one event row.
const sqlInsertErrorEvent = `
		INSERT INTO errors_events (
			errors_events_id_subscription,
			errors_events_id_user,
			errors_events_code,
			errors_events_context,
			errors_events_request_id
		) VALUES ($1, $2, $3, $4, $5)
	`
