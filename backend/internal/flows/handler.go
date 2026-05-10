package flows

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// Handler exposes the flows domain over HTTP.
type Handler struct {
	Svc *Service
}

// NewHandler returns a Handler backed by the given Service.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// GET /api/flows
//
// Returns every flow row for the caller's subscription, grouped by target
// (system / tenant / portfolio). Caller must have flows.manage.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	out, err := h.Svc.ListBySubscription(r.Context(), u.SubscriptionID.String())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// PATCH /_site/flow-states/{id}
//
// Updates the colour of a single flow state. Body: {"colour":"#RRGGBB"} or
// {"colour":null} to clear. Returns the updated state.
func (h *Handler) PatchFlowState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	stateID := chi.URLParam(r, "id")

	var in PatchStateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	st, err := h.Svc.PatchFlowState(r.Context(), u.SubscriptionID.String(), stateID, in)
	if errors.Is(err, ErrStateNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
