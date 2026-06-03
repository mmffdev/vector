package dependencies

import (
	"github.com/go-chi/chi/v5"
)

// Handler hangs the dependencies HTTP surface off the chi router.
// Mounted in cmd/server/main.go under /_site/dependencies behind the
// standard auth + sentinel middleware chain.
//
// B23.1.4 ships the scaffold ONLY — Mount registers no routes yet.
// Subsequent stories add:
//   B23.1.5  — POST   /maps                       (create)
//              PATCH  /maps/{id}                  (rename)
//              POST   /maps/{id}/archive          (archive)
//   B23.1.6  — POST   /edges                      (insert, cycle-guarded)
//   B23.1.7  — POST   /edges/{id}/archive         (archive)
//   B23.1.8  — GET    /work-items/{id}/dependency-impact (preflight; mounted elsewhere)
//   B23.2.1  — GET    /maps                       (list)
//              GET    /maps/{id}                  (detail)
//              GET    /edges                      (three-bucket projection)
//   B23.2.2  — GET    /candidates                 (server-side exclusion)
//   B23.3.1  — GET    /{id}/transitive-impact     (reachability)
type Handler struct {
	Svc *Service
}

// NewHandler wires the handler against the sole-writer service.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// Mount registers the dependencies routes on the chi router. Empty
// in B23.1.4 — story-by-story PRs append handlers as the corresponding
// endpoints land. Kept here so main.go can wire the mount block
// today and reuse it without changes as routes are added.
func (h *Handler) Mount(r chi.Router) {
	// No routes registered yet. See package-level Mount comment for
	// the per-story expansion plan.
	_ = r
}
