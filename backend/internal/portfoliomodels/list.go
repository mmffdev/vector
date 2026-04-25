package portfoliomodels

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// modelListItemDTO is the wire shape returned by GET /api/portfolio-models.
//
// One entry per MMFF-published model. `layer_summary` is a comma-joined
// list of layer names (cheapest correct human-readable summary; the
// full layer set is served by GET /api/portfolio-models/{id} via the
// bundle endpoint). `layer_count` is included alongside so the UI can
// render either form without a second roundtrip.
type modelListItemDTO struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Description   *string   `json:"description"`
	LayerSummary  string    `json:"layer_summary"`
	LayerCount    int32     `json:"layer_count"`
	Version       int32     `json:"version"`
	ModelFamilyID uuid.UUID `json:"model_family_id"`
}

// modelListResponseDTO wraps the slice in an object so additive fields
// (e.g. paging metadata in a later phase) don't break clients.
type modelListResponseDTO struct {
	Models []modelListItemDTO `json:"models"`
}

// List — GET /api/portfolio-models
//
// padmin-only listing of MMFF-published portfolio model bundles.
// Role enforcement is provided by the chi middleware chain
// (auth.RequireRole(RolePAdmin)); this handler runs only after the
// caller is authenticated AND padmin.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	models, err := librarydb.ListPublishedModels(r.Context(), h.RO)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	out := modelListResponseDTO{Models: make([]modelListItemDTO, 0, len(models))}
	for _, m := range models {
		out.Models = append(out.Models, modelListItemDTO{
			ID:            m.ID,
			Name:          m.Name,
			Description:   m.Description,
			LayerSummary:  m.LayerSummary,
			LayerCount:    m.LayerCount,
			Version:       m.Version,
			ModelFamilyID: m.ModelFamilyID,
		})
	}
	writeJSON(w, http.StatusOK, out)
}
