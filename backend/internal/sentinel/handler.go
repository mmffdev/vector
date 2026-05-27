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
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
)

// BootUserPayload is the user-portion of the /sentinel/boot wire shape.
// Mirrors app/sentinel/types.ts:SentinelUser exactly — every field name +
// JSON tag is part of the contract the SentinelProvider reads.
type BootUserPayload struct {
	ID                     uuid.UUID  `json:"id"`
	Email                  string     `json:"email"`
	TenantID               uuid.UUID  `json:"tenant_id"`
	Role                   string     `json:"role"`
	RoleID                 uuid.UUID  `json:"role_id"`
	Permissions            []string   `json:"permissions"`
	DefaultFocusNodeID     *uuid.UUID `json:"default_focus_node_id"`
	HomeLocationFollowMode bool       `json:"home_location_follow_mode"`
	WorkspaceID            uuid.UUID  `json:"workspace_id"`
	MFAEnrolled            bool       `json:"mfa_enrolled,omitempty"`
	ForcePasswordChange    bool       `json:"force_password_change,omitempty"`
}

// BootTenant matches app/sentinel/types.ts:SentinelTenant. Name is left
// empty for now — matches the historical bridge synthesis (path 2) the
// frontend has been receiving and rendering correctly.
type BootTenant struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// BootGrant is the wire shape for one entry in `grants[]`. JSON tags
// match topology.MyGrant + app/sentinel/types.ts:SentinelGrant exactly
// so this struct is interchangeable with both — the boot composer just
// re-exports topology rows via this type to avoid an inter-package import.
type BootGrant struct {
	GrantID       uuid.UUID  `json:"grant_id"`
	NodeID        uuid.UUID  `json:"node_id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	ParentID      *uuid.UUID `json:"parent_id"`
	Name          string     `json:"name"`
	LabelOverride *string    `json:"label_override"`
	Colour        *string    `json:"colour"`
	Icon          *string    `json:"icon"`
	Role          any        `json:"role"`
	GrantedAt     any        `json:"granted_at"`
	Position      int        `json:"position"`
}

// BootPayload is the response body for GET /sentinel/boot. Mirrors the
// SentinelBootPayload wire contract in app/sentinel/types.ts.
type BootPayload struct {
	User        BootUserPayload `json:"user"`
	Tenant      BootTenant      `json:"tenant"`
	Grants      []BootGrant     `json:"grants"`
	TenantRoot  string          `json:"tenant_root"`
}

// LoadRoleAndPermsFn returns (roleCode, roleID, permissions) for the user.
// Injected by the composition root (main.go) to avoid a sentinel→auth
// import cycle. Matches the shape of auth.Service.LoadRoleAndPermissions
// flattened to the three fields the boot payload needs.
type LoadRoleAndPermsFn func(ctx context.Context, userID uuid.UUID) (roleCode string, roleID uuid.UUID, permissions []string)

// ListGrantsFn returns the caller's grants as []BootGrant. Injected by
// the composition root to avoid a sentinel→topology import cycle. The
// adapter in main.go calls topology.Service.ListMyGrants and copies the
// rows into BootGrant (identical JSON tags — straight field copy).
type ListGrantsFn func(ctx context.Context, subscriptionID, userID, actorRoleID uuid.UUID) ([]BootGrant, error)

// Handler wraps the Resolver to expose the few mutations the frontend
// issues against per-user Sentinel preferences.
//
// LoadRolePerms + ListGrants are optional — only required if /sentinel/boot
// is mounted. PutFocus does not use them. Nil-safety lets older callers
// keep using NewHandler(resolver) without breaking; the Boot handler
// short-circuits to 500 if either dependency is missing.
type Handler struct {
	R             Resolver
	LoadRolePerms LoadRoleAndPermsFn
	ListGrants    ListGrantsFn
}

// NewHandler constructs a Handler bound to the given Resolver. Boot
// support (LoadRolePerms + ListGrants) is added via WithBootDeps.
func NewHandler(r Resolver) *Handler {
	return &Handler{R: r}
}

// WithBootDeps returns h with the boot-composition dependencies attached.
// Callers that don't mount /sentinel/boot can skip this entirely.
func (h *Handler) WithBootDeps(loadRolePerms LoadRoleAndPermsFn, listGrants ListGrantsFn) *Handler {
	h.LoadRolePerms = loadRolePerms
	h.ListGrants = listGrants
	return h
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

// Boot composes the SentinelProvider boot payload from the authenticated
// user's role+permissions and topology grants. Replaces the historical
// frontend bridge that fetched /auth/me + /topology/grants/me separately
// — saves one round-trip and a 404 probe on every page load.
//
// Wire:
//
//	GET /_site/sentinel/boot
//	200: { user, tenant, grants, tenant_root }
//	401: unauthenticated
//	500: dependency missing or DB error
//
// tenant_root is derived from the grants slice — the topmost grant
// (no parent_id) wins; falls back to the first grant's node_id; empty
// string if the user has no grants. Mirrors the frontend bridge's
// algorithm exactly so the cutover is a no-op for the provider.
func (h *Handler) Boot(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeProblem(w, r, http.StatusUnauthorized, "unauthorized",
			"authentication required")
		return
	}
	if h.LoadRolePerms == nil || h.ListGrants == nil {
		log.Print("sentinel.Boot: handler not configured with boot deps (WithBootDeps)")
		writeProblem(w, r, http.StatusInternalServerError, "internal",
			"boot composition not wired")
		return
	}

	roleCode, roleID, perms := h.LoadRolePerms(r.Context(), actor.ID)
	grants, err := h.ListGrants(r.Context(), actor.SubscriptionID, actor.ID, actor.RoleID)
	if err != nil {
		log.Printf("sentinel.Boot ListGrants: %v", err)
		writeProblem(w, r, http.StatusInternalServerError, "internal",
			"grant lookup failed")
		return
	}
	// Defensive: nil → empty slice so the JSON encodes `[]` not `null`.
	// SentinelProvider's grant walker tolerates both but `[]` matches
	// the bridge synthesis path's behaviour exactly.
	if grants == nil {
		grants = []BootGrant{}
	}

	// Derive tenant_root from the grants — topmost grant (no parent_id)
	// wins; fall back to the first grant's node; empty string if no
	// grants. Same algorithm as the frontend bridge (path 2).
	var tenantRoot string
	for _, g := range grants {
		if g.ParentID == nil {
			tenantRoot = g.NodeID.String()
			break
		}
	}
	if tenantRoot == "" && len(grants) > 0 {
		tenantRoot = grants[0].NodeID.String()
	}

	// Build user payload — fields mirror SentinelUser exactly.
	user := BootUserPayload{
		ID:                     actor.ID,
		Email:                  actor.Email,
		TenantID:               actor.SubscriptionID,
		Role:                   roleCode,
		RoleID:                 roleID,
		Permissions:            perms,
		DefaultFocusNodeID:     actor.DefaultFocusNodeID,
		HomeLocationFollowMode: actor.HomeLocationFollowMode,
		WorkspaceID:            actor.WorkspaceID,
		MFAEnrolled:            actor.MFAEnrolled,
		ForcePasswordChange:    actor.ForcePasswordChange,
	}

	payload := BootPayload{
		User:       user,
		Tenant:     BootTenant{ID: actor.SubscriptionID},
		Grants:     grants,
		TenantRoot: tenantRoot,
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("sentinel.Boot encode: %v", err)
	}
}
