// Dev reset handlers — POST /_site/admin/dev/adoption-reset
//                       POST /_site/admin/dev/master-reset
//
// Gadmin-only tools for resetting a subscription's data in dev/staging.
// Hard deletes only — no audit trail for these dev-only operations.
//
// Card 00054 (Phase 5)
package portfoliomodels

import (
	"context"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// DevResetHandler holds both DB pools for dev operations.
type DevResetHandler struct {
	VectorPool *pgxpool.Pool // mmff_vector
	VAPool     *pgxpool.Pool // vector_artefacts (may be nil)
}

func NewDevResetHandler(vectorPool *pgxpool.Pool, vaPool *pgxpool.Pool) *DevResetHandler {
	return &DevResetHandler{VectorPool: vectorPool, VAPool: vaPool}
}

// ResetAdoptionState — POST /_site/admin/dev/adoption-reset
//
// Legacy adoption-only reset: clears mirror tables and portfolio model
// state. Leaves artefacts, topology, workspaces, and master_record_tenant
// untouched. Prefer MasterReset for a full testbed rebuild.
func (h *DevResetHandler) ResetAdoptionState(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if err := h.resetAdoptionTables(r.Context(), u.SubscriptionID); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Portfolio adoption state reset to zero.",
	})
}

// MasterReset — POST /_site/admin/dev/master-reset
//
// Full testbed reset. Clears all tenant data across both DBs and
// re-seeds master_record_tenant + one root topology node.
//
// Cleared (mmff_vector):
//   - master_record_workspaces + roles_workspaces (all workspaces)
//   - o_flow_tenant overrides
//   (mmff_vector.master_record_tenant is vestigial since M2 — not reset here)
//
// Cleared (vector_artefacts):
//   - artefact_adoption_state (per-workspace adoption state)
//
// Cleared (vector_artefacts):
//   - artefact_field_values, artefacts, artefact_number_sequence
//   - tenant artefact_types (source='tenant' only; system rows preserved)
//   - timeboxes_sprints, timeboxes_releases
//   - users_roles_topology_nodes, topology_view_states, topology_nodes
//   - master_record_portfolio
//
// Re-seeded (vector_artefacts):
//   - master_record_tenant: ACME Bank testbed identity
//   - topology_nodes: single root node "ACME Bank"
//
// NOT touched: users, sessions, roles, permissions, pages, nav prefs,
//              subscriptions, tenants, system artefact_types.
func (h *DevResetHandler) MasterReset(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	ctx := r.Context()

	// Part A — vector_artefacts
	if h.VAPool != nil {
		if err := h.masterResetVA(ctx, u.SubscriptionID, u.ID); err != nil {
			http.Error(w, fmt.Sprintf("master-reset (vector_artefacts) failed: %v", err), http.StatusInternalServerError)
			return
		}
	}

	// Part B — mmff_vector
	if err := h.masterResetVector(ctx, u.SubscriptionID); err != nil {
		http.Error(w, fmt.Sprintf("master-reset (mmff_vector) failed: %v", err), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"message": "Master reset complete. Tenant data cleared and testbed defaults applied.",
	})
}

// ─── private ─────────────────────────────────────────────────────────────────

// resetAdoptionTables — adoption-only clear (used by ResetAdoptionState).
//
// PLA-0023 cutover (2026-05-13): all six legacy mmff_vector mirror tables
// have been dropped. Adoption state now lives exclusively on
// vector_artefacts.artefact_adoption_state, so this reset is a single VA
// DELETE. No-op when VAPool is unavailable.
func (h *DevResetHandler) resetAdoptionTables(ctx context.Context, subscriptionID uuid.UUID) error {
	if h.VAPool == nil {
		return nil
	}
	_, err := h.VAPool.Exec(ctx, sqlDeleteAllAdoptionStateForSubscription, subscriptionID)
	return err
}

// masterResetVA clears and re-seeds vector_artefacts for the subscription.
func (h *DevResetHandler) masterResetVA(ctx context.Context, subscriptionID uuid.UUID, ownerUserID uuid.UUID) error {
	// Well-known dev workspace UUID — matches the constant in 010_master_reset.sql.
	// This workspace row is created by the workspace seed; the UUID is stable
	// and agreed with the seed script.
	devWorkspaceID := uuid.MustParse("00000000-0000-0000-0000-000000000010")

	tx, err := h.VAPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 0. Adoption state — must clear before artefact_types since the
	//    PLA-0023 cutover replaced the legacy mmff_vector mirror table.
	if _, err = tx.Exec(ctx, sqlDeleteAllAdoptionStateForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefact_adoption_state: %w", err)
	}

	// 1. Artefact field values (child — delete first).
	if _, err = tx.Exec(ctx, sqlDeleteAllArtefactFieldValuesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefact_field_values: %w", err)
	}

	// 2. Artefacts.
	if _, err = tx.Exec(ctx, sqlDeleteAllArtefactsForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefacts: %w", err)
	}

	// 3. Number sequence counters.
	if _, err = tx.Exec(ctx, sqlDeleteArtefactNumberSequenceForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefact_number_sequence: %w", err)
	}

	// 4. Tenant-authored artefact types (source='tenant' only).
	if _, err = tx.Exec(ctx, sqlDeleteTenantArtefactTypesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("artefact_types: %w", err)
	}

	// 5. Timeboxes.
	if _, err = tx.Exec(ctx, sqlDeleteAllTimeboxSprintsForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("timeboxes_sprints: %w", err)
	}
	if _, err = tx.Exec(ctx, sqlDeleteAllTimeboxReleasesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("timeboxes_releases: %w", err)
	}

	// 6. Topology — clear role grants and view state first, then detach
	//    parent_id self-references before deleting nodes (avoids ON DELETE
	//    RESTRICT firing on the parent_id FK during a cascading delete).
	if _, err = tx.Exec(ctx, sqlDeleteAllTopologyRoleGrantsForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("users_roles_topology_nodes: %w", err)
	}
	if _, err = tx.Exec(ctx, sqlDeleteAllTopologyViewStateForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("topology_view_states: %w", err)
	}
	if _, err = tx.Exec(ctx, sqlDetachTopologyParentsForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("topology_nodes parent detach: %w", err)
	}
	if _, err = tx.Exec(ctx, sqlDeleteAllTopologyNodesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("topology_nodes: %w", err)
	}

	// 7. Master record portfolio (adoption snapshot).
	if _, err = tx.Exec(ctx, sqlDeleteMasterRecordPortfolioForWorkspace, devWorkspaceID); err != nil {
		return fmt.Errorf("master_record_portfolio: %w", err)
	}

	// 8. Upsert master_record_tenant with ACME Bank testbed identity.
	if _, err = tx.Exec(ctx, sqlUpsertTestbedTenantRecord, devWorkspaceID, ownerUserID); err != nil {
		return fmt.Errorf("master_record_tenant upsert: %w", err)
	}

	// 9. Seed root topology node "ACME Bank".
	if _, err = tx.Exec(ctx, sqlInsertTestbedRootTopologyNode, devWorkspaceID, subscriptionID); err != nil {
		return fmt.Errorf("topology root node: %w", err)
	}

	// 10. Re-seed starter strategy artefacts via the SQL function installed by
	//     db/vector_artefacts/schema/052_seed_dev_strategy_artefacts.sql. Safe no-op
	//     if the five strategy artefact_types don't exist (e.g. before the
	//     user has adopted a portfolio model). Idempotent — the seed uses
	//     ON CONFLICT against the unique (subscription_id, type, number) index.
	if _, err = tx.Exec(ctx, sqlSeedDevStrategyArtefactsFn, subscriptionID, devWorkspaceID); err != nil {
		return fmt.Errorf("seed_dev_strategy_artefacts: %w", err)
	}

	return tx.Commit(ctx)
}

// masterResetVector clears tenant data from mmff_vector.
// Note: mmff_vector.master_record_tenant is vestigial (superseded by
// vector_artefacts.master_record_tenant in M2) — not written here.
func (h *DevResetHandler) masterResetVector(ctx context.Context, subscriptionID uuid.UUID) error {
	tx, err := h.VectorPool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// PLA-0023 cutover (2026-05-13): legacy adoption mirror tables on
	// mmff_vector are dropped. Adoption state is cleared via the VA path
	// in masterResetVA above (DELETE FROM artefact_adoption_state). This
	// tx now only handles workspaces + role grants on mmff_vector.

	// Workspace role grants before workspaces (FK child).
	if _, err = tx.Exec(ctx, sqlDeleteRolesWorkspacesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("roles_workspaces: %w", err)
	}

	if _, err = tx.Exec(ctx, sqlDeleteAllWorkspacesForSubscription, subscriptionID); err != nil {
		return fmt.Errorf("master_record_workspaces: %w", err)
	}

	return tx.Commit(ctx)
}
