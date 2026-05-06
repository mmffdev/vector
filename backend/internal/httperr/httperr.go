// Package httperr writes RFC 9457 Problem Details responses.
//
// Every 4xx and 5xx from any handler must go through Write or WriteValidation
// so the wire format is always application/problem+json with the required fields.
//
// Ref: https://www.rfc-editor.org/rfc/rfc9457
package httperr

import (
	"encoding/json"
	"net/http"
)

// Problem is the RFC 9457 problem-details body.
type Problem struct {
	Type       string       `json:"type"`
	Title      string       `json:"title"`
	Status     int          `json:"status"`
	Detail     string       `json:"detail"`
	Instance   string       `json:"instance"`
	Violations []Violation  `json:"violations,omitempty"`
}

// Violation is one entry in the violations array (422 responses).
type Violation struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Write emits a RFC 9457 problem-details response. detail is the human-readable
// description of the specific error; status determines the HTTP status code and
// the standard title. instance is set from r.URL.Path.
func Write(w http.ResponseWriter, r *http.Request, status int, detail string) {
	writeProblem(w, r, status, detail, nil)
}

// WriteValidation emits a 422 Unprocessable Entity with a violations array.
func WriteValidation(w http.ResponseWriter, r *http.Request, violations []Violation) {
	writeProblem(w, r, http.StatusUnprocessableEntity, "validation failed", violations)
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, detail string, violations []Violation) {
	p := Problem{
		Type:       "about:blank",
		Title:      http.StatusText(status),
		Status:     status,
		Detail:     detail,
		Instance:   r.URL.Path,
		Violations: violations,
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}
