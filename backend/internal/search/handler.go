package search

import (
	"encoding/json"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler exposes POST /search over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler backed by the given Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Search handles POST /search.
// Body: { "q": "text", "workspace_id": "uuid", "limit": 20, "type_ids": ["uuid"] }
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	var body struct {
		Q           string   `json:"q"`
		WorkspaceID string   `json:"workspace_id"`
		Limit       int      `json:"limit"`
		TypeIDs     []string `json:"type_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if body.WorkspaceID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "workspace_id is required")
		return
	}

	results, err := h.svc.Search(r.Context(), Query{
		Q:           body.Q,
		WorkspaceID: body.WorkspaceID,
		TypeIDs:     body.TypeIDs,
		Limit:       body.Limit,
	})
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"results": results,
		"count":   len(results),
	})
}
