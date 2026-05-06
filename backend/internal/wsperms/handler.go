package wsperms

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
)

type Handler struct{ Svc *Service }

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

type grantReq struct {
	UserID      uuid.UUID `json:"user_id"`
	WorkspaceID uuid.UUID `json:"workspace_id"`
	CanView     bool      `json:"can_view"`
	CanEdit     bool      `json:"can_edit"`
	CanAdmin    bool      `json:"can_admin"`
}

func (h *Handler) Grant(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	var req grantReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "bad request")
		return
	}
	p, err := h.Svc.Grant(r.Context(), GrantInput{
		UserID: req.UserID, WorkspaceID: req.WorkspaceID,
		CanView: req.CanView, CanEdit: req.CanEdit, CanAdmin: req.CanAdmin,
	}, actor.SubscriptionID, actor.ID, clientIP(r))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, 200, p)
}

func (h *Handler) Revoke(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "bad id")
		return
	}
	if err := h.Svc.Revoke(r.Context(), id, actor.SubscriptionID, actor.ID, clientIP(r)); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	q := r.URL.Query()
	if uid := q.Get("user_id"); uid != "" {
		id, err := uuid.Parse(uid)
		if err != nil {
			httperr.Write(w, r, http.StatusBadRequest, "bad user_id")
			return
		}
		out, err := h.Svc.ListForUser(r.Context(), id, actor.SubscriptionID)
		if err != nil {
			httperr.Write(w, r, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, 200, out)
		return
	}
	if wid := q.Get("workspace_id"); wid != "" {
		id, err := uuid.Parse(wid)
		if err != nil {
			httperr.Write(w, r, http.StatusBadRequest, "bad workspace_id")
			return
		}
		out, err := h.Svc.ListForWorkspace(r.Context(), id, actor.SubscriptionID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				httperr.Write(w, r, http.StatusNotFound, "not found")
				return
			}
			httperr.Write(w, r, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, 200, out)
		return
	}
	httperr.Write(w, r, http.StatusBadRequest, "user_id or workspace_id required")
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
