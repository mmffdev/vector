package artefactpriorities

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/topology"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Patch("/{id}", h.Patch)
	r.Delete("/{id}", h.Archive)
}

// GET /_site/artefact-priorities
// Workspace-clamped via WorkspaceClampMiddleware (PLA-0053 / story 00578).
// Returns 401 when no auth, 500 if the workspace clamp is missing — the
// catalogue is meaningless without a workspace.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := topology.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusInternalServerError, "workspace clamp missing")
		return
	}
	out, err := h.Svc.ListByWorkspace(r.Context(), wsID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	if out == nil {
		out = []Priority{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"priorities": out})
}

// POST /_site/artefact-priorities
// Body: { name, sort_order, colour }. slot is server-controlled and
// always null for user-created rows (only the seed sets slots).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := topology.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusInternalServerError, "workspace clamp missing")
		return
	}

	var in CreateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	p, err := h.Svc.Create(r.Context(), wsID, in)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// PATCH /_site/artefact-priorities/{id}
// Partial update of name / sort_order / colour. Slot is immutable.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := topology.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusInternalServerError, "workspace clamp missing")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid priority id")
		return
	}

	var in PatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}

	p, err := h.Svc.Patch(r.Context(), id, wsID, in)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrInvalidInput):
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// DELETE /_site/artefact-priorities/{id}
// Soft-archives. Slotted rows (system seeds) are protected with 403
// so a gadmin can't accidentally hide pri_medium / pri_high / etc.
// and quietly break filtering.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	wsID, ok := topology.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusInternalServerError, "workspace clamp missing")
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid priority id")
		return
	}

	err = h.Svc.Archive(r.Context(), id, wsID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		case errors.Is(err, ErrSlottedRow):
			httperr.Write(w, r, http.StatusForbidden, "cannot archive a system priority")
		default:
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
