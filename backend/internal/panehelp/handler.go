package panehelp

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// GET /api/pane-help — returns {paneId: body_html} for every row.
// Cache hit/miss is exposed via the X-Cache header.
func (h *Handler) GetAll(w http.ResponseWriter, r *http.Request) {
	out, hit, err := h.Svc.GetAll(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if hit {
		w.Header().Set("X-Cache", "HIT")
	} else {
		w.Header().Set("X-Cache", "MISS")
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(out)
}

// GET /api/pane-help/admin — gadmin-only, returns every row with
// updated_at + editor email so the editor UI can display "last edited
// by X on Y" without an extra round-trip.
func (h *Handler) GetAllAdmin(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Svc.GetAllAdmin(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(rows)
}

type putReq struct {
	Body string `json:"body"`
}

// PUT /api/pane-help/{paneId} — gadmin-only, sanitised on write.
// 404 if paneId is not in the seeded registry.
func (h *Handler) Put(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	paneID := strings.TrimSpace(chi.URLParam(r, "paneId"))
	if paneID == "" {
		http.Error(w, "invalid paneId", http.StatusBadRequest)
		return
	}

	var req putReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	clean := Sanitize(req.Body)
	if err := h.Svc.Put(r.Context(), paneID, clean, u.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "paneId not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"paneId": paneID})
}
