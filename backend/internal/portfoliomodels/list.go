package portfoliomodels

import (
	"net/http"

	"github.com/google/uuid"
)

// templateLayerDTO is the wire shape for a single layer in the response.
type templateLayerDTO struct {
	Tag  string `json:"tag"`
	Name string `json:"name"`
}

// modelListItemDTO is the wire shape returned by GET /api/portfolio-models.
type modelListItemDTO struct {
	ID          uuid.UUID          `json:"id"`
	Name        string             `json:"name"`
	Description *string            `json:"description"`
	Layers      []templateLayerDTO `json:"layers"`
}

// modelListResponseDTO wraps the slice so additive fields don't break clients.
type modelListResponseDTO struct {
	Models []modelListItemDTO `json:"models"`
}

// List — GET /api/portfolio-models
//
// padmin-only listing of MMFF-published portfolio model bundles.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	models, err := h.Svc.ListPublishedModels(r.Context())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	out := modelListResponseDTO{Models: make([]modelListItemDTO, 0, len(models))}
	for _, m := range models {
		layers := make([]templateLayerDTO, len(m.Layers))
		for i, l := range m.Layers {
			layers[i] = templateLayerDTO{Tag: l.Tag, Name: l.Name}
		}
		out.Models = append(out.Models, modelListItemDTO{
			ID:          m.ID,
			Name:        m.Name,
			Description: m.Description,
			Layers:      layers,
		})
	}
	writeJSON(w, http.StatusOK, out)
}
