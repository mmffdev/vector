package webhooks

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// Handler exposes webhook subscription CRUD over HTTP.
// Mounts under /workspaces/{workspaceId}/webhooks.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Route("/{webhookId}", func(r chi.Router) {
		r.Get("/", h.Get)
		r.Patch("/", h.Update)
		r.Delete("/", h.Delete)
	})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	wsID, ok := workspaceIDFromPath(w, r)
	if !ok {
		return
	}
	subs, err := h.svc.List(r.Context(), wsID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	if subs == nil {
		subs = []Subscription{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"webhooks": subs})
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	wsID, ok := workspaceIDFromPath(w, r)
	if !ok {
		return
	}
	var in CreateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	sub, err := h.svc.Create(r.Context(), wsID, in)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			httperr.Write(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusCreated, sub)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	wsID, ok := workspaceIDFromPath(w, r)
	if !ok {
		return
	}
	whID, ok := webhookIDFromPath(w, r)
	if !ok {
		return
	}
	sub, err := h.svc.Get(r.Context(), wsID, whID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, sub)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	wsID, ok := workspaceIDFromPath(w, r)
	if !ok {
		return
	}
	whID, ok := webhookIDFromPath(w, r)
	if !ok {
		return
	}
	var in UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	sub, err := h.svc.Update(r.Context(), wsID, whID, in)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			httperr.Write(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, sub)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}
	wsID, ok := workspaceIDFromPath(w, r)
	if !ok {
		return
	}
	whID, ok := webhookIDFromPath(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), wsID, whID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func workspaceIDFromPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "workspaceId"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid workspace id")
		return uuid.UUID{}, false
	}
	return id, true
}

func webhookIDFromPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "webhookId"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid webhook id")
		return uuid.UUID{}, false
	}
	return id, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
