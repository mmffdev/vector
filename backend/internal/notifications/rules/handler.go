package rules

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes the rules CRUD over HTTP. Mounted on both
// /_site/notifications/rules and /samantha/v2/notifications/rules.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// List — GET /notifications/rules
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	rules, err := h.svc.ListForUser(r.Context(), user.ID, user.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"rules": rules,
		"count": len(rules),
	})
}

// Get — GET /notifications/rules/{id}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	rule, err := h.svc.Get(r.Context(), id, user.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rule)
}

// Create — POST /notifications/rules
//
// Body: {
//   name: string,
//   type: "artefact",
//   target: string,                  // artefact_type id for type=artefact
//   conditions: [{field, operator, value}]
// }
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var body struct {
		Name        string      `json:"name"`
		Type        string      `json:"type"`
		WorkspaceID string      `json:"workspace_id"`
		Target      *string     `json:"target,omitempty"`
		Conditions  []Condition `json:"conditions"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	wsID, err := uuid.Parse(body.WorkspaceID)
	if err != nil {
		httperr.WriteValidation(w, r, []httperr.Violation{
			{Field: "workspace_id", Message: "must be a valid uuid"},
		})
		return
	}
	rule, err := h.svc.Create(r.Context(), CreateInput{
		SubscriptionID: user.SubscriptionID,
		UserID:         user.ID,
		WorkspaceID:    wsID,
		Name:           body.Name,
		Type:           RuleType(body.Type),
		Target:         body.Target,
		Conditions:     body.Conditions,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		case errors.Is(err, ErrUnsupportedType):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "type", Message: err.Error()},
			})
		case errors.Is(err, ErrAdminScopeUnwired):
			httperr.Write(w, r, http.StatusConflict, err.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(rule)
}

// Update — PATCH /notifications/rules/{id}
//
// Sparse update: name / conditions / enabled. Nil = unchanged.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var body struct {
		Name       *string      `json:"name,omitempty"`
		Conditions *[]Condition `json:"conditions,omitempty"`
		Enabled    *bool        `json:"enabled,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	rule, err := h.svc.Update(r.Context(), id, user.ID, UpdateInput{
		Name:       body.Name,
		Conditions: body.Conditions,
		Enabled:    body.Enabled,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrInvalidInput):
			httperr.WriteValidation(w, r, []httperr.Violation{
				{Field: "body", Message: err.Error()},
			})
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(rule)
}

// Delete — DELETE /notifications/rules/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromCtx(r.Context())
	if user == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.svc.Delete(r.Context(), id, user.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
