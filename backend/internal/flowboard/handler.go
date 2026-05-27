// Package flowboard HTTP surface.
//
// # Layer discipline
//
// This file contains ONLY HTTP wiring: request parsing, response writing,
// and delegation to Service. It contains no SQL strings (those live in
// sql.go) and no business logic (that lives in service.go).
//
// All routes mount under /_site/flowboard/ (WIP + prefs) or
// /_site/topology/{id}/members (members — owned by this package per spec
// §8 even though the path prefix differs).
//
// The Mount method registers placeholder handlers returning 501 until
// implementing stories fill in the service methods.
package flowboard

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Handler is the chi-mountable HTTP surface for the flowboard package.
// It holds a reference to Service and delegates all business logic there.
type Handler struct {
	svc *Service
}

// NewHandler wires the handler to a Service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Mount registers all flowboard routes onto the provided router.
// The caller (main.go) is responsible for wrapping r in RequireAuth,
// RequireFreshPassword, and rate-limit middlewares BEFORE calling Mount,
// so per-endpoint permission middleware added by later stories can sit
// inside the already-authenticated group.
//
// Route table (spec §8):
//
//	GET  /_site/flowboard/wip           → listWipLimits    (FB1.2.2)
//	PUT  /_site/flowboard/wip           → upsertWipLimits  (FB1.2.2)
//	GET  /_site/flowboard/prefs         → getCardPrefs     (FB1.2.3)
//	PUT  /_site/flowboard/prefs         → upsertCardPrefs  (FB1.2.3)
//	GET  /_site/topology/{id}/members   → listNodeMembers  (FB1.2.4)
//
// The /topology/{id}/members path is registered on the root router
// passed in here because the caller mounts flowboardH.Mount(r) where r
// is the /_site sub-router, giving access to the /topology prefix.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/flowboard", func(r chi.Router) {
		r.Get("/wip", h.listWipLimits)
		r.Put("/wip", h.upsertWipLimits)
		r.Get("/prefs", h.getCardPrefs)
		r.Put("/prefs", h.upsertCardPrefs)
	})
	r.Route("/topology/{id}/members", func(r chi.Router) {
		r.Get("/", h.listNodeMembers)
	})
}

// listWipLimits returns WIP-limit rows for a board.
// TODO(FB1.2.2): implement in story FB1.2.2
func (h *Handler) listWipLimits(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

// upsertWipLimits upserts the WIP limit for one (node, flow_state) pair.
// TODO(FB1.2.2): implement in story FB1.2.2
func (h *Handler) upsertWipLimits(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

// getCardPrefs returns the current user's card-field preferences for a type.
// TODO(FB1.2.3): implement in story FB1.2.3
func (h *Handler) getCardPrefs(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

// upsertCardPrefs updates the current user's card-field preferences.
// TODO(FB1.2.3): implement in story FB1.2.3
func (h *Handler) upsertCardPrefs(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}

// listNodeMembers lists members of a topology node (used by the WIP-edit
// permission gate: only members may write WIP limits).
// TODO(FB1.2.4): implement in story FB1.2.4
func (h *Handler) listNodeMembers(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "not implemented", http.StatusNotImplemented)
}
