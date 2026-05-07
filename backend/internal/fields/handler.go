package fields

// HTTP surface for the field-scope resolver (PLA-0026 / Story 00500, B11).
//
//   GET /api/workspace/{id}/fields → admitted field set for one workspace
//
// The frontend MUST never compute admission itself; it calls this
// endpoint and renders whatever comes back. The endpoint enforces:
//
//   1. Caller authenticated + fresh password (router middlewares).
//   2. Workspace exists and belongs to caller's tenant (else 404 —
//      cross-tenant probes get the same shape as "not found" so we
//      don't leak existence).
//   3. Caller is a workspace member OR a tenant admin (gadmin/padmin).
//      Non-members of a workspace in their own tenant get 403.
//
// On success the body is the union of:
//
//   - scope=global rows from artefact_field_library
//   - scope=tenant rows whose subscription_id == caller tenant
//   - scope=workspace rows whose subscription_id == caller tenant AND
//     have a matching artefact_workspace_fields row for this workspace
//
// Archived rows (archived_at IS NOT NULL) are excluded — same rule the
// resolver uses (ResolveField in resolver.go).
//
// IMPORTANT: this handler reads only vector_artefacts (artefact_field_library
// + artefact_workspace_fields) and mmff_vector.workspace (for the tenant
// boundary check). It does NOT read mmff_library — see
// dev/scripts/lint_portfolio_library_read.py.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
	"github.com/mmffdev/vector-backend/internal/models"
)

// Handler is the chi-mountable HTTP surface for the field resolver.
//
// vectorPool reads workspace tenancy + membership (mmff_vector).
// artefactsPool reads artefact_field_library + artefact_workspace_fields
// (vector_artefacts). artefactsPool may be nil — when VECTOR_ARTEFACTS_DB_URL
// is unset at boot the endpoint returns an empty fields slice (mirrors the
// behaviour of v2 work-items in the same configuration).
type Handler struct {
	vectorPool    *pgxpool.Pool
	artefactsPool *pgxpool.Pool
}

// NewHandler wires the handler. vectorPool MUST be non-nil (the workspace
// existence + tenancy check requires mmff_vector). artefactsPool MAY be
// nil; in that case List returns {workspace_id, fields:[]} after the auth
// gate succeeds — same null-pool fallback used by workitemsv2.
func NewHandler(vectorPool, artefactsPool *pgxpool.Pool) *Handler {
	return &Handler{vectorPool: vectorPool, artefactsPool: artefactsPool}
}

// fieldRowOut is the wire shape for one entry in the response. Columns
// mirror artefact_field_library exactly — we do not invent fields. The
// frontend may ignore columns it doesn't render.
type fieldRowOut struct {
	ID             uuid.UUID       `json:"id"`
	SubscriptionID *uuid.UUID      `json:"subscription_id"`
	FieldName      string          `json:"name"`
	Label          string          `json:"label"`
	FieldType      string          `json:"data_type"`
	OptionsJSON    json.RawMessage `json:"options_json,omitempty"`
	ConfigJSON     json.RawMessage `json:"config_json,omitempty"`
	Description    *string         `json:"description,omitempty"`
	Scope          string          `json:"scope"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
}

// listResponse is the wire shape for GET /api/workspace/{id}/fields.
type listResponse struct {
	WorkspaceID uuid.UUID     `json:"workspace_id"`
	Fields      []fieldRowOut `json:"fields"`
}

// List handles GET /api/workspace/{id}/fields.
//
// Returns 401 on missing user, 400 on malformed UUID, 404 on workspace
// not found / cross-tenant, 403 on workspace-in-tenant but caller is
// neither a member nor a tenant admin, 200 with the admitted field set
// otherwise.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, messages.AuthUnauthorized)
		return
	}

	wsID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}

	// Tenancy + membership gate. mmff_vector is the source of truth for
	// workspace ownership and per-user membership; vector_artefacts has
	// only soft-references back to it.
	if err := h.assertCallerMayRead(r.Context(), wsID, u); err != nil {
		switch {
		case errors.Is(err, errWorkspaceNotFound):
			httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		case errors.Is(err, errForbidden):
			httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
		default:
			httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		}
		return
	}

	// Null-pool fallback — symmetrical to v2 work-items. The auth gate
	// has already passed; an absent vector_artefacts pool means "no
	// fields configured" rather than 500.
	if h.artefactsPool == nil {
		writeJSON(w, http.StatusOK, listResponse{WorkspaceID: wsID, Fields: []fieldRowOut{}})
		return
	}

	rows, err := h.loadAdmittedFields(r.Context(), wsID, u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, listResponse{WorkspaceID: wsID, Fields: rows})
}

// ─── auth helpers ─────────────────────────────────────────────────────

var (
	errWorkspaceNotFound = errors.New("workspace not found")
	errForbidden         = errors.New("forbidden")
)

// assertCallerMayRead returns nil iff the caller can read the field set
// for wsID. Returns:
//
//   - errWorkspaceNotFound if the workspace does not exist OR belongs
//     to another tenant (existence is sensitive — same shape either way).
//   - errForbidden if the workspace is in caller's tenant but caller
//     is neither a workspace member nor a tenant admin.
//   - other errors are plumbing failures (caller maps to 500).
//
// Tenant admins (gadmin / padmin) bypass the membership check — they
// already have full read access to every workspace in the tenant via
// the role grid (PLA-0007 migrations). Plain users must hold a
// user_workspace_permissions row with can_view=TRUE.
func (h *Handler) assertCallerMayRead(ctx context.Context, wsID uuid.UUID, u *models.User) error {
	// 1. Workspace exists + tenant boundary.
	var wsTenant uuid.UUID
	err := h.vectorPool.QueryRow(ctx,
		`SELECT subscription_id FROM workspace WHERE id = $1`, wsID,
	).Scan(&wsTenant)
	if errors.Is(err, pgx.ErrNoRows) {
		return errWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if wsTenant != u.SubscriptionID {
		return errWorkspaceNotFound
	}

	// 2. Tenant admins bypass membership.
	if u.Role == models.RoleGAdmin || u.Role == models.RolePAdmin {
		return nil
	}

	// 3. Workspace membership — any user_workspace_permissions row with
	//    can_view=TRUE is sufficient. The legacy table is the current
	//    source of truth; PLA-0007 G4/G5 will fold this into the role
	//    grid (tracked separately).
	var hasView bool
	err = h.vectorPool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM user_workspace_permissions
			 WHERE user_id = $1 AND workspace_id = $2 AND can_view = TRUE
		)`, u.ID, wsID,
	).Scan(&hasView)
	if err != nil {
		return err
	}
	if !hasView {
		return errForbidden
	}
	return nil
}

// ─── data helpers ─────────────────────────────────────────────────────

// loadAdmittedFields runs a single SQL query against vector_artefacts
// that returns exactly the rows the resolver's per-field ResolveField
// would Admit for (wsID, tenantID). The rules MUST stay in lockstep
// with resolver.go ResolveField — see the test in handler_test.go.
//
// Why a bulk query rather than a loop over ResolveField? The resolver
// is a per-field point-lookup (one row per call). A list endpoint
// would otherwise need to enumerate every candidate id first and then
// fan out N round-trips. Single-query is O(rows), and the WHERE clause
// is a direct translation of the resolver's match table.
func (h *Handler) loadAdmittedFields(ctx context.Context, wsID, tenantID uuid.UUID) ([]fieldRowOut, error) {
	rows, err := h.artefactsPool.Query(ctx, `
		SELECT
		    fl.id,
		    fl.subscription_id,
		    fl.field_name,
		    fl.label,
		    fl.field_type,
		    fl.options_json,
		    fl.config_json,
		    fl.description,
		    fl.scope,
		    fl.created_at,
		    fl.updated_at
		  FROM artefact_field_library fl
		 WHERE fl.archived_at IS NULL
		   AND (
		         -- Cell 1: global → admit unconditionally.
		         fl.scope = 'global'
		      OR -- Cell 2: tenant → admit when caller's tenant matches.
		         (fl.scope = 'tenant'    AND fl.subscription_id = $2)
		      OR -- Cell 4: workspace → tenant must match AND a whitelist
		         --         row must exist for this workspace (defence in
		         --         depth, mirrors resolver.go workspaceHasField).
		         (fl.scope = 'workspace' AND fl.subscription_id = $2 AND EXISTS (
		             SELECT 1 FROM artefact_workspace_fields awf
		              WHERE awf.workspace_id = $1
		                AND awf.field_library_id = fl.id
		         ))
		       )
		 ORDER BY fl.label ASC, fl.field_name ASC`,
		wsID, tenantID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []fieldRowOut{}
	for rows.Next() {
		var (
			r           fieldRowOut
			optionsJSON []byte
			configJSON  []byte
		)
		if err := rows.Scan(
			&r.ID,
			&r.SubscriptionID,
			&r.FieldName,
			&r.Label,
			&r.FieldType,
			&optionsJSON,
			&configJSON,
			&r.Description,
			&r.Scope,
			&r.CreatedAt,
			&r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if len(optionsJSON) > 0 {
			r.OptionsJSON = json.RawMessage(optionsJSON)
		}
		if len(configJSON) > 0 {
			r.ConfigJSON = json.RawMessage(configJSON)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// writeJSON is package-local — same shape as the helper in
// tenantsettings/handler.go.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
