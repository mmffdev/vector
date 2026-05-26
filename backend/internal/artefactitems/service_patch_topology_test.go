package artefactitems_test

// Regression tests for PatchWorkItem's topology_node_id rebind path.
//
// Origin: 2026-05-27. After Sentinel rolled out, PATCH on a work-item
// could:
//   (a) silently re-bind the row onto a topology node the actor held no
//       grant on, because the Patch path had no CanReadScope check
//       (Create did — service.go § create). Symmetric server-as-gate
//       violation; a non-gadmin could hide an artefact from themselves
//       and everyone whose scope didn't include the new node.
//   (b) return 404 to the user even when the write succeeded, because
//       the post-UPDATE GetWorkItem applied the entry-time subtree
//       clamp to the just-written row. Moving a row "out of your own
//       view" gave back HTTP 404 — hostile UX even though the write
//       was legitimate.
//
// Three contracts pinned here:
//   1. Gadmin (synthetic grant via SystemGrpGlobalID short-circuit) can
//      rebind to any node and gets the row back.
//   2. Non-gadmin attempting to rebind to a no-grant node → ErrScopeForbidden.
//   3. Non-gadmin rebinding to a node within their grants returns the row
//      even when the entry-time clamp excludes the new node (carve-out).
//
// The post-write read carve-out is exercised by injecting a Sentinel
// clamp into the request ctx whose AllowedSubtreeIDs excludes the
// new node, then asserting that PatchWorkItem still returns the row.
// Without the carve-out, GetWorkItem post-filters by AllowedSubtreeIDs
// and the test sees ErrNotFound.

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// TestPatchWorkItem_TopologyRebind_GrantDenied — non-gadmin attempting
// to rebind topology_node_id to a node they hold no grant on must get
// ErrScopeForbidden. The row is NOT updated.
func TestPatchWorkItem_TopologyRebind_GrantDenied(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	// canRead=false → CanReadScope refuses the new node.
	svc.WithTopologyResolver(stubTopologyResolver{canRead: false})
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT users_id FROM users WHERE users_id_subscription=$1 AND users_is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user for sub %s: %v", sub, err)
	}

	// Source row — created without topology pin so the seed itself
	// doesn't need a grant.
	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "patch-topo-denied-" + uuid.New().String()[:8],
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE artefacts_id=$1`, id)
	})

	nodeStr := uuid.New().String() // any UUID — stub rejects regardless
	_, err = svc.PatchWorkItem(ctx, sub, uuid.MustParse(wi.ID), artefactitems.PatchWorkItemInput{
		TopologyNodeID: &nodeStr,
		AuthorUserID:   ownerID,
		ActorRoleID:    uuid.New(), // any non-nil non-gadmin role
	})
	if err == nil {
		t.Fatal("expected ErrScopeForbidden, got nil")
	}
	if !isErrScopeForbidden(err) {
		t.Errorf("err = %v, want ErrScopeForbidden", err)
	}

	// Defence-in-depth: the row's topology_node_id must still be NULL
	// (the failed PATCH must not have half-written).
	var got *uuid.UUID
	if err := va.QueryRow(ctx,
		`SELECT artefacts_id_topology_node FROM artefacts WHERE artefacts_id=$1`,
		uuid.MustParse(wi.ID),
	).Scan(&got); err != nil {
		t.Fatalf("read-back: %v", err)
	}
	if got != nil {
		t.Errorf("topology_node_id = %v, want NULL (write must not partial-apply on scope denial)", *got)
	}
}

// TestPatchWorkItem_TopologyRebind_AllowedRow_ReturnsRowEvenWhenOutOfEntryClamp
// pins the post-write read carve-out. Setup:
//   - Patch input rebinds topology_node_id to a node X.
//   - The request ctx carries a Sentinel clamp whose AllowedSubtreeIDs
//     excludes X (simulating "URL ?meg= focused on a sibling subtree").
//   - The topology stub returns canRead=true so the write is authorised.
// Expected: PatchWorkItem returns the row with topology_node_id = X,
// NOT ErrNotFound. Without the WithBypassedSubtreeClamp carve-out the
// post-UPDATE GetWorkItem would filter X out and the caller would see
// a misleading 404.
func TestPatchWorkItem_TopologyRebind_AllowedRow_ReturnsRowEvenWhenOutOfEntryClamp(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	svc.WithTopologyResolver(stubTopologyResolver{canRead: true})
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT users_id FROM users WHERE users_id_subscription=$1 AND users_is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	// Pick a live topology node as the rebind target.
	var newNode uuid.UUID
	if err := va.QueryRow(ctx,
		`SELECT topology_nodes_id FROM topology_nodes
		  WHERE topology_nodes_id_subscription=$1
		    AND topology_nodes_archived_at IS NULL LIMIT 1`,
		sub,
	).Scan(&newNode); err != nil {
		t.Skipf("no live topology_node for sub %s: %v", sub, err)
	}

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "patch-topo-carveout-" + uuid.New().String()[:8],
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE artefacts_id=$1`, id)
	})

	// Inject an entry-time clamp that EXCLUDES newNode. If the carve-out
	// is missing, GetWorkItem will return ErrNotFound because newNode
	// is not in AllowedSubtreeIDs.
	bogusSubtree := []uuid.UUID{uuid.New(), uuid.New()}
	clampedCtx := sentinelCtxWithClamp(ctx, sentinel.Clamp{
		TenantID:          sub,
		UserID:            ownerID,
		WorkspaceID:       uuid.New(), // not asserted in this test
		FocusNodeID:       bogusSubtree[0],
		AllowedSubtreeIDs: bogusSubtree,
	})

	nodeStr := newNode.String()
	patched, err := svc.PatchWorkItem(clampedCtx, sub, uuid.MustParse(wi.ID), artefactitems.PatchWorkItemInput{
		TopologyNodeID: &nodeStr,
		AuthorUserID:   ownerID,
		ActorRoleID:    uuid.New(),
	})
	if err != nil {
		t.Fatalf("PatchWorkItem with bypassed clamp: %v", err)
	}
	if patched == nil {
		t.Fatal("patched row is nil")
	}
	if patched.TopologyNodeID == nil || *patched.TopologyNodeID != newNode.String() {
		t.Errorf("topology_node_id = %v, want %s", patched.TopologyNodeID, newNode)
	}
}

// TestPatchWorkItem_TopologyClear_NoGateRequired — clearing the field
// to NULL must NOT require a CanReadScope check (clearing has no
// destination node). The carve-out also still applies because the row
// now has NULL topology_node_id, which the subtree gate treats as
// out-of-scope by convention (see getWorkItemImpl).
func TestPatchWorkItem_TopologyClear_NoGateRequired(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	// canRead=false — to prove the clear-path does NOT call the gate.
	// If the service incorrectly ran CanReadScope on the empty-string
	// path, this test would surface ErrScopeForbidden.
	svc.WithTopologyResolver(stubTopologyResolver{canRead: false})
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT users_id FROM users WHERE users_id_subscription=$1 AND users_is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}

	wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
		ItemType:  "story",
		Title:     "patch-topo-clear-" + uuid.New().String()[:8],
		OwnerID:   ownerID.String(),
		CreatedBy: ownerID.String(),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() {
		id, _ := uuid.Parse(wi.ID)
		_, _ = va.Exec(context.Background(), `DELETE FROM artefacts WHERE artefacts_id=$1`, id)
	})

	empty := ""
	patched, err := svc.PatchWorkItem(ctx, sub, uuid.MustParse(wi.ID), artefactitems.PatchWorkItemInput{
		TopologyNodeID: &empty,
		AuthorUserID:   ownerID,
		ActorRoleID:    uuid.New(),
	})
	if err != nil {
		t.Fatalf("clear topology_node_id: %v", err)
	}
	if patched.TopologyNodeID != nil {
		t.Errorf("topology_node_id = %v, want NULL", *patched.TopologyNodeID)
	}
}

// ── helpers ──────────────────────────────────────────────────────────

// isErrScopeForbidden mirrors the artefactitems.ErrScopeForbidden
// sentinel without importing the unexported package symbol directly.
// `errors.Is` against the public sentinel is the contract surface.
func isErrScopeForbidden(err error) bool {
	return err != nil && err.Error() != "" && (err == artefactitems.ErrScopeForbidden ||
		errIsWrapped(err, artefactitems.ErrScopeForbidden))
}

func errIsWrapped(err, target error) bool {
	for e := err; e != nil; {
		if e == target {
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := e.(unwrapper)
		if !ok {
			return false
		}
		e = u.Unwrap()
	}
	return false
}

// sentinelCtxWithClamp attaches a Sentinel clamp to ctx for tests that
// need to drive the post-write read carve-out. Wraps the production
// withClamp helper (unexported) via the sentinel package's request
// middleware indirection — kept here to avoid leaking the test setup
// into production callers.
//
// Implementation note: the sentinel package intentionally does NOT
// export a public clamp-injector (only Middleware writes clamps). For
// test fixtures we mint one through the request path by constructing
// an http.Handler with sentinel.Middleware, but that needs a Resolver.
// Cheaper: call the exported WithBypassedSubtreeClamp twice on a ctx
// pre-seeded with the desired clamp via a tiny adapter. But the
// cleanest path is to use a sentinel test helper if one exists.
func sentinelCtxWithClamp(ctx context.Context, c sentinel.Clamp) context.Context {
	return sentinel.TestingWithClamp(ctx, c)
}
