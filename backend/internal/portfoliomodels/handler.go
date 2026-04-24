// Package portfoliomodels exposes the read-only HTTP surface for
// library-authored portfolio model bundles.
//
// Phase 3 of the mmff_library adoption plan: two GET endpoints that
// hand the seeded MMFF bundle (and any future system bundles) to the
// Settings preview UI. Writes — publish, share, adoption — land in
// later phases.
//
//	GET /api/portfolio-models/:family/latest  → FetchLatestByFamily
//	GET /api/portfolio-models/:id             → FetchByModelID
//
// Both require an authenticated user (any tenant). The MMFF-authored
// content in mmff_library is implicitly visible to every authenticated
// caller; per-tenant share enforcement arrives in Phase 5.
package portfoliomodels

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// Handler holds the RO library pool. Only the RO pool is needed for
// Phase 3; publish / ack pools are wired by later phases.
type Handler struct {
	RO *pgxpool.Pool
}

func NewHandler(ro *pgxpool.Pool) *Handler { return &Handler{RO: ro} }

// GetLatestByFamily — GET /api/portfolio-models/{family}/latest
func (h *Handler) GetLatestByFamily(w http.ResponseWriter, r *http.Request) {
	familyID, err := uuid.Parse(chi.URLParam(r, "family"))
	if err != nil {
		http.Error(w, "invalid family id", http.StatusBadRequest)
		return
	}
	bundle, err := librarydb.FetchLatestByFamily(r.Context(), h.RO, familyID)
	if err != nil {
		writeBundleErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, bundleToDTO(bundle))
}

// GetByModelID — GET /api/portfolio-models/{id}
func (h *Handler) GetByModelID(w http.ResponseWriter, r *http.Request) {
	modelID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid model id", http.StatusBadRequest)
		return
	}
	bundle, err := librarydb.FetchByModelID(r.Context(), h.RO, modelID)
	if err != nil {
		writeBundleErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, bundleToDTO(bundle))
}

// writeBundleErr maps fetcher errors to HTTP envelopes.
// Underlying error text is intentionally not leaked.
func writeBundleErr(w http.ResponseWriter, err error) {
	if errors.Is(err, librarydb.ErrBundleNotFound) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
