package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// ── fakes ──────────────────────────────────────────────────────────

type fakeStore struct {
	views          map[uuid.UUID]*View
	nodeMembers    map[[2]uuid.UUID]bool // (userID, nodeID) → true
	userInSub      map[[2]uuid.UUID]bool
	nodeInSub      map[[2]uuid.UUID]bool
	workspaceInSub map[[2]uuid.UUID]bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		views:          map[uuid.UUID]*View{},
		nodeMembers:    map[[2]uuid.UUID]bool{},
		userInSub:      map[[2]uuid.UUID]bool{},
		nodeInSub:      map[[2]uuid.UUID]bool{},
		workspaceInSub: map[[2]uuid.UUID]bool{},
	}
}

func (f *fakeStore) GetByID(_ context.Context, subID, viewID uuid.UUID) (*View, error) {
	v, ok := f.views[viewID]
	if !ok || v.SubscriptionID != subID || v.ArchivedAt != nil {
		return nil, ErrNotFound
	}
	c := *v
	return &c, nil
}
func (f *fakeStore) ListVisibleToUser(_ context.Context, _ ListVisibleQuery) ([]View, error) {
	return nil, nil
}
func (f *fakeStore) Insert(_ context.Context, in CreateInput) (*View, error) {
	id := uuid.New()
	v := &View{
		ID: id, SubscriptionID: in.SubscriptionID, Kind: in.Kind, Scope: in.Scope,
		UserID: in.UserID, NodeID: in.NodeID, WorkspaceID: in.WorkspaceID,
		Target: in.Target, Name: in.Name, Body: in.Body, CreatedBy: in.ActorUserID,
	}
	f.views[id] = v
	c := *v
	return &c, nil
}
func (f *fakeStore) UpdateBody(_ context.Context, subID, viewID uuid.UUID, name *string, body json.RawMessage) (*View, error) {
	v, ok := f.views[viewID]
	if !ok || v.SubscriptionID != subID {
		return nil, ErrNotFound
	}
	if name != nil {
		v.Name = *name
	}
	if body != nil {
		v.Body = body
	}
	c := *v
	return &c, nil
}
func (f *fakeStore) UpdateScope(_ context.Context, in UpdateScopeInput) (*View, error) {
	v, ok := f.views[in.ViewID]
	if !ok || v.SubscriptionID != in.SubscriptionID {
		return nil, ErrNotFound
	}
	v.Scope = in.NewScope
	v.UserID = in.NewUserID
	v.NodeID = in.NewNodeID
	v.WorkspaceID = in.NewWorkspaceID
	c := *v
	return &c, nil
}
func (f *fakeStore) Archive(_ context.Context, subID, viewID uuid.UUID) error {
	v, ok := f.views[viewID]
	if !ok || v.SubscriptionID != subID {
		return ErrNotFound
	}
	t := v.CreatedAt
	v.ArchivedAt = &t
	return nil
}
func (f *fakeStore) VerifyUserInSubscription(_ context.Context, u, s uuid.UUID) (bool, error) {
	return f.userInSub[[2]uuid.UUID{u, s}], nil
}
func (f *fakeStore) VerifyNodeInSubscription(_ context.Context, n, s uuid.UUID) (bool, error) {
	return f.nodeInSub[[2]uuid.UUID{n, s}], nil
}
func (f *fakeStore) VerifyWorkspaceInSubscription(_ context.Context, w, s uuid.UUID) (bool, error) {
	return f.workspaceInSub[[2]uuid.UUID{w, s}], nil
}
func (f *fakeStore) VerifyNodeMembership(_ context.Context, u, n uuid.UUID) (bool, error) {
	return f.nodeMembers[[2]uuid.UUID{u, n}], nil
}

type fakeWSAdmin struct {
	adminOf map[[2]uuid.UUID]bool // (userID, wsID) → true
}

func (f *fakeWSAdmin) HasWorkspaceAdmin(_ context.Context, u, w uuid.UUID) (bool, error) {
	return f.adminOf[[2]uuid.UUID{u, w}], nil
}

func newSvc(store *fakeStore, ws *fakeWSAdmin) *Service {
	return NewService(store, ws, nil)
}

// ── tests ──────────────────────────────────────────────────────────

func TestCreate_UserScope_OwnerAllowed(t *testing.T) {
	store := newFakeStore()
	subID, userID := uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userID, subID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestCreate_UserScope_DifferentUserRejected(t *testing.T) {
	store := newFakeStore()
	subID, userA, userB := uuid.New(), uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userB, subID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userB // actor is A but tries to create scope=user with userB
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userA,
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestCreate_NodeScope_NonMemberRejected(t *testing.T) {
	store := newFakeStore()
	subID, userID, nodeID := uuid.New(), uuid.New(), uuid.New()
	store.nodeInSub[[2]uuid.UUID{nodeID, subID}] = true
	// NOT setting nodeMembers — user is not a member
	svc := newSvc(store, &fakeWSAdmin{})
	nid := nodeID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeNode,
		NodeID: &nid, Target: "objecttree:work_items", Name: "Team",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if !errors.Is(err, ErrNotNodeMember) {
		t.Fatalf("expected ErrNotNodeMember, got %v", err)
	}
}

func TestCreate_NodeScope_MemberAllowed(t *testing.T) {
	store := newFakeStore()
	subID, userID, nodeID := uuid.New(), uuid.New(), uuid.New()
	store.nodeInSub[[2]uuid.UUID{nodeID, subID}] = true
	store.nodeMembers[[2]uuid.UUID{userID, nodeID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	nid := nodeID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeNode,
		NodeID: &nid, Target: "objecttree:work_items", Name: "Team",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestCreate_WorkspaceScope_NonAdminRejected(t *testing.T) {
	store := newFakeStore()
	subID, userID, wsID := uuid.New(), uuid.New(), uuid.New()
	store.workspaceInSub[[2]uuid.UUID{wsID, subID}] = true
	// NOT setting adminOf
	svc := newSvc(store, &fakeWSAdmin{adminOf: map[[2]uuid.UUID]bool{}})
	wid := wsID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeWorkspace,
		WorkspaceID: &wid, Target: "objecttree:work_items", Name: "WS",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if !errors.Is(err, ErrNotWSAdmin) {
		t.Fatalf("expected ErrNotWSAdmin, got %v", err)
	}
}

func TestCreate_WorkspaceScope_AdminAllowed(t *testing.T) {
	store := newFakeStore()
	subID, userID, wsID := uuid.New(), uuid.New(), uuid.New()
	store.workspaceInSub[[2]uuid.UUID{wsID, subID}] = true
	ws := &fakeWSAdmin{adminOf: map[[2]uuid.UUID]bool{{userID, wsID}: true}}
	svc := newSvc(store, ws)
	wid := wsID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeWorkspace,
		WorkspaceID: &wid, Target: "objecttree:work_items", Name: "WS",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
}

func TestCreate_TenantMismatch_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, userID, otherSub := uuid.New(), uuid.New(), uuid.New()
	// user lives in otherSub, not subID
	store.userInSub[[2]uuid.UUID{userID, otherSub}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userID
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userID,
	})
	if !errors.Is(err, ErrTenantMismatch) {
		t.Fatalf("expected ErrTenantMismatch, got %v", err)
	}
}

func TestCreate_InvalidKind_Rejected(t *testing.T) {
	svc := newSvc(newFakeStore(), &fakeWSAdmin{})
	uid := uuid.New()
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: uuid.New(), Kind: "made-up-kind", Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "x",
		Body: json.RawMessage(`{}`), ActorUserID: uid,
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
}

func TestCreate_BodyTooLarge_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, userID := uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userID, subID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	uid := userID
	big := make([]byte, 65537)
	for i := range big {
		big[i] = 'x'
	}
	// Wrap as JSON string for validity
	body := json.RawMessage(append(append([]byte(`"`), big...), '"'))
	_, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: body, ActorUserID: userID,
	})
	if !errors.Is(err, ErrBodyTooLarge) {
		t.Fatalf("expected ErrBodyTooLarge, got %v", err)
	}
}

func TestUpdateBody_NonOwnerNonAdmin_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, owner, other := uuid.New(), uuid.New(), uuid.New()
	uid := owner
	v := &View{
		ID: uuid.New(), SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine", CreatedBy: owner,
	}
	store.views[v.ID] = v
	svc := newSvc(store, &fakeWSAdmin{})
	_, err := svc.UpdateBody(context.Background(), subID, v.ID, other, nil, json.RawMessage(`{"x":1}`))
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

func TestUpdateScope_Promote_NodeMember(t *testing.T) {
	store := newFakeStore()
	subID, owner, nodeID := uuid.New(), uuid.New(), uuid.New()
	uid := owner
	v := &View{
		ID: uuid.New(), SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine", CreatedBy: owner,
	}
	store.views[v.ID] = v
	store.nodeInSub[[2]uuid.UUID{nodeID, subID}] = true
	store.nodeMembers[[2]uuid.UUID{owner, nodeID}] = true
	svc := newSvc(store, &fakeWSAdmin{})
	nid := nodeID
	out, err := svc.UpdateScope(context.Background(), UpdateScopeInput{
		SubscriptionID: subID, ViewID: v.ID,
		NewScope: ScopeNode, NewNodeID: &nid,
		ActorUserID: owner,
	})
	if err != nil {
		t.Fatalf("expected ok, got %v", err)
	}
	if out.Scope != ScopeNode || out.NodeID == nil || *out.NodeID != nodeID {
		t.Fatalf("scope not promoted: %+v", out)
	}
}

// TestService_GetByID_CrossTenantReturnsNotFound pins the existence-leak guard:
// a view ID belonging to subA, looked up under subB's subscription clamp, MUST
// return ErrNotFound (404) — never ErrForbidden (403). Distinguishing the two
// across tenants is itself a security finding (defence/finance posture): the
// response must be indistinguishable from "this ID does not exist."
func TestService_GetByID_CrossTenantReturnsNotFound(t *testing.T) {
	store := newFakeStore()
	subA, subB, userA := uuid.New(), uuid.New(), uuid.New()
	store.userInSub[[2]uuid.UUID{userA, subA}] = true
	svc := newSvc(store, &fakeWSAdmin{})

	// Create a user-scoped view in subA.
	uid := userA
	created, err := svc.Create(context.Background(), CreateInput{
		SubscriptionID: subA, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine",
		Body: json.RawMessage(`{}`), ActorUserID: userA,
	})
	if err != nil {
		t.Fatalf("setup: create failed: %v", err)
	}

	// Look up the same view ID under subB's clamp — must be 404, not 403.
	view, err := svc.GetByID(context.Background(), subB, created.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for cross-tenant lookup, got %v", err)
	}
	if errors.Is(err, ErrForbidden) {
		t.Fatalf("cross-tenant lookup must not leak existence via ErrForbidden")
	}
	if view != nil {
		t.Fatalf("expected nil view on cross-tenant lookup, got %+v", view)
	}
}

func TestArchive_NonOwner_Rejected(t *testing.T) {
	store := newFakeStore()
	subID, owner, other := uuid.New(), uuid.New(), uuid.New()
	uid := owner
	v := &View{
		ID: uuid.New(), SubscriptionID: subID, Kind: KindObjectTree, Scope: ScopeUser,
		UserID: &uid, Target: "objecttree:work_items", Name: "Mine", CreatedBy: owner,
	}
	store.views[v.ID] = v
	svc := newSvc(store, &fakeWSAdmin{})
	err := svc.Archive(context.Background(), subID, v.ID, other)
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
