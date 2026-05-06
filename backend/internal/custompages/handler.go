package custompages

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
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
	pages, err := h.Svc.ListPagesOnly(r.Context(), u.ID, u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, listResp{Pages: pages})
}

// GET /api/custom-pages/{id} — page + views.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	page, err := h.Svc.Get(r.Context(), u.ID, u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
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
		httperr.Write(w, r, http.StatusBadRequest, "invalid request")
		return
	}
	page, err := h.Svc.Create(r.Context(), u.ID, u.SubscriptionID, req.Label, req.Icon)
	if err != nil {
		switch {
		case errors.Is(err, ErrEmptyLabel),
			errors.Is(err, ErrLabelTooLong),
			errors.Is(err, ErrDuplicateLabel),
			errors.Is(err, ErrPageCap):
			httperr.Write(w, r, http.StatusBadRequest, "invalid request")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
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
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request")
		return
	}
	page, err := h.Svc.Patch(r.Context(), u.ID, u.SubscriptionID, id, PatchInput{Label: req.Label, Icon: req.Icon})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		case errors.Is(err, ErrEmptyLabel),
			errors.Is(err, ErrLabelTooLong),
			errors.Is(err, ErrDuplicateLabel):
			httperr.Write(w, r, http.StatusBadRequest, "invalid request")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// DELETE /api/custom-pages/{id} — drop the page (and its views).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.Svc.Delete(r.Context(), u.ID, u.SubscriptionID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
