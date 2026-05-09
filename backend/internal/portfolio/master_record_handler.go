package portfolio

// HTTP read surface for master_record_portfolio (PLA-0026 / story 00498, B9).
//
// Mounts a single route — GET /api/portfolio/master_record?workspace_id=<uuid>
// — that reads the persistent portfolio model record for one workspace.
//
// This endpoint is BundleView's new source of truth for adopted-model
// prose: the frontend MUST NOT read mmff_library at runtime, so this
// handler reads ONLY vector_artefacts.master_record_portfolio (via the
// sole-writer Service in this package). No live library look-ups happen
// here — model_name + model_description were copied at adoption time.
//
// Authorization (matches tenantsettings — tenant-scoped read):
//   - Auth + fresh-password is enforced at the route group in main.go.
//   - Caller's tenant MUST own the workspace; cross-tenant probes return
//     404 (not 403) so the workspace's existence is not leaked.
//   - Padmin / Gadmin bypass the per-workspace membership check
//     (tenant-admin tier).
//   - All other authenticated users must hold an active roles_workspaces
//     grant (viewer / editor / admin).
//
// Errors are RFC 9457 problem-details via internal/httperr.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
	"github.com/mmffdev/vector-backend/internal/models"
)

// Handler is the HTTP surface for master_record_portfolio reads.
//
// vectorPool is the mmff_vector pool — used ONLY for the tenancy +
// membership probe (master_record_workspaces.subscription_id,
// roles_workspaces). master_record_portfolio itself lives in
// vector_artefacts and is read through Svc, never directly here.
type Handler struct {
	Svc        *Service
	vectorPool *pgxpool.Pool
}

// NewHandler builds the read handler.
//
// svc    — the master_record_portfolio sole-writer service (vector_artefacts).
// vector — the mmff_vector pool, for the auth/tenancy probe. May be nil
//          in unit tests; in that case authz is short-circuited to "deny
//          unless padmin/gadmin" so non-admin tests still exercise the
//          deny path without panicking on a nil pool.
func NewHandler(svc *Service, vector *pgxpool.Pool) *Handler {
	return &Handler{Svc: svc, vectorPool: vector}
}

// Mount registers the read route on r. The caller is responsible for
// applying RequireAuth + RequireFreshPassword at the route group level
// (see cmd/server/main.go — /api/portfolio block).
func (h *Handler) Mount(r chi.Router) {
	r.Get("/master_record", h.GetMasterRecord)
}

// GetMasterRecord returns the master_record_portfolio row for the
// workspace identified by the workspace_id query parameter.
//
//	200 — JSON body (MasterRecord wire shape from this package).
//	400 — workspace_id missing or not a UUID.
//	401 — unauthenticated (defensive — middleware should already block).
//	404 — workspace does not belong to caller's tenant, OR no master
//	      record exists for the workspace (unadopted). The two cases
//	      collapse to one status to avoid leaking workspace existence.
//	500 — pool unavailable / DB error.
func (h *Handler) GetMasterRecord(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}

	wsRaw := r.URL.Query().Get("workspace_id")
	if wsRaw == "" {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestMissingFields)
		return
	}
	workspaceID, err := uuid.Parse(wsRaw)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}

	// Tenancy + membership check. On any "not allowed" outcome we
	// return 404 so existence isn't leaked (leak-resistant: do not
	// distinguish "not found" from "not in your tenant").
	ok, err := h.canRead(r.Context(), u, workspaceID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	if !ok {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}

	row, err := h.Svc.Get(r.Context(), workspaceID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
			return
		}
		// ErrPoolMissing falls through to 500 — vector_artefacts is
		// required for this endpoint to function and a misconfigured
		// boot is an operator-visible 500, not a silent empty.
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(row)
}

// canRead reports whether u may read workspaceID's master record.
//
// Returns (true, nil)  — caller is allowed.
// Returns (false, nil) — workspace not in caller's tenant OR caller is
//                       not a member of the workspace; treat as 404.
// Returns (_, err)     — DB error.
//
// Tenant admins (padmin / gadmin) bypass the membership probe.
func (h *Handler) canRead(ctx context.Context, u *models.User, workspaceID uuid.UUID) (bool, error) {
	// Without a vector pool we cannot prove tenancy; only padmin/gadmin
	// pass. This path exists for unit tests that bypass the DB.
	if h.vectorPool == nil {
		return u.Role == models.RolePAdmin || u.Role == models.RoleGAdmin, nil
	}

	// Tenancy: workspace must belong to caller's subscription.
	var ownerSub uuid.UUID
	err := h.vectorPool.QueryRow(ctx,
		`SELECT subscription_id FROM master_record_workspaces WHERE id = $1`, workspaceID,
	).Scan(&ownerSub)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	if ownerSub != u.SubscriptionID {
		return false, nil
	}

	// Tenant admins always pass.
	if u.Role == models.RolePAdmin || u.Role == models.RoleGAdmin {
		return true, nil
	}

	// Per-workspace membership: any active roles_workspaces grant
	// (viewer / editor / admin) suffices.
	var member bool
	err = h.vectorPool.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1 FROM roles_workspaces
		     WHERE workspace_id = $1
		       AND user_id = $2
		       AND revoked_at IS NULL
		)`,
		workspaceID, u.ID,
	).Scan(&member)
	if err != nil {
		return false, err
	}
	return member, nil
}
