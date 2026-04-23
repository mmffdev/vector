package custompages

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type listResp struct {
	Pages []CustomPage `json:"pages"`
}

// GET /api/custom-pages — list this user's pages (no views).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	pages, err := h.Svc.ListPagesOnly(r.Context(), u.ID, u.TenantID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, listResp{Pages: pages})
}

// GET /api/custom-pages/{id} — page + views.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	page, err := h.Svc.Get(r.Context(), u.ID, u.TenantID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

type createReq struct {
	Label string `json:"label"`
	Icon  string `json:"icon"`
}

// POST /api/custom-pages — create a new page (seeds a Timeline view).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	page, err := h.Svc.Create(r.Context(), u.ID, u.TenantID, req.Label, req.Icon)
	if err != nil {
		switch {
		case errors.Is(err, ErrEmptyLabel),
			errors.Is(err, ErrLabelTooLong),
			errors.Is(err, ErrDuplicateLabel),
			errors.Is(err, ErrPageCap):
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, page)
}

type patchReq struct {
	Label *string `json:"label,omitempty"`
	Icon  *string `json:"icon,omitempty"`
}

// PATCH /api/custom-pages/{id} — rename / change icon.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	page, err := h.Svc.Patch(r.Context(), u.ID, u.TenantID, id, PatchInput{Label: req.Label, Icon: req.Icon})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			http.Error(w, "not found", http.StatusNotFound)
			return
		case errors.Is(err, ErrEmptyLabel),
			errors.Is(err, ErrLabelTooLong),
			errors.Is(err, ErrDuplicateLabel):
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// DELETE /api/custom-pages/{id} — drop the page (and its views).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := h.Svc.Delete(r.Context(), u.ID, u.TenantID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
