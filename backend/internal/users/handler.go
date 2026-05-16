package users

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/security"
)

type Handler struct {
	Svc          *Service
	PermResolver *permissions.Resolver
}

func NewHandler(s *Service, res *permissions.Resolver) *Handler {
	return &Handler{Svc: s, PermResolver: res}
}

// targetRoleCreateCode maps a requested target Role (legacy user_role
// enum: 'gadmin'/'padmin'/'user') to the specific users.create.<target>
// permission code the actor must hold. The route is gated by
// RequireAnyPermission across all seven grp_* codes; this map turns
// that OR-gate into the AND-gate the creator matrix actually requires
// (PLA-0007 AC #4). Returns "" for unknown roles.
//
// PLA-0049: the legacy wire enum has only three values, so this only
// gates creation of grp_global / grp_portfolio / grp_team_member.
// Creating grp_product / grp_team_lead / grp_stakeholder / grp_external
// requires a follow-up wire-shape change to accept role_id directly
// (deferred to Phase 1.x — until then those roles are admin-grid-only).
func targetRoleCreateCode(role roletypes.Role) permissions.Code {
	switch role {
	case roletypes.RoleGAdmin:
		return permissions.UsersCreateGrpGlobal
	case roletypes.RolePAdmin:
		return permissions.UsersCreateGrpPortfolio
	case roletypes.RoleUser:
		return permissions.UsersCreateGrpTeamMember
	}
	return ""
}

type createReq struct {
	Email string      `json:"email"`
	Role  roletypes.Role `json:"role"`
}

type createResp struct {
	User     *roletypes.User `json:"user"`
	ResetURL string       `json:"reset_url,omitempty"` // only in dev; omit in prod
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return
	}
	if req.Role == "" {
		req.Role = roletypes.RoleUser
	}
	// Creator-matrix discriminator (PLA-0007 AC #4).
	// The route-level gate is RequireAnyPermission across the five
	// users.create.<target> codes, which only proves the actor can
	// create *some* role. Here we assert the actor holds the specific
	// code for the requested target.
	want := targetRoleCreateCode(req.Role)
	if want == "" {
		httperr.Write(w, r, http.StatusBadRequest, "unknown_target_role")
		return
	}
	set, err := h.PermResolver.PermissionsFor(r.Context(), actor.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		return
	}
	if _, ok := set[want]; !ok {
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		return
	}
	// Tenant always comes from the verified session, never the payload.
	// See c_security.md#input-comes-from-the-session-not-the-payload.
	u, link, err := h.Svc.Create(r.Context(), CreateInput{Email: req.Email, Role: req.Role, SubscriptionID: actor.SubscriptionID}, actor.Role, actor.ID, security.ClientIP(r))
	if err != nil {
		if errors.Is(err, ErrDuplicateEmail) {
			httperr.Write(w, r, http.StatusConflict, err.Error())
			return
		}
		if errors.Is(err, ErrRoleCeiling) {
			httperr.Write(w, r, http.StatusForbidden, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, 201, createResp{User: u, ResetURL: link})
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	out, err := h.Svc.List(r.Context(), actor.SubscriptionID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, 200, out)
}

type patchReq struct {
	Role       *roletypes.Role `json:"role,omitempty"`
	IsActive   *bool        `json:"is_active,omitempty"`
	FirstName  *string      `json:"first_name,omitempty"`
	LastName   *string      `json:"last_name,omitempty"`
	Department *string      `json:"department,omitempty"`
}

func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
		return
	}
	if err := h.Svc.Update(r.Context(), id, UpdateInput{
		Role:       req.Role,
		IsActive:   req.IsActive,
		FirstName:  req.FirstName,
		LastName:   req.LastName,
		Department: req.Department,
	}, actor.Role, actor.SubscriptionID, actor.ID, security.ClientIP(r)); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		if errors.Is(err, ErrRoleCeiling) {
			httperr.Write(w, r, http.StatusForbidden, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.Svc.Delete(r.Context(), id, actor.Role, actor.SubscriptionID, actor.ID, security.ClientIP(r)); err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		if errors.Is(err, ErrRoleCeiling) {
			httperr.Write(w, r, http.StatusForbidden, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type resetResp struct {
	Email    string `json:"email"`
	ResetURL string `json:"reset_url,omitempty"`
}

func (h *Handler) IssueReset(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	link, err := h.Svc.IssueResetLink(r.Context(), id, actor.Role, actor.SubscriptionID, actor.ID, security.ClientIP(r))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return
		}
		if errors.Is(err, ErrRoleCeiling) {
			httperr.Write(w, r, http.StatusForbidden, err.Error())
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	// Look up the email from the same row for the response payload.
	var email string
	_ = h.Svc.Pool.QueryRow(r.Context(), sqlSelectUserEmailByID, id).Scan(&email)
	writeJSON(w, http.StatusOK, resetResp{Email: email, ResetURL: link})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
