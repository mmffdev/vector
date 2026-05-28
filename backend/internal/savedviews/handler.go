package savedviews

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// Handler is the chi-mountable HTTP surface. All endpoints under
// /_site/saved-views require RequireAuth + RequireFreshPassword from
// the wider mount block in main.go.
type Handler struct {
	svc *Service
	// nodeMembers resolves the actor's node memberships for the
	// ListVisibleToUser query. Caller supplies; main.go wires from
	// the topology service.
	nodeMembers func(ctx interface{ Done() <-chan struct{} }, userID uuid.UUID) ([]uuid.UUID, error)
}

// NewHandler wires a Handler. nodeMembersFn must return the set of
// topology nodes the user is a member of within their active
// subscription.
func NewHandler(svc *Service, nodeMembersFn func(ctx interface{ Done() <-chan struct{} }, userID uuid.UUID) ([]uuid.UUID, error)) *Handler {
	return &Handler{svc: svc, nodeMembers: nodeMembersFn}
}

// Mount attaches the routes under a chi.Router. Caller must apply
// auth.Service.RequireAuth + RequireFreshPassword in the parent block.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{view_id}", h.Get)
	r.Patch("/{view_id}", h.UpdateBody)
	r.Patch("/{view_id}/scope", h.UpdateScope)
	r.Delete("/{view_id}", h.Archive)
}

// ── List GET /?kind=&target= ───────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	kind := r.URL.Query().Get("kind")
	target := r.URL.Query().Get("target")
	if kind == "" || target == "" {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
		return
	}
	nodeIDs, err := h.nodeMembers(r.Context(), u.ID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	views, err := h.svc.ListVisibleToUser(r.Context(), ListVisibleQuery{
		SubscriptionID: u.SubscriptionID,
		ActorUserID:    u.ID,
		ActorWorkspace: u.WorkspaceID,
		ActorNodeIDs:   nodeIDs,
		Kind:           kind,
		Target:         target,
	})
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"views": views})
}

// ── Get GET /{view_id} ─────────────────────────────────────────────

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	v, err := h.svc.GetByID(r.Context(), u.SubscriptionID, viewID)
	if errors.Is(err, ErrNotFound) {
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// ── Create POST / ──────────────────────────────────────────────────

type createReq struct {
	Kind        string          `json:"kind"`
	Scope       string          `json:"scope"`
	UserID      *uuid.UUID      `json:"id_user,omitempty"`
	NodeID      *uuid.UUID      `json:"id_node,omitempty"`
	WorkspaceID *uuid.UUID      `json:"id_workspace,omitempty"`
	Target      string          `json:"target"`
	Name        string          `json:"name"`
	Body        json.RawMessage `json:"body"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	v, err := h.svc.Create(r.Context(), CreateInput{
		SubscriptionID: u.SubscriptionID,
		Kind:           req.Kind,
		Scope:          req.Scope,
		UserID:         req.UserID,
		NodeID:         req.NodeID,
		WorkspaceID:    req.WorkspaceID,
		Target:         req.Target,
		Name:           req.Name,
		Body:           req.Body,
		ActorUserID:    u.ID,
	})
	h.respondWriteResult(w, r, v, err, http.StatusCreated)
}

// ── UpdateBody PATCH /{view_id} ────────────────────────────────────

type updateBodyReq struct {
	Name *string         `json:"name,omitempty"`
	Body json.RawMessage `json:"body,omitempty"`
}

func (h *Handler) UpdateBody(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req updateBodyReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	v, err := h.svc.UpdateBody(r.Context(), u.SubscriptionID, viewID, u.ID, req.Name, req.Body)
	h.respondWriteResult(w, r, v, err, http.StatusOK)
}

// ── UpdateScope PATCH /{view_id}/scope ─────────────────────────────

type updateScopeReq struct {
	Scope       string     `json:"scope"`
	UserID      *uuid.UUID `json:"id_user,omitempty"`
	NodeID      *uuid.UUID `json:"id_node,omitempty"`
	WorkspaceID *uuid.UUID `json:"id_workspace,omitempty"`
}

func (h *Handler) UpdateScope(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req updateScopeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	v, err := h.svc.UpdateScope(r.Context(), UpdateScopeInput{
		SubscriptionID: u.SubscriptionID,
		ViewID:         viewID,
		NewScope:       req.Scope,
		NewUserID:      req.UserID,
		NewNodeID:      req.NodeID,
		NewWorkspaceID: req.WorkspaceID,
		ActorUserID:    u.ID,
	})
	h.respondWriteResult(w, r, v, err, http.StatusOK)
}

// ── Archive DELETE /{view_id} ──────────────────────────────────────

func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return
	}
	viewID, err := uuid.Parse(chi.URLParam(r, "view_id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	err = h.svc.Archive(r.Context(), u.SubscriptionID, viewID, u.ID)
	switch {
	case errors.Is(err, ErrNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrForbidden):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	case err != nil:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// ── helpers ────────────────────────────────────────────────────────

func (h *Handler) respondWriteResult(w http.ResponseWriter, r *http.Request, v *View, err error, okStatus int) {
	switch {
	case errors.Is(err, ErrNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrBodyTooLarge):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrNotNodeMember), errors.Is(err, ErrNotWSAdmin):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	case errors.Is(err, ErrTenantMismatch):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
	case err != nil:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	default:
		writeJSON(w, okStatus, v)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
