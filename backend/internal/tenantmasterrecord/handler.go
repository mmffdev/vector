package tenantmasterrecord

// HTTP surface for the master_record_workspaces sole-writer service
// (table renamed from master_record_tenants by migration 067 on 2026-05-15).
// Mounts under /api/tenant-settings; both routes require auth +
// fresh-password (handled by main.go middlewares). Reads are open
// to any authenticated user in the tenant; writes inherit the same
// gate and rely on tenant scoping (the row is keyed by the caller's
// subscription_id, so cross-tenant writes are not even addressable).

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.Get)
	r.Patch("/", h.Patch)
}

// GET /api/tenant-settings — returns the row for the caller's tenant.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	row, err := h.Svc.Get(r.Context(), u.SubscriptionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// PATCH /api/tenant-settings — partial update. 422 with violations[]
// on validation failure.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var in PatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	row, err := h.Svc.Patch(r.Context(), u.SubscriptionID, u.ID, in)
	if err != nil {
		var ve *ValidationError
		if errors.As(err, &ve) {
			vs := make([]httperr.Violation, 0, len(ve.Violations))
			for _, v := range ve.Violations {
				vs = append(vs, httperr.Violation{Field: v.Field, Message: v.Message})
			}
			httperr.WriteValidation(w, r, vs)
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
