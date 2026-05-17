package flows

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/topology"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes the flows domain over HTTP.
type Handler struct {
	Svc *Service
}

// NewHandler returns a Handler backed by the given Service.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// GET /api/flows
//
// Returns every flow row for the caller's active workspace, grouped by scope
// (work / strategy). Caller must have flows.manage. WorkspaceClampMiddleware
// must be applied on the route so topology.WorkspaceIDFromCtx is populated.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	wsID, ok := topology.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "active workspace not set")
		return
	}
	out, err := h.Svc.ListByWorkspace(r.Context(), u.SubscriptionID.String(), wsID.String())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
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
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
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
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
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
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
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
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /_site/flow-states/{id}/exit-rules
//
// Returns the ordered list of active exit rules for one flow state.
func (h *Handler) ListExitRules(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	stateID := chi.URLParam(r, "id")

	rules, err := h.Svc.ListExitRules(r.Context(), u.SubscriptionID.String(), stateID)
	if errors.Is(err, ErrStateNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, rules)
}

// POST /_site/flow-states/{id}/exit-rules
//
// Appends a new exit rule to a flow state at max(sort_order)+10.
func (h *Handler) CreateExitRule(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	stateID := chi.URLParam(r, "id")

	var in CreateExitRuleInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	rule, err := h.Svc.CreateExitRule(r.Context(), u.SubscriptionID.String(), stateID, in)
	if errors.Is(err, ErrStateNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, rule)
}

// PATCH /_site/flow-state-exit-rules/{id}
//
// Updates name, colour, or sort_order on one exit rule.
func (h *Handler) PatchExitRule(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	ruleID := chi.URLParam(r, "id")

	var in PatchExitRuleInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	rule, err := h.Svc.PatchExitRule(r.Context(), u.SubscriptionID.String(), ruleID, in)
	if errors.Is(err, ErrExitRuleNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, rule)
}

// DELETE /_site/flow-state-exit-rules/{id}
func (h *Handler) DeleteExitRule(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	ruleID := chi.URLParam(r, "id")

	err := h.Svc.DeleteExitRule(r.Context(), u.SubscriptionID.String(), ruleID)
	if errors.Is(err, ErrExitRuleNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
