package nav

// Admin grid surface for the page-permissions matrix at
// /user-management/permissions. Read + per-cell write of users_roles_pages
// for system pages only. Tenant-scoped entity pages (user-pinned
// portfolios/products) are deliberately excluded — the grid governs the
// product catalogue, not personal bookmarks.
//
// Gating: the route layer mounts these handlers behind
// auth.RequirePermission(roles.assign_permissions), which is gadmin-only
// in the seeded grant matrix.
//
// PLA-0049 invariants:
//   • {role_id} URL param refuses the grp_global UUID (gadmin universal
//     access cannot be revoked through this surface).
//   • DELETE refuses any avatar-bucket page (locked floor — every role
//     must keep avatar pages even if the admin tries to revoke).

import (
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/roles"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

type GrantsAdminHandler struct {
	Pool     *pgxpool.Pool
	Registry *CachedRegistry
	Roles    *roles.Service
}

func NewGrantsAdminHandler(pool *pgxpool.Pool, reg *CachedRegistry, rolesSvc *roles.Service) *GrantsAdminHandler {
	return &GrantsAdminHandler{Pool: pool, Registry: reg, Roles: rolesSvc}
}

type pageGrantRow struct {
	PageID       uuid.UUID   `json:"page_id"`
	KeyEnum      string      `json:"key_enum"`
	Label        string      `json:"label"`
	Href         string      `json:"href"`
	TagEnum      string      `json:"tag_enum"`
	BucketLabel  string      `json:"bucket_label"`
	BucketOrder  int         `json:"bucket_order"`
	DefaultOrder int         `json:"default_order"`
	RoleIDs      []uuid.UUID `json:"role_ids"`
}

type pageGrantsResp struct {
	Pages []pageGrantRow `json:"pages"`
}

// GET /api/admin/page-grants — full system-page grant matrix.
func (h *GrantsAdminHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.Pool.Query(r.Context(), sqlListSystemPagesForGrantsAdmin)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	defer rows.Close()

	out := make([]pageGrantRow, 0, 64)
	for rows.Next() {
		var row pageGrantRow
		if err := rows.Scan(
			&row.PageID, &row.KeyEnum, &row.Label, &row.Href, &row.TagEnum, &row.DefaultOrder,
			&row.BucketLabel, &row.BucketOrder, &row.RoleIDs,
		); err != nil {
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
			return
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, pageGrantsResp{Pages: out})
}

// PUT /api/admin/page-grants/{page_id}/{role_id} — idempotent grant.
func (h *GrantsAdminHandler) Grant(w http.ResponseWriter, r *http.Request) {
	pageID, roleID, ok := h.parseAndValidate(w, r)
	if !ok {
		return
	}
	if _, err := h.Pool.Exec(r.Context(), sqlUpsertPageRoleGrant, pageID, roleID); err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	h.invalidate(r)
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/admin/page-grants/{page_id}/{role_id} — revoke (idempotent).
// Phase 1 will add an avatar-bucket guard here (refuse revoke when the
// page sits in tag_enum='avatar_menu'). For now revoke is unrestricted
// except for the grp_global UUID guard in parseAndValidate.
func (h *GrantsAdminHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	pageID, roleID, ok := h.parseAndValidate(w, r)
	if !ok {
		return
	}
	if _, err := h.Pool.Exec(r.Context(), sqlDeletePageRoleGrant, pageID, roleID); err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	h.invalidate(r)
	w.WriteHeader(http.StatusNoContent)
}

// parseAndValidate extracts page_id + role_id from URL params, refuses
// the grp_global UUID, and confirms the page is a system page. Returns
// ok=false after writing the error.
func (h *GrantsAdminHandler) parseAndValidate(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	pageID, err := uuid.Parse(chi.URLParam(r, "page_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	roleID, err := uuid.Parse(chi.URLParam(r, "role_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	if h.Roles != nil && roleID == h.Roles.SystemRoles.GrpGlobal {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return uuid.Nil, uuid.Nil, false
	}
	var one int
	if err := h.Pool.QueryRow(r.Context(), sqlPageExistsForGrantsAdmin, pageID).Scan(&one); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return uuid.Nil, uuid.Nil, false
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return uuid.Nil, uuid.Nil, false
	}
	return pageID, roleID, true
}

// invalidate forces the cached nav registry to refresh on next read so
// gated UI (rail, catalogue) reflects the new grant within the next
// catalogue request rather than waiting for the TTL to expire.
func (h *GrantsAdminHandler) invalidate(r *http.Request) {
	if h.Registry == nil {
		return
	}
	_, _ = h.Registry.Load(r.Context())
}
