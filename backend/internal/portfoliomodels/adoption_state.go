// Adoption-state endpoint — GET /api/portfolio-models/adoption-state
//
// PLA-0026 / Story 00501 (B12): rewritten to read from the
// vector_artefacts substrate (master_record_portfolios + artefacts_types)
// instead of the legacy mmff_vector mirror (subscription_portfolio_model_state
// + obj_strategy_types_layers).
//
// The legacy mirror tables stay alive for now — other callers still
// read them — but the saga's master-of-truth for "is a portfolio model
// adopted?" is master_record_portfolios (B6 finalize step), so this
// handler must read the same source the saga writes.
//
// Status logic (substrate-driven):
//
//   notStarted: master_record_portfolios has NO row for this workspace_id
//               AND artefacts_types has NO scope='strategy' rows for this
//               workspace_id.
//
//   inProgress: artefacts_types HAS scope='strategy' rows for this
//               workspace_id BUT master_record_portfolios has NO row.
//               (Saga partway through; B6 finalize hasn't run.)
//
//   adopted:    master_record_portfolios HAS a row for this workspace_id.
//
// The route stays /api/portfolio-models/adoption-state (subscription-
// scoped, no path param) for wire compatibility — the frontend will not
// change as part of this story. We resolve workspace_id from the
// caller's subscription via mmff_vector.workspaces, matching the
// adoption-saga's resolveWorkspaceID() convention.
//
// Response shape: backward-compatible. The legacy `adopted` boolean is
// preserved (true iff status='adopted'); status, model_id, adopted_at,
// adopted_by_user_id are emitted alongside it. Optional fields are
// omitted when adopted=false.
//
// Pool wiring:
//   - vectorPool (mmff_vector) — used to resolve subscription_id →
//     workspace_id. Always required.
//   - vaPool (vector_artefacts) — used to read master_record_portfolios
//     and artefacts_types. May be nil when VECTOR_ARTEFACTS_DB_URL is
//     unset; in that case the handler returns status='notStarted' for
//     backward compatibility (no environment regresses to a 5xx).
package portfoliomodels

import (
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// AdoptionStateHandler reads adoption status from the new substrate.
// VectorPool resolves subscription → workspace; VAPool reads
// master_record_portfolios + artefacts_types in vector_artefacts. VAPool
// may be nil; the handler degrades to notStarted in that case.
type AdoptionStateHandler struct {
	VectorPool *pgxpool.Pool
	VAPool     *pgxpool.Pool
}

// NewAdoptionStateHandler constructs the handler with both pools.
// Pass nil for vaPool to disable VA reads (handler returns notStarted).
func NewAdoptionStateHandler(vectorPool *pgxpool.Pool, vaPool *pgxpool.Pool) *AdoptionStateHandler {
	return &AdoptionStateHandler{VectorPool: vectorPool, VAPool: vaPool}
}

// Adoption status tri-state. Wire values are the JSON strings.
const (
	statusNotStarted = "notStarted"
	statusInProgress = "inProgress"
	statusAdopted    = "adopted"
)

// adoptionStateDTO is the wire shape of GET /api/portfolio-models/adoption-state.
//
// `status` is the new tri-state field (notStarted | inProgress | adopted).
// `adopted` (legacy boolean) is preserved for wire compatibility — the
// frontend in this story does not change. `adopted == (status ==
// "adopted")`. The model/time/user fields are emitted only when
// adopted is true.
type adoptionStateDTO struct {
	Status          string     `json:"status"`
	Adopted         bool       `json:"adopted"`
	ModelID         *uuid.UUID `json:"model_id,omitempty"`
	AdoptedAt       *time.Time `json:"adopted_at,omitempty"`
	AdoptedByUserID *uuid.UUID `json:"adopted_by_user_id,omitempty"`
}

// GetAdoptionState — GET /api/portfolio-models/adoption-state
//
// Returns the caller's subscription's adoption status computed from the
// new substrate. Always 200 for an authenticated caller — no spurious
// 404s post-reset, since "no rows yet" is a legitimate notStarted
// state, not a missing resource.
func (h *AdoptionStateHandler) GetAdoptionState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Resolve workspace_id for this subscription. Mirrors the
	// adoption-saga's resolveWorkspaceID() convention (lowest-id live
	// workspace). Multi-workspace subscriptions are out of scope for
	// the cutover — adoption is per-tenant today.
	var workspaceID uuid.UUID
	err := h.VectorPool.QueryRow(r.Context(), sqlSelectFirstLiveWorkspaceForSubscription,
		u.SubscriptionID,
	).Scan(&workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		// No workspace for this subscription — there is nothing to adopt
		// against yet. Treat as notStarted rather than 404 so the UI
		// surfaces a clean empty state.
		writeJSON(w, http.StatusOK, adoptionStateDTO{
			Status:  statusNotStarted,
			Adopted: false,
		})
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// VA pool optional — without it we cannot inspect the new substrate.
	// Return notStarted to keep the endpoint working in environments
	// without VECTOR_ARTEFACTS_DB_URL (matches the v2 work-items pattern).
	if h.VAPool == nil {
		writeJSON(w, http.StatusOK, adoptionStateDTO{
			Status:  statusNotStarted,
			Adopted: false,
		})
		return
	}

	// Single-statement substrate check:
	//   - master_record_portfolios row presence → adopted
	//   - artefacts_types scope='strategy' presence → inProgress
	//   - neither → notStarted
	// LEFT JOIN gives us the master-record fields when present and
	// NULLs when not; the EXISTS sub-select gives us a cheap "any
	// strategy types?" boolean.
	var (
		hasMaster       bool
		hasStrategyType bool
		modelID         *uuid.UUID
		adoptedAt       *time.Time
		adoptedByUserID *uuid.UUID
	)
	err = h.VAPool.QueryRow(r.Context(), sqlSelectAdoptionStateForWorkspace,
		workspaceID,
	).Scan(&hasMaster, &hasStrategyType, &modelID, &adoptedAt, &adoptedByUserID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	switch {
	case hasMaster:
		writeJSON(w, http.StatusOK, adoptionStateDTO{
			Status:          statusAdopted,
			Adopted:         true,
			ModelID:         modelID,
			AdoptedAt:       adoptedAt,
			AdoptedByUserID: adoptedByUserID,
		})
	case hasStrategyType:
		writeJSON(w, http.StatusOK, adoptionStateDTO{
			Status:  statusInProgress,
			Adopted: false,
		})
	default:
		writeJSON(w, http.StatusOK, adoptionStateDTO{
			Status:  statusNotStarted,
			Adopted: false,
		})
	}
}
