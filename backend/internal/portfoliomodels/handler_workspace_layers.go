// PLA-0026 / Story 00499 (B10): GET /api/workspace/{id}/portfolio/layers
//
// Workspace-scoped successor to the legacy GET /api/subscription/layers
// (handler_layers.go). Reads the strategy-layer hierarchy from
// vector_artefacts.artefacts_types (scope='strategy'), instead of the
// legacy mmff_vector.obj_strategy_types_layers.
//
// Per R047 §9 the legacy endpoint stays live until F3 (frontend cutover);
// this file ADDS the new endpoint and does not modify or remove the old
// one. The response shape mirrors subscriptionLayerDTO (handler_layers.go)
// so the frontend can swap call sites with minimal change.
//
// Auth contract:
//   - 401 if unauthenticated.
//   - 404 if the workspace does not exist OR is in a different tenant
//     (tenant-isolation: existence is sensitive — same response either
//     way, leaked-resistant).
//   - 403 if the caller is neither a workspace member (workspace_roles
//     row, revoked_at IS NULL) nor a tenant admin (Role == "gadmin").
//   - 200 with the layers array on success.
//
// PLA-0039 / Story 00530: all SQL lifted into Service; handler is now
// parse + auth + svc.Method() + render only.
package portfoliomodels

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// WorkspaceLayersHandler serves the workspace-scoped strategy-layer GET.
// All DB I/O — workspace tenancy probe, workspace_roles membership
// probe, artefacts_types read — is delegated to Svc.
type WorkspaceLayersHandler struct {
	Svc *Service
}

// NewWorkspaceLayersHandler constructs the handler around the Service.
// The Service's vaPool may be nil; in that case ListWorkspaceArtefactLayers
// returns ErrVAUnavailable and the handler renders 503.
func NewWorkspaceLayersHandler(svc *Service) *WorkspaceLayersHandler {
	return &WorkspaceLayersHandler{Svc: svc}
}

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
	if err := h.Svc.AssertWorkspaceInTenant(r.Context(), wsID, u.SubscriptionID); err != nil {
		if errors.Is(err, ErrWorkspaceNotFound) {
			http.Error(w, "workspace not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// 2. Caller must be a workspace member (roles_workspaces, live)
	//    OR a tenant admin (Role == "gadmin"). gadmin override mirrors
	//    the pattern used elsewhere in the codebase (orgdesign,
	//    workspaces) so support staff can read every workspace.
	if u.Role != roletypes.RoleGAdmin {
		ok, err := h.Svc.IsWorkspaceMember(r.Context(), wsID, u.ID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	out, err := h.Svc.ListWorkspaceArtefactLayers(r.Context(), wsID)
	if err != nil {
		if errors.Is(err, ErrVAUnavailable) {
			http.Error(w, "vector_artefacts unavailable", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// PatchWorkspaceLayers — PATCH /_site/workspace/{id}/portfolio/layers/batch
func (h *WorkspaceLayersHandler) PatchWorkspaceLayers(w http.ResponseWriter, r *http.Request) {
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

	if err := h.Svc.AssertWorkspaceInTenant(r.Context(), wsID, u.SubscriptionID); err != nil {
		if errors.Is(err, ErrWorkspaceNotFound) {
			http.Error(w, "workspace not found", http.StatusNotFound)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if u.Role != roletypes.RoleGAdmin {
		ok, err := h.Svc.IsWorkspaceMember(r.Context(), wsID, u.ID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		if !ok {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}

	var inputs []PatchWorkspaceArtefactLayerInput
	if err := json.NewDecoder(r.Body).Decode(&inputs); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	out, err := h.Svc.PatchWorkspaceArtefactLayers(r.Context(), wsID, inputs)
	if err != nil {
		if errors.Is(err, ErrVAUnavailable) {
			http.Error(w, "vector_artefacts unavailable", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
