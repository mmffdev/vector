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

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler delegates all DB I/O to Svc; PLA-0039 / Story 00530 lifted
// the RO library pool out of this struct.
type Handler struct {
	Svc *Service
}

// NewHandler constructs the bundle-read handler around the package
// Service. The Service must hold a non-nil libRO pool for these routes
// to function.
func NewHandler(svc *Service) *Handler { return &Handler{Svc: svc} }

// GetLatestByFamily — GET /api/portfolio-models/{family}/latest
//
// Post-R010: families/versions are gone; the path param now identifies
// a portfolio_templates row directly. The /latest suffix is kept so the
// frontend route doesn't need to change.
func (h *Handler) GetLatestByFamily(w http.ResponseWriter, r *http.Request) {
	templateID, err := uuid.Parse(chi.URLParam(r, "family"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	bundle, err := h.Svc.FetchTemplate(r.Context(), templateID)
	if err != nil {
		writeBundleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, bundleToDTO(bundle))
}

// GetByModelID — GET /api/portfolio-models/{id}
func (h *Handler) GetByModelID(w http.ResponseWriter, r *http.Request) {
	modelID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	bundle, err := h.Svc.FetchTemplate(r.Context(), modelID)
	if err != nil {
		writeBundleErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, bundleToDTO(bundle))
}

// writeBundleErr maps fetcher errors to HTTP envelopes.
// Underlying error text is intentionally not leaked.
func writeBundleErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, librarydb.ErrBundleNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
