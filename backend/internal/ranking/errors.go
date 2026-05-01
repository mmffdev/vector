package ranking

import "errors"

var (
	// ErrUnknownResource is returned by Lookup when the resource type
	// hasn't been registered. Map to HTTP 400.
	ErrUnknownResource = errors.New("ranking: unknown resource type")

	// ErrForbidden is returned by the rank service when the resource's
	// PermissionChecker rejects the move. Map to HTTP 403.
	ErrForbidden = errors.New("ranking: forbidden")

	// ErrRowNotFound is returned when the row being moved (or a
	// before/after target) does not exist in the resource's table or
	// belongs to a different subscription. Map to HTTP 404.
	ErrRowNotFound = errors.New("ranking: row not found")

	// ErrScopeMismatch is returned when the move's before/after
	// targets are in a different scope than the row being moved
	// (e.g. dropping a backlog item next to a sprint item). Map to
	// HTTP 409.
	ErrScopeMismatch = errors.New("ranking: scope mismatch between row and targets")

	// ErrInvalidArgument is returned for malformed input — empty
	// scope, both before+after set, neither set, etc. Map to 400.
	ErrInvalidArgument = errors.New("ranking: invalid argument")
)
