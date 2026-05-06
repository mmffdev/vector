package workspaces

// HTTP surface for the workspaces sole-writer service (PLA-0006 /
// story 00377). All routes mount under /api/workspaces and live behind
// auth.RequireAuth + auth.RequireFreshPassword in main.go — this
// handler trusts that auth.UserFromCtx returns a non-nil user.
//
// Permission gating is delegated to the service: every mutation method
// calls s.requirePermission(...) using the workspace.* permission
// catalogue (migration 100). The handler maps the resulting sentinels
// to HTTP statuses per the contract documented on errors.go:
//
//	GET    /api/workspaces                → ListBySubscription(false)     AC1
//	GET    /api/workspaces?archived=true  → ListBySubscription(true), filtered to archived rows  00381 AC
//	POST   /api/workspaces                → Create                         AC2
//	PATCH  /api/workspaces/{id}           → Rename                         00380 AC
//	POST   /api/workspaces/{id}/archive   → Archive                        AC3
//	POST   /api/workspaces/{id}/restore   → Restore                        00381 AC
//
// Reads are not audited; writes are (audit rows are emitted by the
// service so they sit inside the same transaction as the mutation).
//
// The "non-gadmin → 403 / gadmin → 200" rule for archive/restore is
// expressed via the workspace.archive / workspace.restore permission
// codes seeded by migration 100 — only the gadmin role grid carries
// those codes in MVP, so the service-level requirePermission call is
// the gate. ErrPermissionDenied → 403.

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// Handler is the chi-mountable HTTP surface for workspaces.
type Handler struct {
	Svc *Service
}

// NewHandler wires the handler to a Service. The Service carries its
// own audit + permission resolver; nothing else to inject here.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// Mount registers all five routes onto r. Caller is expected to wrap
// r in RequireAuth + RequireFreshPassword + rate-limit middlewares
// before calling Mount, mirroring /api/topology in main.go.
func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Patch("/{id}", h.Patch)
	r.Post("/{id}/archive", h.Archive)
	r.Post("/{id}/restore", h.Restore)
}

// ─── request shapes ────────────────────────────────────────────────────

type createReq struct {
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description,omitempty"`
}

type patchReq struct {
	Name *string `json:"name,omitempty"`
	// Slug is reserved for a future Reslug command; included here so the
	// JSON shape matches the AC for 00380 even when only Name is wired.
	Slug *string `json:"slug,omitempty"`
}

// ─── handlers ──────────────────────────────────────────────────────────

// GET /api/workspaces — AC1. Returns the live (non-archived)
// workspaces for the caller's tenant ordered by created_at ASC.
// Reads are not permission-gated at the service layer; the auth
// middleware on the route is the only gate.
//
// GET /api/workspaces?archived=true — story 00381. Returns the
// ARCHIVED-ONLY workspaces for the caller's tenant. The service's
// ListBySubscription(true, …) gates on workspace.view_archived and
// returns BOTH live + archived rows; this handler then filters out
// the live rows so the frontend sees a clean archived-only payload.
// Non-holders of workspace.view_archived → 403 (ErrPermissionDenied).
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	includeArchived := r.URL.Query().Get(messages.ResourceArchived) == "true"
	rows, err := h.Svc.ListBySubscription(r.Context(), u.SubscriptionID, includeArchived, u.ID)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if includeArchived {
		// Strip live rows so callers asking for the archived list
		// only get archived workspaces. Service returns the union;
		// frontend wants the slice.
		filtered := rows[:0]
		for _, x := range rows {
			if x.ArchivedAt != nil {
				filtered = append(filtered, x)
			}
		}
		rows = filtered
	}
	writeJSON(w, http.StatusOK, rows)
}

// POST /api/workspaces — AC2. Body: {name, slug, description?}.
// Returns the new row on success (201). Duplicate slug → 409.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	var req createReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	row, err := h.Svc.Create(r.Context(), CreateInput{
		SubscriptionID: u.SubscriptionID,
		Name:           req.Name,
		Slug:           req.Slug,
		Description:    req.Description,
		ActorID:        u.ID,
	})
	if err != nil {
		writeErr(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, row)
}

// PATCH /api/workspaces/{id} — story 00380. Body: {name?, slug?}.
// MVP supports rename only; slug is reserved for a future Reslug
// command. Sending only slug returns 400.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidBody)
		return
	}
	if req.Name == nil && req.Slug == nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestMissingFields)
		return
	}
	if req.Slug != nil && req.Name == nil {
		// Reslug is not yet a service command — surface a clear 400
		// instead of a silent no-op.
		httperr.Write(w, r, http.StatusBadRequest, "slug is immutable in MVP — supply name to rename")
		return
	}
	if err := h.Svc.Rename(r.Context(), u.SubscriptionID, id, *req.Name, u.ID); err != nil {
		writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/workspaces/{id}/archive — AC3. Gated on
// workspace.archive (gadmin in MVP); non-gadmin → 403.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}
	if err := h.Svc.Archive(r.Context(), u.SubscriptionID, id, u.ID); err != nil {
		writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// POST /api/workspaces/{id}/restore — story 00381. Gated on
// workspace.restore (gadmin in MVP).
func (h *Handler) Restore(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestInvalidID)
		return
	}
	if err := h.Svc.Restore(r.Context(), u.SubscriptionID, id, u.ID); err != nil {
		writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// ─── helpers ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeErr maps the package's sentinel errors to HTTP statuses per the
// contract on errors.go. The mapping mirrors orgdesign/handler.go's
// writeErr so the two surfaces feel identical to a frontend client.
func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrGrantNotFound):
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
	case errors.Is(err, ErrSlugTaken):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "slug_taken"})
	case errors.Is(err, ErrAlreadyArchived):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already_archived"})
	case errors.Is(err, ErrNotArchived):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "not_archived"})
	case errors.Is(err, ErrCannotArchiveLastLive):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot_archive_last_live"})
	case errors.Is(err, ErrSingleAdminViolation):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "single_admin_violation"})
	case errors.Is(err, ErrInvalidName):
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestMissingFields)
	case errors.Is(err, ErrInvalidSlug):
		httperr.Write(w, r, http.StatusBadRequest, "slug must match ^[a-z0-9][a-z0-9-]*$")
	case errors.Is(err, ErrInvalidRole):
		httperr.Write(w, r, http.StatusBadRequest, messages.RequestBadRequest)
	case errors.Is(err, ErrPermissionDenied):
		httperr.Write(w, r, http.StatusForbidden, messages.AuthForbidden)
	default:
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
	}
}
