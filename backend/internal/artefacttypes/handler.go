package artefacttypes

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/sentinel"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

type Handler struct {
	Svc *Service
	// Perms resolves the caller's effective permission set for the
	// route-level gate on write endpoints (see Mount). The READ routes
	// (List/Patch today) keep their existing auth-only posture; the new
	// create route is gated on portfolio.model.edit.
	Perms *permissions.Resolver
}

func NewHandler(s *Service, perms *permissions.Resolver) *Handler {
	return &Handler{Svc: s, Perms: perms}
}

func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Patch("/{id}", h.Patch)
	// Server is the gate: creating a tenant work type requires
	// portfolio.model.edit. Modelled on the existing route gates in
	// cmd/server/main.go (e.g. WorkItemsSettingsEdit on artefact-priorities).
	gate := auth.RequirePermission(h.Perms, permissions.PortfolioModelEdit)
	r.With(gate).Post("/", h.Create)
}

// GET /_site/artefact-types
// Returns live artefact types for the caller. PLA-0053 / story 00579:
// when a workspace clamp is seeded on context (by WorkspaceClampMiddleware
// per story 00578), reads narrow to that workspace. Without a clamp
// (admin tools or migrations that bypass the middleware) the legacy
// subscription-scoped path runs — covers backward compatibility and
// keeps the dev-tool surface working.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var (
		types []ArtefactType
		err   error
	)
	if wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context()); ok {
		types, err = h.Svc.ListByWorkspace(r.Context(), u.SubscriptionID, wsID)
	} else {
		types, err = h.Svc.List(r.Context(), u.SubscriptionID)
	}
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
		writeArtefactTypeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// POST /_site/artefact-types — create a tenant WORK type.
// Strategy types are created only via /insert-layer (Phase 3). Gated on
// portfolio.model.edit at the route (see Mount).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "workspace context required")
		return
	}
	var in CreateWorkTypeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	created, err := h.Svc.CreateWorkType(r.Context(), u.SubscriptionID, wsID, in)
	if err != nil {
		writeArtefactTypeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

// writeArtefactTypeErr maps a service error to the wire response shared by
// Create/Patch (and InsertLayer in Phase 3): ValidationError → 422 with
// violations[], ErrNotFound → 404, anything else → 500.
func writeArtefactTypeErr(w http.ResponseWriter, r *http.Request, err error) {
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
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
