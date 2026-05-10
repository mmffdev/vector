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

// POST /_site/flows/{flowId}/states
func (h *Handler) CreateFlowState(w http.ResponseWriter, r *http.Request) {
	u      := auth.UserFromCtx(r.Context())
	flowID := chi.URLParam(r, "flowId")

	var in CreateStateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	st, err := h.Svc.CreateState(r.Context(), u.SubscriptionID.String(), flowID, in)
	if errors.Is(err, ErrFlowNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, st)
}

// DELETE /_site/flow-states/{id}
func (h *Handler) DeleteFlowState(w http.ResponseWriter, r *http.Request) {
	u       := auth.UserFromCtx(r.Context())
	stateID := chi.URLParam(r, "id")

	err := h.Svc.DeleteState(r.Context(), u.SubscriptionID.String(), stateID)
	if errors.Is(err, ErrStateNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /_site/flows/{flowId}/transitions
func (h *Handler) CreateTransition(w http.ResponseWriter, r *http.Request) {
	u      := auth.UserFromCtx(r.Context())
	flowID := chi.URLParam(r, "flowId")

	var in CreateTransitionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	tr, err := h.Svc.CreateTransition(r.Context(), u.SubscriptionID.String(), flowID, in)
	if errors.Is(err, ErrFlowNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if errors.Is(err, ErrTransitionExists) {
		httperr.Write(w, r, http.StatusConflict, "transition already exists")
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, tr)
}

// DELETE /_site/flows/{flowId}/transitions
func (h *Handler) DeleteTransition(w http.ResponseWriter, r *http.Request) {
	u      := auth.UserFromCtx(r.Context())
	flowID := chi.URLParam(r, "flowId")

	var in DeleteTransitionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	err := h.Svc.DeleteTransition(r.Context(), u.SubscriptionID.String(), flowID, in)
	if errors.Is(err, ErrTransitionNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
