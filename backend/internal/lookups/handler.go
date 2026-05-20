package lookups

import (
	"encoding/json"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes the lookups domain over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler backed by the given Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// ListUsersInScope handles GET /_site/lookups/users-in-scope.
func (h *Handler) ListUsersInScope(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	users, err := h.svc.ListUsersInScope(r.Context(), u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"users": users,
		"count": len(users),
	})
}
