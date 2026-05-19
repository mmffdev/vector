package portfoliomodels

// PLA-0026 / Story 00497 (B8): integration test for the re-adoption
// flow. Hits the live vector_artefacts DB via the tunnel on :5435.
// Coverage:
//   - happy path: insert one strategy type + one work type in workspace
//     W; insert a strategy artefact under the strategy type; insert a
//     work artefact whose parent points at the strategy artefact.
//     runReadoption must:
//       (a) insert exactly one is_placeholder=TRUE strategy type for W
//       (b) insert exactly one strategy artefact pointing at that type
//       (c) UPDATE the work artefact's parent_artefact_id to the
//           placeholder artefact (NOT NULL invariant preserved)
//       (d) DELETE the original strategy artefact
//       (e) soft-archive the original strategy artefact_type
//   - idempotency: re-running runReadoption is a no-op (still one
//     placeholder, still one placeholder artefact, work artefact still
//     parented to the placeholder)
//
// Test cleans up its own fixtures via prefix tagging in the workspace
// id (random uuid per test run) and does not depend on existing data.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestRunReadoption_HappyPath(t *testing.T) {
	pool := vaTestPool(t)
	defer pool.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	subID := uuid.New()
	wsID := uuid.New()
	userID := uuid.New()

	// ── Seed: a default priority for the workspace (artefacts now
	//    require a non-null priority_id), one OLD strategy type, one OLD
	//    strategy artefact, one work type, one work artefact whose
	//    parent is the strategy artefact. All in the same fresh
	//    workspace, so nothing else on the dev DB collides.
	var (
		priorityID                               uuid.UUID
		oldStrategyTypeID, oldStrategyArtefactID uuid.UUID
		workTypeID, workArtefactID               uuid.UUID
	)
	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO artefact_priorities (workspace_id, name, sort_order)
			VALUES ($1, 'Medium', 0) RETURNING id`, wsID,
		).Scan(&priorityID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO artefacts_types (
				artefacts_types_id_subscription, artefacts_types_id_workspace,
				artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix,
				artefacts_types_allows_children, artefacts_types_sort_order, artefacts_types_is_placeholder
			) VALUES ($1, $2, 'strategy', 'tenant', 'OldRoot', 'OLD',
			          TRUE, 0, FALSE)
			RETURNING artefacts_types_id`, subID, wsID).Scan(&oldStrategyTypeID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO artefacts_types (
				artefacts_types_id_subscription, artefacts_types_id_workspace,
				artefacts_types_scope, artefacts_types_source, artefacts_types_name, artefacts_types_prefix,
				artefacts_types_allows_children, artefacts_types_sort_order, artefacts_types_is_placeholder
			) VALUES ($1, $2, 'work', 'tenant', 'OldStory', 'OST',
			          FALSE, 0, FALSE)
			RETURNING artefacts_types_id`, subID, wsID).Scan(&workTypeID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO artefacts (
				subscription_id, workspace_id,
				artefact_type_id, number, title,
				parent_artefact_id, position, priority_id
			) VALUES ($1, $2, $3, 1, 'Old root artefact', NULL, 0, $4)
			RETURNING id`,
			subID, wsID, oldStrategyTypeID, priorityID,
		).Scan(&oldStrategyArtefactID); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO artefacts (
				subscription_id, workspace_id,
				artefact_type_id, number, title,
				parent_artefact_id, position, priority_id
			) VALUES ($1, $2, $3, 1, 'Story under old root', $4, 0, $5)
			RETURNING id`,
			subID, wsID, workTypeID, oldStrategyArtefactID, priorityID,
		).Scan(&workArtefactID); err != nil {
			return err
		}
		return nil
	})

	// Cleanup at end: delete artefacts then artefacts_types then priorities for this ws.
	t.Cleanup(func() {
		c, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(c, `DELETE FROM artefacts WHERE workspace_id = $1`, wsID)
		_, _ = pool.Exec(c, `DELETE FROM artefacts_types WHERE artefacts_types_id_workspace = $1`, wsID)
		_, _ = pool.Exec(c, `DELETE FROM artefact_priorities WHERE workspace_id = $1`, wsID)
	})

	// ── Run the re-adoption flow.
	var placeholderTypeID, placeholderArtefactID uuid.UUID
	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		var err error
		placeholderTypeID, placeholderArtefactID, err = runReadoption(ctx, tx, subID, wsID, userID)
		return err
	})

	if placeholderTypeID == uuid.Nil || placeholderArtefactID == uuid.Nil {
		t.Fatalf("expected non-nil placeholder ids; got type=%v artefact=%v",
			placeholderTypeID, placeholderArtefactID)
	}

	// (a) exactly one is_placeholder=TRUE type for this workspace.
	var ct int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1
		   AND artefacts_types_is_placeholder = TRUE
		   AND artefacts_types_archived_at IS NULL`, wsID).Scan(&ct); err != nil {
		t.Fatalf("count placeholder types: %v", err)
	}
	if ct != 1 {
		t.Fatalf("expected 1 live placeholder type, got %d", ct)
	}

	// (b) exactly one strategy artefact under the placeholder type.
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts
		 WHERE workspace_id = $1
		   AND artefact_type_id = $2
		   AND archived_at IS NULL`, wsID, placeholderTypeID).Scan(&ct); err != nil {
		t.Fatalf("count placeholder artefacts: %v", err)
	}
	if ct != 1 {
		t.Fatalf("expected 1 placeholder artefact, got %d", ct)
	}

	// (c) work artefact must now point at the placeholder artefact
	//     (NOT NULL invariant preserved).
	var actualParent *uuid.UUID
	if err := pool.QueryRow(ctx, `
		SELECT parent_artefact_id FROM artefacts WHERE id = $1`,
		workArtefactID,
	).Scan(&actualParent); err != nil {
		t.Fatalf("read repointed work artefact: %v", err)
	}
	if actualParent == nil {
		t.Fatalf("work artefact parent_artefact_id is NULL — re-adoption broke the invariant")
	}
	if *actualParent != placeholderArtefactID {
		t.Fatalf("expected work artefact parent=%v, got %v",
			placeholderArtefactID, *actualParent)
	}

	// (d) original strategy artefact deleted.
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts WHERE id = $1`,
		oldStrategyArtefactID,
	).Scan(&ct); err != nil {
		t.Fatalf("count old strategy artefact: %v", err)
	}
	if ct != 0 {
		t.Fatalf("expected old strategy artefact deleted, found %d row(s)", ct)
	}

	// (e) original strategy artefact_type soft-archived.
	var archivedAt *time.Time
	if err := pool.QueryRow(ctx, `
		SELECT artefacts_types_archived_at FROM artefacts_types WHERE artefacts_types_id = $1`,
		oldStrategyTypeID,
	).Scan(&archivedAt); err != nil {
		t.Fatalf("read old strategy type: %v", err)
	}
	if archivedAt == nil {
		t.Fatalf("expected old strategy type soft-archived, archived_at is NULL")
	}

	// Idempotency: rerun is a no-op.
	var phType2, phArt2 uuid.UUID
	runInVATx(t, ctx, pool, func(tx pgx.Tx) error {
		var err error
		phType2, phArt2, err = runReadoption(ctx, tx, subID, wsID, userID)
		return err
	})
	if phType2 != placeholderTypeID {
		t.Fatalf("idempotency: placeholder type id changed: %v → %v", placeholderTypeID, phType2)
	}
	if phArt2 != placeholderArtefactID {
		t.Fatalf("idempotency: placeholder artefact id changed: %v → %v", placeholderArtefactID, phArt2)
	}
	// Still exactly one live placeholder type.
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM artefacts_types
		 WHERE artefacts_types_id_workspace = $1 AND artefacts_types_is_placeholder = TRUE AND artefacts_types_archived_at IS NULL`,
		wsID).Scan(&ct); err != nil {
		t.Fatalf("count placeholder types (rerun): %v", err)
	}
	if ct != 1 {
		t.Fatalf("idempotency: expected 1 live placeholder type after rerun, got %d", ct)
	}
}

func TestRunReadoption_RejectsZeroIDs(t *testing.T) {
	ctx := context.Background()
	pool := vaTestPool(t)
	defer pool.Close()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	if _, _, err := runReadoption(ctx, tx, uuid.Nil, uuid.New(), uuid.New()); err == nil {
		t.Fatalf("expected error for nil subscription_id")
	}
	if _, _, err := runReadoption(ctx, tx, uuid.New(), uuid.Nil, uuid.New()); err == nil {
		t.Fatalf("expected error for nil workspace_id")
	}
}
