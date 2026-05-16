package portfoliomodels

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// PLA-0026 / Story 00494 (B5): integration test for the work
// artefacts_types writer. Hits the live vector_artefacts DB via the SSH
// tunnel on :5435. Mirrors the shape of adopt_strategy_types_test.go
// (see vaTestPool / runInVATx defined in that file).
//
// The writer reads SYSTEM rows (source='system', scope='work') for the
// passed subscription and mirrors them as per-workspace tenant rows
// (source='tenant'). To keep tests hermetic we synthesise a fresh
// subscription_id + a small set of system templates per test rather
// than relying on the seed function from migration 010 — that way the
// tests do not interact with any tenant's real seed data.
//
// Coverage:
//   - happy path: every system row mirrored, source='tenant',
//     scope='work', parent chain resolved (synthetic seed includes a
//     parent reference to exercise Phase 2 even though current
//     production seed is flat).
//   - idempotent: re-running with the same inputs is a no-op.
//   - preserves user edits: pre-edited tenant name survives a re-run.
//   - handles empty seed: no system rows => no-op + nil error.

// seedSystemWorkTypes inserts a small synthetic set of system work-
// type rows for a fresh subscription. Returns the system row IDs
// keyed by prefix so tests can assert parent resolution. Includes one
// row with a parent reference so Phase 2 has work to do.
//
// NOTES on DB-level schema dependencies that this writer is designed
// to operate AGAINST (and which the test transaction temporarily
// loosens — rollback restores everything):
//
//   - artefact_types_prefix_unique_live (subscription_id, scope, prefix)
//     from migration 003 collides with the per-workspace tenant copy
//     pattern (system row + tenant row share subscription_id + prefix).
//     The replacement uq_artefact_types_ws_scope_prefix from migration
//     019 is the correct invariant. Test drops the legacy index.
//   - artefact_types_work_no_parent CHECK from migration 003 forbids
//     parent_type_id on scope='work'. To exercise Phase 2 we drop that
//     CHECK only when includeParent=true.
//
// Both legacy guards are slated for removal as part of the per-
// workspace cutover (PLA-0026 follow-up migration). Until then the
// writer test surfaces the dependency by dropping them in-tx.
func seedSystemWorkTypes(
	t *testing.T,
	ctx context.Context,
	tx pgx.Tx,
	subscriptionID uuid.UUID,
	includeParent bool,
) map[string]uuid.UUID {
	t.Helper()

	// Drop the legacy (subscription_id, scope, prefix) unique that
	// blocks tenant copies sharing a subscription with the system row.
	// The new (workspace_id, scope, prefix) unique remains in force.
	if _, err := tx.Exec(ctx, `
		DROP INDEX IF EXISTS artefact_types_prefix_unique_live`); err != nil {
		t.Fatalf("drop legacy prefix-unique index: %v", err)
	}

	// Insert system rows. workspace_id is required NOT NULL post-019;
	// per migration 019 backfill convention we use subscription_id as
	// the placeholder workspace_id for orphan-sub fixtures (the
	// writer's input workspaceID is a different UUID — exactly the
	// per-workspace tenant copy this test asserts).
	type seed struct {
		name           string
		prefix         string
		sortOrder      int
		allowsChildren bool
	}
	seeds := []seed{
		{"Story", "US", 10, false},
		{"Defect", "DE", 20, false},
		{"Task", "TA", 30, false},
		{"Epic", "EP", 40, true},
	}

	ids := make(map[string]uuid.UUID, len(seeds))
	for _, s := range seeds {
		var id uuid.UUID
		if err := tx.QueryRow(ctx, `
			INSERT INTO artefacts_types (
				subscription_id, workspace_id,
				scope, source,
				name, prefix, sort_order, allows_children
			) VALUES ($1, $1, 'work', 'system', $2, $3, $4, $5)
			RETURNING id`,
			subscriptionID, s.name, s.prefix, s.sortOrder, s.allowsChildren,
		).Scan(&id); err != nil {
			t.Fatalf("seed system %q: %v", s.name, err)
		}
		ids[s.prefix] = id
	}

	if includeParent {
		// Drop the work-no-parent CHECK temporarily so we can exercise
		// the writer's Phase 2. The constraint is re-added inside this
		// same tx so the test's own rollback restores schema state.
		// (We intentionally use a per-test transaction for seeding so
		// this DDL is contained.)
		if _, err := tx.Exec(ctx, `
			ALTER TABLE artefacts_types
				DROP CONSTRAINT IF EXISTS artefact_types_work_no_parent`); err != nil {
			t.Fatalf("drop work-no-parent check: %v", err)
		}
		// Make Story (US) a child of Epic (EP) — synthetic hierarchy
		// that exercises Phase 2 parent resolution by prefix.
		if _, err := tx.Exec(ctx, `
			UPDATE artefacts_types SET parent_type_id = $1 WHERE id = $2`,
			ids["EP"], ids["US"],
		); err != nil {
			t.Fatalf("set synthetic parent: %v", err)
		}
	}

	return ids
}

// runIntegratedVATx wraps writer + assertions into one tx that we
// rollback at the end so synthetic system rows + DDL changes do not
// persist. Differs from runInVATx (which commits) — that helper would
// leak our synthetic system rows into shared dev DB state.
func runIntegratedVATx(
	t *testing.T,
	ctx context.Context,
	pool interface {
		BeginTx(ctx context.Context, txOptions pgx.TxOptions) (pgx.Tx, error)
	},
	fn func(pgx.Tx),
) {
	t.Helper()
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	fn(tx)
	// Always rollback — these tests must not leak synthetic system
	// rows or the DDL drop into the shared dev DB.
}

func TestWriteWorkArtefactTypes_HappyPath(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	subscriptionID := uuid.New()
	workspaceID := uuid.New()

	runIntegratedVATx(t, ctx, pool, func(tx pgx.Tx) {
		// Seed synthetic system rows incl. a Story→Epic parent link so
		// Phase 2 actually does something.
		systemIDs := seedSystemWorkTypes(t, ctx, tx, subscriptionID, true)

		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			t.Fatalf("writer: %v", err)
		}

		// 4 tenant rows landed in this workspace.
		var n int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID).Scan(&n); err != nil {
			t.Fatalf("count tenant rows: %v", err)
		}
		if n != 4 {
			t.Fatalf("tenant row count: want 4, got %d", n)
		}

		// Spot-check Story: scope=work, source=tenant, library_layer_id=NULL.
		var (
			gotScope, gotSource, gotName string
			gotLibID                     *uuid.UUID
			gotLibTag                    *string
		)
		if err := tx.QueryRow(ctx, `
			SELECT scope, source, name, library_layer_id, library_layer_tag
			  FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work' AND prefix = 'US'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID,
		).Scan(&gotScope, &gotSource, &gotName, &gotLibID, &gotLibTag); err != nil {
			t.Fatalf("load Story tenant row: %v", err)
		}
		if gotScope != "work" {
			t.Errorf("scope: want work, got %q", gotScope)
		}
		if gotSource != "tenant" {
			t.Errorf("source: want tenant, got %q", gotSource)
		}
		if gotName != "Story" {
			t.Errorf("name: want Story, got %q", gotName)
		}
		if gotLibID != nil {
			t.Errorf("library_layer_id: want NULL, got %v", gotLibID)
		}
		if gotLibTag != nil {
			t.Errorf("library_layer_tag: want NULL, got %v", gotLibTag)
		}

		// Phase 2: Story tenant row's parent_type_id resolves to Epic
		// tenant row's id (via prefix EP).
		var epicTenantID uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT id FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work' AND prefix = 'EP'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID).Scan(&epicTenantID); err != nil {
			t.Fatalf("load Epic tenant id: %v", err)
		}
		var storyParent *uuid.UUID
		if err := tx.QueryRow(ctx, `
			SELECT parent_type_id FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work' AND prefix = 'US'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID).Scan(&storyParent); err != nil {
			t.Fatalf("load Story parent: %v", err)
		}
		if storyParent == nil {
			t.Fatalf("Story parent_type_id: want %s, got NULL", epicTenantID)
		}
		if *storyParent != epicTenantID {
			t.Errorf("Story parent_type_id: want %s, got %s", epicTenantID, *storyParent)
		}

		// Sanity: tenant Epic id is NOT the same as system Epic id —
		// the writer copied, didn't alias.
		if epicTenantID == systemIDs["EP"] {
			t.Errorf("Epic tenant id == system id (%s); writer aliased instead of copying", epicTenantID)
		}
	})
}

func TestWriteWorkArtefactTypes_Idempotent(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	subscriptionID := uuid.New()
	workspaceID := uuid.New()

	runIntegratedVATx(t, ctx, pool, func(tx pgx.Tx) {
		seedSystemWorkTypes(t, ctx, tx, subscriptionID, false)

		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			t.Fatalf("first write: %v", err)
		}
		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			t.Fatalf("second write: %v", err)
		}

		var n int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 4 {
			t.Errorf("idempotent: want 4 tenant rows, got %d", n)
		}
	})
}

func TestWriteWorkArtefactTypes_PreservesUserEdits(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	subscriptionID := uuid.New()
	workspaceID := uuid.New()

	runIntegratedVATx(t, ctx, pool, func(tx pgx.Tx) {
		seedSystemWorkTypes(t, ctx, tx, subscriptionID, false)

		// First write: tenant copies created.
		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			t.Fatalf("first write: %v", err)
		}

		// Tenant customises the Story name.
		if _, err := tx.Exec(ctx, `
			UPDATE artefacts_types SET name = 'User Story (custom)'
			 WHERE workspace_id = $1 AND scope = 'work' AND prefix = 'US'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID,
		); err != nil {
			t.Fatalf("user customisation: %v", err)
		}

		// Re-run writer — must not overwrite the user edit.
		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			t.Fatalf("second write: %v", err)
		}

		var name string
		if err := tx.QueryRow(ctx, `
			SELECT name FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work' AND prefix = 'US'
			   AND source = 'tenant' AND archived_at IS NULL`,
			workspaceID).Scan(&name); err != nil {
			t.Fatalf("reload Story name: %v", err)
		}
		if name != "User Story (custom)" {
			t.Errorf("user edit clobbered: want 'User Story (custom)', got %q", name)
		}
	})
}

func TestWriteWorkArtefactTypes_HandlesEmptySeed(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx := context.Background()
	subscriptionID := uuid.New() // fresh sub: zero system rows for it
	workspaceID := uuid.New()

	runIntegratedVATx(t, ctx, pool, func(tx pgx.Tx) {
		// Deliberately do NOT seed.
		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			t.Fatalf("empty-seed writer: want nil, got %v", err)
		}

		var n int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM artefacts_types
			 WHERE workspace_id = $1 AND scope = 'work'`,
			workspaceID).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 0 {
			t.Errorf("empty-seed: want 0 rows, got %d", n)
		}
	})
}
