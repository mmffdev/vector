package usertaborder

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler {
	return &Handler{Svc: s}
}

type listResp struct {
	PageID string `json:"page_id"`
	Items  []Row  `json:"items"`
}

// GET /api/user/tab-order/{pageId}
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	pageID := chi.URLParam(r, "pageId")
	if pageID == "" {
		http.Error(w, "page_id required", http.StatusBadRequest)
		return
	}
	rows, err := h.Svc.List(r.Context(), u.ID, u.SubscriptionID, pageID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, listResp{PageID: pageID, Items: rows})
}

type putReq struct {
	Items []Row `json:"items"`
}

// PUT /api/user/tab-order/{pageId}
//
// Request body: { "items": [ { "tab_key": "...", "position": 0 }, ... ] }
// Replaces the user's full tab order for (subscription, page) atomically.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	pageID := chi.URLParam(r, "pageId")
	if pageID == "" {
		http.Error(w, "page_id required", http.StatusBadRequest)
		return
	}
	var body putReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.Replace(r.Context(), u.ID, u.SubscriptionID, pageID, body.Items); err != nil {
		switch {
		case errors.Is(err, ErrTooManyTabs),
			errors.Is(err, ErrEmptyTabKey),
			errors.Is(err, ErrEmptyPageID),
			errors.Is(err, ErrTabKeyTooLong),
			errors.Is(err, ErrPageIDTooLong),
			errors.Is(err, ErrDuplicateTab),
			errors.Is(err, ErrBadPositions):
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		default:
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}
	writeJSON(w, http.StatusOK, listResp{PageID: pageID, Items: body.Items})
}

// DELETE /api/user/tab-order/{pageId}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	pageID := chi.URLParam(r, "pageId")
	if pageID == "" {
		http.Error(w, "page_id required", http.StatusBadRequest)
		return
	}
	if err := h.Svc.Reset(r.Context(), u.ID, u.SubscriptionID, pageID); err != nil {
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
