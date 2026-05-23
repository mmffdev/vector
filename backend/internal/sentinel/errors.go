package sentinel

import (
	"encoding/json"
	"errors"
	"net/http"
)

// Sentinel error sentinels — returned by Resolver implementations and
// matched by Middleware to choose the right HTTP status + ProblemJSON
// type URI. Each one maps 1:1 to a /errors/sentinel/<slug> type URI
// per RFC 9457.
var (
	// ErrFocusNotInTenant — the requested ?focus= node belongs to a
	// different subscription. Cross-tenant attempts get 403, NOT 404,
	// to align with the Trust-No-One narrative: we ACKNOWLEDGE the
	// caller's auth but DECLINE the action. 404 would leak existence
	// across tenant boundaries.
	ErrFocusNotInTenant = errors.New("sentinel: focus node belongs to another tenant")

	// ErrFocusNoAccess — the focus node is inside the user's tenant
	// but the user holds no grant covering it (or any ancestor that
	// would cover it via descend-inheritance). 403.
	ErrFocusNoAccess = errors.New("sentinel: user has no grant on focus node")

	// ErrNoWorkspace — the subscription has zero live workspaces. The
	// JWT carried no workspace_id claim, the FirstLiveWorkspace
	// fallback hit an empty set, and the request cannot be served.
	// 403 /errors/sentinel/no-workspace.
	ErrNoWorkspace = errors.New("sentinel: tenant has no live workspaces")

	// ErrNoWorkspaceRole — workspace was resolved successfully (either
	// from the JWT claim or the first-live fallback) but the actor
	// holds no active role on it. 403 /errors/sentinel/no-workspace-role.
	// Explicitly NOT an empty list — see AC#3 of story 00378 in the
	// original PLA-0053 work, preserved here under Sentinel ownership.
	ErrNoWorkspaceRole = errors.New("sentinel: user has no active role on workspace")
)

// problemBody is the RFC 9457 wire shape the middleware emits. Sentinel
// uses its own writer (not httperr.Write) because httperr always sets
// type to "about:blank"; sentinel must set a typed URI per case for
// machine-readable error routing.
type problemBody struct {
	Type     string `json:"type"`
	Title    string `json:"title"`
	Status   int    `json:"status"`
	Detail   string `json:"detail"`
	Instance string `json:"instance"`
}

// writeProblem emits the RFC 9457 problem+json body with a typed
// /errors/sentinel/<slug> Type URI. Use this rather than httperr.Write
// when the wire response must carry sentinel-specific routing info.
func writeProblem(w http.ResponseWriter, r *http.Request, status int, typeSlug, detail string) {
	body := problemBody{
		Type:     "/errors/sentinel/" + typeSlug,
		Title:    http.StatusText(status),
		Status:   status,
		Detail:   detail,
		Instance: r.URL.Path,
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
