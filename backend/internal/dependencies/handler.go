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
	"github.com/mmffdev/vector-backend/internal/sentinel"
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
	ImpactForArtefact(ctx context.Context, artefactID, workspaceID uuid.UUID) (ImpactReport, error)
	ListMaps(ctx context.Context, nodeID uuid.UUID) ([]Map, error)
	GetMapDetail(ctx context.Context, mapID uuid.UUID) (Map, error)
	EdgesForFocusedArtefact(ctx context.Context, mapID, focusedArtefactID uuid.UUID) (BucketProjection, error)
	ListEdgesForMap(ctx context.Context, mapID uuid.UUID) ([]Edge, error)
	SearchCandidates(ctx context.Context, in CandidateSearchInput) ([]Candidate, error)
	TransitiveImpact(ctx context.Context, artefactID uuid.UUID) (TransitiveImpactReport, error)
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
	r.Get("/maps", h.ListMaps)
	r.Post("/maps", h.CreateMap)
	r.Get("/maps/{id}", h.GetMapDetail)
	r.Patch("/maps/{id}", h.RenameMap)
	r.Post("/maps/{id}/archive", h.ArchiveMap)
	r.Get("/edges", h.ListEdgesForFocus)
	r.Get("/maps/{id}/edges", h.ListEdgesForMap)
	r.Post("/edges", h.CreateEdge)
	r.Post("/edges/{id}/archive", h.ArchiveEdge)
	r.Get("/candidates", h.SearchCandidates)
	r.Get("/{id}/transitive-impact", h.TransitiveImpact)
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

// ListMaps handles GET /_site/dependencies/maps?topology_node_id=...
// Sentinel-clamped to caller's workspace; topology_node_id is an
// optional filter. Returns 200 + array (possibly empty); 403 when
// the requested topology_node_id is outside the caller clamp.
func (h *Handler) ListMaps(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	var nodeID uuid.UUID
	if raw := r.URL.Query().Get("topology_node_id"); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
			return
		}
		nodeID = parsed
	}
	out, err := h.svc.ListMaps(r.Context(), nodeID)
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

// GetMapDetail handles GET /_site/dependencies/maps/{id}.
// Returns the map row + live edge count; 404 missing/wrong workspace;
// 403 when topology owner is outside caller clamp.
func (h *Handler) GetMapDetail(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mapID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	out, err := h.svc.GetMapDetail(r.Context(), mapID)
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

// ListEdgesForFocus handles GET /_site/dependencies/edges?focused_artefact_id=...&map_id=...
// Returns the three-bucket projection shaped for direct composer
// consumption: { requires, parallel, unlocks } where each entry is
// { edge_id, artefact_id, kind }. 422 on missing/bad query params,
// 403 on out-of-scope map, 404 on missing map.
func (h *Handler) ListEdgesForFocus(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	rawMap := r.URL.Query().Get("map_id")
	rawFocus := r.URL.Query().Get("focused_artefact_id")
	if rawMap == "" || rawFocus == "" {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestMissingFields)
		return
	}
	mapID, err := uuid.Parse(rawMap)
	if err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	focusedID, err := uuid.Parse(rawFocus)
	if err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	out, err := h.svc.EdgesForFocusedArtefact(r.Context(), mapID, focusedID)
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

// ListEdgesForMap handles GET /_site/dependencies/maps/{id}/edges.
// Returns every live edge in the map (no focused-artefact narrowing)
// so the map-view can render the whole graph in one round-trip per
// map instead of fanning out per artefact. Sentinel clamp +
// workspace gate happen inside the service via GetMap; an
// out-of-scope map id returns 404, never edge data.
func (h *Handler) ListEdgesForMap(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	mapID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	edges, err := h.svc.ListEdgesForMap(r.Context(), mapID)
	if mapped, ok := mapServiceError(err); ok {
		httperr.Write(w, r, mapped.status, mapped.msg)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, edges)
}

// TransitiveImpact handles GET /_site/dependencies/{id}/transitive-impact.
// Returns visible downstream + upstream chains plus a redacted_count
// for nodes the caller can't see. 401 no auth, 422 bad uuid,
// 403 caller has no resolved Sentinel scope.
func (h *Handler) TransitiveImpact(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	artefactID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	out, err := h.svc.TransitiveImpact(r.Context(), artefactID)
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

// SearchCandidates handles GET /_site/dependencies/candidates
// ?focused_artefact_id=...&map_id=...&q=...&limit=...
//
// Returns a list of artefacts the caller can see that are NOT
// already linked to the focused artefact in the named map. Used by
// the composer's candidate dropdown — server-side exclusion is the
// authoritative source, the React state mirror is defence-in-depth.
func (h *Handler) SearchCandidates(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	q := r.URL.Query()
	rawMap := q.Get("map_id")
	rawFocus := q.Get("focused_artefact_id")
	if rawMap == "" || rawFocus == "" {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestMissingFields)
		return
	}
	mapID, err := uuid.Parse(rawMap)
	if err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	focusedID, err := uuid.Parse(rawFocus)
	if err != nil {
		httperr.Write(w, r, http.StatusUnprocessableEntity, usermessages.RequestBadRequest)
		return
	}
	limit := 0
	if raw := q.Get("limit"); raw != "" {
		// Soft parse — bad input falls back to the service default
		// rather than 422, since limit is non-critical.
		if v, err := parsePositiveInt(raw); err == nil {
			limit = v
		}
	}
	out, err := h.svc.SearchCandidates(r.Context(), CandidateSearchInput{
		FocusedArtefactID: focusedID,
		MapID:             mapID,
		Query:             q.Get("q"),
		Limit:             limit,
	})
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

// ImpactForArtefact handles GET /_site/work-items/{id}/dependency-impact.
// Mounted from main.go on the /_site/work-items route group, NOT on
// /_site/dependencies (URL lives under work-items by AC; the logic
// lives here because it queries the edge tables this package owns).
//
// 200 + ImpactReport on success (empty list + zero TotalEdges when
// the artefact participates in no live edges); 401 no auth; 422 on
// bad uuid; 500 only on genuine DB errors. Workspace clamp comes
// from sentinel.FromCtx so cross-workspace map names never surface.
func (h *Handler) ImpactForArtefact(w http.ResponseWriter, r *http.Request) {
	if !requireAuth(w, r) {
		return
	}
	artefactID, ok := parseUUIDParam(w, r, "id")
	if !ok {
		return
	}
	wsID, ok := sentinel.WorkspaceIDFromCtx(r.Context())
	if !ok {
		httperr.Write(w, r, http.StatusInternalServerError, "workspace clamp missing")
		return
	}
	out, err := h.svc.ImpactForArtefact(r.Context(), artefactID, wsID)
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

// parsePositiveInt returns n>0 or an error. Used by query-param
// limit parsing — keeps the handler tight and lets bad input fall
// back to the service default rather than 422.
func parsePositiveInt(s string) (int, error) {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return 0, errors.New("not a positive int")
		}
		n = n*10 + int(ch-'0')
	}
	if n == 0 {
		return 0, errors.New("zero")
	}
	return n, nil
}
