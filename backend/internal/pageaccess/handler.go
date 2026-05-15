package pageaccess

// HTTP surface for page access. PLA-0049 Phase 0.5.3.
//
// One endpoint: GET /me/page-access. Returns the caller's full
// key_enum access set plus the global pages_access_version. Used by
// the frontend usePageAccess() hook to:
//
//   1. Decide on first render whether to mount the page or swap to
//      PageAccessDenied (no extra round-trip per page — the set is
//      pre-fetched and cached client-side).
//   2. Detect drift mid-session — frontend re-polls on tab focus or
//      periodically; if the version bumps, refetch the set, possibly
//      bouncing the user off a now-denied page in place.
//
// User identity is resolved via UserIDFromCtx — a function pointer
// injected at construction (set by main.go to auth.UserIDFromCtx).
// This avoids an import cycle with the auth package, which itself
// imports pageaccess for the RequirePageAccess middleware.

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// UserIDFromCtx is the contract pageaccess.Handler uses to extract the
// caller's user ID without importing the auth package. Implementations
// return (uuid.Nil, false) when no user is in context.
type UserIDFromCtx func(ctx context.Context) (uuid.UUID, bool)

type Handler struct {
	Resolver  *Resolver
	UserIDCtx UserIDFromCtx
}

func NewHandler(r *Resolver, userIDFromCtx UserIDFromCtx) *Handler {
	return &Handler{Resolver: r, UserIDCtx: userIDFromCtx}
}

type accessResp struct {
	Version int64    `json:"version"`
	Pages   []string `json:"pages"`
}

// MeAccess: GET /me/page-access. Returns the caller's allowed key_enum
// set + the current global version.
func (h *Handler) MeAccess(w http.ResponseWriter, r *http.Request) {
	uid, ok := h.UserIDCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	set, err := h.Resolver.AccessSetFor(r.Context(), uid)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	v, err := h.Resolver.CurrentVersion(r.Context())
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	pages := make([]string, 0, len(set))
	for k := range set {
		pages = append(pages, k)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(accessResp{Version: v, Pages: pages})
}
