package usermessages

// Auth
const (
	AuthInvalidCredentials     = "The email or password you entered is incorrect."
	AuthAccountLocked          = "Your account has been locked after too many failed attempts. Please contact your administrator."
	AuthAccountInactive        = "Your account is not active. Please contact your administrator."
	AuthTokenExpired           = "Your session has expired. Please sign in again."
	AuthUnauthorized           = "You must be signed in to do that."
	AuthForbidden              = "You don't have permission to do that."
	AuthPasswordChangeRequired = "You must change your password before continuing."
	AuthCSRFInvalid            = "Your session appears invalid. Please refresh the page and try again."
	AuthInvalidCurrentPassword = "Your current password is incorrect."
	// Session-state messages — paired with Problem.Code values declared
	// in `auth/errors.go` (B16.8.11 step 3). Detail strings are what the
	// user reads; the Code drives frontend routing.
	AuthSessionRevoked     = "Your session was ended (signed out from another device or revoked by an admin). Please sign in again."
	AuthSessionIdleExpired = "Your session expired due to inactivity. Please re-enter your password to continue."
	// B16.8.10 — per-action step-up reauth.
	AuthReauthRequired = "Please re-enter your password to confirm this action."
	AuthReauthInvalid  = "That confirmation has expired or already been used. Please try again."
	// B16.8 P4 — HIBP breach-password check (enforce mode only). Telemetry
	// mode never surfaces this string because the user is never blocked.
	AuthBreachedPassword = "This password has appeared in a known data breach. Please choose a different one."
)

// Request
const (
	RequestInvalidBody   = "The request body was not valid."
	RequestInvalidID     = "The ID provided was not valid."
	RequestMissingFields = "Some required fields are missing."
	RequestBadRequest    = "The request was not valid."
)

// Generic
const (
	NotFound           = "The requested item could not be found."
	Conflict           = "This action conflicts with existing data."
	InternalError      = "Something went wrong on our end. Please try again."
	ServiceUnavailable = "This feature is temporarily unavailable. Please try again shortly."
	LimitReached       = "You've reached the maximum number allowed."
	ResourceArchived   = "This resource has been archived and cannot be modified."
	ResourceLocked     = "This resource is protected and cannot be changed."
)

// Success
const (
	PasswordChanged   = "Your password has been changed successfully."
	PasswordResetSent = "If that email exists, a reset link has been sent."
)
