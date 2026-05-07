// PLA-0026 / Story 00499 (B10): GET /api/workspace/{id}/portfolio/layers
//
// Workspace-scoped successor to the legacy GET /api/subscription/layers
// (handler_layers.go). Reads the strategy-layer hierarchy from
// vector_artefacts.artefact_types (scope='strategy'), instead of the
// legacy mmff_vector.obj_strategy_types_layers.
//
// Per R047 §9 the legacy endpoint stays live until F3 (frontend cutover);
// this file ADDS the new endpoint and does not modify or remove the old
// one. The response shape mirrors subscriptionLayerDTO (handler_layers.go)
// so the frontend can swap call sites with minimal change. Two fields
// that were previously redundant carry over with renamed semantics:
//
//	source_library_id  ← artefact_types.library_layer_id (NULL for
//	                     tenant-built rows; populated by the adoption
//	                     saga for library-minted layers).
//	tag                ← artefact_types.prefix
//	parent_layer_id    ← artefact_types.parent_type_id
//	description_md     ← artefact_types.description
//
// artefact_types has no icon / colour / help_md / is_leaf columns, so
// those fields emit as null / derived (is_leaf := !allows_children) to
// keep the wire shape stable for the frontend.
//
// Auth contract:
//   - 401 if unauthenticated.
//   - 404 if the workspace does not exist OR is in a different tenant
//     (tenant-isolation: existence is sensitive — same response either
//     way, mirroring wsperms.ErrNotFound).
//   - 403 if the caller is neither a workspace member (workspace_roles
//     row, revoked_at IS NULL) nor a tenant admin (Role == "gadmin").
//   - 200 with the layers array on success.
package portfoliomodels

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
)

// WorkspaceLayersHandler serves the workspace-scoped strategy-layer GET.
// VectorPool reads workspace + workspace_roles from mmff_vector for the
// auth check; VAPool reads artefact_types from vector_artefacts.
type WorkspaceLayersHandler struct {
	VectorPool *pgxpool.Pool
	VAPool     *pgxpool.Pool
}

// NewWorkspaceLayersHandler constructs the handler. vaPool may be nil in
// environments where vector_artefacts is unavailable; in that case GET
// returns 503 so the frontend can degrade gracefully rather than 500.
func NewWorkspaceLayersHandler(vectorPool, vaPool *pgxpool.Pool) *WorkspaceLayersHandler {
	return &WorkspaceLayersHandler{VectorPool: vectorPool, VAPool: vaPool}
}

// workspaceLayerDTO mirrors subscriptionLayerDTO (handler_layers.go) so
// the frontend can keep its existing decoder. Fields not present in the
// artefact_types schema (icon, colour, help_md) are emitted as NULL.
// is_leaf is derived from allows_children for shape parity.
type workspaceLayerDTO struct {
	ID              uuid.UUID  `json:"id"`
	WorkspaceID     uuid.UUID  `json:"workspace_id"`
	SourceLibraryID *uuid.UUID `json:"source_library_id"`
	Name            string     `json:"name"`
	Tag             string     `json:"tag"`
	SortOrder       int32      `json:"sort_order"`
	ParentLayerID   *uuid.UUID `json:"parent_layer_id"`
	Icon            *string    `json:"icon"`
	Colour          *string    `json:"colour"`
	DescriptionMD   *string    `json:"description_md"`
	HelpMD          *string    `json:"help_md"`
	AllowsChildren  bool       `json:"allows_children"`
	IsLeaf          bool       `json:"is_leaf"`
	IsPlaceholder   bool       `json:"is_placeholder"`
	ArchivedAt      *time.Time `json:"archived_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// errWorkspaceNotFound is the sentinel returned when the workspace doesn't
// exist or belongs to another tenant. Existence is leaked-resistant — same
// 404 response either way (matches wsperms.ErrNotFound).
var errWorkspaceNotFound = errors.New("workspace not found")

// GetWorkspaceLayers — GET /api/workspace/{id}/portfolio/layers
func (h *WorkspaceLayersHandler) GetWorkspaceLayers(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	wsIDRaw := chi.URLParam(r, "id")
	wsID, err := uuid.Parse(wsIDRaw)
	if err != nil {
		http.Error(w, "invalid workspace id", http.StatusBadRequest)
		return
	}

	// 1. Workspace must exist AND belong to caller's tenant. 404 either
	//    way so we don't leak existence across tenants.
	if err := h.assertWorkspaceInTenant(r.Context(), wsID, u.SubscriptionID); err != nil {
		if errors.Is(err, errWorkspaceNotFound) {
			http.Error(w, "workspace not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// 2. Caller must be a workspace member (workspace_roles, live)
	//    OR a tenant admin (Role == "gadmin"). gadmin override mirrors
	//    the pattern used elsewhere in the codebase (orgdesign,
	//    workspaces) so support staff can read every workspace.
	if u.Role != models.RoleGAdmin {
		ok, err := h.isWorkspaceMember(r.Context(), wsID, u.ID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	// 3. vector_artefacts must be available; if VECTOR_ARTEFACTS_DB_URL
	//    is unset, the cutover endpoint cannot serve.
	if h.VAPool == nil {
		http.Error(w, "vector_artefacts unavailable", http.StatusServiceUnavailable)
		return
	}

	// 4. Hierarchical read. Order by parent-first (NULLs first), then
	//    sort_order, then name — matches the legacy ordering intent
	//    while remaining stable when sort_order is not yet set on
	//    tenant-built rows.
	rows, err := h.VAPool.Query(r.Context(), `
		SELECT id, workspace_id,
		       library_layer_id,
		       name, prefix, sort_order,
		       parent_type_id,
		       description, allows_children,
		       is_placeholder,
		       archived_at, created_at, updated_at
		  FROM artefact_types
		 WHERE workspace_id = $1
		   AND scope         = 'strategy'
		   AND archived_at  IS NULL
		 ORDER BY (parent_type_id IS NOT NULL),
		          sort_order,
		          name`,
		wsID,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	out := []workspaceLayerDTO{}
	for rows.Next() {
		var d workspaceLayerDTO
		if err := rows.Scan(
			&d.ID, &d.WorkspaceID,
			&d.SourceLibraryID,
			&d.Name, &d.Tag, &d.SortOrder,
			&d.ParentLayerID,
			&d.DescriptionMD, &d.AllowsChildren,
			&d.IsPlaceholder,
			&d.ArchivedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		// Derived: parity with legacy subscriptionLayerDTO.is_leaf.
		d.IsLeaf = !d.AllowsChildren
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, out)
}

// assertWorkspaceInTenant returns errWorkspaceNotFound if the workspace
// does not exist OR is in a different tenant. The query intentionally
// does not distinguish these cases — same 404 either way, leak-resistant.
func (h *WorkspaceLayersHandler) assertWorkspaceInTenant(
	ctx context.Context, workspaceID, subscriptionID uuid.UUID,
) error {
	var got uuid.UUID
	err := h.VectorPool.QueryRow(ctx,
		`SELECT subscription_id FROM workspace WHERE id = $1`, workspaceID,
	).Scan(&got)
	if err == pgx.ErrNoRows {
		return errWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if got != subscriptionID {
		return errWorkspaceNotFound
	}
	return nil
}

// isWorkspaceMember reports whether the user holds any live (revoked_at
// IS NULL) workspace_roles row for the workspace. Tenant admins skip
// this check upstream.
func (h *WorkspaceLayersHandler) isWorkspaceMember(
	ctx context.Context, workspaceID, userID uuid.UUID,
) (bool, error) {
	var exists bool
	err := h.VectorPool.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1
		      FROM workspace_roles
		     WHERE workspace_id = $1
		       AND user_id      = $2
		       AND revoked_at  IS NULL
		)`, workspaceID, userID,
	).Scan(&exists)
	return exists, err
}
