package nav

// Admin grid surface for the page-permissions matrix at
// /user-management/permissions. Read + per-cell write of users_roles_pages
// for system pages only. Tenant-scoped entity pages (user-pinned
// portfolios/products) are deliberately excluded — the grid governs the
// product catalogue, not personal bookmarks.
//
// Gating: the route layer mounts these handlers behind
// auth.RequirePermission(roles.assign_permissions) AND
// auth.RequirePageAccess("um-permissions").
//
// PLA-0049 invariants:
//   • {role_id} URL param refuses the grp_global UUID — gadmin
//     universal access cannot be revoked through this surface.
//   • DELETE refuses any avatar-bucket page (locked floor — every
//     role must always keep their avatar pages).
//   • Every grant/revoke produces an audit_logs entry with the
//     actor, page, and role.
//   • Bucket-row toggle endpoint grants or revokes every system
//     page in a bucket atomically.

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/roles"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

const avatarMenuTagEnum = "avatar_menu"

type GrantsAdminHandler struct {
	Pool     *pgxpool.Pool
	Registry *CachedRegistry
	Roles    *roles.Service
	Audit    *audit.Logger
}

func NewGrantsAdminHandler(pool *pgxpool.Pool, reg *CachedRegistry, rolesSvc *roles.Service, auditLog *audit.Logger) *GrantsAdminHandler {
	return &GrantsAdminHandler{Pool: pool, Registry: reg, Roles: rolesSvc, Audit: auditLog}
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

type bucketToggleReq struct {
	Checked bool `json:"checked"`
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
	pageID, roleID, _, ok := h.parseAndValidate(w, r, false)
	if !ok {
		return
	}
	if _, err := h.Pool.Exec(r.Context(), sqlUpsertPageRoleGrant, pageID, roleID); err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	h.audit(r, "page_grants.grant", pageID, roleID, nil)
	h.invalidate(r)
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/admin/page-grants/{page_id}/{role_id} — revoke.
// Refused (409 ResourceLocked) for any avatar-bucket page — that
// floor is invariant for every role.
func (h *GrantsAdminHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	pageID, roleID, tagEnum, ok := h.parseAndValidate(w, r, true)
	if !ok {
		return
	}
	if tagEnum == avatarMenuTagEnum {
		httperr.Write(w, r, http.StatusConflict, usermessages.ResourceLocked)
		return
	}
	if _, err := h.Pool.Exec(r.Context(), sqlDeletePageRoleGrant, pageID, roleID); err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	h.audit(r, "page_grants.revoke", pageID, roleID, nil)
	h.invalidate(r)
	w.WriteHeader(http.StatusNoContent)
}

// PUT /api/admin/page-grants/bucket/{tag_enum}/{role_id} — atomic
// bucket-row toggle. Body: {"checked": true|false}. Grants or revokes
// every system page in the named bucket for the named role in a
// single statement. Avatar bucket is REFUSED on the off-side
// (revoke) but allowed on the on-side (the floor seeds redundantly).
func (h *GrantsAdminHandler) BucketToggle(w http.ResponseWriter, r *http.Request) {
	tagEnum := chi.URLParam(r, "tag_enum")
	roleID, err := uuid.Parse(chi.URLParam(r, "role_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return
	}
	if h.Roles != nil && roleID == h.Roles.SystemRoles.GrpGlobal {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return
	}
	var req bucketToggleReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return
	}

	if !req.Checked && tagEnum == avatarMenuTagEnum {
		httperr.Write(w, r, http.StatusConflict, usermessages.ResourceLocked)
		return
	}

	var query string
	if req.Checked {
		query = sqlBatchGrantSystemPagesByBucket
	} else {
		query = sqlBatchRevokeSystemPagesByBucket
	}
	tag, err := h.Pool.Exec(r.Context(), query, tagEnum, roleID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}

	action := "page_grants.bucket_revoke"
	if req.Checked {
		action = "page_grants.bucket_grant"
	}
	h.audit(r, action, uuid.Nil, roleID, map[string]any{
		"tag_enum":      tagEnum,
		"rows_affected": tag.RowsAffected(),
	})
	h.invalidate(r)
	w.WriteHeader(http.StatusNoContent)
}

// parseAndValidate extracts page_id + role_id from URL params, refuses
// the grp_global UUID, and confirms the page is a system page. When
// needTagEnum=true, also returns the page's tag_enum so the avatar
// guard can run.
func (h *GrantsAdminHandler) parseAndValidate(w http.ResponseWriter, r *http.Request, needTagEnum bool) (uuid.UUID, uuid.UUID, string, bool) {
	pageID, err := uuid.Parse(chi.URLParam(r, "page_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return uuid.Nil, uuid.Nil, "", false
	}
	roleID, err := uuid.Parse(chi.URLParam(r, "role_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return uuid.Nil, uuid.Nil, "", false
	}
	if h.Roles != nil && roleID == h.Roles.SystemRoles.GrpGlobal {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return uuid.Nil, uuid.Nil, "", false
	}
	var one int
	if err := h.Pool.QueryRow(r.Context(), sqlPageExistsForGrantsAdmin, pageID).Scan(&one); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return uuid.Nil, uuid.Nil, "", false
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return uuid.Nil, uuid.Nil, "", false
	}
	tagEnum := ""
	if needTagEnum {
		if err := h.Pool.QueryRow(r.Context(), sqlPageTagEnumByID, pageID).Scan(&tagEnum); err != nil {
			httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
			return uuid.Nil, uuid.Nil, "", false
		}
	}
	return pageID, roleID, tagEnum, true
}

// audit emits an entry to audit_logs identifying the actor and the
// (page, role) pair. Best-effort: the underlying Logger swallows DB
// errors so a transient audit hiccup never blocks the user-visible
// write.
func (h *GrantsAdminHandler) audit(r *http.Request, action string, pageID, roleID uuid.UUID, extra map[string]any) {
	if h.Audit == nil {
		return
	}
	u := auth.UserFromCtx(r.Context())
	var userID, subID *uuid.UUID
	if u != nil {
		uid := u.ID
		userID = &uid
		sid := u.SubscriptionID
		subID = &sid
	}
	resource := "users_roles_pages"
	resourceID := pageID.String() + ":" + roleID.String()
	meta := map[string]any{"role_id": roleID.String()}
	if pageID != uuid.Nil {
		meta["page_id"] = pageID.String()
	}
	for k, v := range extra {
		meta[k] = v
	}
	ip := security.ClientIP(r)
	h.Audit.Log(r.Context(), audit.Entry{
		UserID:         userID,
		SubscriptionID: subID,
		Action:         action,
		Resource:       &resource,
		ResourceID:     &resourceID,
		Metadata:       meta,
		IPAddress:      &ip,
	})
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
