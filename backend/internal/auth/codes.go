package auth

// Problem.Code values emitted on auth-related 4xx responses (B16.8.11
// step 3). Lower_snake_case, machine-stable. Paired with the
// usermessages.Auth* human-readable detail strings.
//
// Frontend AuthContext (B16.8.11 step 4) switches on these codes to
// route session-state vs generic-unauth flows without parsing the
// detail string.
const (
	CodeSessionRevoked     = "session_revoked"
	CodeSessionIdleExpired = "session_idle_expired"
)
