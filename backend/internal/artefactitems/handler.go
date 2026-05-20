package artefactitems

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/apikeys"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/topology"
)

// jsonErrBody safely marshals an error message into a {"error":"..."} JSON body.
func jsonErrBody(err error) []byte {
	msg, _ := json.Marshal(err.Error())
	return append([]byte(`{"error":`), append(msg, '}')...)
}

// parseUUIDList splits a comma-separated query param into a slice of
// uuid.UUID, rejecting the whole list on the first malformed entry.
// Empty input → nil slice + nil error (caller treats absence + empty
// as "no filter"). PLA-0054 / story 00585.
func parseUUIDList(raw string) ([]uuid.UUID, error) {
	parts := strings.Split(raw, ",")
	out := make([]uuid.UUID, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		id, err := uuid.Parse(p)
		if err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// Handler exposes the v2 work-items domain over HTTP.
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler backed by the given Service.
// svc may wrap a nil pool; List returns an empty page in that case.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// listResponse is the wire shape for GET /api/v2/work-items.
type listResponse struct {
	Items []WorkItem `json:"items"`
	Total int        `json:"total"`
}

// List handles GET /api/v2/work-items.
// Requires auth middleware (wired in story 00469); reads subscription_id
// from the JWT context via auth.UserFromCtx.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	subID := auth.UserFromCtx(r.Context()).SubscriptionID

	q := r.URL.Query()
	f := Filters{Limit: 50}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			f.Limit = n
		}
	}
	if v := q.Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			f.Offset = n
		}
	}
	if v := q.Get("parent_id"); v != "" {
		f.ParentID = &v
	}

	// PLA-0054 / story 00587: reject legacy slug paths so a stale
	// frontend learns about the break at the edge rather than getting
	// silently-unfiltered results. The frontend migrates in story 00590
	// (catalogue + chip rewire); the two stories ship together in the
	// same commit window so there is no transition shim and no debt.
	if q.Get("item_type") != "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"?item_type=<slug> is removed; use ?item_type_id=<uuid>[,<uuid>] (PLA-0054)"}`))
		return
	}
	if q.Get("status") != "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"?status=<slug> is removed; use ?flow_state_id=<uuid>[,<uuid>] (PLA-0054)"}`))
		return
	}

	// PLA-0054 / story 00585: multi-value UUID parsers.
	if v := q.Get("item_type_id"); v != "" {
		ids, perr := parseUUIDList(v)
		if perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid item_type_id"}`))
			return
		}
		f.ItemType = ids
	}
	if v := q.Get("flow_state_id"); v != "" {
		ids, perr := parseUUIDList(v)
		if perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid flow_state_id"}`))
			return
		}
		f.Status = ids
	}
	// PLA-0055 / story 00597 — reject legacy ?priority=<slug>; require
	// the new ?priority_id=<uuid>[,<uuid>] param. Frontend chip ships
	// in lockstep so the slug path is dead on day one.
	if q.Get("priority") != "" {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"?priority=<slug> is removed; use ?priority_id=<uuid>[,<uuid>] (PLA-0055)"}`))
		return
	}
	if v := q.Get("priority_id"); v != "" {
		ids, perr := parseUUIDList(v)
		if perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid priority_id"}`))
			return
		}
		f.Priority = ids
	}
	if v := q.Get("sprint_id"); v != "" {
		f.SprintID = &v
	}
	if v := q.Get("owner_id"); v != "" {
		ids, perr := parseUUIDList(v)
		if perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid owner_id"}`))
			return
		}
		f.OwnerID = ids
	}
	if v := q.Get("sort"); v != "" {
		f.Sort = v
	}
	if v := q.Get("dir"); v != "" {
		f.Dir = v
	}
	// ?scope_dir=ascend|descend controls the topology traversal direction.
	// "descend" (default): rootNode + all descendants.
	// "ascend": rootNode + strict ancestor chain only (no siblings).
	if v := q.Get("scope_dir"); v == "ascend" || v == "descend" {
		f.ScopeDirection = v
	}
	// PLA-0043 — ?meg=<uuid> clamps reads to the artefacts owned by
	// this topology node and every live descendant. Invalid UUID is 400
	// before reaching the service; permission/existence is checked
	// inside the service and surfaced as 403/404.
	// ?scope= is the legacy name (cutover via TD-URL-SCOPE-PARAM-CUTOVER);
	// ?meg= takes precedence when both are present.
	megVal := q.Get("meg")
	if megVal == "" {
		megVal = q.Get("scope")
	}
	if megVal != "" {
		if _, perr := uuid.Parse(megVal); perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid scope"}`))
			return
		}
		f.ScopeNodeID = &megVal
		actor := auth.UserFromCtx(r.Context())
		userIDStr := actor.ID.String()
		f.ActorUserID = &userIDStr
		f.ActorRoleID = actor.RoleID
	}

	// PLA-0053 / story 00579: workspace clamp from JWT-anchored
	// context (seeded by WorkspaceClampMiddleware per story 00578).
	// When absent, service falls back to subscription-only — admin
	// tools / migrations that bypass the middleware keep working.
	if wsID, ok := topology.WorkspaceIDFromCtx(r.Context()); ok {
		wsStr := wsID.String()
		f.WorkspaceID = &wsStr
	}

	items, total, err := h.svc.ListWorkItems(r.Context(), subID, f)
	if err != nil {
		if errors.Is(err, ErrScopeForbidden) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"scope_read_denied"}`))
			return
		}
		if errors.Is(err, ErrScopeNodeNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"scope node not found"}`))
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		log.Printf("artefactitems.List: subID=%s err=%v", subID, err)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(listResponse{Items: items, Total: total})
}

// Get handles GET /api/v2/work-items/{id}.
//
// PLA-0053 / story 00579: when a workspace clamp is on context (set by
// WorkspaceClampMiddleware), reads narrow to that workspace and a
// cross-workspace ID returns 404 (existence not leaked). When absent
// (admin tools), the legacy subscription-only path runs.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	idStr := chi.URLParam(r, "id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	var wi *WorkItem
	if wsID, ok := topology.WorkspaceIDFromCtx(r.Context()); ok {
		wi, err = h.svc.GetWorkItemInWorkspace(r.Context(), subID, wsID, id)
	} else {
		wi, err = h.svc.GetWorkItem(r.Context(), subID, id)
	}
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(wi)
}

// ListChildren handles GET /api/v2/work-items/{id}/children.
func (h *Handler) ListChildren(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	items, err := h.svc.ListChildren(r.Context(), subID, id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"items": items})
}

// ListAncestors handles GET /_site/work-items/{id}/ancestors. Returns
// the slim parent chain (immediate-parent-first) used by the
// ArtefactNodeDiagram to render the hierarchy above the selected row.
// One round-trip regardless of depth via a recursive CTE on the SQL
// side. Subscription clamp enforced inside the query, no separate
// scope check needed for read-by-ancestry.
func (h *Handler) ListAncestors(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	ancestors, err := h.svc.ListAncestors(r.Context(), subID, id)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ancestors": ancestors})
}

// Summary handles GET /api/v2/work-items/summary.
//
// PLA-0043 / 2026-05-18 — when `?scope=<uuid>` is on the request, the
// summary clamps to that topology node's subtree (same descendant set
// List uses). Without this, Summary would always show subscription-
// wide counts and disagree with the List below it. Permission check
// mirrors List: the actor must hold a read-grant on the node, else
// 403 scope_read_denied.
func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	actor := auth.UserFromCtx(r.Context())
	subID := actor.SubscriptionID
	q := r.URL.Query()
	var sprintID *string
	if v := q.Get("sprint_id"); v != "" {
		sprintID = &v
	}
	var scopeNodeID, actorUserID *string
	var actorRoleID uuid.UUID
	// ?meg= is the canonical name; ?scope= is the legacy fallback
	// (TD-URL-SCOPE-PARAM-CUTOVER).
	megVal := q.Get("meg")
	if megVal == "" {
		megVal = q.Get("scope")
	}
	if megVal != "" {
		if _, perr := uuid.Parse(megVal); perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid scope"}`))
			return
		}
		scopeNodeID = &megVal
		userIDStr := actor.ID.String()
		actorUserID = &userIDStr
		actorRoleID = actor.RoleID
	}
	var scopeDir string
	if v := q.Get("scope_dir"); v == "ascend" || v == "descend" {
		scopeDir = v
	}
	out, err := h.svc.SummariseWorkItems(r.Context(), subID, sprintID, scopeNodeID, actorUserID, actorRoleID, scopeDir)
	if err != nil {
		if errors.Is(err, ErrScopeForbidden) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"scope_read_denied"}`))
			return
		}
		if errors.Is(err, ErrScopeNodeNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"scope node not found"}`))
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		log.Printf("artefactitems.Summary: subID=%s err=%v", subID, err)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// log.Printf above mirrors the List handler's existing pattern at the
// 500 fall-through — same signal level, same content.

// RisksSummary handles GET /_site/risks/summary (PLA-0052 Story 10).
// Severity × likelihood aggregator for the /risk page header.
func (h *Handler) RisksSummary(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID
	out, err := h.svc.SummariseRisks(r.Context(), subID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// ListFlowStates handles GET /_site/work-items/flow-states[?artefact_type_id=<uuid>[,<uuid>...]].
//
// Three call patterns:
//   - No param → legacy "first work-scoped type" fallback. Used by
//     useWorkItemFlowStates (a single subscription-wide list).
//   - One uuid → returns just that type's states. Used by the inline
//     edit form's Flow state dropdown.
//   - Comma-separated list → returns the union, ordered (type, position).
//     Used by the ObjectTree to prime a per-type cache for the Status
//     pill row of every visible row.
//
// Response envelope carries:
//   - `flow_states` (canonical flat list — matches the siteAPI declaration)
//   - `states` (legacy alias for the useWorkItemFlowStates hook)
//   - `by_type` (map of artefact_type_id → states[]) populated only when
//     the by-type branch ran. Frontend bulk caller reads this.
func (h *Handler) ListFlowStates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	subID := auth.UserFromCtx(r.Context()).SubscriptionID

	var typeIDs []uuid.UUID
	if raw := r.URL.Query().Get("artefact_type_id"); raw != "" {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			parsed, err := uuid.Parse(part)
			if err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid artefact_type_id"}`))
				return
			}
			typeIDs = append(typeIDs, parsed)
		}
	}

	states, err := h.svc.ListFlowStates(r.Context(), subID, typeIDs)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}

	resp := map[string]any{
		"flow_states": states,
		"states":      states, // legacy alias
	}
	if len(typeIDs) > 0 {
		byType := make(map[string][]WorkItemFlowState, len(typeIDs))
		for _, st := range states {
			byType[st.ArtefactTypeID] = append(byType[st.ArtefactTypeID], st)
		}
		// Ensure every requested id appears in the map even if it has
		// no flow (frontend cache lookup is keyed by id; missing keys
		// would re-trigger fetches forever).
		for _, id := range typeIDs {
			key := id.String()
			if _, ok := byType[key]; !ok {
				byType[key] = []WorkItemFlowState{}
			}
		}
		resp["by_type"] = byType
	}
	_ = json.NewEncoder(w).Encode(resp)
}

type createWorkItemReq struct {
	ItemType    string  `json:"item_type"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Status      string  `json:"status,omitempty"`
	// PLA-0055 / story 00595+00597 — priority is now a UUID FK; the
	// legacy slug field is rejected at the handler edge.
	PriorityID  *string `json:"priority_id,omitempty"`
	StoryPoints *int    `json:"story_points,omitempty"`
	SprintID    *string `json:"sprint_id,omitempty"`
	ParentID    *string `json:"parent_id,omitempty"`
}

// Create handles POST /api/v2/work-items.
//
// PLA-0043 writer path — ?meg=<uuid> (or its legacy alias ?scope=)
// pins the new artefact to a topology node. Without it the row inserts
// with NULL topology_node_id and becomes invisible to any per-node
// clamp (a zombie). Validation runs in the service: the node must
// exist in the actor's tenant AND the actor must hold a grant on it.
//
// X-Act-As: <user-uuid> lets an api-key caller override the owner/
// created-by attribution. Honored only when the request authenticated
// via an api-key (the synthetic User otherwise resolves to whoever the
// key seeds to). Plain JWT callers cannot impersonate.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	var req createWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}

	// ?meg=<uuid> — canonical name; ?scope= is the legacy fallback.
	// Same precedence + parse contract as List() at L167-182.
	q := r.URL.Query()
	megVal := q.Get("meg")
	if megVal == "" {
		megVal = q.Get("scope")
	}
	var topologyNodeID *string
	if megVal != "" {
		if _, perr := uuid.Parse(megVal); perr != nil {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":"invalid meg"}`))
			return
		}
		topologyNodeID = &megVal
	}

	// X-Act-As — owner/created-by override for api-key callers.
	// Only honored when the request reached us via an api-key (the
	// CtxKeySubscriptionID context value is set by apikeys.Middleware).
	// Plain JWT cannot impersonate — the header is silently ignored.
	ownerID := u.ID.String()
	createdBy := u.ID.String()
	if actAs := r.Header.Get("X-Act-As"); actAs != "" {
		if r.Context().Value(apikeys.CtxKeySubscriptionID) != nil {
			if _, perr := uuid.Parse(actAs); perr != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid X-Act-As"}`))
				return
			}
			ownerID = actAs
			createdBy = actAs
		}
	}

	wi, err := h.svc.CreateWorkItem(r.Context(), u.SubscriptionID, CreateWorkItemInput{
		ItemType:       req.ItemType,
		Title:          req.Title,
		Description:    req.Description,
		Status:         req.Status,
		PriorityID:     req.PriorityID,
		StoryPoints:    req.StoryPoints,
		SprintID:       req.SprintID,
		ParentID:       req.ParentID,
		OwnerID:        ownerID,
		CreatedBy:      createdBy,
		TopologyNodeID: topologyNodeID,
		ActorRoleID:    u.RoleID,
	})
	if err != nil {
		if errors.Is(err, ErrScopeForbidden) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":"scope_write_denied"}`))
			return
		}
		if errors.Is(err, ErrScopeNodeNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"scope node not found"}`))
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(wi)
}

type patchWorkItemReq struct {
	Title       *string         `json:"title,omitempty"`
	Description *string         `json:"description,omitempty"`
	Status      *string         `json:"status,omitempty"`
	FlowStateID *string         `json:"flow_state_id,omitempty"`
	// PLA-0055 / story 00595+00597 — priority is now a UUID FK.
	PriorityID  *string         `json:"priority_id,omitempty"`
	StoryPoints *int            `json:"story_points,omitempty"`
	SprintID    *string         `json:"sprint_id,omitempty"`
	DueDate     json.RawMessage `json:"due_date,omitempty"`
	// ArtefactInlineForm first-class columns. Each follows the
	// three-state convention: absent ⇒ no change; explicit "" ⇒ clear
	// to NULL (omitted for IsBlocked which is a strict bool). The
	// handler decodes them like SprintID/DueDate, then the service
	// translates "" → NULL and non-empty → UPDATE.
	Colour           *string         `json:"colour,omitempty"`
	IsBlocked        *bool           `json:"is_blocked,omitempty"`
	BlockedReason    *string         `json:"blocked_reason,omitempty"`
	ReleaseID        *string         `json:"release_id,omitempty"`
	MilestoneID      *string         `json:"milestone_id,omitempty"`
	OwnedByUserID    *string         `json:"owned_by_user_id,omitempty"`
	ParentArtefactID *string         `json:"parent_artefact_id,omitempty"`
	TopologyNodeID   *string         `json:"topology_node_id,omitempty"`
	// DescriptionDoc — TipTap (ProseMirror) JSON. RawMessage so we
	// don't decode it; pass-through to the service which writes it
	// verbatim into the JSONB column. nil = field absent; "null" or
	// "{}" = clear to NULL; any other JSON = store as-is.
	DescriptionDoc   json.RawMessage `json:"description_doc,omitempty"`
}

// ptrRawMessage returns a pointer to the raw JSON when the caller sent
// the field at all (len > 0), nil otherwise. Lets the service-layer
// three-state convention (nil = skip, present = write) work cleanly
// against the omitempty JSON tag above.
func ptrRawMessage(r json.RawMessage) *json.RawMessage {
	if len(r) == 0 {
		return nil
	}
	return &r
}

// Patch handles PATCH /api/v2/work-items/{id}.
func (h *Handler) Patch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	var req patchWorkItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	var dueDate *string
	if len(req.DueDate) > 0 {
		raw := string(req.DueDate)
		if raw == "null" || raw == `""` {
			empty := ""
			dueDate = &empty
		} else {
			var s string
			if err := json.Unmarshal(req.DueDate, &s); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":"invalid body"}`))
				return
			}
			dueDate = &s
		}
	}
	wi, err := h.svc.PatchWorkItem(r.Context(), u.SubscriptionID, id, PatchWorkItemInput{
		Title:            req.Title,
		Description:      req.Description,
		Status:           req.Status,
		FlowStateID:      req.FlowStateID,
		PriorityID:       req.PriorityID,
		StoryPoints:      req.StoryPoints,
		SprintID:         req.SprintID,
		DueDate:          dueDate,
		Colour:           req.Colour,
		IsBlocked:        req.IsBlocked,
		BlockedReason:    req.BlockedReason,
		ReleaseID:        req.ReleaseID,
		MilestoneID:      req.MilestoneID,
		OwnedByUserID:    req.OwnedByUserID,
		ParentArtefactID: req.ParentArtefactID,
		TopologyNodeID:   req.TopologyNodeID,
		DescriptionDoc:   ptrRawMessage(req.DescriptionDoc),
	})
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
		case errors.Is(err, ErrParentFlowStateDerived):
			// 409 — the row has live children, so its flow state is
			// derived from them (work flows up). Frontend pill row is
			// also locked for parented rows; this is defence-in-depth.
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"parent_flow_state_derived","detail":"This artefact has children — its state is derived from them and cannot be set manually."}`))
		case errors.Is(err, ErrInvalidInput):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
		default:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"error":"internal"}`))
		}
		return
	}
	_ = json.NewEncoder(w).Encode(wi)
}

// Archive handles DELETE /api/v2/work-items/{id}.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	if err := h.svc.ArchiveWorkItem(r.Context(), u.SubscriptionID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkOpsReq struct {
	IDs     []string       `json:"ids"`
	Op      string         `json:"op"`
	Payload map[string]any `json:"payload"`
}

// Bulk handles POST /api/v2/work-items/bulk.
func (h *Handler) Bulk(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	var req bulkOpsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	out, err := h.svc.BulkOps(r.Context(), u.SubscriptionID, req.IDs, req.Op, req.Payload)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(out)
}

// ListFieldValues handles GET /api/v2/work-items/{id}/field-values.
func (h *Handler) ListFieldValues(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	fvs, err := h.svc.ListFieldValues(r.Context(), u.SubscriptionID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"field_values": fvs})
}

type upsertFieldValueReq struct {
	FieldLibraryID string  `json:"field_library_id"`
	StringValue    *string `json:"string_value,omitempty"`
	NumberValue    *string `json:"number_value,omitempty"`
	TextValue      *string `json:"text_value,omitempty"`
	DateValue      *string `json:"date_value,omitempty"`
}

// UpsertFieldValues handles PUT /api/v2/work-items/{id}/field-values.
func (h *Handler) UpsertFieldValues(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	var req upsertFieldValueReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid body"}`))
		return
	}
	if err := h.svc.UpsertFieldValue(r.Context(), u.SubscriptionID, id, UpsertFieldValueInput{
		FieldLibraryID: req.FieldLibraryID,
		StringValue:    req.StringValue,
		NumberValue:    req.NumberValue,
		TextValue:      req.TextValue,
		DateValue:      req.DateValue,
	}); err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalidInput) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write(jsonErrBody(err))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteFieldValue handles DELETE /api/v2/work-items/{id}/field-values/{field_library_id}.
func (h *Handler) DeleteFieldValue(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid id"}`))
		return
	}
	fvID, err := uuid.Parse(chi.URLParam(r, "field_library_id"))
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid field_library_id"}`))
		return
	}
	if err := h.svc.DeleteFieldValue(r.Context(), u.SubscriptionID, id, fvID); err != nil {
		if errors.Is(err, ErrFieldNotFound) || errors.Is(err, ErrNotFound) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
