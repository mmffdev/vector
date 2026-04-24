package users

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

type Handler struct{ Svc *Service }

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type createReq struct {
	Email string      `json:"email"`
	Role  models.Role `json:"role"`
}

type createResp struct {
	User     *models.User `json:"user"`
	ResetURL string       `json:"reset_url,omitempty"` // only in dev; omit in prod
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = models.RoleUser
	}
	// Tenant always comes from the verified session, never the payload.
	// See c_security.md#input-comes-from-the-session-not-the-payload.
	u, link, err := h.Svc.Create(r.Context(), CreateInput{Email: req.Email, Role: req.Role, SubscriptionID: actor.SubscriptionID}, actor.Role, actor.ID, clientIP(r))
	if err != nil {
		if errors.Is(err, ErrDuplicateEmail) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		if errors.Is(err, ErrRoleCeiling) {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, 201, createResp{User: u, ResetURL: link})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	out, err := h.Svc.List(r.Context(), actor.SubscriptionID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, 200, out)
}

type patchReq struct {
	Role     *models.Role `json:"role,omitempty"`
	IsActive *bool        `json:"is_active,omitempty"`
}

func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := h.Svc.Update(r.Context(), id, UpdateInput{Role: req.Role, IsActive: req.IsActive}, actor.Role, actor.SubscriptionID, actor.ID, clientIP(r)); err != nil {
		if errors.Is(err, ErrNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if errors.Is(err, ErrRoleCeiling) {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
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
