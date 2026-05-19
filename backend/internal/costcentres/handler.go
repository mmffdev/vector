package costcentres

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// PermissionCode is the canonical permission gating writes.
// Reads (List) are available to any authenticated tenant member —
// they only see their own subscription's data via the SubscriptionID
// claim. Writes require cost_centres.manage.
const PermissionCode = permissions.CostCentresManage

type Handler struct {
	svc *Service
	res *permissions.Resolver
}

func NewHandler(svc *Service, res *permissions.Resolver) *Handler {
	return &Handler{svc: svc, res: res}
}

// GET /_site/cost-centres
//
// Read endpoint. Any authenticated member of the tenant can list —
// the row set is scoped by SubscriptionID from the JWT, so cross-
// tenant access is structurally impossible. Used by the per-user
// cost-centre dropdown which every admin needs even if they don't
// hold cost_centres.manage themselves.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	rows, err := h.svc.List(r.Context(), u.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "Internal error")
		return
	}
	writeJSON(w, http.StatusOK, rows)
}

type createReq struct {
	ParentID *string `json:"parent_id,omitempty"`
	Code     string  `json:"code"`
	Name     string  `json:"name"`
	IsActive *bool   `json:"is_active,omitempty"`
}

// POST /_site/cost-centres
//
// Write endpoint. Requires cost_centres.manage (server-side
// re-checked here even though the route gate enforces it — SERVER
// IS THE GATE: defence in depth).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if ok, _ := h.res.Has(r.Context(), u.ID, PermissionCode); !ok {
		httperr.Write(w, r, http.StatusForbidden, "cost_centres.manage required")
		return
	}

	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "Invalid JSON")
		return
	}
	parent, perr := parseParentID(req.ParentID)
	if perr != nil {
		httperr.Write(w, r, http.StatusBadRequest, "parent_id must be a UUID")
		return
	}

	c, err := h.svc.Create(r.Context(), u.SubscriptionID, CreateInput{
		ParentID: parent,
		Code:     req.Code,
		Name:     req.Name,
		IsActive: req.IsActive,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalid):
			httperr.Write(w, r, http.StatusBadRequest, "code and name required")
		case errors.Is(err, ErrDuplicateCode):
			httperr.Write(w, r, http.StatusConflict, "code already in use")
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "Internal error")
		}
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

type updateReq struct {
	ParentID *string `json:"parent_id,omitempty"`
	Code     *string `json:"code,omitempty"`
	Name     *string `json:"name,omitempty"`
	IsActive *bool   `json:"is_active,omitempty"`
}

// PATCH /_site/cost-centres/{id}
//
// Sparse update. Requires cost_centres.manage.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if ok, _ := h.res.Has(r.Context(), u.ID, PermissionCode); !ok {
		httperr.Write(w, r, http.StatusForbidden, "cost_centres.manage required")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "Invalid id")
		return
	}
	var req updateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "Invalid JSON")
		return
	}
	parent, perr := parseParentID(req.ParentID)
	if perr != nil {
		httperr.Write(w, r, http.StatusBadRequest, "parent_id must be a UUID")
		return
	}

	c, err := h.svc.Update(r.Context(), id, u.SubscriptionID, UpdateInput{
		ParentID: parent,
		Code:     req.Code,
		Name:     req.Name,
		IsActive: req.IsActive,
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			httperr.Write(w, r, http.StatusNotFound, "cost centre not found")
		case errors.Is(err, ErrInvalid):
			httperr.Write(w, r, http.StatusBadRequest, "code and name cannot be empty")
		case errors.Is(err, ErrDuplicateCode):
			httperr.Write(w, r, http.StatusConflict, "code already in use")
		default:
			httperr.Write(w, r, http.StatusInternalServerError, "Internal error")
		}
		return
	}
	writeJSON(w, http.StatusOK, c)
}

// DELETE /_site/cost-centres/{id}
//
// Soft-archive. Cost centre stays queryable for historical user
// assignments (FK ON DELETE RESTRICT); active list omits it.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if ok, _ := h.res.Has(r.Context(), u.ID, PermissionCode); !ok {
		httperr.Write(w, r, http.StatusForbidden, "cost_centres.manage required")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "Invalid id")
		return
	}
	if err := h.svc.Archive(r.Context(), id, u.SubscriptionID); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "cost centre not found")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "Internal error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseParentID converts a *string from JSON to a *uuid.UUID. Empty
// string or nil → nil (no parent / clear parent on update). Anything
// else must parse cleanly.
func parseParentID(s *string) (*uuid.UUID, error) {
	if s == nil || *s == "" {
		return nil, nil
	}
	id, err := uuid.Parse(*s)
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
