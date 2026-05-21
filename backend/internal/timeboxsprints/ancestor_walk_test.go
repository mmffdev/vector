package timeboxsprints_test

// Slice 5B (2026-05-21) — read-side ancestor-walk + write-side 409.
// Integration tests against the dev vector_artefacts pool. Same skip
// behaviour as the rest of the test file: VECTOR_ARTEFACTS_DB_URL must
// be set + the tunnel up.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/timeboxsprints"
	"github.com/mmffdev/vector-backend/internal/topology"
)

// seedTopologyChain inserts (parent → child) into topology_nodes for
// the given subscription + workspace. Returns (parentID, childID).
// Cleanup is registered via t.Cleanup. The tests use raw SQL because
// topology.Service.CreateNode requires a much wider set of context
// (auth user, validation, audit log) than we want to set up here.
func seedTopologyChain(t *testing.T, pool *pgxpool.Pool, subID, wsID string) (parentID, childID string) {
	t.Helper()
	parentID = uuid.NewString()
	childID = uuid.NewString()
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		INSERT INTO topology_nodes (
			id, workspace_id, subscription_id, parent_id, name, description,
			layout_mode, collapsed_default, sort_order
		) VALUES (
			$1, $2, $3, NULL, 'slice5b-parent', '',
			'auto-horizontal', false, 0
		)
	`, parentID, wsID, subID)
	if err != nil {
		t.Fatalf("seed parent node: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO topology_nodes (
			id, workspace_id, subscription_id, parent_id, name, description,
			layout_mode, collapsed_default, sort_order
		) VALUES (
			$1, $2, $3, $4, 'slice5b-child', '',
			'auto-horizontal', false, 0
		)
	`, childID, wsID, subID, parentID)
	if err != nil {
		t.Fatalf("seed child node: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`DELETE FROM topology_nodes WHERE subscription_id = $1`, subID)
	})
	return parentID, childID
}

// TestAncestorWalk_InheritedSprintAppears verifies the slice-5B read path:
// a sprint pinned to a parent topology node with propagation flagged
// surfaces in a child-node List query as origin=inherited with the
// parent's id and name attached.
func TestAncestorWalk_InheritedSprintAppears(t *testing.T) {
	pool := openVAPool(t)
	topo := topology.New(nil, pool)
	svc := timeboxsprints.NewService(pool).WithTopology(topo)
	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	parentID, childID := seedTopologyChain(t, pool, sub, ws)

	// Create a sprint pinned to the PARENT with propagation flag set.
	propagate := "this_node_and_descendants"
	in := baseInput(sub, ws, &parentID, "Inherited Sprint", "2030-02-01", "2030-02-14")
	in.ScopePropagation = &propagate
	if _, err := svc.Create(context.Background(), in); err != nil {
		t.Fatalf("Create parent sprint: %v", err)
	}

	// Local sprint pinned to the child directly — should come back as origin=local.
	localIn := baseInput(sub, ws, &childID, "Local Sprint", "2030-03-01", "2030-03-14")
	if _, err := svc.Create(context.Background(), localIn); err != nil {
		t.Fatalf("Create child sprint: %v", err)
	}

	// List from the CHILD node WITH subscription wired so ancestor-walk activates.
	got, err := svc.List(context.Background(), ws, timeboxsprints.ListFilters{
		OrgNodeID:      &childID,
		SubscriptionID: &sub,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 sprints (1 local + 1 inherited); got %d", len(got))
	}

	var sawLocal, sawInherited bool
	for _, sp := range got {
		switch sp.SprintName {
		case "Local Sprint":
			sawLocal = true
			if sp.Origin != "local" {
				t.Errorf("Local Sprint origin: want %q got %q", "local", sp.Origin)
			}
			if sp.FromNodeID != nil {
				t.Errorf("Local Sprint FromNodeID: want nil got %q", *sp.FromNodeID)
			}
		case "Inherited Sprint":
			sawInherited = true
			if sp.Origin != "inherited" {
				t.Errorf("Inherited Sprint origin: want %q got %q", "inherited", sp.Origin)
			}
			if sp.FromNodeID == nil || *sp.FromNodeID != parentID {
				t.Errorf("Inherited Sprint FromNodeID: want %q got %v", parentID, sp.FromNodeID)
			}
			if sp.FromNodeName == nil || *sp.FromNodeName != "slice5b-parent" {
				t.Errorf("Inherited Sprint FromNodeName: want %q got %v", "slice5b-parent", sp.FromNodeName)
			}
		}
	}
	if !sawLocal {
		t.Error("expected the local sprint to appear in the child-node list")
	}
	if !sawInherited {
		t.Error("expected the propagated parent sprint to appear in the child-node list")
	}
}

// TestAncestorWalk_NoPropagationFlag verifies that a parent sprint
// WITHOUT the propagation flag does NOT leak into a child-node read.
func TestAncestorWalk_NoPropagationFlag(t *testing.T) {
	pool := openVAPool(t)
	topo := topology.New(nil, pool)
	svc := timeboxsprints.NewService(pool).WithTopology(topo)
	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	parentID, childID := seedTopologyChain(t, pool, sub, ws)

	// Parent sprint with DEFAULT propagation ('this_node_only').
	in := baseInput(sub, ws, &parentID, "Local-only Parent Sprint", "2030-04-01", "2030-04-14")
	if _, err := svc.Create(context.Background(), in); err != nil {
		t.Fatalf("Create parent sprint: %v", err)
	}

	got, err := svc.List(context.Background(), ws, timeboxsprints.ListFilters{
		OrgNodeID:      &childID,
		SubscriptionID: &sub,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 sprints from child-node view (parent not flagged); got %d", len(got))
	}
}

// TestAncestorWalk_BackCompat_NoSubscriptionID verifies that callers
// who pass OrgNodeID without SubscriptionID get the legacy
// "pinned-only" behaviour — no ancestor-walk, no origin metadata.
func TestAncestorWalk_BackCompat_NoSubscriptionID(t *testing.T) {
	pool := openVAPool(t)
	topo := topology.New(nil, pool)
	svc := timeboxsprints.NewService(pool).WithTopology(topo)
	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	parentID, childID := seedTopologyChain(t, pool, sub, ws)

	propagate := "this_node_and_descendants"
	in := baseInput(sub, ws, &parentID, "Propagated but invisible", "2030-05-01", "2030-05-14")
	in.ScopePropagation = &propagate
	if _, err := svc.Create(context.Background(), in); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// SubscriptionID intentionally omitted — old-school caller.
	got, err := svc.List(context.Background(), ws, timeboxsprints.ListFilters{
		OrgNodeID: &childID,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 sprints (ancestor-walk should be dormant without SubscriptionID); got %d", len(got))
	}
}

// TestEnsureWritable_RejectsInheritedRow verifies the write-side 409
// path: a sprint pinned to a parent with propagation flagged returns
// ErrInheritedReadOnly when EnsureWritable is called with the child
// node as the viewing context.
func TestEnsureWritable_RejectsInheritedRow(t *testing.T) {
	pool := openVAPool(t)
	topo := topology.New(nil, pool)
	svc := timeboxsprints.NewService(pool).WithTopology(topo)
	sub, ws, _ := newIDs()
	t.Cleanup(cleanup(pool, ws))

	parentID, childID := seedTopologyChain(t, pool, sub, ws)

	propagate := "this_node_and_descendants"
	in := baseInput(sub, ws, &parentID, "Locked Sprint", "2030-06-01", "2030-06-14")
	in.ScopePropagation = &propagate
	created, err := svc.Create(context.Background(), in)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// EnsureWritable from the CHILD vantage → ErrInheritedReadOnly.
	err = svc.EnsureWritable(context.Background(), ws, created.ID, sub, childID)
	if err != timeboxsprints.ErrInheritedReadOnly {
		t.Errorf("EnsureWritable from child: want ErrInheritedReadOnly got %v", err)
	}

	// EnsureWritable from the PARENT vantage (the sprint's own pinned
	// node) → nil; the user is editing on the pinned node.
	if err := svc.EnsureWritable(context.Background(), ws, created.ID, sub, parentID); err != nil {
		t.Errorf("EnsureWritable from parent: want nil got %v", err)
	}

	// EnsureWritable with no viewing node → nil (no-op back-compat).
	if err := svc.EnsureWritable(context.Background(), ws, created.ID, sub, ""); err != nil {
		t.Errorf("EnsureWritable with empty viewingNodeID: want nil got %v", err)
	}
}
