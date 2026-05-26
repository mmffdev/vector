package sentinel

// Handler exposes the Sentinel writer surface. Today that is just
// PUT /sentinel/focus — the persistence side of the per-user default
// focus node (read side resolves via Middleware + DefaultFocus, has
// shipped since S06). Future writers (scope direction defaults,
// per-user scope preferences) land on this same handler so the
// /sentinel/* route group stays the single mutation surface for
// per-user Sentinel preferences.
//
// Construction takes a Resolver — same dependency the Middleware
// uses — so unit tests in handler_test.go reuse the existing
// stubResolver pattern from middleware_test.go without touching a
// live DB.

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// Handler wraps the Resolver to expose the few mutations the frontend
// issues against per-user Sentinel preferences.
type Handler struct {
	R Resolver
}

// NewHandler constructs a Handler bound to the given Resolver.
func NewHandler(r Resolver) *Handler {
	return &Handler{R: r}
}

// putFocusReq is the wire shape for PUT /sentinel/focus.
//
// FocusNodeID is a pointer so the JSON null case is distinguishable
// from the omitted-field case. The frontend's putFocus(nodeId) at
// app/sentinel/sentinel_api.ts:166 passes `focus_node_id: null` to
// clear; treating omit-field the same way matches user intent.
type putFocusReq struct {
	FocusNodeID *string `json:"focus_node_id"`
}

// PutFocus persists the user's default focus node — the "home topology
// node" surfaced in the account-settings dropdown. Wire shape:
//
//	PUT /_site/sentinel/focus
//	Body:    { "focus_node_id": "<uuid>" | null }
//	204:     silent success
//	400:     malformed body / bad UUID
//	401:     no actor on ctx
//	403:     actor has no grant on the node (or node not in tenant)
//	500:     resolver / DB failure
//
// Validation rules:
//
//   - Authenticated request (mounted downstream of auth.RequireAuth +
//     RequireFreshPassword; auth.UserFromCtx must return non-nil).
//   - When focus_node_id is non-null: the actor MUST hold an active
//     grant on the node OR any ancestor in their tenant. Same
//     descend-inheritance predicate the request-time middleware
//     applies to read paths (PLA-0043 scope-read gate).
//   - When focus_node_id is null: column clears; no grant check
//     (clearing the default is always allowed).
//
// Standard-ref: NIST 800-53 AC-3 — re-validates the actor's right
// to reference the stored node before write. Procurement narrative:
// "a user cannot store a default pointing at a node they have no
// access to."
func (h *Handler) PutFocus(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeProblem(w, r, http.StatusUnauthorized, "unauthorized",
			"authentication required")
		return
	}

	var req putFocusReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, r, http.StatusBadRequest, "invalid-body",
			"request body is not valid JSON")
		return
	}

	var nodeID *uuid.UUID
	if req.FocusNodeID != nil && *req.FocusNodeID != "" {
		parsed, err := uuid.Parse(*req.FocusNodeID)
		if err != nil {
			writeProblem(w, r, http.StatusBadRequest, "invalid-focus-node-id",
				"focus_node_id must be a uuid")
			return
		}
		// Grant gate. Matches the descend-inheritance rule the
		// request-time middleware enforces in ResolveSubtree — if
		// the user can READ the node, they can store it as default.
		// actor.RoleID drives the gadmin short-circuit in PoolResolver.
		ok, err := h.R.GrantOnNode(r.Context(), actor.SubscriptionID, actor.ID, parsed, actor.RoleID)
		if err != nil {
			log.Printf("sentinel.PutFocus GrantOnNode: %v", err)
			writeProblem(w, r, http.StatusInternalServerError, "internal",
				"grant lookup failed")
			return
		}
		if !ok {
			writeProblem(w, r, http.StatusForbidden, "focus-no-access",
				"you have no active grant on that node")
			return
		}
		nodeID = &parsed
	}

	if err := h.R.SetUserDefaultFocus(r.Context(), actor.ID, nodeID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeProblem(w, r, http.StatusUnauthorized, "user-not-found",
				"user record not found or inactive")
			return
		}
		log.Printf("sentinel.PutFocus SetUserDefaultFocus: %v", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal",
			"update failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
