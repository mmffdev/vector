package usertaborder

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
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
		httperr.Write(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	pageID := chi.URLParam(r, "pageId")
	if pageID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "page_id required")
		return
	}
	rows, err := h.Svc.List(r.Context(), u.ID, u.SubscriptionID, pageID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "internal error")
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
		httperr.Write(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	pageID := chi.URLParam(r, "pageId")
	if pageID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "page_id required")
		return
	}
	var body putReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request")
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
			httperr.Write(w, r, http.StatusBadRequest, err.Error())
			return
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "internal error")
			return
		}
	}
	writeJSON(w, http.StatusOK, listResp{PageID: pageID, Items: body.Items})
}

// DELETE /api/user/tab-order/{pageId}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, "unauthorized")
		return
	}
	pageID := chi.URLParam(r, "pageId")
	if pageID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "page_id required")
		return
	}
	if err := h.Svc.Reset(r.Context(), u.ID, u.SubscriptionID, pageID); err != nil {
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
