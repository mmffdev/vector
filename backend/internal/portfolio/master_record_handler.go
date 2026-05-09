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
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// Handler is the HTTP surface for master_record_portfolio reads.
//
// All DB I/O lives in Svc. Tenancy + workspace-membership probes are
// also delegated to Svc via CanReadMasterRecord; the handler does only
// parse + auth-context check + svc.Method() + render (PLA-0039).
type Handler struct {
	Svc *Service
}

// NewHandler builds the read handler.
//
// svc — the master_record_portfolio service. Must be non-nil; pass a
// Service whose pools are wired (vector_artefacts via NewService, +
// .WithVectorPool(mmff_vector) for the read authz path).
func NewHandler(svc *Service) *Handler {
	return &Handler{Svc: svc}
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

	// Tenancy + membership check delegated to the Service. On any
	// "not allowed" outcome we return 404 so existence isn't leaked
	// (leak-resistant: do not distinguish "not found" from "not in
	// your tenant").
	ok, err := h.Svc.CanReadMasterRecord(r.Context(), u, workspaceID)
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

// canRead has moved to Service.CanReadMasterRecord (PLA-0039 / Story
// 00530). The handler is now DB-free; all SQL lives in the Service.
