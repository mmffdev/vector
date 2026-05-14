package artefacttypes

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

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Patch("/{id}", h.Patch)
}

// GET /_site/artefact-types
// Returns all live artefact types for the caller's subscription.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	types, err := h.Svc.List(r.Context(), u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	if types == nil {
		types = []ArtefactType{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"types": types})
}

// PATCH /_site/artefact-types/{id}
// Partial update: name, prefix, description, colour.
// Returns 422 with violations[] on validation failure.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid artefact type id")
		return
	}

	var in PatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	updated, err := h.Svc.Patch(r.Context(), id, u.SubscriptionID, in)
	if err != nil {
		var ve *ValidationError
		if errors.As(err, &ve) {
			type violation struct {
				Field   string `json:"field"`
				Message string `json:"message"`
			}
			viols := make([]violation, len(ve.Violations))
			for i, v := range ve.Violations {
				viols[i] = violation{v.Field, v.Message}
			}
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"violations": viols})
			return
		}
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
