package permissions

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct{ Svc *Service }

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type grantReq struct {
	UserID    uuid.UUID `json:"user_id"`
	ProjectID uuid.UUID `json:"project_id"`
	CanView   bool      `json:"can_view"`
	CanEdit   bool      `json:"can_edit"`
	CanAdmin  bool      `json:"can_admin"`
}

func (h *Handler) Grant(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	var req grantReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	p, err := h.Svc.Grant(r.Context(), GrantInput{
		UserID: req.UserID, ProjectID: req.ProjectID,
		CanView: req.CanView, CanEdit: req.CanEdit, CanAdmin: req.CanAdmin,
	}, actor.ID, clientIP(r))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, 200, p)
}

func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	if err := h.Svc.Revoke(r.Context(), id, actor.ID, clientIP(r)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if uid := q.Get("user_id"); uid != "" {
		id, err := uuid.Parse(uid)
		if err != nil {
			http.Error(w, "bad user_id", http.StatusBadRequest)
			return
		}
		out, err := h.Svc.ListForUser(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, 200, out)
		return
	}
	if pid := q.Get("project_id"); pid != "" {
		id, err := uuid.Parse(pid)
		if err != nil {
			http.Error(w, "bad project_id", http.StatusBadRequest)
			return
		}
		out, err := h.Svc.ListForProject(r.Context(), id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, 200, out)
		return
	}
	http.Error(w, "user_id or project_id required", http.StatusBadRequest)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if i := strings.Index(xf, ","); i >= 0 {
			return strings.TrimSpace(xf[:i])
		}
		return xf
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
