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
//	DELETE /api/workspaces/{id}           → Delete (cross-DB guard)        PLA-0026 / 00502
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
	"github.com/mmffdev/vector-backend/internal/usermessages"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// Handler is the chi-mountable HTTP surface for workspaces.
type Handler struct {
	Svc *Service
}

// NewHandler wires the handler to a Service. The Service carries its
// own audit + permission resolver; nothing else to inject here.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// Mount registers the non-DELETE routes onto r. Caller is expected to
// wrap r in RequireAuth + RequireFreshPassword + rate-limit middlewares
// before calling Mount, mirroring /api/topology in main.go.
//
// B16.8.10: DELETE /{id} is deliberately NOT registered here — it
// requires the per-action step-up reauth gate (RequireStepUpReauth
// + h.Delete) which must be wired in main.go before Mount runs.
// Chi silently overwrites duplicate registrations, so leaving a plain
// r.Delete here would defeat the gate. See main.go:/workspaces.
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
	includeArchived := r.URL.Query().Get(usermessages.ResourceArchived) == "true"
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	var req patchReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	if req.Name == nil && req.Slug == nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
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
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}
	if err := h.Svc.Restore(r.Context(), u.SubscriptionID, id, u.ID); err != nil {
		writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// DELETE /api/workspaces/{id} — PLA-0026 / story 00502 (B13).
//
// This handler is the workspace-deletion entry point and the host of
// the cross-DB orphan guard required by R047 §12.1. It performs the
// following sequence, in order; a 4xx response on any step
// short-circuits before any mutation:
//
//  1. Parse the workspace id from the URL; 400 on a malformed UUID.
//  2. Permission gate. Workspace deletion is privileged: caller must
//     hold workspace.archive (the destructive-tier permission seeded
//     by migration 100). Non-holders → 403.
//  3. Existence + tenant-scope check. Cross-tenant access returns
//     404 (no existence leak). Use of Get keeps the loadWorkspace
//     SELECT… FOR UPDATE semantics out of the read path here.
//  4. Cross-DB orphan scan against vector_artefacts. If any LIVE row
//     in any VA table references this workspace, refuse with 409
//     Conflict and emit the orphan list in the response body so an
//     operator can see exactly what needs cleanup. The scan is
//     read-only and idempotent. When VAPool is nil the scan is a
//     documented no-op.
//  5. Hard delete is OUT OF SCOPE for this story (R047 §12.1 covers
//     only the guard). The handler returns 501 Not Implemented with
//     a clear detail string instead of mutating mmff_vector.workspaces.
//     A future story (PLA-0026 follow-up) will add the actual delete
//     statement once the cleanup invariants for workspace_roles and
//     org_nodes are agreed.
//
// Auth/permission rationale: there is currently no `workspace.delete`
// permission code in the catalogue (catalogue.go lists only create /
// rename / archive / restore / view_archived). Rather than introduce
// a new code that requires a migration, this handler reuses
// `workspace.archive` — the same destructive-tier gate that the
// Archive endpoint uses. In MVP only the gadmin role grid carries
// that code; padmin/user → 403, matching the "tenant admin OR
// padmin/gadmin" expectation in the story.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidID)
		return
	}

	// 2. Permission gate. Reuse workspace.archive (gadmin tier in MVP).
	if err := h.Svc.requirePermission(r.Context(), u.ID, permissions.WorkspaceArchive); err != nil {
		writeErr(w, r, err)
		return
	}

	// 3. Existence + tenant-scope check. Cross-tenant → 404.
	if _, err := h.Svc.Get(r.Context(), u.SubscriptionID, id); err != nil {
		writeErr(w, r, err)
		return
	}

	// 4. Cross-DB orphan scan. 409 Conflict + orphan list when any
	// live row in vector_artefacts references this workspace.
	orphans, err := h.Svc.CheckCrossDBOrphans(r.Context(), id)
	if err != nil {
		writeErr(w, r, err)
		return
	}
	if len(orphans) > 0 {
		writeOrphans409(w, r, orphans)
		return
	}

	// 5. Hard delete out of scope. Document via 501 so the route is
	// still wired for the guard (steps 1–4) but mutation is deferred
	// to a follow-up story.
	httperr.Write(w, r, http.StatusNotImplemented,
		"workspace hard-delete is not yet implemented; cross-DB orphan guard is wired (PLA-0026/00502) — use POST /archive in the meantime")
}


// ─── helpers ────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeOrphans409 emits the PLA-0026 / story 00502 cross-DB orphan
// 409 body. Shape mirrors RFC 9457 (httperr.Problem) plus an extra
// `orphans` field listing every vector_artefacts table that still
// references the workspace under inspection. Tables with zero rows
// are omitted by CheckCrossDBOrphans before this helper is called.
//
// We can't reuse httperr.Write here because Problem doesn't carry an
// open extension slot; the AC explicitly requires the orphan list in
// the response body so an operator can see what to clean up.
func writeOrphans409(w http.ResponseWriter, r *http.Request, orphans []OrphanReport) {
	body := struct {
		Type     string         `json:"type"`
		Title    string         `json:"title"`
		Status   int            `json:"status"`
		Detail   string         `json:"detail"`
		Instance string         `json:"instance"`
		Orphans  []OrphanReport `json:"orphans"`
	}{
		Type:     "about:blank",
		Title:    http.StatusText(http.StatusConflict),
		Status:   http.StatusConflict,
		Detail:   "workspace has live references in vector_artefacts; clean up before deletion",
		Instance: r.URL.Path,
		Orphans:  orphans,
	}
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(http.StatusConflict)
	_ = json.NewEncoder(w).Encode(body)
}

// writeErr maps the package's sentinel errors to HTTP statuses per the
// contract on errors.go. The mapping mirrors orgdesign/handler.go's
// writeErr so the two surfaces feel identical to a frontend client.
func writeErr(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrGrantNotFound):
		httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
	case errors.Is(err, ErrSlugTaken):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "slug_taken"})
	case errors.Is(err, ErrAlreadyArchived):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already_archived"})
	case errors.Is(err, ErrNotArchived):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "not_archived"})
	case errors.Is(err, ErrCrossDBOrphans):
		// Defensive mapping. The Delete handler emits the rich
		// orphan-list body via writeOrphans409 directly and never
		// surfaces this sentinel; this branch exists so that any
		// future caller that returns ErrCrossDBOrphans from a
		// service method gets a stable 409 instead of a 500.
		writeJSON(w, http.StatusConflict, map[string]string{"error": "cross_db_orphans"})
	case errors.Is(err, ErrCannotArchiveLastLive):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "cannot_archive_last_live"})
	case errors.Is(err, ErrSingleAdminViolation):
		writeJSON(w, http.StatusConflict, map[string]string{"error": "single_admin_violation"})
	case errors.Is(err, ErrInvalidName):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestMissingFields)
	case errors.Is(err, ErrInvalidSlug):
		httperr.Write(w, r, http.StatusBadRequest, "slug must match ^[a-z0-9][a-z0-9-]*$")
	case errors.Is(err, ErrInvalidRole):
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestBadRequest)
	case errors.Is(err, ErrPermissionDenied):
		httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
	default:
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
	}
}
