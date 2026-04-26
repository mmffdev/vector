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
package portfoliomodels

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// LayersBatchHandler holds the vector pool for subscription_layers writes.
// Padmin gating is enforced at the router layer (RequireRole(RolePAdmin)).
type LayersBatchHandler struct {
	VectorPool *pgxpool.Pool
}

// NewLayersBatchHandler constructs the handler.
func NewLayersBatchHandler(vectorPool *pgxpool.Pool) *LayersBatchHandler {
	return &LayersBatchHandler{VectorPool: vectorPool}
}

// layerPatchInput is one element of the PATCH request body array.
type layerPatchInput struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Tag           string    `json:"tag"`
	SortOrder     int32     `json:"sort_order"`
	DescriptionMD *string   `json:"description_md"`
}

// subscriptionLayerDTO is the wire shape of one layer in the PATCH response.
// It mirrors layerDTO (dto.go) but uses source_library_id in place of
// model_id — subscription_layers has no model_id column.
type subscriptionLayerDTO struct {
	ID              uuid.UUID  `json:"id"`
	SourceLibraryID uuid.UUID  `json:"source_library_id"`
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
	ArchivedAt      *time.Time `json:"archived_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// fieldError is one element of the 422 errors array.
type fieldError struct {
	Index   int    `json:"index"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// GetLayers — GET /api/subscription/layers
// Returns all live subscription_layers rows for the caller's subscription,
// ordered by sort_order. This is the authoritative source for the editable
// layers table — IDs here are subscription UUIDs, not library UUIDs.
func (h *LayersBatchHandler) GetLayers(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	rows, err := h.VectorPool.Query(r.Context(), `
		SELECT id, source_library_id, name, tag, sort_order,
		       parent_layer_id, icon, colour,
		       description_md, help_md,
		       allows_children, is_leaf,
		       archived_at, created_at, updated_at
		  FROM subscription_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY sort_order`,
		u.SubscriptionID,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var result []subscriptionLayerDTO
	for rows.Next() {
		var d subscriptionLayerDTO
		if err := rows.Scan(
			&d.ID, &d.SourceLibraryID, &d.Name, &d.Tag, &d.SortOrder,
			&d.ParentLayerID, &d.Icon, &d.Colour,
			&d.DescriptionMD, &d.HelpMD,
			&d.AllowsChildren, &d.IsLeaf,
			&d.ArchivedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		result = append(result, d)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if result == nil {
		result = []subscriptionLayerDTO{}
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

	// ── Decode body ──────────────────────────────────────────────────
	var inputs []layerPatchInput
	if err := json.NewDecoder(r.Body).Decode(&inputs); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	// ── Fetch live layer IDs for this subscription ───────────────────
	rows, err := h.VectorPool.Query(r.Context(), `
		SELECT id
		  FROM subscription_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL`,
		u.SubscriptionID,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	liveIDs := make(map[uuid.UUID]struct{})
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		liveIDs[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// ── AC 1: payload must be the exact complete set of live layers ──
	if len(inputs) != len(liveIDs) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf(
				"payload contains %d layers but subscription has %d live layers; must include all",
				len(inputs), len(liveIDs),
			),
		})
		return
	}

	// Every ID in payload must be a live layer for this subscription.
	for i, inp := range inputs {
		if _, ok := liveIDs[inp.ID]; !ok {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": fmt.Sprintf("index %d: id %s is not a live layer for this subscription", i, inp.ID),
			})
			return
		}
	}

	// ── AC 2: validate all rows before any writes ────────────────────
	var fieldErrors []fieldError

	seenNames := make(map[string]int) // name → first-seen index
	seenTags := make(map[string]int)  // tag  → first-seen index

	for i, inp := range inputs {
		// Tag length 2–4 chars
		if len(inp.Tag) < 2 || len(inp.Tag) > 4 {
			fieldErrors = append(fieldErrors, fieldError{
				Index:   i,
				Field:   "tag",
				Message: fmt.Sprintf("tag %q must be 2–4 characters", inp.Tag),
			})
		}

		// Name must not be empty
		if inp.Name == "" {
			fieldErrors = append(fieldErrors, fieldError{
				Index:   i,
				Field:   "name",
				Message: "name must not be empty",
			})
		}

		// Duplicate name within payload
		if firstIdx, seen := seenNames[inp.Name]; seen {
			fieldErrors = append(fieldErrors, fieldError{
				Index:   i,
				Field:   "name",
				Message: fmt.Sprintf("duplicate name %q; first seen at index %d", inp.Name, firstIdx),
			})
		} else {
			seenNames[inp.Name] = i
		}

		// Duplicate tag within payload
		if firstIdx, seen := seenTags[inp.Tag]; seen {
			fieldErrors = append(fieldErrors, fieldError{
				Index:   i,
				Field:   "tag",
				Message: fmt.Sprintf("duplicate tag %q; first seen at index %d", inp.Tag, firstIdx),
			})
		} else {
			seenTags[inp.Tag] = i
		}
	}

	if len(fieldErrors) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		_ = json.NewEncoder(w).Encode(map[string]any{"errors": fieldErrors})
		return
	}

	// ── AC 3: write all updates in a single transaction ──────────────
	tx, err := h.VectorPool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	for _, inp := range inputs {
		if _, err := tx.Exec(r.Context(), `
			UPDATE subscription_layers
			   SET name           = $1,
			       tag            = $2,
			       sort_order     = $3,
			       description_md = $4
			 WHERE id             = $5
			   AND subscription_id = $6
			   AND archived_at IS NULL`,
			inp.Name, inp.Tag, inp.SortOrder, inp.DescriptionMD,
			inp.ID, u.SubscriptionID,
		); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}

	// ── Read back updated rows inside the same tx ────────────────────
	updatedRows, err := tx.Query(r.Context(), `
		SELECT id, source_library_id, name, tag, sort_order,
		       parent_layer_id, icon, colour,
		       description_md, help_md,
		       allows_children, is_leaf,
		       archived_at, created_at, updated_at
		  FROM subscription_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY sort_order, name`,
		u.SubscriptionID,
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	var result []subscriptionLayerDTO
	for updatedRows.Next() {
		var d subscriptionLayerDTO
		if err := updatedRows.Scan(
			&d.ID, &d.SourceLibraryID, &d.Name, &d.Tag, &d.SortOrder,
			&d.ParentLayerID, &d.Icon, &d.Colour,
			&d.DescriptionMD, &d.HelpMD,
			&d.AllowsChildren, &d.IsLeaf,
			&d.ArchivedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			updatedRows.Close()
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		result = append(result, d)
	}
	updatedRows.Close()
	if err := updatedRows.Err(); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if result == nil {
		result = []subscriptionLayerDTO{}
	}
	writeJSON(w, http.StatusOK, result)
}
