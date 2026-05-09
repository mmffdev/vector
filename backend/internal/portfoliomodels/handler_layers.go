// PatchLayersBatch — PATCH /api/subscription/layers/batch
//
// Allows a padmin to rename, retag, update description, and reorder ALL live
// (non-archived) layers for their subscription in a single atomic write.
//
// Contract (story 00062):
//   - Body: [{id, name, tag, sort_order, description_md}] — must be the
//     complete set of live layers; partial arrays → 400.
//   - Tag 2–4 chars enforced; duplicate name or tag within payload → 422
//     with field-level error identifying the offending row index.
//   - Writes atomically in a single transaction: only name, tag, sort_order,
//     description_md are written. parent_layer_id, is_leaf, allows_children,
//     source_library_id, archived_at are NEVER touched.
//   - padmin-only (403 for gadmin or unauthenticated).
//   - Response: updated layer array (subscriptionLayerDTO) so the frontend
//     can refresh without a follow-up GET.
//
// PLA-0039 / Story 00530: SQL is owned by Service; the handler is now
// parse + auth + svc.Method() + render only.
package portfoliomodels

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// LayersBatchHandler delegates to the package Service for all SQL.
// Padmin-equivalent gating is enforced at the router layer
// (RequirePermission(PortfolioList) — PLA-0007).
type LayersBatchHandler struct {
	Svc *Service
}

// NewLayersBatchHandler constructs the handler around the Service.
func NewLayersBatchHandler(svc *Service) *LayersBatchHandler {
	return &LayersBatchHandler{Svc: svc}
}

// GetLayers — GET /api/subscription/layers
// Returns all live obj_strategy_types_layers rows for the caller's subscription,
// ordered by sort_order. This is the authoritative source for the editable
// layers table — IDs here are subscription UUIDs, not library UUIDs.
func (h *LayersBatchHandler) GetLayers(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	result, err := h.Svc.ListLiveSubscriptionLayers(r.Context(), u.SubscriptionID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// PatchLayersBatch — PATCH /api/subscription/layers/batch
func (h *LayersBatchHandler) PatchLayersBatch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var inputs []LayerPatch
	if err := json.NewDecoder(r.Body).Decode(&inputs); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	result, err := h.Svc.PatchLiveSubscriptionLayers(r.Context(), u.SubscriptionID, inputs)
	if err != nil {
		var ve *ValidationError
		if errors.As(err, &ve) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{"errors": ve.Violations})
			return
		}
		if errors.Is(err, ErrLayerCountMismatch) || errors.Is(err, ErrLayerUnknown) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, result)
}
