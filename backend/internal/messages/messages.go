package messages

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
)

// Success
const (
	PasswordChanged   = "Your password has been changed successfully."
	PasswordResetSent = "If that email exists, a reset link has been sent."
)
