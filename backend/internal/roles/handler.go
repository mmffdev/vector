// Package roles HTTP surface — exposes Service to the chi router.
//
// Sole writer is Service; this file is a thin translation layer
// (parse → call → map errors → JSON). Self-elevation guard for
// AssignPermissions delegates to Svc.ResolveActorPermissionIDs (PLA-0039 /
// Story 00529, B22.9) — the handler no longer touches the DB.
package roles

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/security"
)

// Handler fronts Service for the chi router. PermResolver is retained
// only for the in-memory cache reads (Creatable's PermissionsFor) and
// the cache-invalidation calls after Assign/Revoke — neither touches
// the DB. The DB-bound codes→ids translation lives on Service.
type Handler struct {
	Svc          *Service
	PermResolver *permissions.Resolver
}

// NewHandler wires a roles handler. The Service must already have its
// Resolver set (see main.go) — handler does not write Svc.Resolver.
func NewHandler(s *Service, res *permissions.Resolver) *Handler {
	return &Handler{Svc: s, PermResolver: res}
}

// ── endpoints ──────────────────────────────────────────────────

// List returns every role visible to the actor (system + own-tenant).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	out, err := h.Svc.List(r.Context(), actor.SubscriptionID)
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// Creatable returns the subset of system roles the actor may assign
// to a NEW user, gated by the users.create.<role> creator-matrix codes.
func (h *Handler) Creatable(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	codes, err := h.PermResolver.PermissionsFor(r.Context(), actor.ID)
	if err != nil {
		writeErrFromService(w, err)
		return
	}

	pairs := []struct {
		code permissions.Code
		id   uuid.UUID
	}{
		{permissions.UsersCreateGadmin, SystemRoleGadmin},
		{permissions.UsersCreatePadmin, SystemRolePadmin},
		{permissions.UsersCreateTeamLead, SystemRoleTeamLead},
		{permissions.UsersCreateUser, SystemRoleUser},
		{permissions.UsersCreateExternal, SystemRoleExternal},
	}

	out := []any{}
	for _, p := range pairs {
		if _, ok := codes[p.code]; !ok {
			continue
		}
		row, err := h.Svc.Get(r.Context(), p.id, actor.SubscriptionID)
		if err != nil {
			// System rows are always visible; a Get error here is genuinely 500.
			writeErrFromService(w, err)
			return
		}
		out = append(out, row)
	}
	writeJSON(w, http.StatusOK, out)
}

// Get returns a single role visible to the actor (404 otherwise).
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id")
		return
	}
	row, err := h.Svc.Get(r.Context(), id, actor.SubscriptionID)
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

type createReq struct {
	Code        string `json:"code"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Rank        int    `json:"rank"`
	IsExternal  bool   `json:"is_external"`
}

// Create inserts a tenant-custom role under the actor's subscription.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	row, err := h.Svc.Create(r.Context(), CreateInput{
		Code: req.Code, Label: req.Label, Description: req.Description,
		Rank: req.Rank, IsExternal: req.IsExternal,
	}, actor.SubscriptionID, actor.ID, security.ClientIP(r))
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

type updateReq struct {
	Label       *string `json:"label,omitempty"`
	Description *string `json:"description,omitempty"`
	Rank        *int    `json:"rank,omitempty"`
}

// Update edits a role (label/description always; rank only on tenant rows).
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id")
		return
	}
	var req updateReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	row, err := h.Svc.Update(r.Context(), id, UpdateInput{
		Label: req.Label, Description: req.Description, Rank: req.Rank,
	}, actor.SubscriptionID, actor.ID, security.ClientIP(r))
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	writeJSON(w, http.StatusOK, row)
}

// Archive soft-archives a tenant-custom role (system rows reject 403).
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id")
		return
	}
	if err := h.Svc.Archive(r.Context(), id, actor.SubscriptionID, actor.ID, security.ClientIP(r)); err != nil {
		writeErrFromService(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListPermissionsCatalogue returns the full permissions catalogue
// (id, code, label, category, description). Visibility gate is
// roles.list — anyone who can list roles can see the codes that
// roles can grant. Used by /admin/roles detail to render the
// permission grid.
func (h *Handler) ListPermissionsCatalogue(w http.ResponseWriter, r *http.Request) {
	out, err := h.Svc.ListPermissionsCatalogue(r.Context())
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ListPermissions returns the permission ids granted to a role.
func (h *Handler) ListPermissions(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id")
		return
	}
	out, err := h.Svc.ListPermissionsForRole(r.Context(), id, actor.SubscriptionID)
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

type permIDsReq struct {
	PermissionIDs []uuid.UUID `json:"permission_ids"`
}

// AssignPermissions grants a set of permission ids to a role.
func (h *Handler) AssignPermissions(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id")
		return
	}
	var req permIDsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	actorPermIDs, err := h.Svc.ResolveActorPermissionIDs(r.Context(), actor.ID)
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	if err := h.Svc.AssignPermissions(r.Context(), id, req.PermissionIDs,
		actor.SubscriptionID, actor.ID, actorPermIDs, security.ClientIP(r)); err != nil {
		writeErrFromService(w, err)
		return
	}
	if h.PermResolver != nil {
		h.PermResolver.InvalidateRole(id)
	}
	w.WriteHeader(http.StatusNoContent)
}

// RevokePermissions removes a set of permission ids from a role.
func (h *Handler) RevokePermissions(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	if actor == nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "bad_id")
		return
	}
	var req permIDsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_request")
		return
	}
	if err := h.Svc.RevokePermissions(r.Context(), id, req.PermissionIDs,
		actor.SubscriptionID, actor.ID, security.ClientIP(r)); err != nil {
		writeErrFromService(w, err)
		return
	}
	if h.PermResolver != nil {
		h.PermResolver.InvalidateRole(id)
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ────────────────────────────────────────────────────

// writeErrFromService maps roles sentinel errors to HTTP responses.
func writeErrFromService(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeErr(w, http.StatusNotFound, "not_found")
	case errors.Is(err, ErrSystemRoleImmutable):
		writeErr(w, http.StatusForbidden, "system_role_immutable")
	case errors.Is(err, ErrReservedRank):
		writeErr(w, http.StatusBadRequest, "reserved_rank")
	case errors.Is(err, ErrSelfElevation):
		writeErr(w, http.StatusForbidden, "self_elevation_blocked")
	case errors.Is(err, ErrCodeTaken):
		writeErr(w, http.StatusConflict, "code_taken")
	default:
		writeErr(w, http.StatusInternalServerError, "internal")
	}
}

func writeErr(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

