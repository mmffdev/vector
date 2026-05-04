package orgdesign

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
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

// clientIP mirrors backend/internal/auth/handler.go's helper.
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

// ─── request/response shapes ───────────────────────────────────────────

type createNodeReq struct {
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

type createLevelReq struct {
	Depth    int    `json:"depth"`
	Name     string `json:"name"`
	Position int    `json:"position,omitempty"`
}

type renameLevelReq struct {
	Name string `json:"name"`
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

type viewStateReq struct {
	Collapsed bool `json:"collapsed"`
}

// ─── handlers ───────────────────────────────────────────────────────────

// POST /api/topology/nodes
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createNodeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	n, err := h.Svc.CreateNode(r.Context(), CreateNodeInput{
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
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.created",
		Resource: strPtr("org_node"), ResourceID: strPtr(n.ID.String()),
		IPAddress: ipPtr(clientIP(r)),
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
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req patchNodeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	hasMove := req.ParentID != nil || (req.ClearRoot != nil && *req.ClearRoot)
	hasFields := req.Name != nil || req.Description != nil || req.LabelOverride != nil ||
		req.Icon != nil || req.Colour != nil || req.AvatarURL != nil
	if hasMove && hasFields {
		http.Error(w, "patch may set move OR field updates, not both", http.StatusBadRequest)
		return
	}
	if !hasMove && !hasFields {
		http.Error(w, "patch requires at least one field", http.StatusBadRequest)
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
			writeErr(w, err)
			return
		}
		h.logAudit(r.Context(), audit.Entry{
			UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
			Action: "topology.node.moved",
			Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
			IPAddress: ipPtr(clientIP(r)),
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
		writeErr(w, err)
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
		IPAddress: ipPtr(clientIP(r)),
		Metadata:  meta,
	})
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/topology/nodes/{id}/disconnect — story 00320.
func (h *Handler) Disconnect(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := h.Svc.DisconnectNode(r.Context(), u.SubscriptionID, id); err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.disconnected",
		Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
		IPAddress: ipPtr(clientIP(r)),
	})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/topology/disconnected — story 00321.
func (h *Handler) Disconnected(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	nodes, err := h.Svc.ListDisconnected(r.Context(), u.SubscriptionID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

// GET /api/topology/levels — story 00318 (left-edge label boxes).
func (h *Handler) ListLevels(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	levels, err := h.Svc.ListLevels(r.Context(), u.SubscriptionID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, levels)
}

// POST /api/topology/levels — story 00318.
func (h *Handler) CreateLevel(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createLevelReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	l, err := h.Svc.CreateLevel(r.Context(), CreateLevelInput{
		SubscriptionID: u.SubscriptionID,
		Depth:          req.Depth,
		Name:           req.Name,
		Position:       req.Position,
	})
	if err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.level.created",
		Resource: strPtr("org_level"), ResourceID: strPtr(l.ID.String()),
		IPAddress: ipPtr(clientIP(r)),
		Metadata:  map[string]any{"depth": l.Depth, "name": l.Name},
	})
	writeJSON(w, http.StatusCreated, l)
}

// PATCH /api/topology/levels/{id} — story 00318 (rename).
func (h *Handler) RenameLevel(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req renameLevelReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.Svc.RenameLevel(r.Context(), u.SubscriptionID, id, req.Name); err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.level.renamed",
		Resource: strPtr("org_level"), ResourceID: strPtr(id.String()),
		IPAddress: ipPtr(clientIP(r)),
		Metadata:  map[string]any{"new_name": req.Name},
	})
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/topology/commit — story 00322 (banner state).
func (h *Handler) CommitStatus(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	st, err := h.Svc.GetCommitStatus(r.Context(), u.SubscriptionID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

// POST /api/topology/commit — story 00322.
func (h *Handler) Commit(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	st, err := h.Svc.Commit(r.Context(), u.SubscriptionID, u.ID, string(u.Role))
	if err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action:    "topology.committed",
		Resource:  strPtr("subscription"),
		ResourceID: strPtr(u.SubscriptionID.String()),
		IPAddress: ipPtr(clientIP(r)),
	})
	writeJSON(w, http.StatusOK, st)
}

// POST /api/topology/reset — story 00310 (gadmin-only).
func (h *Handler) Reset(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	count, err := h.Svc.ResetCanvas(r.Context(), u.SubscriptionID, u.ID, string(u.Role))
	if err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action:    "topology.reset",
		Resource:  strPtr("subscription"),
		ResourceID: strPtr(u.SubscriptionID.String()),
		IPAddress: ipPtr(clientIP(r)),
		Metadata:  map[string]any{"archived_count": count},
	})
	writeJSON(w, http.StatusOK, map[string]int{"archived_count": count})
}

// DELETE /api/topology/nodes/{id} — soft-archive
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	if err := h.Svc.ArchiveNode(r.Context(), u.SubscriptionID, id); err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.archived",
		Resource: strPtr("org_node"), ResourceID: strPtr(id.String()),
		IPAddress: ipPtr(clientIP(r)),
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
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	n, err := h.Svc.DuplicateSubtree(r.Context(), u.SubscriptionID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.node.duplicated",
		Resource: strPtr("org_node"), ResourceID: strPtr(n.ID.String()),
		IPAddress: ipPtr(clientIP(r)),
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
		http.Error(w, "invalid request body", http.StatusBadRequest)
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
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action:    "topology.node.bulk_position",
		Resource:  strPtr("org_node"),
		IPAddress: ipPtr(clientIP(r)),
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
			http.Error(w, "invalid root id", http.StatusBadRequest)
			return
		}
		rootID = parsed
	}

	nodes, err := h.Svc.Subtree(r.Context(), u.SubscriptionID, rootID)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
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
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	descendants, err := h.Svc.ArchivedDescendants(r.Context(), u.SubscriptionID, id)
	if err != nil {
		writeErr(w, err)
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
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req struct {
		NewParentID *uuid.UUID `json:"new_parent_id,omitempty"`
	}
	// Empty body is valid (means "restore in place"). Decode tolerates
	// EOF so callers can send Content-Length:0.
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
	}
	if err := h.Svc.RestoreNode(r.Context(), u.SubscriptionID, id, req.NewParentID); err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID:     &u.ID,
		SubscriptionID: &u.SubscriptionID,
		Action:     "topology.node.restored",
		Resource:   strPtr("org_node"),
		ResourceID: strPtr(id.String()),
		IPAddress:  ipPtr(clientIP(r)),
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
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	nodes, err := h.Svc.AncestorsOf(r.Context(), u.SubscriptionID, id)
	if err != nil {
		writeErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, nodes)
}

// POST /api/topology/nodes/{id}/roles
func (h *Handler) GrantRole(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req grantRoleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	grantID, err := h.Svc.GrantRole(r.Context(), u.SubscriptionID, nodeID, req.UserID, req.Role, u.ID, string(u.Role), req.CanRedelegate)
	if err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.role.granted",
		Resource: strPtr("org_node_role"), ResourceID: strPtr(grantID.String()),
		IPAddress: ipPtr(clientIP(r)),
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
		http.Error(w, "invalid grant_id", http.StatusBadRequest)
		return
	}
	if err := h.Svc.RevokeRole(r.Context(), u.SubscriptionID, grantID, u.ID); err != nil {
		writeErr(w, err)
		return
	}
	h.logAudit(r.Context(), audit.Entry{
		UserID: &u.ID, SubscriptionID: &u.SubscriptionID,
		Action: "topology.role.revoked",
		Resource: strPtr("org_node_role"), ResourceID: strPtr(grantID.String()),
		IPAddress: ipPtr(clientIP(r)),
	})
	w.WriteHeader(http.StatusNoContent)
}

// PUT /api/topology/nodes/{id}/view-state — per-user collapse flag.
func (h *Handler) ViewState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	var req viewStateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if err := h.Svc.SetViewState(r.Context(), u.SubscriptionID, nodeID, u.ID, req.Collapsed); err != nil {
		writeErr(w, err)
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
		http.Error(w, "invalid node id", http.StatusBadRequest)
		return
	}
	var newParent *uuid.UUID
	if pidStr := r.URL.Query().Get("new_parent"); pidStr != "" {
		pid, err := uuid.Parse(pidStr)
		if err != nil {
			http.Error(w, "invalid new_parent id", http.StatusBadRequest)
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
		err := h.Svc.pool.QueryRow(r.Context(), `
			WITH RECURSIVE up AS (
			    SELECT id, parent_id FROM org_nodes WHERE id = $1 AND subscription_id = $3
			    UNION ALL
			    SELECT n.id, n.parent_id
			      FROM org_nodes n
			      JOIN up ON up.parent_id = n.id
			     WHERE n.subscription_id = $3
			)
			SELECT EXISTS(SELECT 1 FROM up WHERE id = $2)
		`, *newParent, nodeID, u.SubscriptionID).Scan(&ancestor)
		if err != nil {
			writeErr(w, err)
			return
		}
		if ancestor {
			writeJSON(w, http.StatusOK, map[string]any{"ok": false, "reason": "cycle"})
			return
		}
	}

	moving, err := h.Svc.Subtree(r.Context(), u.SubscriptionID, nodeID)
	if err != nil {
		writeErr(w, err)
		return
	}
	var landing []Node
	if newParent != nil {
		landing, err = h.Svc.AncestorsOf(r.Context(), u.SubscriptionID, *newParent)
		if err != nil {
			writeErr(w, err)
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
func writeErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNodeNotFound), errors.Is(err, ErrTenantMismatch), errors.Is(err, ErrGrantNotFound):
		http.Error(w, "not found", http.StatusNotFound)
	case errors.Is(err, ErrCycleDetected):
		http.Error(w, "move would create a cycle", http.StatusBadRequest)
	case errors.Is(err, ErrInvalidLayoutMode):
		http.Error(w, "invalid layout_mode", http.StatusBadRequest)
	case errors.Is(err, ErrInvalidRole):
		http.Error(w, "invalid role", http.StatusBadRequest)
	case errors.Is(err, ErrInvalidName):
		http.Error(w, "name must be non-empty", http.StatusBadRequest)
	case errors.Is(err, ErrManualXYRequired):
		http.Error(w, "manual layout requires manual_x and manual_y", http.StatusBadRequest)
	case errors.Is(err, ErrManualXYForbidden):
		http.Error(w, "manual_x/manual_y only allowed in manual layout", http.StatusBadRequest)
	case errors.Is(err, ErrAdminAlreadyGranted):
		http.Error(w, "an admin grant already exists for this node", http.StatusConflict)
	case errors.Is(err, ErrDelegationDepth):
		http.Error(w, "delegation depth exceeded — only gadmin may grant in MVP", http.StatusForbidden)
	case errors.Is(err, ErrRedelegationDisabled):
		http.Error(w, "can_redelegate is reserved for Phase X", http.StatusForbidden)
	case errors.Is(err, ErrLevelNotFound):
		http.Error(w, "level not found", http.StatusNotFound)
	case errors.Is(err, ErrInvalidLevelDepth):
		http.Error(w, "level depth must be >= 0", http.StatusBadRequest)
	case errors.Is(err, ErrCommitForbidden):
		http.Error(w, "only gadmin may commit the topology working model", http.StatusForbidden)
	case errors.Is(err, ErrResetForbidden):
		http.Error(w, "only gadmin may reset the topology canvas", http.StatusForbidden)
	case errors.Is(err, ErrNotArchived):
		// 409: client asked to restore a live node — semantic conflict,
		// not a 400 (request was well-formed and authorised).
		writeJSON(w, http.StatusConflict, map[string]string{"error": "not_archived"})
	case errors.Is(err, ErrParentArchived):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "parent_archived"})
	case errors.Is(err, ErrParentMissing):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "parent_missing"})
	default:
		http.Error(w, "internal error", http.StatusInternalServerError)
	}
}
