// Package flowboard HTTP surface.
//
// # Layer discipline
//
// This file contains ONLY HTTP wiring: request parsing, response writing,
// and delegation to Service. It contains no SQL strings (those live in
// sql.go) and no business logic (that lives in service.go).
//
// All routes mount under /_site/flowboard/ (WIP + prefs) or
// /_site/topology/{id}/members (members — owned by this package per spec
// §8 even though the path prefix differs).
//
// The Mount method registers placeholder handlers returning 501 until
// implementing stories fill in the service methods.
package flowboard

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// Handler is the chi-mountable HTTP surface for the flowboard package.
// It holds a reference to serviceIface and delegates all business logic there.
// The svc field is the narrow interface so tests can inject a stub without
// a real database (same pattern as workspacemasterrecord).
type Handler struct {
	svc serviceIface
}

// NewHandler wires the handler to a concrete *Service. main.go uses this.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// newHandlerWithIface is a test-only constructor that accepts the narrow
// interface, enabling stub injection without a live DB.
func newHandlerWithIface(svc serviceIface) *Handler { return &Handler{svc: svc} }

// Mount registers all flowboard routes onto the provided router.
// The caller (main.go) is responsible for wrapping r in RequireAuth,
// RequireFreshPassword, and rate-limit middlewares BEFORE calling Mount,
// so per-endpoint permission middleware added by later stories can sit
// inside the already-authenticated group.
//
// Route table (spec §8):
//
//	GET  /_site/flowboard/wip           → listWipLimits    (FB1.2.2)
//	PUT  /_site/flowboard/wip           → upsertWipLimits  (FB1.2.2)
//	GET  /_site/flowboard/prefs         → getCardPrefs     (FB1.2.3)
//	PUT  /_site/flowboard/prefs         → upsertCardPrefs  (FB1.2.3)
//	GET  /_site/topology/{id}/members   → listNodeMembers  (FB1.2.4)
//
// The /topology/{id}/members path is registered on the root router
// passed in here because the caller mounts flowboardH.Mount(r) where r
// is the /_site sub-router, giving access to the /topology prefix.
func (h *Handler) Mount(r chi.Router) {
	r.Route("/flowboard", func(r chi.Router) {
		r.Get("/wip", h.listWipLimits)
		r.Put("/wip", h.upsertWipLimits)
		r.Get("/prefs", h.getCardPrefs)
		r.Put("/prefs", h.upsertCardPrefs)
	})
	r.Route("/topology/{id}/members", func(r chi.Router) {
		r.Get("/", h.listNodeMembers)
	})
}

// listWipLimits handles GET /_site/flowboard/wip
//
// Query params:
//   - node_id        (uuid, required) — topology node whose WIP limits to return
//   - artefact_type_id (uuid, optional) — reserved for future per-type limits;
//     parsed + validated here but not yet used in the DB query
//
// Sentinel-clamped: workspace_id is read from the sentinel Clamp. A request
// without a valid Clamp returns 403 (not 401 — the auth middleware already
// ran; a missing clamp means the route is misconfigured or the token is
// structurally invalid).
//
// Workspace-scope gate: the node's owning workspace is fetched via
// NodeWorkspaceID before the main query runs. If the node does not exist OR
// its workspace does not match the sentinel WorkspaceID, the handler returns
// 403. Both cases collapse to the same status code — no existence leak
// (security argument: a cross-scope caller must not be able to infer whether
// a node exists in another workspace by observing 404 vs 403).
func (h *Handler) listWipLimits(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.WorkspaceID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, "workspace clamp required")
		return
	}

	nodeIDStr := r.URL.Query().Get("node_id")
	nodeID, err := uuid.Parse(nodeIDStr)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "node_id must be a valid UUID")
		return
	}

	// artefact_type_id is validated but not yet forwarded to the DB query
	// (reserved for per-type WIP limits in a future story).
	if atStr := r.URL.Query().Get("artefact_type_id"); atStr != "" {
		if _, err := uuid.Parse(atStr); err != nil {
			httperr.Write(w, r, http.StatusBadRequest, "artefact_type_id must be a valid UUID")
			return
		}
	}

	// Workspace-scope gate: fetch the node's owning workspace and compare
	// against the sentinel clamp. Missing node and cross-scope mismatch both
	// return 403 (no existence leak).
	nodeWS, err := h.svc.NodeWorkspaceID(r.Context(), nodeID)
	if errors.Is(err, ErrNodeNotFound) || (err == nil && nodeWS != clamp.WorkspaceID) {
		httperr.Write(w, r, http.StatusForbidden, "forbidden")
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "failed to verify node workspace")
		return
	}

	rows, err := h.svc.ListWipLimits(r.Context(), nodeID, clamp.WorkspaceID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "failed to list WIP limits")
		return
	}

	writeJSON(w, http.StatusOK, rows)
}

// upsertWipLimitsRequest is the JSON body accepted by PUT /_site/flowboard/wip.
// Limit is a pointer so the JSON value null (or omitting the field) maps to
// nil → SQL NULL → unlimited semantics (spec §3.2 / AC).
type upsertWipLimitsRequest struct {
	NodeID      uuid.UUID `json:"node_id"`
	FlowStateID uuid.UUID `json:"flow_state_id"`
	Limit       *int      `json:"limit"`
}

// upsertWipLimits handles PUT /_site/flowboard/wip
//
// Permission gate: caller must have a row in topology_nodes_members for the
// target node. Service returns ErrNotMember when not; handler returns 403.
//
// Sentinel-clamped: workspace_id is read from the sentinel Clamp. Missing
// Clamp → 403.
func (h *Handler) upsertWipLimits(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.WorkspaceID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, "workspace clamp required")
		return
	}

	var req upsertWipLimitsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.NodeID == uuid.Nil {
		httperr.Write(w, r, http.StatusBadRequest, "node_id is required")
		return
	}
	if req.FlowStateID == uuid.Nil {
		httperr.Write(w, r, http.StatusBadRequest, "flow_state_id is required")
		return
	}

	row, err := h.svc.UpsertWipLimit(
		r.Context(),
		req.NodeID,
		req.FlowStateID,
		clamp.UserID,
		clamp.WorkspaceID,
		req.Limit,
	)
	if err != nil {
		if errors.Is(err, ErrNotMember) {
			httperr.Write(w, r, http.StatusForbidden, "caller is not a member of this topology node")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "failed to upsert WIP limit")
		return
	}

	writeJSON(w, http.StatusOK, row)
}

// writeJSON serialises v as JSON with the given status code.
// Content-Type is always application/json.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// getCardPrefs handles GET /_site/flowboard/prefs?artefact_type_id=<uuid>
//
// Returns the calling user's card-field preferences for the given artefact
// type. When no row exists the handler returns 404 so the frontend falls back
// to the sidecar default field list (spec §3.3 / AC).
//
// Sentinel-clamped: callerUserID is always read from the sentinel Clamp —
// never from the query string. A missing Clamp (WorkspaceID == Nil) returns 403.
func (h *Handler) getCardPrefs(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.UserID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, "auth clamp required")
		return
	}

	atStr := r.URL.Query().Get("artefact_type_id")
	artefactTypeID, err := uuid.Parse(atStr)
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "artefact_type_id must be a valid UUID")
		return
	}

	dto, err := h.svc.GetCardPrefs(r.Context(), clamp.UserID, artefactTypeID)
	if err != nil {
		if errors.Is(err, ErrCardPrefsNotFound) {
			httperr.Write(w, r, http.StatusNotFound, "no card prefs found for this artefact type")
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "failed to get card prefs")
		return
	}

	writeJSON(w, http.StatusOK, dto)
}

// upsertCardPrefsRequest is the JSON body accepted by PUT /_site/flowboard/prefs.
// UserID is accepted in the body but IGNORED — the sentinel CallerUserID always
// wins (AC: "caller can only write their own row").
// ArtefactTypeID identifies which artefact type's prefs to write.
// CardFields is the ordered list of field keys to persist.
type upsertCardPrefsRequest struct {
	UserID         *uuid.UUID `json:"user_id"`         // ignored — sentinel wins
	ArtefactTypeID uuid.UUID  `json:"artefact_type_id"`
	CardFields     []string   `json:"card_fields"`
}

// upsertCardPrefs handles PUT /_site/flowboard/prefs
//
// UPSERTs the calling user's card-field preferences for a given artefact type.
// Body user_id is silently ignored — the sentinel CallerUserID is always used
// (AC: "caller can only write their own row").
//
// Invalid field keys in card_fields return 422 with a JSON error body
// identifying the offending key (AC: "junk keys return 422").
//
// Sentinel-clamped: callerUserID + workspaceID are both read from the Clamp.
// A missing Clamp (WorkspaceID == Nil) returns 403.
func (h *Handler) upsertCardPrefs(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.WorkspaceID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, "workspace clamp required")
		return
	}

	var req upsertCardPrefsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.ArtefactTypeID == uuid.Nil {
		httperr.Write(w, r, http.StatusBadRequest, "artefact_type_id is required")
		return
	}

	// callerUserID is always the sentinel user — body user_id is ignored.
	dto, err := h.svc.UpsertCardPrefs(
		r.Context(),
		clamp.UserID,
		req.ArtefactTypeID,
		clamp.WorkspaceID,
		req.CardFields,
	)
	if err != nil {
		if errors.Is(err, ErrInvalidCardField) {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
				"error": err.Error(),
			})
			return
		}
		httperr.Write(w, r, http.StatusInternalServerError, "failed to upsert card prefs")
		return
	}

	writeJSON(w, http.StatusOK, dto)
}

// listNodeMembers handles GET /_site/topology/{id}/members
//
// Returns the membership list for the given topology node. Each entry
// carries {user_id, role, created_at} ordered by created_at ASC.
//
// Sentinel-clamped: workspace_id is read from the sentinel Clamp. A
// request without a valid Clamp (WorkspaceID == Nil) returns 403.
//
// Workspace-scope gate: the node's owning workspace is fetched via
// NodeWorkspaceID. If the node does not exist OR its workspace does not
// match the sentinel WorkspaceID, handler returns 403 (no existence leak).
func (h *Handler) listNodeMembers(w http.ResponseWriter, r *http.Request) {
	clamp := sentinel.FromCtx(r.Context())
	if clamp.WorkspaceID == uuid.Nil {
		httperr.Write(w, r, http.StatusForbidden, "workspace clamp required")
		return
	}

	nodeID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "id must be a valid UUID")
		return
	}

	// Workspace-scope gate: missing node and cross-scope mismatch both return
	// 403 (no existence leak — same pattern as listWipLimits).
	nodeWS, err := h.svc.NodeWorkspaceID(r.Context(), nodeID)
	if errors.Is(err, ErrNodeNotFound) || (err == nil && nodeWS != clamp.WorkspaceID) {
		httperr.Write(w, r, http.StatusForbidden, "forbidden")
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "failed to verify node workspace")
		return
	}

	members, err := h.svc.ListNodeMembers(r.Context(), nodeID)
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, "failed to list node members")
		return
	}

	writeJSON(w, http.StatusOK, members)
}
