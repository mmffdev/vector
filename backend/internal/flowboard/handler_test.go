package flowboard

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// TestNewHandler_NotNil verifies that NewHandler returns a non-nil Handler
// when wired to a service constructed with a nil pool (smoke test — no DB
// required, mirrors the zero-wiring pattern in topology/service_test.go).
func TestNewHandler_NotNil(t *testing.T) {
	h := NewHandler(NewService(nil))
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
}

// ---------------------------------------------------------------------------
// Fake service — map-backed, no database needed.
// ---------------------------------------------------------------------------

// fakeStore holds (nodeID, flowStateID) → WipLimitDTO.
// Each test builds its own fakeService with explicit setup.
type fakeStore map[[2]uuid.UUID]WipLimitDTO

// fakeService is the test double for serviceIface.
// memberIDs lists every (nodeID, userID) pair considered a member.
// workspaceForNode maps nodeID → owning workspaceID (for cross-scope checks).
type fakeService struct {
	// memberPairs is the set of (nodeID, userID) pairs that count as members.
	memberPairs map[[2]uuid.UUID]bool
	// workspaceForNode maps a nodeID to its owning workspace.
	// If the caller's workspaceID ≠ workspaceForNode[nodeID], it's treated
	// as ErrNotMember (cross-scope: no member rows will match).
	workspaceForNode map[uuid.UUID]uuid.UUID
	// store is the in-memory row table.
	store fakeStore
}

func newFakeService() *fakeService {
	return &fakeService{
		memberPairs:      make(map[[2]uuid.UUID]bool),
		workspaceForNode: make(map[uuid.UUID]uuid.UUID),
		store:            make(fakeStore),
	}
}

func (f *fakeService) addMember(nodeID, userID uuid.UUID) {
	f.memberPairs[[2]uuid.UUID{nodeID, userID}] = true
}

func (f *fakeService) setNodeWorkspace(nodeID, workspaceID uuid.UUID) {
	f.workspaceForNode[nodeID] = workspaceID
}

// isMember returns true only when (nodeID, userID) is registered AND
// the caller's workspaceID matches the node's owning workspace (or no
// workspace is configured for the node, meaning the caller is in-scope
// by construction in the test).
func (f *fakeService) isMember(nodeID, userID, callerWorkspaceID uuid.UUID) bool {
	// Cross-scope gate: if the node belongs to a different workspace,
	// there can be no valid member row for this caller.
	if nodeWS, ok := f.workspaceForNode[nodeID]; ok {
		if nodeWS != callerWorkspaceID {
			return false
		}
	}
	return f.memberPairs[[2]uuid.UUID{nodeID, userID}]
}

// NodeWorkspaceID returns the workspace for the node, or ErrNodeNotFound when
// the node is not registered in workspaceForNode.
func (f *fakeService) NodeWorkspaceID(_ context.Context, nodeID uuid.UUID) (uuid.UUID, error) {
	wsID, ok := f.workspaceForNode[nodeID]
	if !ok {
		return uuid.Nil, ErrNodeNotFound
	}
	return wsID, nil
}

func (f *fakeService) ListWipLimits(_ context.Context, nodeID, workspaceID uuid.UUID) ([]WipLimitDTO, error) {
	out := make([]WipLimitDTO, 0)
	for k, v := range f.store {
		if k[0] == nodeID {
			// Apply workspace scope: only include rows whose node is in the right workspace.
			if nodeWS, ok := f.workspaceForNode[nodeID]; ok && nodeWS != workspaceID {
				continue
			}
			out = append(out, v)
		}
	}
	return out, nil
}

func (f *fakeService) UpsertWipLimit(
	_ context.Context,
	nodeID, flowStateID, callerUserID, workspaceID uuid.UUID,
	limit *int,
) (WipLimitDTO, error) {
	if !f.isMember(nodeID, callerUserID, workspaceID) {
		return WipLimitDTO{}, ErrNotMember
	}
	now := time.Now().UTC()
	dto := WipLimitDTO{
		FlowStateID: flowStateID,
		Limit:       limit,
		UpdatedAt:   now,
		UpdatedBy:   &callerUserID,
	}
	f.store[[2]uuid.UUID{nodeID, flowStateID}] = dto
	return dto, nil
}

// ---------------------------------------------------------------------------
// Helper: build a sentinel-clamped context.
// ---------------------------------------------------------------------------

func clampCtx(workspaceID, userID uuid.UUID) context.Context {
	c := sentinel.Clamp{
		WorkspaceID: workspaceID,
		UserID:      userID,
	}
	return sentinel.TestingWithClamp(context.Background(), c)
}

// ---------------------------------------------------------------------------
// Helper: call PUT /_site/flowboard/wip directly on the handler.
// ---------------------------------------------------------------------------

func doPUT(t *testing.T, h *Handler, ctx context.Context, body upsertWipLimitsRequest) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPut, "/_site/flowboard/wip", bytes.NewReader(b))
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.upsertWipLimits(rec, req)
	return rec
}

// ---------------------------------------------------------------------------
// FB1.2.2 AC tests (four scenarios)
// ---------------------------------------------------------------------------

// TestUpsertWipLimit_MemberAllowed — caller is a registered member of the
// target node, same workspace. PUT must return 200 with the resulting row.
func TestUpsertWipLimit_MemberAllowed(t *testing.T) {
	workspaceID := uuid.New()
	userID := uuid.New()
	nodeID := uuid.New()
	flowStateID := uuid.New()
	limit := 5

	svc := newFakeService()
	svc.addMember(nodeID, userID)
	svc.setNodeWorkspace(nodeID, workspaceID)

	h := newHandlerWithIface(svc)
	ctx := clampCtx(workspaceID, userID)

	rec := doPUT(t, h, ctx, upsertWipLimitsRequest{
		NodeID:      nodeID,
		FlowStateID: flowStateID,
		Limit:       &limit,
	})

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var got WipLimitDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.FlowStateID != flowStateID {
		t.Errorf("flow_state_id: want %s, got %s", flowStateID, got.FlowStateID)
	}
	if got.Limit == nil || *got.Limit != limit {
		t.Errorf("limit: want %d, got %v", limit, got.Limit)
	}
	if got.UpdatedBy == nil || *got.UpdatedBy != userID {
		t.Errorf("updated_by: want %s, got %v", userID, got.UpdatedBy)
	}
}

// TestUpsertWipLimit_NonMember403 — caller's userID has no row in
// topology_nodes_members for the target node. Service returns ErrNotMember;
// handler must return 403.
func TestUpsertWipLimit_NonMember403(t *testing.T) {
	workspaceID := uuid.New()
	nodeID := uuid.New()
	flowStateID := uuid.New()
	nonMemberID := uuid.New() // deliberately NOT added as a member

	svc := newFakeService()
	svc.setNodeWorkspace(nodeID, workspaceID)
	// no svc.addMember call — caller is not a member

	h := newHandlerWithIface(svc)
	ctx := clampCtx(workspaceID, nonMemberID)

	rec := doPUT(t, h, ctx, upsertWipLimitsRequest{
		NodeID:      nodeID,
		FlowStateID: flowStateID,
	})

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// TestUpsertWipLimit_CrossScope403 — caller's sentinel workspace_id does not
// match the owning workspace of the target node. The fake service correctly
// treats this as ErrNotMember (no member rows exist cross-workspace) and
// handler returns 403.
func TestUpsertWipLimit_CrossScope403(t *testing.T) {
	nodeWorkspaceID := uuid.New()  // workspace that owns the node
	callerWorkspaceID := uuid.New() // different workspace — caller is in wrong scope
	userID := uuid.New()
	nodeID := uuid.New()
	flowStateID := uuid.New()

	svc := newFakeService()
	// Register user as a member in the node's own workspace.
	svc.addMember(nodeID, userID)
	svc.setNodeWorkspace(nodeID, nodeWorkspaceID)
	// But the caller's sentinel carries a different workspaceID.

	h := newHandlerWithIface(svc)
	ctx := clampCtx(callerWorkspaceID, userID) // cross-scope clamp

	rec := doPUT(t, h, ctx, upsertWipLimitsRequest{
		NodeID:      nodeID,
		FlowStateID: flowStateID,
	})

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-scope caller, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Helper: call GET /_site/flowboard/wip directly on the handler.
// ---------------------------------------------------------------------------

func doGET(t *testing.T, h *Handler, ctx context.Context, nodeID uuid.UUID) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/_site/flowboard/wip?node_id="+nodeID.String(), nil)
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.listWipLimits(rec, req)
	return rec
}

// ---------------------------------------------------------------------------
// FB1.2.2 AC tests — GET workspace-scope gate (2 scenarios).
// ---------------------------------------------------------------------------

// TestListWipLimits_InScope200 — caller's sentinel workspace matches the node's
// workspace. GET must return 200 and the seeded rows.
func TestListWipLimits_InScope200(t *testing.T) {
	workspaceID := uuid.New()
	userID := uuid.New()
	nodeID := uuid.New()
	flowStateID := uuid.New()
	limit := 4

	svc := newFakeService()
	svc.setNodeWorkspace(nodeID, workspaceID)
	// Seed one WIP-limit row for the node.
	svc.store[[2]uuid.UUID{nodeID, flowStateID}] = WipLimitDTO{
		FlowStateID: flowStateID,
		Limit:       &limit,
	}

	h := newHandlerWithIface(svc)
	ctx := clampCtx(workspaceID, userID)

	rec := doGET(t, h, ctx, nodeID)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var rows []WipLimitDTO
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].FlowStateID != flowStateID {
		t.Errorf("flow_state_id: want %s, got %s", flowStateID, rows[0].FlowStateID)
	}
	if rows[0].Limit == nil || *rows[0].Limit != limit {
		t.Errorf("limit: want %d, got %v", limit, rows[0].Limit)
	}
}

// TestListWipLimits_CrossScope403 — caller's sentinel workspace_id does not
// match the node's owning workspace. GET must return 403.
func TestListWipLimits_CrossScope403(t *testing.T) {
	nodeWorkspaceID := uuid.New()   // workspace that owns the node
	callerWorkspaceID := uuid.New() // different workspace — cross-scope caller
	userID := uuid.New()
	nodeID := uuid.New()

	svc := newFakeService()
	svc.setNodeWorkspace(nodeID, nodeWorkspaceID)

	h := newHandlerWithIface(svc)
	ctx := clampCtx(callerWorkspaceID, userID) // cross-scope clamp

	rec := doGET(t, h, ctx, nodeID)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-scope GET, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// TestUpsertWipLimit_Idempotent — two successive PUTs for the same
// (nodeID, flowStateID) with different limit values. The second PUT
// must overwrite the first (ON CONFLICT DO UPDATE semantics). After
// both calls the store must contain exactly one row and the limit
// must match the second PUT's value.
func TestUpsertWipLimit_Idempotent(t *testing.T) {
	workspaceID := uuid.New()
	userID := uuid.New()
	nodeID := uuid.New()
	flowStateID := uuid.New()

	svc := newFakeService()
	svc.addMember(nodeID, userID)
	svc.setNodeWorkspace(nodeID, workspaceID)

	h := newHandlerWithIface(svc)
	ctx := clampCtx(workspaceID, userID)

	limit1 := 3
	limit2 := 7

	// First PUT — insert.
	rec1 := doPUT(t, h, ctx, upsertWipLimitsRequest{
		NodeID:      nodeID,
		FlowStateID: flowStateID,
		Limit:       &limit1,
	})
	if rec1.Code != http.StatusOK {
		t.Fatalf("first PUT: expected 200, got %d; body: %s", rec1.Code, rec1.Body.String())
	}

	// Second PUT — update with different limit.
	rec2 := doPUT(t, h, ctx, upsertWipLimitsRequest{
		NodeID:      nodeID,
		FlowStateID: flowStateID,
		Limit:       &limit2,
	})
	if rec2.Code != http.StatusOK {
		t.Fatalf("second PUT: expected 200, got %d; body: %s", rec2.Code, rec2.Body.String())
	}

	// Exactly one row must be in the store (idempotent upsert, not insert).
	if got := len(svc.store); got != 1 {
		t.Errorf("store row count: want 1, got %d", got)
	}

	// The stored limit must reflect the second PUT.
	key := [2]uuid.UUID{nodeID, flowStateID}
	stored, ok := svc.store[key]
	if !ok {
		t.Fatal("expected row not found in store")
	}
	if stored.Limit == nil || *stored.Limit != limit2 {
		t.Errorf("stored limit: want %d, got %v", limit2, stored.Limit)
	}

	// The response body of the second PUT must also carry the new limit.
	var got WipLimitDTO
	if err := json.Unmarshal(rec2.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode second response: %v", err)
	}
	if got.Limit == nil || *got.Limit != limit2 {
		t.Errorf("response limit: want %d, got %v", limit2, got.Limit)
	}
}
