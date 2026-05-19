package topology

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
	"github.com/mmffdev/vector-backend/internal/security"
	sharedtopology "github.com/mmffdev/vector-backend/internal/shared/topology"
)

// Handler exposes Service over HTTP under /api/topology. The router
// (backend/cmd/server/main.go) wraps every route in RequireAuth +
// RequireFreshPassword + rate-limit; this handler trusts that
// auth.UserFromCtx returns a non-nil user.
//
// Audit logging (story 00287): every successful mutation emits a
// row to audit_log via audit.Logger. Reads are not logged. The Logger
// is optional; nil is permitted so test wiring stays light.
type Handler struct {
	Svc   *Service
	Audit *audit.Logger
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// WithAudit wires a Logger so handler mutations emit audit entries.
func (h *Handler) WithAudit(a *audit.Logger) *Handler {
	h.Audit = a
	return h
}

// logAudit is a thin wrapper that no-ops when the Logger is nil so
// tests don't need to thread it.
func (h *Handler) logAudit(ctx context.Context, e audit.Entry) {
	if h.Audit == nil {
		return
	}
	h.Audit.Log(ctx, e)
}

func strPtr(s string) *string { return &s }
func ipPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ─── request/response shapes ───────────────────────────────────────────

type createNodeReq struct {
	WorkspaceID      *uuid.UUID `json:"workspace_id,omitempty"`
	ParentID         *uuid.UUID `json:"parent_id,omitempty"`
	Name             string     `json:"name"`
	Description      *string    `json:"description,omitempty"`
	LabelOverride    *string    `json:"label_override,omitempty"`
	Icon             *string    `json:"icon,omitempty"`
	Colour           *string    `json:"colour,omitempty"`
	AvatarURL        *string    `json:"avatar_url,omitempty"`
	LayoutMode       LayoutMode `json:"layout_mode,omitempty"`
	ManualX          *int       `json:"manual_x,omitempty"`
	ManualY          *int       `json:"manual_y,omitempty"`
	CollapsedDefault *bool      `json:"collapsed_default,omitempty"`
	Position         int        `json:"position,omitempty"`
}

type patchNodeReq struct {
	Name          *string    `json:"name,omitempty"`
	ParentID      *uuid.UUID `json:"parent_id,omitempty"`
	ClearRoot     *bool      `json:"clear_root,omitempty"` // true → move to root (parent_id=NULL)
	Description   *string    `json:"description,omitempty"`
	LabelOverride *string    `json:"label_override,omitempty"`
	Icon          *string    `json:"icon,omitempty"`
	Colour        *string    `json:"colour,omitempty"`
	AvatarURL     *string    `json:"avatar_url,omitempty"`
}

type bulkPositionReq struct {
	Updates []bulkPositionEntry `json:"updates"`
}

type bulkPositionEntry struct {
	NodeID     uuid.UUID  `json:"node_id"`
	Position   int        `json:"position"`
	LayoutMode LayoutMode `json:"layout_mode,omitempty"`
	ManualX    *int       `json:"manual_x,omitempty"`
	ManualY    *int       `json:"manual_y,omitempty"`
}

type grantRoleReq struct {
	UserID        uuid.UUID `json:"user_id"`
	Role          Role      `json:"role"`
	CanRedelegate bool      `json:"can_redelegate,omitempty"`
}

// viewStateReq is the request body for PUT /api/topology/view-state.
//
// Signature change at M6.2.7: legacy org_node_view_state stored a
// per-node collapsed flag, while topology_view_states stores the
// canvas-level viewport (pan + zoom). The route is now scoped to a
// workspace (resolved from the WorkspaceClampMiddleware on context),
// not a node.
type viewStateReq struct {
	ViewportX    float64 `json:"viewport_x"`
	ViewportY    float64 `json:"viewport_y"`
	ViewportZoom float64 `json:"viewport_zoom"`
}

// ─── handlers ───────────────────────────────────────────────────────────

// POST /api/topology/nodes
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createNodeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	// Resolve workspace_id: prefer an explicit body field, fall back to
	// the workspace clamped onto the request context by
	// WorkspaceClampMiddleware (story 00378). When the parent is set,
	// CreateNode itself overrides this with the parent's workspace.
	var workspaceID uuid.UUID
	if req.WorkspaceID != nil {
		workspaceID = *req.WorkspaceID
	} else if id, ok := WorkspaceIDFromCtx(r.Context()); ok {
		workspaceID = id
	}
	n, err := h.Svc.CreateNode(r.Context(), CreateNodeInput{
		WorkspaceID:      workspaceID,
		SubscriptionID:   u.SubscriptionID,
		ParentID:         req.ParentID,
		Name:             req.Name,
		Description:      req.Description,
		LabelOverride:    req.LabelOverride,
		Icon:             req.Icon,
		Colour:           req.Colour,
		AvatarURL:        req.AvatarURL,
		LayoutMode:       req.LayoutMode,
		ManualX:          req.ManualX,
		ManualY:          req.ManualY,
		CollapsedDefault: req.CollapsedDefault,
		Position:         req.Position,
	})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.created",
		Resource: strPtr("org_node"), ResourceID: strPtr(n.ID.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
		Metadata: map[string]any{
			"name":        n.Name,
			"parent_id":   n.ParentID,
			"layout_mode": n.LayoutMode,
		},
	})
	writeJSON(w, http.StatusCreated, n)
}

// PATCH /api/topology/nodes/{id}
//
// Three mutually-exclusive shapes:
//   - move:  parent_id OR clear_root=true  → MoveNode
//   - other: any of name/description/label_override/icon/colour/avatar_url → PatchNode
//
// Move is its own shape so the audit trail stays clean and the
// cycle-check / depth-refresh path is unmistakable. All other
// fields go through PatchNode, which is a sparse UPDATE — empty
// strings clear the column.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req patchNodeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	hasMove := req.ParentID != nil || (req.ClearRoot != nil && *req.ClearRoot)
	hasFields := req.Name != nil || req.Description != nil || req.LabelOverride != nil ||
		req.Icon != nil || req.Colour != nil || req.AvatarURL != nil
	if hasMove && hasFields {
		httperr.Write(w, r, http.StatusBadRequest, "patch may set move OR field updates, not both")
		return
	}
	if !hasMove && !hasFields {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
		return
	}
	if hasMove {
		var newParent *uuid.UUID
		if req.ClearRoot != nil && *req.ClearRoot {
			newParent = nil
		} else {
			newParent = req.ParentID
		}
		if err := h.Svc.MoveNode(r.Context(), u.SubscriptionID, id, newParent); err != nil {
			writeErr(w, r, err)
			return
		}
		h.logAudit(r.Context(), audit.Entry{
			UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
			Action: "topology.node.moved",
			Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
			IPAddress: ipPtr(security.ClientIP(r)),
			Metadata:  map[string]any{"new_parent_id": newParent},
		})
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Field-level patch (write-through edits from the flyout).
	if err := h.Svc.PatchNode(r.Context(), u.SubscriptionID, id, PatchNodeInput{
		Name:          req.Name,
		Description:   req.Description,
		LabelOverride: req.LabelOverride,
		Icon:          req.Icon,
		Colour:        req.Colour,
		AvatarURL:     req.AvatarURL,
	}); err != nil {
		writeErr(w, r, err)
		return
	}
	meta := map[string]any{}
	if req.Name != nil {
		meta["name"] = *req.Name
	}
	if req.Description != nil {
		meta["description_set"] = true
	}
	if req.LabelOverride != nil {
		meta["label_override"] = *req.LabelOverride
	}
	// PLA-0006/00312 — when exactly one field changes, emit a
	// field-specific audit action so dashboards can filter on the
	// shape of the edit (renamed / described / relabelled). Mixed
	// patches keep the generic `topology.node.patched` umbrella.
	action := "topology.node.patched"
	onlyName := req.Name != nil && req.Description == nil && req.LabelOverride == nil &&
		req.Icon == nil && req.Colour == nil && req.AvatarURL == nil
	onlyDescription := req.Description != nil && req.Name == nil && req.LabelOverride == nil &&
		req.Icon == nil && req.Colour == nil && req.AvatarURL == nil
	onlyLabel := req.LabelOverride != nil && req.Name == nil && req.Description == nil &&
		req.Icon == nil && req.Colour == nil && req.AvatarURL == nil
	switch {
	case onlyName:
		action = "topology.node.renamed"
		meta["new_name"] = *req.Name
	case onlyDescription:
		action = "topology.node.described"
	case onlyLabel:
		action = "topology.node.relabelled"
		meta["new_label"] = *req.LabelOverride
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: action,
		Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
		Metadata:  meta,
	})
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/topology/nodes/{id}/disconnect — story 00320.
func (h *Handler) Disconnect(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.Svc.DisconnectNode(r.Context(), u.SubscriptionID, id); err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.disconnected",
		Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
	})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/topology/disconnected — story 00321.
func (h *Handler) Disconnected(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	nodes, err := h.Svc.ListDisconnected(r.Context(), u.SubscriptionID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

// Levels handlers (ListLevels / CreateLevel / RenameLevel) were
// removed at M6.2.7. The vector_artefacts substrate has no
// org_levels equivalent — display depth is derived on the fly from
// parent_id chains. The /levels routes were unmounted from the
// router at the same time; clients that depended on them now read
// the topology tree directly.

// GET /api/topology/commit — story 00322 (banner state).
func (h *Handler) CommitStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	st, err := h.Svc.GetCommitStatus(r.Context(), u.SubscriptionID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// POST /api/topology/commit — story 00322.
func (h *Handler) Commit(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	st, err := h.Svc.Commit(r.Context(), u.SubscriptionID, u.ID, u.RoleID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action:    "topology.committed",
		Resource:  strPtr("subscription"),
		ResourceID: strPtr(u.SubscriptionID.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
	})
	writeJSON(w, http.StatusOK, st)
}

// POST /api/topology/reset — story 00310 (gadmin-only).
func (h *Handler) Reset(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	count, err := h.Svc.ResetCanvas(r.Context(), u.SubscriptionID, u.ID, u.RoleID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action:    "topology.reset",
		Resource:  strPtr("subscription"),
		ResourceID: strPtr(u.SubscriptionID.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
		Metadata:  map[string]any{"archived_count": count},
	})
	writeJSON(w, http.StatusOK, map[string]int{"archived_count": count})
}

// DELETE /api/topology/nodes/{id} — soft-archive
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.Svc.ArchiveNode(r.Context(), u.SubscriptionID, id); err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.archived",
		Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
	})
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/topology/nodes/{id}/duplicate — story 00277.
//
// Recursively clones the live subtree rooted at {id} into the same
// subscription, preserving names verbatim (migration 096 dropped
// sibling-uniqueness so duplicate names are legal). The new root is
// inserted immediately to the right of the source in sibling order.
// Returns the cloned root node so the caller can refocus the canvas
// on it without re-fetching the tree first.
func (h *Handler) Duplicate(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	n, err := h.Svc.DuplicateSubtree(r.Context(), u.SubscriptionID, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.duplicated",
		Resource: strPtr("org_node"), ResourceID: strPtr(n.ID.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
		Metadata: map[string]any{
			"source_id": id.String(),
			"name":      n.Name,
		},
	})
	writeJSON(w, http.StatusCreated, n)
}

// POST /api/topology/nodes/bulk-position
func (h *Handler) BulkPosition(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req bulkPositionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if len(req.Updates) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	updates := make([]NodePositionUpdate, len(req.Updates))
	for i, e := range req.Updates {
		updates[i] = NodePositionUpdate{
			NodeID:     e.NodeID,
			Position:   e.Position,
			LayoutMode: e.LayoutMode,
			ManualX:    e.ManualX,
			ManualY:    e.ManualY,
		}
	}
	if err := h.Svc.BulkPosition(r.Context(), u.SubscriptionID, updates); err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action:    "topology.node.bulk_position",
		Resource:  strPtr("org_node"),
		IPAddress: ipPtr(security.ClientIP(r)),
		Metadata:  map[string]any{"count": len(updates)},
	})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/topology/tree?root={id}
//
// Returns the live subtree rooted at {id}, depth-first by position.
// When root is omitted we look up the caller's tenant root (parent_id
// IS NULL) and use that — the canvas calls /tree on first paint
// without needing a separate root-lookup round-trip.
func (h *Handler) Tree(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	rootParam := r.URL.Query().Get("root")

	var rootID uuid.UUID
	if rootParam == "" {
		// Resolve the tenant's single root. If there are multiple roots
		// (legacy data), we return the lowest-position one — the canvas
		// is welcome to ask explicitly for a different root id.
		//
		// TenantRootID honours the workspace clamp seeded by
		// WorkspaceClampMiddleware (story 00378), so the canvas paints
		// the root of the resolved workspace — not a sibling workspace's
		// root in the same subscription.
		id, err := h.Svc.TenantRootID(r.Context(), u.SubscriptionID)
		if err != nil {
			// Empty topology → return [] not 500
			writeJSON(w, http.StatusOK, []Node{})
			return
		}
		rootID = id
	} else {
		parsed, err := uuid.Parse(rootParam)
		if err != nil {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
			return
		}
		rootID = parsed
	}

	nodes, err := h.Svc.Subtree(r.Context(), u.SubscriptionID, rootID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	// PLA-0044 / story 00543: run the response through the shared walker
	// before serialising. Subtree's recursive CTE already orders by
	// sort_order path and filters archived rows, but the walker enforces
	// the orphan-drop contract — when WorkspaceClampMiddleware narrows
	// scope mid-flight, a node whose parent is no longer in the result
	// set must be dropped, not silently re-rooted. visibleIDs filters
	// the original Node slice so we keep the rich fields (descendant
	// counts, layout, archive metadata) while emitting in the walker's
	// canonical sort order.
	walk := sharedtopology.Walk(nodes, sharedtopology.Opts[Node]{
		Less: func(a, b Node) bool {
			if a.SortOrder != b.SortOrder {
				return a.SortOrder < b.SortOrder
			}
			return a.Name < b.Name
		},
	})
	out := make([]Node, 0, len(walk.Rows))
	byID := make(map[string]Node, len(nodes))
	for _, n := range nodes {
		byID[n.ID.String()] = n
	}
	for _, row := range walk.Rows {
		if n, ok := byID[row.ID]; ok {
			out = append(out, n)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/topology/nodes/{id}/archived-descendants
//
// Returns the closure of archived nodes reachable from the live anchor
// {id} — direct archived children plus their transitively-archived
// descendants. Each row carries `parent_id` so the frontend can rebuild
// the tree, and `parent_is_archived` so the UI knows whether the row's
// default Restore-to-parent action is reachable.
func (h *Handler) ArchivedDescendants(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	descendants, err := h.Svc.ArchivedDescendants(r.Context(), u.SubscriptionID, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, descendants)
}

// POST /api/topology/nodes/{id}/restore
//
// Lifts a node out of limbo. Body is `{"new_parent_id": "<uuid>"}` to
// reparent on restore (required when the node's original parent is also
// archived); omit / null to keep the existing parent. Returns 409 with
// `parent_archived` or `parent_missing` when the requested parent is
// not a valid landing target.
func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req struct {
		NewParentID *uuid.UUID `json:"new_parent_id,omitempty"`
	}
	// Empty body is valid (means "restore in place"). Decode tolerates
	// EOF so callers can send Content-Length:0.
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
			return
		}
	}
	if err := h.Svc.RestoreNode(r.Context(), u.SubscriptionID, id, req.NewParentID); err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID:     &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:     "topology.node.restored",
		Resource:   strPtr("org_node"),
		ResourceID: strPtr(id.String()),
		IPAddress:  ipPtr(security.ClientIP(r)),
		Metadata: map[string]any{
			"new_parent_id": req.NewParentID,
		},
	})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/topology/nodes/{id}/ancestors
func (h *Handler) Ancestors(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	nodes, err := h.Svc.AncestorsOf(r.Context(), u.SubscriptionID, id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

// GET /api/topology/grants/me — list every active grant for the
// authenticated user, joined to the underlying live node. The chrome
// scope picker (PLA-0042) uses this to render the user's switchable
// node set without needing tree-read permission. No workspace clamp
// is applied: a user may legitimately hold grants across workspaces
// inside the same subscription.
func (h *Handler) MyGrants(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	grants, err := h.Svc.ListMyGrants(r.Context(), u.SubscriptionID, u.ID, u.RoleID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, grants)
}

// GET /api/topology/users/{userId}/grants — list every active grant
// for the target user (admin-pivot). Gated by topology.grants.manage_others
// at the route, and re-checked service-side via actorRoleID (PLA-0046 / B6.8).
func (h *Handler) ListGrantsByUser(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	targetID, err := uuid.Parse(chi.URLParam(r, "userId"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	grants, err := h.Svc.ListGrantsByUser(r.Context(), u.SubscriptionID, targetID, u.RoleID)
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			httperr.Write(w, r, http.StatusForbidden, "topology.grants.manage_others required")
			return
		}
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, grants)
}

// POST /api/topology/nodes/{id}/roles
func (h *Handler) GrantRole(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req grantRoleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	grantID, err := h.Svc.GrantRole(r.Context(), u.SubscriptionID, nodeID, req.UserID, req.Role, u.ID, u.RoleID, req.CanRedelegate)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.role.granted",
		Resource: strPtr("org_node_role"), ResourceID: strPtr(grantID.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
		Metadata: map[string]any{
			"node_id":        nodeID,
			"grantee_id":     req.UserID,
			"role":           req.Role,
			"can_redelegate": req.CanRedelegate,
		},
	})
	writeJSON(w, http.StatusCreated, map[string]uuid.UUID{"grant_id": grantID})
}

// DELETE /api/topology/roles/{grant_id}
func (h *Handler) RevokeRole(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	grantID, err := uuid.Parse(chi.URLParam(r, "grant_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.Svc.RevokeRole(r.Context(), u.SubscriptionID, grantID, u.ID); err != nil {
		writeErr(w, r, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.role.revoked",
		Resource: strPtr("org_node_role"), ResourceID: strPtr(grantID.String()),
		IPAddress: ipPtr(security.ClientIP(r)),
	})
	w.WriteHeader(http.StatusNoContent)
}

// PUT /api/topology/view-state — per-user canvas viewport (pan + zoom).
//
// Signature change at M6.2.7: legacy org_node_view_state stored a
// per-node collapsed flag; topology_view_states stores the canvas
// viewport, scoped by (workspace_id, user_id). The workspace is
// resolved from WorkspaceClampMiddleware on the request context — no
// {id} URL param. Callers that previously hit /nodes/{id}/view-state
// now hit /view-state with a viewport_x/y/zoom body.
func (h *Handler) ViewState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	workspaceID, ok := WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusBadRequest, "view-state requires a workspace clamp on the request")
		return
	}
	var req viewStateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if err := h.Svc.SetViewState(r.Context(), u.SubscriptionID, workspaceID, u.ID, req.ViewportX, req.ViewportY, req.ViewportZoom); err != nil {
		writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/topology/preview-move?node={id}&new_parent={pid}
//
// Diff before commit: returns the subtree under {node} (what moves)
// plus the new ancestor chain from {new_parent} to root (where it
// lands). The frontend modal renders both side-by-side. Cycle would
// also reject here so the user gets feedback before clicking commit.
func (h *Handler) PreviewMove(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	nodeIDStr := r.URL.Query().Get("node")
	nodeID, err := uuid.Parse(nodeIDStr)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var newParent *uuid.UUID
	if pidStr := r.URL.Query().Get("new_parent"); pidStr != "" {
		pid, err := uuid.Parse(pidStr)
		if err != nil {
			httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
			return
		}
		newParent = &pid
	}

	// Cycle check using the same recursive CTE shape as MoveNode.
	if newParent != nil {
		if *newParent == nodeID {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": "cycle"})
			return
		}
		var ancestor bool
		err := h.Svc.vaPool.QueryRow(r.Context(), sqlCycleCheckAncestor,
			*newParent, nodeID, u.SubscriptionID).Scan(&ancestor)
		if err != nil {
			writeErr(w, r, err)
			return
		}
		if ancestor {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": "cycle"})
			return
		}
	}

	moving, err := h.Svc.Subtree(r.Context(), u.SubscriptionID, nodeID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	var landing []Node
	if newParent != nil {
		landing, err = h.Svc.AncestorsOf(r.Context(), u.SubscriptionID, *newParent)
		if err != nil {
			writeErr(w, r, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"moving":  moving,
		"landing": landing,
	})
}

// ─── helpers ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeErr maps the package's sentinel errors to HTTP statuses per the
// contract documented at the top of service.go.
func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNodeNotFound), errors.Is(err, ErrTenantMismatch), errors.Is(err, ErrGrantNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrCycleDetected):
		httperr.Write(w, r, http.StatusBadRequest, "move would create a cycle")
	case errors.Is(err, ErrInvalidLayoutMode):
		httperr.Write(w, r, http.StatusBadRequest, "invalid layout_mode")
	case errors.Is(err, ErrInvalidRole):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
	case errors.Is(err, ErrInvalidName):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
	case errors.Is(err, ErrManualXYRequired):
		httperr.Write(w, r, http.StatusBadRequest, "manual layout requires manual_x and manual_y")
	case errors.Is(err, ErrManualXYForbidden):
		httperr.Write(w, r, http.StatusBadRequest, "manual_x/manual_y only allowed in manual layout")
	case errors.Is(err, ErrAdminAlreadyGranted):
		httperr.Write(w, r, http.StatusConflict, usermessages.Conflict)
	case errors.Is(err, ErrDelegationDepth):
		httperr.Write(w, r, http.StatusForbidden, "delegation depth exceeded — only gadmin may grant in MVP")
	case errors.Is(err, ErrRedelegationDisabled):
		httperr.Write(w, r, http.StatusForbidden, "can_redelegate is reserved for Phase X")
	case errors.Is(err, ErrWorkspaceRequired):
		httperr.Write(w, r, http.StatusBadRequest, "write requires a workspace clamp on context")
	case errors.Is(err, ErrCommitForbidden):
		httperr.Write(w, r, http.StatusForbidden, "only gadmin may commit the topology working model")
	case errors.Is(err, ErrResetForbidden):
		httperr.Write(w, r, http.StatusForbidden, "only gadmin may reset the topology canvas")
	case errors.Is(err, ErrNotArchived):
		// 409: client asked to restore a live node — semantic conflict,
		// not a 400 (request was well-formed and authorised).
		writeJSON(w, http.StatusConflict, map[string]string{"error": "not_archived"})
	case errors.Is(err, ErrParentArchived):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "parent_archived"})
	case errors.Is(err, ErrParentMissing):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "parent_missing"})
	default:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	}
}
