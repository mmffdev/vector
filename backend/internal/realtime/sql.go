package realtime

// SQL used by the session sweeper (B16.8.12). Lives in a dedicated
// sql.go file to satisfy lint:sql-in-sqlfile-only — SQL strings are
// kept out of business-logic files so every query in the package is
// greppable from one place.
//
// sqlSelectSessionStatesBatch resolves a batch of users_sessions rows
// in a single roundtrip per sweep tick. last_activity mirrors the
// COALESCE the HTTP path uses (auth.sqlSelectUserBySessionID) — keeps
// the two surfaces aligned on the same idle-timestamp semantics.
const sqlSelectSessionStatesBatch = `
	SELECT users_sessions_id,
	       users_sessions_revoked,
	       COALESCE(users_sessions_rotated_at, users_sessions_created_at) AS last_activity
	  FROM users_sessions
	 WHERE users_sessions_id = ANY($1)
`
