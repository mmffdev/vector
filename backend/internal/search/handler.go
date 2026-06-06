package search

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/sentinel"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// searcher is the behaviour the Handler needs from its service. *Service
// satisfies it; tests inject a fake to assert the workspace passed to the
// service comes from the clamp, not the request body (SEC-001).
type searcher interface {
	Search(ctx context.Context, q Query) ([]Result, error)
}

// Handler exposes POST /search over HTTP.
type Handler struct {
	svc searcher
}

// NewHandler creates a Handler backed by the given Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Search handles POST /search.
// Body: { "q": "text", "limit": 20, "type_ids": ["uuid"] }
//
// SEC-001 (RES066): the workspace is derived SOLELY from the Sentinel
// clamp on ctx (seeded by sentinelMW from the JWT), never from the
// request body. The route MUST be mounted behind sentinelMW; if the
// clamp is absent we fail closed with 403 rather than fall back to an
// unbounded query. This is the SERVER-IS-THE-GATE contract — the caller
// cannot name a workspace it isn't clamped to.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}

	wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context())
	if !ok {
		// No clamp on ctx => route is not behind sentinelMW (or the
		// middleware could not resolve a workspace). Fail closed.
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		return
	}

	var body struct {
		Q       string   `json:"q"`
		Limit   int      `json:"limit"`
		TypeIDs []string `json:"type_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}

	results, err := h.svc.Search(r.Context(), Query{
		Q:           body.Q,
		WorkspaceID: wsID.String(),
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
