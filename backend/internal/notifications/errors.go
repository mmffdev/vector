package notifications

import "errors"

var (
	ErrNotFound     = errors.New("notification not found")
	ErrInvalidInput = errors.New("invalid input")
)
