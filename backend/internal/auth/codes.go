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
	// B16.8.10 — per-action step-up reauth.
	//
	// reauth_required: middleware gating a sensitive action found no
	// (or invalid) X-Action-Proof header. The 409 response body carries
	// {action_token: <opaque>} — the frontend opens the reauth modal,
	// the user re-presents password (+ TOTP), POSTs to /auth/reauth,
	// then retries the original request with the returned proof.
	//
	// reauth_invalid: caller presented an X-Action-Proof but it failed
	// validation (bad HMAC, wrong action_key, already consumed, expired).
	// 401 — distinct from generic AuthUnauthorized so the frontend can
	// re-open the reauth modal rather than redirecting to /login.
	CodeReauthRequired = "reauth_required"
	CodeReauthInvalid  = "reauth_invalid"
	// B16.8 P4 — HIBP breach-password check.
	//
	// breached_password: the candidate password matches an entry in the
	// HaveIBeenPwned breach corpus AND HIBP_CHECK_MODE=enforce. The
	// handler returns 400 with this code so the frontend can render a
	// targeted "choose a different password" prompt instead of the
	// generic "request invalid" surface. Telemetry-only mode (the
	// default rollout setting) logs the hit but does NOT emit this code.
	CodeBreachedPassword = "breached_password"
	// TD-SEC-SESSION-ANOMALY — geo / ASN drift on /auth/refresh.
	//
	// session_anomaly: the inbound refresh request resolved to a
	// different country or ASN than the session's first_country /
	// first_asn baseline. Treated as a terminal session-state code
	// — the frontend's hardLogout cascade catches it and redirects
	// to /login with an explanatory banner ("we detected a location
	// change — please sign in to continue"). The session family is
	// revoked on the backend before this code is emitted; refresh
	// is irrecoverable. Audit row carries both fingerprints for
	// forensics.
	CodeSessionAnomaly = "session_anomaly"
)
