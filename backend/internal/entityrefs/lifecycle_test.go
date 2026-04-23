package entityrefs

import "testing"

// TestArchiveLifecycle_* are the per-(parent kind × child relationship)
// integration tests required by Phase 3.4 of TD-001 pay-down. Each cell
// would: create a parent, attach a child via the service, archive the
// parent through its real Go handler, assert the child row is gone in
// the same tx.
//
// As of 2026-04-23 NO Go handler exists for ANY of the parent kinds
// listed below — see the registry comment in CleanupChildren. So every
// cell here is t.Skip'd with the canonical message. When a handler
// ships, drop the t.Skip and fill the body following the pattern:
//
//	tx, _ := pool.Begin(ctx); defer tx.Rollback(ctx)
//	parentID := seedParent(t, tx, ...)
//	childID  := svc.InsertEntityStakeholder(ctx, tx, kind, parentID, ...)
//	require(t, archiveHandler.Archive(ctx, tx, parentID))
//	assertNoRow(t, tx, "entity_stakeholders", childID)
//
// The dispatch trigger (migration 013) blocks orphan inserts; these
// tests catch the *other* leak — orphans created by a cleanup omission
// at archive time. Canary TestNoPolymorphicOrphans is the post-deploy
// backstop.

const skipNoHandler = "no archive handler for %s yet — see plan_db_polymorphic_paydown.md 3.3"

func TestArchiveLifecycle_Workspace_Stakeholders(t *testing.T) {
	t.Skipf(skipNoHandler, "workspace")
}

func TestArchiveLifecycle_Portfolio_Stakeholders(t *testing.T) {
	t.Skipf(skipNoHandler, "portfolio")
}

func TestArchiveLifecycle_Portfolio_PageRefs(t *testing.T) {
	t.Skipf(skipNoHandler, "portfolio")
}

func TestArchiveLifecycle_Product_Stakeholders(t *testing.T) {
	t.Skipf(skipNoHandler, "product")
}

func TestArchiveLifecycle_Product_PageRefs(t *testing.T) {
	t.Skipf(skipNoHandler, "product")
}

func TestArchiveLifecycle_CompanyRoadmap_Stakeholders(t *testing.T) {
	// company_roadmap is auto-created and per c_schema.md may never be
	// archived. Kept as a placeholder so if that policy ever changes the
	// cell is already here.
	t.Skipf(skipNoHandler, "company_roadmap")
}

func TestArchiveLifecycle_PortfolioItemTypes_ItemTypeStates(t *testing.T) {
	t.Skipf(skipNoHandler, "portfolio_item_types")
}

func TestArchiveLifecycle_ExecutionItemTypes_ItemTypeStates(t *testing.T) {
	t.Skipf(skipNoHandler, "execution_item_types")
}

// portfolio_item / execution_item parent tables don't exist yet (item
// tables not built per c_polymorphic_writes.md). When they ship, add:
//   TestArchiveLifecycle_PortfolioItem_ItemStateHistory
//   TestArchiveLifecycle_ExecutionItem_ItemStateHistory
// item_state_history is append-only (UPDATE/DELETE rejected by trigger)
// — adding the cleanup call requires either lifting the trigger for
// cleanup-context deletes or a soft-tombstone column.
