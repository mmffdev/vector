package dependencies

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

// serviceIface is the narrow interface the handler depends on. The
// concrete *Service satisfies it; tests inject a stub via
// newHandlerWithIface so handler behaviour can be pinned without a
// live DB. Mirrors the flowboard / workspacemasterrecord pattern.
type serviceIface interface {
	CreateMap(ctx context.Context, in CreateMapInput) (Map, error)
	RenameMap(ctx context.Context, mapID uuid.UUID, in RenameMapInput) (Map, error)
	ArchiveMap(ctx context.Context, mapID uuid.UUID) (Map, error)
	GetMap(ctx context.Context, mapID uuid.UUID) (Map, error)
	CreateEdge(ctx context.Context, in CreateEdgeInput) (Edge, error)
	ArchiveEdge(ctx context.Context, edgeID uuid.UUID) (Edge, error)
}

// Handler hangs the dependencies HTTP surface off the chi router.
// Mounted in cmd/server/main.go under /_site/dependencies behind the
// standard auth + sentinel middleware chain.
//
// B23.1.5 adds map CRUD. Subsequent stories add:
//   B23.1.6  — POST   /edges                      (insert, cycle-guarded)
//   B23.1.7  — POST   /edges/{id}/archive         (archive)
//   B23.1.8  — GET    /work-items/{id}/dependency-impact (preflight; mounted elsewhere)
//   B23.2.1  — GET    /maps                       (list)
//              GET    /maps/{id}                  (detail)
//              GET    /edges                      (three-bucket projection)
//   B23.2.2  — GET    /candidates                 (server-side exclusion)
//   B23.3.1  — GET    /{id}/transitive-impact     (reachability)
type Handler struct {
	svc serviceIface
}

// NewHandler wires the handler against the sole-writer service.
func NewHandler(s *Service) *Handler { return &Handler{svc: s} }

// newHandlerWithIface is a test-only constructor that accepts the
// narrow interface, enabling stub injection without a live DB.
func newHandlerWithIface(s serviceIface) *Handler { return &Handler{svc: s} }

// Mount registers the dependencies routes on the chi router. Called
// from main.go inside the /_site/dependencies route group after the
// auth + sentinel middleware chain.
func (h *Handler) Mount(r chi.Router) {
	r.Post("/maps", h.CreateMap)
	r.Patch("/maps/{id}", h.RenameMap)
	r.Post("/maps/{id}/archive", h.ArchiveMap)
	r.Post("/edges", h.CreateEdge)
	r.Post("/edges/{id}/archive", h.ArchiveEdge)
}

// CreateMap handles POST /_site/dependencies/maps.
// 201 on success; 401 no auth; 403 if topology_node_id outside
// caller clamp; 422 bad input; 500 on DB error.
func (h *Handler) CreateMap(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	var in CreateMapInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	out, err := h.svc.CreateMap(r.Context(), in)
	if mapped, ok := mapServiceError(err); ok {
		httperr.Write(w, r, mapped.status, mapped.msg)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// RenameMap handles PATCH /_site/dependencies/maps/{id}.
// 200 on success; 404 if missing/archived/wrong workspace; 403 if
// topology owner outside clamp; 422 bad id or name.
func (h *Handler) RenameMap(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mapID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	var in RenameMapInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	out, err := h.svc.RenameMap(r.Context(), mapID, in)
	if mapped, ok := mapServiceError(err); ok {
		httperr.Write(w, r, mapped.status, mapped.msg)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ArchiveMap handles POST /_site/dependencies/maps/{id}/archive.
// 200 on success (whether the row was archived now or already
// archived — idempotent); 404 if missing or wrong workspace; 403 if
// topology owner outside clamp.
func (h *Handler) ArchiveMap(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mapID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	out, err := h.svc.ArchiveMap(r.Context(), mapID)
	if mapped, ok := mapServiceError(err); ok {
		httperr.Write(w, r, mapped.status, mapped.msg)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// CreateEdge handles POST /_site/dependencies/edges.
// 201 + Edge on success; 401 no auth; 422 on bad JSON / unknown kind
// / self-loop / cycle; 403 if either endpoint is outside the caller
// clamp; 404 if the map id is missing or archived; 409 on duplicate
// per any of the three partial unique indexes.
func (h *Handler) CreateEdge(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	var in CreateEdgeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	out, err := h.svc.CreateEdge(r.Context(), in)
	if mapped, ok := mapServiceError(err); ok {
		httperr.Write(w, r, mapped.status, mapped.msg)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusCreated, out)
}

// ArchiveEdge handles POST /_site/dependencies/edges/{id}/archive.
// 200 + Edge on success (whether just archived now or already
// archived — idempotent); 404 missing or wrong workspace; 403 if
// the edge's parent map's topology owner is outside caller clamp.
func (h *Handler) ArchiveEdge(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	edgeID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	out, err := h.svc.ArchiveEdge(r.Context(), edgeID)
	if mapped, ok := mapServiceError(err); ok {
		httperr.Write(w, r, mapped.status, mapped.msg)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// ── helpers ──────────────────────────────────────────────────────

// requireAuth rejects unauthenticated requests with 401 and returns
// false; returns true on success. Shared by every handler.
func requireAuth(w http.ResponseWriter, r *http.Request) bool {
	if auth.UserFromCtx(r.Context()) == nil {
		httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
		return false
	}
	return true
}

// parseUUIDParam extracts a UUID from a chi URL param, writing 422
// on parse failure. Returns (id, true) on success.
func parseUUIDParam(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	raw := chi.URLParam(r, name)
	id, err := uuid.Parse(raw)
	if err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return uuid.Nil, false
	}
	return id, true
}

// mappedErr pairs an HTTP status with a usermessage code. mapServiceError
// returns one alongside an ok=true when the service error is in the
// known vocabulary; callers use ok=false to fall through to a generic
// 500 (preserving stack traces for ops, never leaking them to the wire).
type mappedErr struct {
	status int
	msg    string
}

func mapServiceError(err error) (mappedErr, bool) {
	switch {
	case err == nil:
		return mappedErr{}, false
	case errors.Is(err, ErrNotFound):
		return mappedErr{http.StatusNotFound, usermessages.NotFound}, true
	case errors.Is(err, ErrEndpointNotInScope):
		return mappedErr{http.StatusForbidden, usermessages.AuthForbidden}, true
	case errors.Is(err, ErrInvalidInput):
		return mappedErr{http.StatusUnprocessableEntity, usermessages.RequestBadRequest}, true
	case errors.Is(err, ErrSelfLoop), errors.Is(err, ErrCycle):
		return mappedErr{http.StatusUnprocessableEntity, usermessages.RequestBadRequest}, true
	case errors.Is(err, ErrDuplicateEdge):
		return mappedErr{http.StatusConflict, usermessages.Conflict}, true
	case errors.Is(err, ErrArchived):
		return mappedErr{http.StatusNotFound, usermessages.NotFound}, true
	default:
		return mappedErr{}, false
	}
}

// writeJSON serialises body as application/json with the given status.
// Errors during encode are silently ignored — the response is partial
// at that point and there's nothing useful the client can do.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
