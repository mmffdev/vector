package flows

import (
	"encoding/json"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// Handler exposes the flows domain over HTTP.
type Handler struct {
	Svc *Service
}

// NewHandler returns a Handler backed by the given Service.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// GET /api/flows
//
// Returns every flow row for the caller's subscription, grouped by target
// (system / tenant / portfolio). Caller must have flows.manage.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	out, err := h.Svc.ListBySubscription(r.Context(), u.SubscriptionID.String())
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
