package workspacemasterrecord

// HTTP surface for the master_record_workspaces sole-writer service
// (table renamed from master_record_tenants by migration 067 on 2026-05-15).
// Mounts under /_site/workspace-settings; both routes require auth +
// fresh-password (handled by main.go middlewares).
//
// **Workspace scope is backend-only.** The user never picks a workspace,
// never sees one in a URL. The handler resolves the active workspace ID
// from the caller's subscription via ActiveWorkspaceResolver, then asks
// the service for that row. See:
//   .claude/memory/project_workspace_scope_invisible.md
// and TD-WS-001 in docs/c_tech_debt.md (closed by this rewire).

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// ErrNoActiveWorkspace is the resolver's "this subscription has no
// workspace I'm allowed to act on" signal. Handlers turn it into 404
// without leaking auth state. Hard errors (DB down, etc.) bubble up
// distinct from this sentinel.
var ErrNoActiveWorkspace = errors.New("no active workspace for subscription")

// ActiveWorkspaceResolver maps a subscription_id to the workspace_id
// the caller is permitted to act on right now. Production reads
// fdw_workspaces (FDW shadow over mmff_vector.master_record_workspaces).
// Tests inject a stub.
//
// For single-workspace-per-subscription (current shape), the resolver
// returns the one workspace. When multi-workspace lands, the resolver
// extends to consult topology assignment + user prefs — without ever
// involving the URL or the client.
type ActiveWorkspaceResolver interface {
	ActiveWorkspaceFor(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error)
}

// workspaceSettingsService is the narrow contract the handler needs.
// Concrete Service satisfies it; tests can swap in a recording stub.
type workspaceSettingsService interface {
	Get(ctx context.Context, workspaceID uuid.UUID) (*Settings, error)
	Patch(ctx context.Context, workspaceID, actorID uuid.UUID, in PatchInput) (*Settings, error)
}

type Handler struct {
	Svc      workspaceSettingsService
	Resolver ActiveWorkspaceResolver
}

// NewHandler builds a handler with the concrete *Service. main.go wires
// the resolver via NewHandlerWithResolver once both deps exist.
func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// WithResolver attaches the active-workspace resolver. Required for the
// handler to serve traffic — a nil resolver returns 500 on every request
// (defensive; main.go wires this on startup).
func (h *Handler) WithResolver(r ActiveWorkspaceResolver) *Handler {
	h.Resolver = r
	return h
}

// newHandlerWithDeps is a test-only constructor that takes both deps
// as interfaces. Production code uses NewHandler + WithResolver.
func newHandlerWithDeps(svc workspaceSettingsService, r ActiveWorkspaceResolver) *Handler {
	return &Handler{Svc: svc, Resolver: r}
}

func (h *Handler) Mount(r chi.Router) {
	r.Get("/", h.Get)
	r.Patch("/", h.Patch)
}

// resolveActiveWorkspace pulls the user from context, resolves their
// active workspace_id via the resolver, and returns (id, ok) where !ok
// means a response has already been written. Centralises the
// auth-then-resolver flow used by Get and Patch.
func (h *Handler) resolveActiveWorkspace(w http.ResponseWriter, r *http.Request) (workspaceID uuid.UUID, subscriptionID uuid.UUID, actorID uuid.UUID, ok bool) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	if h.Resolver == nil {
		// Defensive: main.go must wire the resolver. A nil here means
		// boot wiring is wrong — bail loudly rather than fall back to
		// the old subscription-as-workspace bug.
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	wsID, err := h.Resolver.ActiveWorkspaceFor(r.Context(), u.SubscriptionID)
	if err != nil {
		if errors.Is(err, ErrNoActiveWorkspace) {
			httperr.Write(w, r, http.StatusNotFound, usermessages.NotFound)
			return uuid.Nil, uuid.Nil, uuid.Nil, false
		}
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return wsID, u.SubscriptionID, u.ID, true
}

// GET /_site/workspace-settings — returns the row for the caller's
// active workspace (resolved server-side; never URL-driven).
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	wsID, _, _, ok := h.resolveActiveWorkspace(w, r)
	if !ok {
		return
	}
	row, err := h.Svc.Get(r.Context(), wsID)
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

// PATCH /_site/workspace-settings — partial update for the caller's
// active workspace. 422 with violations[] on validation failure.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	wsID, _, actorID, ok := h.resolveActiveWorkspace(w, r)
	if !ok {
		return
	}
	var in PatchInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, usermessages.RequestInvalidBody)
		return
	}
	row, err := h.Svc.Patch(r.Context(), wsID, actorID, in)
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
