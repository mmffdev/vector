// Adoption-state endpoint — GET /api/portfolio-models/adoption-state
//
// Padmin-only read of the caller's subscription_portfolio_model_state
// row. Returns the live adoption (status='completed', archived_at NULL)
// for the caller's subscription, or {adopted: false} when no such row
// exists. In-flight saga rows (pending / in_progress / failed /
// rolled_back) are deliberately treated as "not yet adopted" — the UI
// only flips its banner when the saga has fully landed.
//
// The table lives in mmff_vector (not the library DB), so this handler
// holds its own *pgxpool.Pool against the vector cluster — separate
// from the Phase 3 library-RO Handler in handler.go to keep Phase 3
// wiring untouched and avoid merge collisions with the parallel
// portfolio-models list handler.
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

// AdoptionStateHandler reads subscription_portfolio_model_state from
// the mmff_vector pool. Padmin gating happens at the router layer
// (RequireRole(models.RolePAdmin)).
type AdoptionStateHandler struct {
	VectorPool *pgxpool.Pool
}

func NewAdoptionStateHandler(vectorPool *pgxpool.Pool) *AdoptionStateHandler {
	return &AdoptionStateHandler{VectorPool: vectorPool}
}

// adoptionStateDTO is the wire shape of GET /api/portfolio-models/adoption-state.
//
// `adopted` is always emitted; the other fields are emitted only when
// `adopted` is true (omitempty + pointer types). When the subscription
// has no completed adoption row, the response is the single-key shape
// `{"adopted": false}`.
type adoptionStateDTO struct {
	Adopted          bool       `json:"adopted"`
	ModelID          *uuid.UUID `json:"model_id,omitempty"`
	AdoptedAt        *time.Time `json:"adopted_at,omitempty"`
	AdoptedByUserID  *uuid.UUID `json:"adopted_by_user_id,omitempty"`
}

// GetAdoptionState — GET /api/portfolio-models/adoption-state
//
// Returns the caller's subscription's live adoption record. "Live" =
// status='completed' AND archived_at IS NULL. The partial unique index
// on subscription_portfolio_model_state guarantees at most one such row
// per subscription; we still LIMIT 1 defensively.
func (h *AdoptionStateHandler) GetAdoptionState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var (
		modelID         uuid.UUID
		adoptedAt       time.Time
		adoptedByUserID uuid.UUID
	)
	err := h.VectorPool.QueryRow(r.Context(), `
		SELECT adopted_model_id, adopted_at, adopted_by_user_id
		  FROM subscription_portfolio_model_state
		 WHERE subscription_id = $1
		   AND status = 'completed'
		   AND archived_at IS NULL
		 LIMIT 1`,
		u.SubscriptionID,
	).Scan(&modelID, &adoptedAt, &adoptedByUserID)

	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, adoptionStateDTO{Adopted: false})
		return
	}
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, adoptionStateDTO{
		Adopted:         true,
		ModelID:         &modelID,
		AdoptedAt:       &adoptedAt,
		AdoptedByUserID: &adoptedByUserID,
	})
}
