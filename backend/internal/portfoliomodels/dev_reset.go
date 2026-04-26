// Dev adoption reset — POST /api/admin/dev/adoption-reset
//
// Gadmin-only tool for completely resetting a subscription's portfolio
// adoption state to zero (erases all adoption records and mirror tables).
// Useful for testing the adoption flow and recovering from dev errors.
//
// Card 00054 (Phase 5)
package portfoliomodels

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// DevResetHandler holds the vector pool for dev operations.
type DevResetHandler struct {
	VectorPool *pgxpool.Pool
}

func NewDevResetHandler(vectorPool *pgxpool.Pool) *DevResetHandler {
	return &DevResetHandler{VectorPool: vectorPool}
}

// DevResetAdoptionState — POST /api/admin/dev/adoption-reset
//
// Deletes all subscription_portfolio_model_state rows + mirror tables
// for the caller's subscription. Hard delete (no audit trail for this
// dev-only operation). Requires gadmin role.
func (h *DevResetHandler) ResetAdoptionState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Delete order matters: children before parents, per FK constraints.
	// Mirror tables have source_library_id set; we use that to identify
	// rows created during adoption (not hand-authored subscription data).

	err := h.resetTables(r.Context(), u.SubscriptionID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Portfolio adoption state reset to zero.",
	})
}

// resetTables performs the cascading delete in the right order.
// Each delete targets rows with source_library_id IS NOT NULL to avoid
// touching any hand-authored subscription data.
func (h *DevResetHandler) resetTables(ctx context.Context, subscriptionID uuid.UUID) error {
	// Delete artifacts (no FK deps)
	_, err := h.VectorPool.Exec(ctx, `
		DELETE FROM subscription_artifacts
		WHERE subscription_id = $1 AND source_library_id IS NOT NULL
	`, subscriptionID)
	if err != nil {
		return err
	}

	// Delete terminology (no FK deps)
	_, err = h.VectorPool.Exec(ctx, `
		DELETE FROM subscription_terminology
		WHERE subscription_id = $1 AND source_library_id IS NOT NULL
	`, subscriptionID)
	if err != nil {
		return err
	}

	// Delete transitions (FK to workflows)
	_, err = h.VectorPool.Exec(ctx, `
		DELETE FROM subscription_workflow_transitions
		WHERE subscription_id = $1 AND source_library_id IS NOT NULL
	`, subscriptionID)
	if err != nil {
		return err
	}

	// Delete workflows (FK to layers)
	_, err = h.VectorPool.Exec(ctx, `
		DELETE FROM subscription_workflows
		WHERE subscription_id = $1 AND source_library_id IS NOT NULL
	`, subscriptionID)
	if err != nil {
		return err
	}

	// Delete layers (self-FK on parent_layer_id; delete all with source_library_id)
	_, err = h.VectorPool.Exec(ctx, `
		DELETE FROM subscription_layers
		WHERE subscription_id = $1 AND source_library_id IS NOT NULL
	`, subscriptionID)
	if err != nil {
		return err
	}

	// Delete adoption state records (audit-only after this point)
	_, err = h.VectorPool.Exec(ctx, `
		DELETE FROM subscription_portfolio_model_state
		WHERE subscription_id = $1
	`, subscriptionID)
	if err != nil {
		return err
	}

	return nil
}
