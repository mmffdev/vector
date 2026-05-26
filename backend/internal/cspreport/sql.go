package cspreport

// sqlInsertCSPReport persists one browser-reported CSP violation.
// Column order matches the bind args in service.go::InsertReport.
//
// Post Pillar 3 step 1 (refactorDB, 2026-05-26): csp_reports lives in
// vector_artefacts with the full-table-name column-prefix rule applied
// (`csp_reports_<col>`). The mmff_vector copy of the table is bare-
// column but is now a write-mute zombie (no backend service writes to
// it after the pool repoint). Column names match the VA schema.
const sqlInsertCSPReport = `
	INSERT INTO csp_reports (
		csp_reports_document_uri, csp_reports_referrer,
		csp_reports_violated_directive, csp_reports_effective_directive, csp_reports_original_policy,
		csp_reports_disposition,
		csp_reports_blocked_uri, csp_reports_source_file,
		csp_reports_line_number, csp_reports_column_number, csp_reports_status_code,
		csp_reports_user_agent,
		csp_reports_remote_ip,
		csp_reports_raw
	) VALUES (
		$1, $2,
		$3, $4, $5,
		$6,
		$7, $8,
		$9, $10, $11,
		$12,
		$13,
		$14::jsonb
	)
`
