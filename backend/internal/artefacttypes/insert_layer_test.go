package artefacttypes

// DB-backed tests for the insert-strategic-layer flow (PreviewInsertLayer +
// InsertLayer). Requires a live vector_artefacts pool (VA_DB_* env vars or
// .env.local); skips cleanly when the pool is unavailable, mirroring
// seed_test.go / service_create_test.go. Reuses testPool, seedTestSubscription,
// seedTestWorkspace, ptr from service_create_test.go.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// seedDefaultPriority inserts a minimal pri_medium-slotted priority row for the
// workspace so both the seeded child artefacts AND the pass-through wrappers can
// resolve a non-NULL artefacts_id_priority. Returns its id. Registers cleanup.
func seedDefaultPriority(t *testing.T, pool *pgxpool.Pool, wsID uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO artefact_priorities (
			artefact_priorities_id_workspace, artefact_priorities_name,
			artefact_priorities_slot, artefact_priorities_sort_order)
		VALUES ($1, 'Medium', 'pri_medium', 10)
		RETURNING artefact_priorities_id`,
		wsID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedDefaultPriority: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefact_priorities WHERE artefact_priorities_id_workspace = $1`, wsID)
	})
	return id
}

// seedStrategyType inserts a strategy-scope tenant type with the given
// strategy_parent_id (nil for the ladder root). Cleanup is keyed on (sub, ws).
func seedStrategyType(t *testing.T, pool *pgxpool.Pool, subID, wsID uuid.UUID, name, prefix string, parent *uuid.UUID) *ArtefactType {
	t.Helper()
	ctx := context.Background()
	var out ArtefactType
	err := pool.QueryRow(ctx, `
		INSERT INTO artefacts_types (
			artefacts_types_id_subscription, artefacts_types_id_workspace,
			artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix,
			artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_sort_order
		) VALUES ($1,$2,'strategy','tenant',$3,$4,$5,TRUE,0)
		RETURNING
			artefacts_types_id, artefacts_types_scope, artefacts_types_source,
			artefacts_types_name, artefacts_types_prefix, artefacts_types_description,
			artefacts_types_colour, artefacts_types_slot, artefacts_types_strategy_parent_id,
			artefacts_types_allows_children, artefacts_types_layer_depth,
			artefacts_types_sort_order, artefacts_types_archived_at,
			artefacts_types_created_at, artefacts_types_updated_at,
			artefacts_types_execution_parent_slots`,
		subID, wsID, name, prefix, parent,
	).Scan(
		&out.ID, &out.Scope, &out.Source, &out.Name, &out.Prefix, &out.Description,
		&out.Colour, &out.Slot, &out.ParentTypeID, &out.AllowsChildren, &out.LayerDepth,
		&out.SortOrder, &out.ArchivedAt, &out.CreatedAt, &out.UpdatedAt, &out.ExecutionParentSlots,
	)
	if err != nil {
		t.Fatalf("seedStrategyType %q: %v", name, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefacts_types WHERE artefacts_types_id_subscription = $1 AND artefacts_types_id_workspace = $2`,
			subID, wsID,
		)
	})
	return &out
}

// seededArtefact is a tiny handle for a seeded artefacts row.
type seededArtefact struct {
	ID uuid.UUID
}

// seedArtefact inserts a live artefact instance of the given type, with the
// given title and optional parent. It sets artefacts_id_priority from the
// workspace default (resolved via the same query the pass-through insert uses),
// so the NOT-NULL priority column is satisfied. Cleanup is keyed on (sub, ws).
func seedArtefact(t *testing.T, pool *pgxpool.Pool, subID, wsID, typeID uuid.UUID, title string, parent *uuid.UUID) *seededArtefact {
	t.Helper()
	ctx := context.Background()

	var priorityID uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT artefact_priorities_id FROM artefact_priorities
		 WHERE artefact_priorities_id_workspace = $1
		   AND artefact_priorities_archived_at IS NULL
		 ORDER BY (artefact_priorities_slot = 'pri_medium') DESC, artefact_priorities_sort_order ASC
		 LIMIT 1`, wsID,
	).Scan(&priorityID); err != nil {
		t.Fatalf("seedArtefact resolve priority (seed a default priority first): %v", err)
	}

	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO artefacts (
			artefacts_id_subscription, artefacts_id_workspace,
			artefacts_id_artefact_type, artefacts_number, artefacts_title,
			artefacts_id_parent, artefacts_id_priority)
		VALUES ($1,$2,$3,
			COALESCE((SELECT MAX(artefacts_number)+1 FROM artefacts WHERE artefacts_id_workspace=$2),1),
			$4,$5,$6)
		RETURNING artefacts_id`,
		subID, wsID, typeID, title, parent, priorityID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedArtefact %q: %v", title, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefacts WHERE artefacts_id_subscription = $1 AND artefacts_id_workspace = $2`,
			subID, wsID,
		)
	})
	return &seededArtefact{ID: id}
}

// assertParentTypeID asserts that the type `childTypeID`'s strategy parent is
// `wantParentID`.
func assertParentTypeID(t *testing.T, pool *pgxpool.Pool, childTypeID, wantParentID uuid.UUID) {
	t.Helper()
	var got *uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT artefacts_types_strategy_parent_id FROM artefacts_types WHERE artefacts_types_id = $1`,
		childTypeID,
	).Scan(&got); err != nil {
		t.Fatalf("assertParentTypeID query: %v", err)
	}
	if got == nil {
		t.Fatalf("type %s strategy parent is NULL, want %s", childTypeID, wantParentID)
	}
	if *got != wantParentID {
		t.Fatalf("type %s strategy parent = %s, want %s", childTypeID, *got, wantParentID)
	}
}

// artefactParent returns the parent id of the given artefact (must be non-NULL).
func artefactParent(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) uuid.UUID {
	t.Helper()
	var p *uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT artefacts_id_parent FROM artefacts WHERE artefacts_id = $1`, id,
	).Scan(&p); err != nil {
		t.Fatalf("artefactParent query: %v", err)
	}
	if p == nil {
		t.Fatalf("artefact %s has NULL parent, expected a pass-through wrapper", id)
	}
	return *p
}

// assertArtefactTitle asserts the artefact's title equals want.
func assertArtefactTitle(t *testing.T, pool *pgxpool.Pool, id uuid.UUID, want string) {
	t.Helper()
	var got string
	if err := pool.QueryRow(context.Background(),
		`SELECT artefacts_title FROM artefacts WHERE artefacts_id = $1`, id,
	).Scan(&got); err != nil {
		t.Fatalf("assertArtefactTitle query: %v", err)
	}
	if got != want {
		t.Fatalf("artefact %s title = %q, want %q", id, got, want)
	}
}

// assertArtefactParent asserts the artefact's parent equals wantParent.
func assertArtefactParent(t *testing.T, pool *pgxpool.Pool, id, wantParent uuid.UUID) {
	t.Helper()
	var p *uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT artefacts_id_parent FROM artefacts WHERE artefacts_id = $1`, id,
	).Scan(&p); err != nil {
		t.Fatalf("assertArtefactParent query: %v", err)
	}
	if p == nil {
		t.Fatalf("artefact %s has NULL parent, want %s", id, wantParent)
	}
	if *p != wantParent {
		t.Fatalf("artefact %s parent = %s, want %s", id, *p, wantParent)
	}
}

// seedTopologyNode inserts a real topology_nodes row (artefacts_id_topology_node
// is FK-constrained to it) and returns its id.
func seedTopologyNode(t *testing.T, pool *pgxpool.Pool, subID, wsID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO topology_nodes (
			topology_nodes_id, topology_nodes_id_subscription,
			topology_nodes_id_workspace, topology_nodes_name)
		VALUES ($1,$2,$3,'insert-layer-test-node')`, id, subID, wsID,
	); err != nil {
		t.Fatalf("seedTopologyNode: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM topology_nodes WHERE topology_nodes_id_subscription = $1 AND topology_nodes_id_workspace = $2`,
			subID, wsID)
	})
	return id
}

// stampTopologyNode sets an artefact's topology node directly (test scaffolding
// for the pass-through-inherits-topology regression).
func stampTopologyNode(t *testing.T, pool *pgxpool.Pool, id, node uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE artefacts SET artefacts_id_topology_node = $1 WHERE artefacts_id = $2`, node, id,
	); err != nil {
		t.Fatalf("stampTopologyNode: %v", err)
	}
}

// assertArtefactTopologyNode asserts an artefact's topology node equals want.
// Guards the pass-through-wrapper bug: a wrapper created with a NULL topology
// node is dropped by ListChildren's topology subtree clamp, capping the tree at
// the inserted layer (origin: 2026-06-07 "portfolio tree stops at Theme").
func assertArtefactTopologyNode(t *testing.T, pool *pgxpool.Pool, id, want uuid.UUID) {
	t.Helper()
	var node *uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT artefacts_id_topology_node FROM artefacts WHERE artefacts_id = $1`, id,
	).Scan(&node); err != nil {
		t.Fatalf("assertArtefactTopologyNode query: %v", err)
	}
	if node == nil {
		t.Fatalf("artefact %s topology node is NULL, want %s (wrapper would be clamp-dropped)", id, want)
	}
	if *node != want {
		t.Fatalf("artefact %s topology node = %s, want %s", id, *node, want)
	}
}

// assertArtefactParentNil asserts the artefact's parent is NULL (a root).
func assertArtefactParentNil(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) {
	t.Helper()
	var p *uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT artefacts_id_parent FROM artefacts WHERE artefacts_id = $1`, id,
	).Scan(&p); err != nil {
		t.Fatalf("assertArtefactParentNil query: %v", err)
	}
	if p != nil {
		t.Fatalf("artefact %s parent = %s, want NULL (root wrapper)", id, *p)
	}
}

// Theme(parent=Product) has two Feature children with two Feature INSTANCES.
// Insert "Strategic Objective" between Theme and Feature → each Feature instance
// gets one pass-through parent of the new type, mirroring its name.
func TestInsertLayer_PassThroughBackfill(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
	wsID := seedTestWorkspace(t, pool, subID)
	seedDefaultPriority(t, pool, wsID)

	product := seedStrategyType(t, pool, subID, wsID, "Product", "PR", nil)
	theme := seedStrategyType(t, pool, subID, wsID, "Theme", "TH", &product.ID)
	feature := seedStrategyType(t, pool, subID, wsID, "Feature", "FE", &theme.ID)

	// Two feature instances, each parented to a theme instance.
	themeInst := seedArtefact(t, pool, subID, wsID, theme.ID, "Theme A", nil)
	f1 := seedArtefact(t, pool, subID, wsID, feature.ID, "Login", &themeInst.ID)
	f2 := seedArtefact(t, pool, subID, wsID, feature.ID, "Signup", &themeInst.ID)

	prev, err := svc.PreviewInsertLayer(ctx, subID, wsID, InsertLayerInput{
		Tag: "so", Name: "Strategic Objective", ChildTypeID: feature.ID,
	})
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if prev.Rejection != nil {
		t.Fatalf("unexpected rejection: %q", *prev.Rejection)
	}
	if prev.PassthroughCount != 2 {
		t.Fatalf("expected 2 impacted, got %d", prev.PassthroughCount)
	}
	if prev.ParentLayer.ID != theme.ID {
		t.Fatalf("preview parent layer = %s, want theme %s", prev.ParentLayer.ID, theme.ID)
	}
	if prev.ChildLayer.ID != feature.ID {
		t.Fatalf("preview child layer = %s, want feature %s", prev.ChildLayer.ID, feature.ID)
	}

	res, err := svc.InsertLayer(ctx, subID, wsID, InsertLayerInput{
		Tag: "so", Name: "Strategic Objective", ChildTypeID: feature.ID,
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if res.CreatedCount != 2 {
		t.Fatalf("expected 2 created, got %d", res.CreatedCount)
	}
	if res.NewType == nil {
		t.Fatalf("insert returned nil NewType")
	}

	// Feature type now parents under the new type.
	assertParentTypeID(t, pool, feature.ID, res.NewType.ID)
	// New type parents under Theme.
	assertParentTypeID(t, pool, res.NewType.ID, theme.ID)

	// f1's parent is now a pass-through named "Login", whose parent is themeInst.
	p1 := artefactParent(t, pool, f1.ID)
	assertArtefactTitle(t, pool, p1, "Login")
	assertArtefactParent(t, pool, p1, themeInst.ID)

	// f2's parent is a pass-through named "Signup", whose parent is themeInst.
	p2 := artefactParent(t, pool, f2.ID)
	assertArtefactTitle(t, pool, p2, "Signup")
	assertArtefactParent(t, pool, p2, themeInst.ID)
}

// A child instance on a topology node yields a pass-through wrapper on the SAME
// node — not NULL. Regression for the "tree stops at the inserted layer" bug:
// ListChildren clamps direct children by artefacts_id_topology_node, so a
// NULL-node wrapper is silently dropped and the inserted layer's descendants
// never render.
func TestInsertLayer_PassThroughInheritsTopologyNode(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
	wsID := seedTestWorkspace(t, pool, subID)
	seedDefaultPriority(t, pool, wsID)

	product := seedStrategyType(t, pool, subID, wsID, "Product", "PR", nil)
	theme := seedStrategyType(t, pool, subID, wsID, "Theme", "TH", &product.ID)
	feature := seedStrategyType(t, pool, subID, wsID, "Feature", "FE", &theme.ID)

	// Seed a real topology node FIRST (its cleanup runs LIFO, i.e. AFTER the
	// artefact cleanups registered below, so the FK is clear by then). One
	// feature instance, stamped with that node.
	node := seedTopologyNode(t, pool, subID, wsID)
	themeInst := seedArtefact(t, pool, subID, wsID, theme.ID, "Theme A", nil)
	f1 := seedArtefact(t, pool, subID, wsID, feature.ID, "Login", &themeInst.ID)
	stampTopologyNode(t, pool, f1.ID, node)

	if _, err := svc.InsertLayer(ctx, subID, wsID, InsertLayerInput{
		Tag: "so", Name: "Strategic Objective", ChildTypeID: feature.ID,
	}); err != nil {
		t.Fatalf("insert: %v", err)
	}

	// The pass-through wrapper now parents the feature instance; it must carry
	// the child's topology node (else ListChildren's clamp drops it).
	wrapper := artefactParent(t, pool, f1.ID)
	assertArtefactTopologyNode(t, pool, wrapper, node)
}

func TestInsertLayer_OrphanChild(t *testing.T) {
	pool := testPool(t)
	svc := NewService(pool, nil)
	ctx := context.Background()
	subID := seedTestSubscription(t, pool)
	wsID := seedTestWorkspace(t, pool, subID)
	seedDefaultPriority(t, pool, wsID)

	product := seedStrategyType(t, pool, subID, wsID, "Product", "PR", nil)
	theme := seedStrategyType(t, pool, subID, wsID, "Theme", "TH", &product.ID)
	feature := seedStrategyType(t, pool, subID, wsID, "Feature", "FE", &theme.ID)
	orphan := seedArtefact(t, pool, subID, wsID, feature.ID, "Orphan", nil) // no parent

	res, err := svc.InsertLayer(ctx, subID, wsID, InsertLayerInput{Tag: "so", Name: "SO", ChildTypeID: feature.ID})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if res.CreatedCount != 1 {
		t.Fatalf("orphan should still get one wrapper, got %d", res.CreatedCount)
	}
	p := artefactParent(t, pool, orphan.ID)
	assertArtefactParentNil(t, pool, p) // wrapper is a root
}
