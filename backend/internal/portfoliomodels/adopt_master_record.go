package portfoliomodels

// PLA-0026 / Story 00495 (B6): adoption-saga finalize-step writer —
// upsert the master_record_portfolios row for this workspace.
//
// Called at saga step 7 (finalize), AFTER the per-step VA writers have
// committed (B3–B5). One row per workspace; absence means "no model
// adopted". The row carries a *copy* of the library template's prose
// (model_name + model_description) so it survives library-template
// deletion (R047 §6).
//
// Writer-boundary contract: master_record_portfolios writes MUST go
// through portfolio.Service (sole writer for that table; lint:
// writer-boundary). This file calls portfolio.Service.Upsert and
// performs no direct SQL against master_record_portfolios.
//
// Tx semantics: portfolio.Service.Upsert runs against the
// vector_artefacts pool directly (not a passed-in tx). That is
// deliberate and correct here — the upsert is idempotent on the
// (workspace_id) PK with `ON CONFLICT (workspace_id) DO UPDATE` (see
// master_record_service.go), so a retry that re-runs the finalize step
// converges to the same row. Wrapping it in the saga's vaTx would
// require a parallel UpsertInTx surface on the service for one writer
// only; the cost (extra service surface + more code paths to test)
// outweighed the benefit (single idempotent statement). Documented in
// the report-out so reviewers see the trade-off.
//
// Workspace identity (name, description, owner) is intentionally NOT
// duplicated here — that lives in mmff_vector.workspaces (R047 §6).

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/portfolio"
)

// writeMasterRecordPortfolio upserts the master_record_portfolios row
// for this workspace. Called at saga step 7 (finalize), AFTER the
// per-step VA writers have committed. Copies model_name +
// model_description from the library bundle so the row survives
// library-template deletion (R047 §6).
//
// Uses portfolio.Service.Upsert as the sole writer (lint:
// writer-boundary). Workspace identity (name, description, owner)
// is intentionally NOT duplicated here — it lives in
// mmff_vector.workspaces.
//
// vaTx parameter is accepted for signature parity with the other VA
// step writers (writeStrategyArtefactTypes etc.) but intentionally
// unused: the call goes through portfolio.Service which holds its own
// pool reference. See package-doc above for rationale.
func writeMasterRecordPortfolio(
	ctx context.Context,
	vaTx pgx.Tx,
	svc *portfolio.Service,
	workspaceID, modelID, adoptedByUserID uuid.UUID,
	bundle *librarydb.Bundle,
) error {
	_ = vaTx // see doc-comment

	// Defensive validation. portfolio.Service.Upsert revalidates
	// workspace_id + model_name; we surface clearer messages here for
	// inputs the saga is responsible for resolving (modelID,
	// adoptedByUserID).
	if workspaceID == uuid.Nil {
		return fmt.Errorf("upsert master_record_portfolios: workspace_id is required")
	}
	if modelID == uuid.Nil {
		return fmt.Errorf("upsert master_record_portfolios: model_id is required")
	}
	if adoptedByUserID == uuid.Nil {
		return fmt.Errorf("upsert master_record_portfolios: adopted_by_user_id is required (R047 §6)")
	}
	if svc == nil {
		return fmt.Errorf("upsert master_record_portfolios: master record service not configured")
	}
	if bundle == nil {
		return fmt.Errorf("upsert master_record_portfolios: bundle is required")
	}

	in := portfolio.UpsertInput{
		WorkspaceID:      workspaceID,
		ModelID:          &modelID,
		ModelName:        bundle.Model.Name,
		ModelDescription: bundle.Model.Description,
		AdoptedByUserID:  &adoptedByUserID,
	}
	if _, err := svc.Upsert(ctx, in); err != nil {
		return fmt.Errorf("upsert master_record_portfolios: %w", err)
	}
	return nil
}
