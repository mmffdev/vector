// Package roles HTTP surface — exposes Service to the chi router.
//
// Sole writer is Service; this file is a thin translation layer
// (parse → call → map errors → JSON). Self-elevation guard for
// AssignPermissions resolves the actor's permission CODES via the
// permissions.Resolver, then translates those codes to permission
// row IDs via a DB lookup (Service takes IDs, the resolver caches
// codes — see PLA-0007 G3 for the rationale).
package roles

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// Handler fronts Service for the chi router. PermResolver + Pool are
// only needed for the self-elevation gate on AssignPermissions and for
// the /creatable endpoint, which both need to read the actor's effective
// permission code set.
type Handler struct {
	Svc          *Service
	PermResolver *permissions.Resolver
	Pool         *pgxpool.Pool
}

// NewHandler wires a roles handler. Pool is required for the codes→ids
// translation that AssignPermissions needs (the resolver caches codes,
// the service takes ids).
func NewHandler(s *Service, res *permissions.Resolver, pool *pgxpool.Pool) *Handler {
	return &Handler{Svc: s, PermResolver: res, Pool: pool}
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
	}, actor.SubscriptionID, actor.ID, clientIP(r))
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
	}, actor.SubscriptionID, actor.ID, clientIP(r))
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
	if err := h.Svc.Archive(r.Context(), id, actor.SubscriptionID, actor.ID, clientIP(r)); err != nil {
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
	actorPermIDs, err := h.resolveActorPermissionIDs(r.Context(), actor.ID)
	if err != nil {
		writeErrFromService(w, err)
		return
	}
	if err := h.Svc.AssignPermissions(r.Context(), id, req.PermissionIDs,
		actor.SubscriptionID, actor.ID, actorPermIDs, clientIP(r)); err != nil {
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
		actor.SubscriptionID, actor.ID, clientIP(r)); err != nil {
		writeErrFromService(w, err)
		return
	}
	if h.PermResolver != nil {
		h.PermResolver.InvalidateRole(id)
	}
	w.WriteHeader(http.StatusNoContent)
}

// ── helpers ────────────────────────────────────────────────────

// resolveActorPermissionIDs resolves the actor's effective permission
// CODES (from the resolver cache) and translates them to permission row
// IDs via a single DB lookup. Returns an empty set when the actor has
// no role grid.
func (h *Handler) resolveActorPermissionIDs(ctx context.Context, actorID uuid.UUID) (map[uuid.UUID]struct{}, error) {
	codeSet, err := h.PermResolver.PermissionsFor(ctx, actorID)
	if err != nil {
		return nil, err
	}
	if len(codeSet) == 0 {
		return map[uuid.UUID]struct{}{}, nil
	}
	codes := make([]string, 0, len(codeSet))
	for c := range codeSet {
		codes = append(codes, string(c))
	}
	rows, err := h.Pool.Query(ctx,
		`SELECT id FROM permissions WHERE code = ANY($1)`, codes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[uuid.UUID]struct{}, len(codes))
	for rows.Next() {
		var pid uuid.UUID
		if err := rows.Scan(&pid); err != nil {
			return nil, err
		}
		out[pid] = struct{}{}
	}
	return out, rows.Err()
}

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

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		if i := strings.Index(xf, ","); i >= 0 {
			return strings.TrimSpace(xf[:i])
		}
		return xf
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
