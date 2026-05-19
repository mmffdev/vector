package cspreport

// sqlInsertCSPReport persists one browser-reported CSP violation.
// Column order matches the bind args in service.go::InsertReport.
const sqlInsertCSPReport = `
	INSERT INTO csp_reports (
		document_uri, referrer,
		violated_directive, effective_directive, original_policy,
		disposition,
		blocked_uri, source_file,
		line_number, column_number, status_code,
		user_agent,
		remote_ip,
		raw
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
