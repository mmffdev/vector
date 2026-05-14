// Package errorsreport implements POST /api/errors/report.
//
// Wire contract (request body):
//
//	{ "code": "<string>",   "context": { ...free-form JSON... } }
//
// On success we return 204 No Content. The caller only reports an
// occurrence — there is no read surface here.
//
// Validation:
//   - code MUST exist in mmff_library.error_codes (lookup via libRO).
//     A bad/unknown code is a 400 with body {"error":"unknown_error_code"};
//     this is treated as the caller's bug, not an internal failure.
//   - context is optional and free-form JSON object. We pass it through
//     to the JSONB column as-is. Hard size cap (4 KiB encoded) matches
//     the column comment in db/mmff_vector/schema/028_error_events.sql so a single
//     misbehaving caller cannot bloat the table.
//
// All DB I/O lives in errorsreport.Service (service.go); this handler
// is parse + auth + svc.Method + render only — `lint:no-db-in-handlers`
// enforces it.
package errorsreport

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// MaxContextBytes caps the encoded JSON size of the context payload.
// Matches the "< ~4 KB" guidance documented on error_events.context in
// db/mmff_vector/schema/028_error_events.sql.
const MaxContextBytes = 4096

// Handler is the chi-mountable HTTP surface; all DB access is delegated
// to Svc.
type Handler struct {
	Svc *Service
}

// NewHandler wires the handler around an existing Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{Svc: svc}
}

// reportRequest is the wire shape. context is captured as RawMessage so
// we can re-encode it verbatim into JSONB without an intermediate
// map[string]any round-trip (which would re-order keys and discard
// numeric precision).
type reportRequest struct {
	Code    string          `json:"code"`
	Context json.RawMessage `json:"context"`
}

// Report handles POST /api/errors/report.
func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}

	var req reportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	if req.Code == "" {
		httperr.Write(w, r, http.StatusBadRequest, "missing_code")
		return
	}
	if len(req.Context) > MaxContextBytes {
		httperr.Write(w, r, http.StatusBadRequest, "context_too_large")
		return
	}

	ok, err := h.Svc.CodeExists(r.Context(), req.Code)
	if err != nil {
		if errors.Is(err, ErrLibPoolMissing) {
			httperr.Write(w, r, http.StatusServiceUnavailable, messages.InternalError)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "unknown_error_code")
		return
	}

	if err := h.Svc.Record(r.Context(), Event{
		SubscriptionID: u.SubscriptionID,
		UserID:         u.ID,
		Code:           req.Code,
		Context:        req.Context,
		RequestID:      middleware.GetReqID(r.Context()),
	}); err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
