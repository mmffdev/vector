// Adopt orchestrator — POST /api/portfolio-models/{id}/adopt
//
// Card 00008. Implements the cross-DB adoption saga from
// `dev/planning/feature_library_db_and_portfolio_presets_v3.md` §10–§11:
//
//   1. Open a long-running REPEATABLE READ + READ ONLY library snapshot
//      so every per-step library re-read sees the same rows.
//   2. For each saga step, open a short-lived SERIALIZABLE tenant tx,
//      write that step's mirror table, commit. Per-step atomic, per the
//      AC. We deliberately do NOT batch multiple mirror tables into one
//      tenant tx.
//   3. On failure of step N: rollback that tenant tx, mark the state row
//      `failed`, append an `error_events` row with the matching
//      `ADOPT_*` code, return 500. Library tx is rolled back (read-only,
//      so no effect).
//   4. Final step flips `artefacts_adoption_states.status` to
//      `completed` and stamps adopted_at / adopted_by_user_id.
//
// Idempotency / retry-resume
//
//   The card AC asks for `ON CONFLICT (subscription_id, source_library_id)
//   DO NOTHING` on every mirror insert so a retry that re-runs an
//   already-landed step is a no-op. Migration 029 does NOT carry a unique
//   index on `(subscription_id, source_library_id)` (only a non-unique
//   covering index), so we instead use each mirror table's existing
//   natural-key unique index — `(subscription_id, name)` for layers,
//   `(subscription_id, layer_id, state_key)` for workflows, etc. The
//   end-state is identical: a retry that re-runs every step lands no
//   duplicate rows.
//
//   The `artefacts_adoption_states` row has no
//   `failed_step` / `current_step` / `last_error_code` columns, so we
//   cannot record "resume from step N" telemetry in the DB. Per the
//   card's hard constraint we do NOT add a follow-up migration here;
//   instead "resume from failed step on retry" degenerates into "re-run
//   all steps under the existing idempotent inserts". A flag-and-ask
//   note is included in the report-out for this card.
//
// Hooks for 00009 (SSE) and 00010 (sim harness)
//
//   The orchestrator surfaces step lifecycle through a `StepHook`
//   callback (see type below). 00009 will subscribe with a channel that
//   bridges to an SSE stream; 00010 will subscribe with a hook that can
//   inject a synthetic failure on a chosen step. The orchestrator itself
//   stays transport-agnostic — this Adopt endpoint returns a final
//   status code per the card's "DO NOT add SSE here" hard constraint.
package portfoliomodels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/portfolio"
	"github.com/mmffdev/vector-backend/internal/topology"
)

// Adoption error codes — must match the seed in
// `db/mmff_library/schema/008_error_codes.sql`. Validation that each code is
// present in `mmff_library.error_codes` is the job of
// `errorsreport.codeExists`; here we only enforce spelling against the
// seed by hand-typing the constants.
const (
	codeAdoptBundleNotFound = "ADOPT_BUNDLE_NOT_FOUND"
	codeAdoptStepFailLayers = "ADOPT_STEP_FAIL_LAYERS"
	codeAdoptInternal       = "ADOPT_INTERNAL"
)

// stepName is a short stable identifier for each saga step. Surfaced in
// the StepHook payload, in error_events.context, and in handler logs.
// Order matches the saga's required ordering (parents before children).
const (
	stepValidate    = "validate"
	stepLayers      = "layers"
	stepWorkflows   = "workflows"
	stepTransitions = "transitions"
	stepArtifacts   = "artifacts"
	stepTerminology = "terminology"
	stepFinalize    = "finalize"
)

// stepOrder is the canonical step list. 00010's sim harness will iterate
// this slice and may inject a "fail at step name" hook; 00009's SSE
// stream will emit one event per step boundary. Keep it in sync with
// the vaSteps slice in Adopt().
// SA1 (PLA-0026 2026-05-13): stepTerminology removed — no VA writer
// exists and the legacy mirror table is being dropped (story 00486).
var stepOrder = []string{
	stepValidate,
	stepLayers,
	stepWorkflows,
	stepTransitions,
	stepArtifacts,
	stepFinalize,
}

// StepEvent is the payload passed to a StepHook. `Phase` is "start" or
// "end"; `Err` is non-nil only on "end" of a failed step. `Index` is
// the 0-based position in stepOrder.
type StepEvent struct {
	Index int
	Name  string
	Phase string // "start" | "end"
	Err   error
}

// StepHook is the extension point used by 00009 (SSE) and 00010 (sim
// harness). nil hook is fine — the orchestrator no-ops it. Hooks MUST
// NOT block; SSE will buffer through a channel, sim harness only
// inspects + maybe returns a synthetic error via the harness-only
// `inject` field below.
type StepHook func(ctx context.Context, ev StepEvent)

// AdoptionResult is the JSON shape returned by the handler on success.
// Includes the row id and final state so the caller (UI) can flip its
// banner without a follow-up GET.
type AdoptionResult struct {
	StateID   uuid.UUID `json:"state_id"`
	ModelID   uuid.UUID `json:"model_id"`
	Status    string    `json:"status"`
	AdoptedAt time.Time `json:"adopted_at"`
}

// Orchestrator is the package-level adopt service. Uses the library RO
// pool for snapshot + code-exists validation, the vector pool for
// per-step mirror writes + state row + error_events.
//
// `Refs` is reserved for the cross-DB writer-rules pay-down (TD-LIB-007/
// 008/009) — when the entityrefs service grows a `ValidateLibraryRef`
// method, the orchestrator will call it before each mirror insert.
// Until then we open the library snapshot ourselves.
type Orchestrator struct {
	LibRO      *pgxpool.Pool
	VectorPool *pgxpool.Pool
	// VAPool is the vector_artefacts pool. Optional — when nil the
	// saga skips every dual-write into vector_artefacts and behaves
	// exactly like the pre-PLA-0026 path. Lets dev/staging configs
	// run without the artefacts DB while production cuts over.
	VAPool *pgxpool.Pool
	// ErrorsPool is the destination for appendErrorEvent INSERTs into
	// error_events. PLA-0023 P1 (2026-05-13) moved error_events from
	// mmff_vector to vector_artefacts; NewOrchestrator sets this to
	// VAPool when available, falling back to VectorPool.
	ErrorsPool *pgxpool.Pool
	// MasterRecordSvc is the sole-writer for master_record_portfolios
	// (PLA-0026 B6). Optional — when nil the saga skips the finalize-
	// step master_record upsert. Pair with VAPool: a non-nil VAPool
	// without a MasterRecordSvc will still run B3–B5 but skip B6.
	MasterRecordSvc *portfolio.Service
}

// NewOrchestrator builds the adopt orchestrator. Pass nil for vaPool
// (and/or masterRecordSvc) to disable the PLA-0026 dual-writes
// (legacy-only behaviour).
func NewOrchestrator(libRO, vectorPool, vaPool *pgxpool.Pool, masterRecordSvc *portfolio.Service) *Orchestrator {
	errorsPool := vectorPool
	if vaPool != nil {
		errorsPool = vaPool
	}
	return &Orchestrator{
		LibRO:           libRO,
		VectorPool:      vectorPool,
		VAPool:          vaPool,
		ErrorsPool:      errorsPool,
		MasterRecordSvc: masterRecordSvc,
	}
}

// AdoptOptions lets 00010's sim harness inject a synthetic failure on a
// chosen step. nil/empty values mean "no override" — production callers
// pass a zero AdoptOptions.
type AdoptOptions struct {
	// Hook fires at the start and end of each step. Optional.
	Hook StepHook
	// FailAtStep, if non-empty, makes the orchestrator return a
	// synthetic error at the start of the named step. Used by the
	// 00010 simulation harness only; production callers leave empty.
	FailAtStep string
}

// Adopt runs the saga end-to-end. Returns the final state row on
// success, or an error mapped to an ADOPT_* code. The handler wraps
// this; tests call it directly.
//
// Hard contract for 00009 + 00010:
//   - Steps in `stepOrder`. Hook fires {start,end} per step; on an end
//     event with Err != nil, the saga has already aborted (state row =
//     failed, error_event appended, library tx rolled back).
//   - Each non-validate, non-finalize step writes its mirror table in
//     a fresh tenant tx that commits before the next step begins. A
//     retry of the same (subscription, model) pair re-runs every step
//     under idempotent inserts; partial work from a prior failed
//     attempt is preserved (and not duplicated).
func (o *Orchestrator) Adopt(
	ctx context.Context,
	subscriptionID, userID, modelID uuid.UUID,
	requestID string,
	opts AdoptOptions,
) (*AdoptionResult, error) {
	hook := opts.Hook
	if hook == nil {
		hook = func(context.Context, StepEvent) {}
	}

	// Resolve workspace early — needed for state table routing (SA3).
	// Orphan-sub fixtures have no workspace row; they get uuid.Nil and
	// fall back to the legacy mmff_vector state path below.
	workspaceID, err := o.resolveWorkspaceID(ctx, subscriptionID)
	if err != nil {
		return nil, o.reportInternal(ctx, subscriptionID, userID, requestID, modelID, "", err)
	}

	// PLA-0026 / 00497 (B8): set when the existing-state check below
	// detects a completed adoption to a *different* model. Drives the
	// re-adoption pre-step that inserts the placeholder strategy
	// artefact and repoints orphaned work artefacts before the
	// strategy writer mints the new chain.
	isReadoption := false

	// ── Idempotency check (BEFORE opening any tx) ────────────────
	// SA3 (PLA-0026 2026-05-13): state reads/writes now target
	// vector_artefacts.artefacts_adoption_states (keyed by workspace_id)
	// when VAPool != nil and workspaceID != uuid.Nil. Orphan-sub
	// fixtures still fall back to the mmff_vector predecessor path.
	existingState, err := o.loadActiveState(ctx, subscriptionID, workspaceID)
	if err != nil {
		return nil, o.reportInternal(ctx, subscriptionID, userID, requestID, modelID, "", err)
	}
	if existingState != nil {
		switch existingState.Status {
		case "completed":
			// Same model already adopted → 200-ish no-op. Caller
			// translates this to HTTP 200 with the existing row.
			if existingState.ModelID == modelID {
				return &AdoptionResult{
					StateID:   existingState.ID,
					ModelID:   existingState.ModelID,
					Status:    existingState.Status,
					AdoptedAt: existingState.AdoptedAt,
				}, nil
			}
			// Different model adopted → re-adoption (PLA-0026 / 00497).
			// The placeholder-insert + repoint-orphans flow in
			// runReadoption (adopt_readopt.go) preserves the
			// invariant that work artefacts always have a non-NULL
			// parent. We archive the OLD completed state row so the
			// partial unique index admits a fresh in_progress row for
			// the new model, and flag the saga so the VA pre-step
			// dispatches runReadoption before the strategy writer.
			if err := o.archiveCompletedStateForReadoption(ctx, existingState.ID, workspaceID); err != nil {
				return nil, o.reportInternal(ctx, subscriptionID, userID, requestID, modelID, "", err)
			}
			isReadoption = true
			existingState = nil // treat as a clean slate; insertPendingState below mints a new row
		case "in_progress", "pending":
			// Another saga attempt is mid-flight. Per partial unique
			// index, this should be impossible to race; treat as a
			// 409 to stay safe.
			return nil, errInFlight{}
		case "failed":
			if existingState.ModelID != modelID {
				// Stale failed row is for a different model. Archive it
				// so the partial unique index admits a fresh row for the
				// newly-selected model.
				if err := o.archiveStaleFailedRow(ctx, existingState.ID, workspaceID); err != nil {
					return nil, o.reportInternal(ctx, subscriptionID, userID, requestID, modelID, "", err)
				}
				existingState = nil // treat as a clean slate
				break
			}
			// Resume — re-run all steps under idempotent inserts. We
			// flip the row back to in_progress and reuse its id.
			// (No `failed_step` column exists on migration 026, so we
			// cannot resume from step N; idempotent inserts make a
			// full re-run safe. See package doc.)
			if err := o.resetFailedToInProgress(ctx, existingState.ID, workspaceID); err != nil {
				return nil, o.reportInternal(ctx, subscriptionID, userID, requestID, modelID, "", err)
			}
		}
	}

	// ── Open the long-running library snapshot ──────────────────
	// REPEATABLE READ + READ ONLY: lib row reads are stable across
	// the saga and any post-snapshot library write is invisible to
	// us, which is exactly the semantics §10 calls out for "snapshot
	// before tenant writes".
	libTx, err := o.LibRO.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return nil, o.reportInternal(ctx, subscriptionID, userID, requestID, modelID, stepValidate, err)
	}
	// The defer fires whether we succeed or fail. A read-only tx
	// rollback is a no-op semantically — it just releases the
	// snapshot. The library tx stays open across all steps.
	defer libTx.Rollback(ctx)

	// ── Step 1: validate (also: ensure / pin a state row) ────────
	hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "start"})
	if opts.FailAtStep == stepValidate {
		err := errSimInjected{step: stepValidate}
		hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, stepValidate, err, codeAdoptInternal)
	}

	bundle, err := librarydb.FetchTemplateByID(ctx, o.LibRO, modelID)
	// FetchTemplateByID reads from portfolio_templates (flat JSONB layers).
	// If the template was removed between the list call and now, it returns ErrBundleNotFound.
	if errors.Is(err, librarydb.ErrBundleNotFound) {
		hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, stepValidate, err, codeAdoptBundleNotFound)
	}
	if err != nil {
		hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, stepValidate, err, codeAdoptInternal)
	}

	// Pin the state row: either reuse the resumed row, or insert a
	// fresh `in_progress` row. Done in its own tenant tx so the
	// sentinel exists before any mirror write.
	stateID := uuid.UUID{}
	if existingState != nil {
		stateID = existingState.ID
	} else {
		newID, err := o.insertPendingState(ctx, subscriptionID, userID, modelID, workspaceID)
		if err != nil {
			hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
			return nil, o.failSagaNoState(ctx, subscriptionID, userID, modelID, requestID, stepValidate, err, codeAdoptInternal)
		}
		stateID = newID
	}

	hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end"})

	// ── Steps 2..6: VA writers, each in its own vector_artefacts tx ─
	// SA1 (PLA-0026 2026-05-13): legacy mmff_vector mirror writes
	// (obj_strategy_types_layers, subscription_workflows,
	// subscription_workflow_transitions, subscription_artifacts,
	// subscription_terminology) removed. VA is now the sole write path.
	vaSteps := []struct {
		name string
		fn   func(ctx context.Context, vaTx pgx.Tx) error
	}{
		{stepLayers, func(ctx context.Context, vaTx pgx.Tx) error {
			// B8: re-adoption pre-step inserts placeholder type + artefact,
			// repoints orphan work artefacts, deletes old strategy artefacts,
			// and archives old strategy types — atomically in the same vaTx.
			if isReadoption {
				if _, _, err := runReadoption(ctx, vaTx, subscriptionID, workspaceID, userID); err != nil {
					return err
				}
			}
			return writeStrategyArtefactTypes(ctx, vaTx, subscriptionID, workspaceID, bundle)
		}},
		{stepWorkflows, func(ctx context.Context, vaTx pgx.Tx) error {
			return writeFlowsAndStates(ctx, vaTx, subscriptionID, workspaceID, bundle)
		}},
		{stepTransitions, func(ctx context.Context, vaTx pgx.Tx) error {
			return writeFlowTransitions(ctx, vaTx, subscriptionID, workspaceID, bundle)
		}},
		{stepArtifacts, func(ctx context.Context, vaTx pgx.Tx) error {
			return writeWorkArtefactTypes(ctx, vaTx, subscriptionID, workspaceID)
		}},
		// stepTerminology has no VA writer yet; the legacy table is being
		// dropped (PLA-0026 S1 story 00486). Skip silently for now — no
		// terminology data is stored on the VA substrate.
	}

	for i, step := range vaSteps {
		idx := i + 1 // stepValidate is index 0

		hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "start"})

		if opts.FailAtStep == step.name {
			err := errSimInjected{step: step.name}
			hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "end", Err: err})
			return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, step.name, err, mirrorErrCode(step.name))
		}

		if o.VAPool != nil && workspaceID != uuid.Nil {
			if err := o.runVAStep(ctx, step.fn); err != nil {
				hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "end", Err: err})
				return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, step.name, err, mirrorErrCode(step.name))
			}
		}

		hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "end"})
	}

	// ── Step 7: finalize — flip state row to `completed` ────────
	finalizeIdx := len(stepOrder) - 1
	hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "start"})

	if opts.FailAtStep == stepFinalize {
		err := errSimInjected{step: stepFinalize}
		hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, stepFinalize, err, codeAdoptInternal)
	}

	// PLA-0026 / Story 00495 (B6): upsert master_record_portfolios for
	// this workspace BEFORE markCompleted. The master-record service
	// writes against the VA pool directly (idempotent on workspace_id
	// PK), so a saga retry converges to the same row. No-op when
	// VAPool / MasterRecordSvc / workspaceID are absent (orphan-sub
	// fixtures + tests that exercise only the legacy mirror path).
	if o.VAPool != nil && o.MasterRecordSvc != nil && workspaceID != uuid.Nil {
		if err := writeMasterRecordPortfolio(ctx, nil, o.MasterRecordSvc,
			workspaceID, modelID, userID, bundle); err != nil {
			hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end", Err: err})
			return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, stepFinalize, err, codeAdoptInternal)
		}
	}

	adoptedAt, err := o.markCompleted(ctx, stateID, userID, workspaceID)
	if err != nil {
		hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, workspaceID, requestID, stepFinalize, err, codeAdoptInternal)
	}
	hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end"})

	return &AdoptionResult{
		StateID:   stateID,
		ModelID:   modelID,
		Status:    "completed",
		AdoptedAt: adoptedAt,
	}, nil
}

// resolveWorkspaceID returns the workspace_id for a subscription, or
// uuid.Nil when none exists (orphan-sub fixtures). The PLA-0026 VA
// writes use this to address artefacts_types per workspace; the legacy
// mirror path is unaffected.
//
// Context is checked first: if WorkspaceClampMiddleware has already
// seeded a workspace_id (normal request path), that value is returned
// directly. The DB fallback (first-live-workspace) exists for orphan-sub
// fixtures and pre-clamp callers only.
func (o *Orchestrator) resolveWorkspaceID(ctx context.Context, subscriptionID uuid.UUID) (uuid.UUID, error) {
	if id, ok := topology.WorkspaceIDFromCtx(ctx); ok {
		return id, nil
	}
	var ws uuid.UUID
	err := o.VectorPool.QueryRow(ctx, sqlSelectFirstLiveWorkspaceForSubscription,
		subscriptionID,
	).Scan(&ws)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, nil
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("resolve workspace_id: %w", err)
	}
	return ws, nil
}

// runVAStep wraps one vector_artefacts write in a fresh SERIALIZABLE
// tx on VAPool. Mirrors runMirrorStep's contract — commit on success,
// rollback on failure. Caller has already verified VAPool != nil.
func (o *Orchestrator) runVAStep(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := o.VAPool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("begin va tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit va tx: %w", err)
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────
// State-row helpers (vector_artefacts.artefacts_adoption_states)
// ──────────────────────────────────────────────────────────────────
//
// PLA-0023 cutover (2026-05-13): legacy mmff_vector.subscription_portfolio_model_state
// dropped. VA is the sole adoption-state substrate. workspaceID is required
// — orchestrator callers resolve it before invoking any state helper.

type stateRow struct {
	ID        uuid.UUID
	ModelID   uuid.UUID
	Status    string
	AdoptedAt time.Time
}

// loadActiveState returns the live (archived_at IS NULL) state row for
// this workspace if any, otherwise nil.
func (o *Orchestrator) loadActiveState(ctx context.Context, _ /*subscriptionID*/, workspaceID uuid.UUID) (*stateRow, error) {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return nil, ErrVAUnavailable
	}
	var s stateRow
	err := o.VAPool.QueryRow(ctx, sqlSelectActiveAdoptionState,
		workspaceID,
	).Scan(&s.ID, &s.ModelID, &s.Status, &s.AdoptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load active state: %w", err)
	}
	return &s, nil
}

// insertPendingState writes a fresh `in_progress` row, returning the
// new id. We jump straight to in_progress (skipping `pending`) because
// the saga starts immediately — `pending` is a planned-but-not-started
// state we don't need to surface yet.
func (o *Orchestrator) insertPendingState(
	ctx context.Context,
	subscriptionID, userID, modelID, workspaceID uuid.UUID,
) (uuid.UUID, error) {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return uuid.UUID{}, ErrVAUnavailable
	}
	var id uuid.UUID
	err := o.VAPool.QueryRow(ctx, sqlInsertAdoptionState,
		workspaceID, subscriptionID, modelID, userID,
	).Scan(&id)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("insert state row: %w", err)
	}
	return id, nil
}

// archiveCompletedStateForReadoption soft-archives a previously-
// completed state row when the operator picks a different model
// (PLA-0026 / 00497). The partial unique index keys on
// (workspace_id, archived_at IS NULL), so flipping archived_at to NOW()
// admits a fresh in_progress row for the new model. The historical row
// stays for audit.
func (o *Orchestrator) archiveCompletedStateForReadoption(ctx context.Context, stateID, workspaceID uuid.UUID) error {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return ErrVAUnavailable
	}
	_, err := o.VAPool.Exec(ctx, sqlArchiveCompletedStateForReadoption,
		stateID, workspaceID,
	)
	if err != nil {
		return fmt.Errorf("archive completed state for re-adoption: %w", err)
	}
	return nil
}

// archiveStaleFailedRow soft-archives a failed row for a *different*
// model so the partial unique index (archived_at IS NULL) admits a
// fresh row for the newly-selected model.
func (o *Orchestrator) archiveStaleFailedRow(ctx context.Context, stateID, workspaceID uuid.UUID) error {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return ErrVAUnavailable
	}
	_, err := o.VAPool.Exec(ctx, sqlArchiveStaleFailedAdoptionState,
		stateID, workspaceID,
	)
	if err != nil {
		return fmt.Errorf("archive stale failed row: %w", err)
	}
	return nil
}

// resetFailedToInProgress flips a previously-failed row back to
// in_progress so the partial unique index admits the resumed saga.
// Called only when a prior attempt for the *same* model_id failed.
func (o *Orchestrator) resetFailedToInProgress(ctx context.Context, stateID, workspaceID uuid.UUID) error {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return ErrVAUnavailable
	}
	_, err := o.VAPool.Exec(ctx, sqlResetFailedAdoptionStateToInProgress,
		stateID, workspaceID,
	)
	if err != nil {
		return fmt.Errorf("reset failed state: %w", err)
	}
	return nil
}

// markCompleted flips the state row to `completed`, stamps adopted_at +
// adopted_by_user_id, returns the timestamp.
func (o *Orchestrator) markCompleted(ctx context.Context, stateID, userID, workspaceID uuid.UUID) (time.Time, error) {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return time.Time{}, ErrVAUnavailable
	}
	var ts time.Time
	err := o.VAPool.QueryRow(ctx, sqlMarkAdoptionStateCompleted,
		stateID, userID, workspaceID,
	).Scan(&ts)
	if err != nil {
		return time.Time{}, fmt.Errorf("mark completed: %w", err)
	}
	return ts, nil
}

// markFailed flips the state row to `failed`. Best-effort: if this
// fails too, we log via the error caller — there's no further state to
// roll back.
func (o *Orchestrator) markFailed(ctx context.Context, stateID, workspaceID uuid.UUID) {
	if o.VAPool == nil || workspaceID == uuid.Nil {
		return
	}
	_, _ = o.VAPool.Exec(ctx, sqlMarkAdoptionStateFailed,
		stateID, workspaceID,
	)
}

// ──────────────────────────────────────────────────────────────────
// Failure helpers — flip state, append error_event, build error
// ──────────────────────────────────────────────────────────────────

// failSaga is the unified failure path for any step that occurs after a
// state row has been pinned. Marks the row failed, appends an
// error_event with the matching ADOPT_* code, returns the wrapped
// error to the caller.
// SA3: workspaceID threads through to loadActiveState and markFailed for
// VA routing.
func (o *Orchestrator) failSaga(
	ctx context.Context,
	subscriptionID, userID, modelID, workspaceID uuid.UUID,
	requestID string,
	stepName string,
	cause error,
	code string,
) error {
	if s, err := o.loadActiveState(ctx, subscriptionID, workspaceID); err == nil && s != nil {
		o.markFailed(ctx, s.ID, workspaceID)
	}
	o.appendErrorEvent(ctx, subscriptionID, userID, requestID, code, stepName, modelID, cause)
	return adoptionError{Code: code, Step: stepName, Cause: cause}
}

// failSagaNoState is identical to failSaga but skips the markFailed
// call — used when state row insertion itself failed, so there's
// nothing to flip.
func (o *Orchestrator) failSagaNoState(
	ctx context.Context,
	subscriptionID, userID, modelID uuid.UUID,
	requestID, stepName string,
	cause error, code string,
) error {
	o.appendErrorEvent(ctx, subscriptionID, userID, requestID, code, stepName, modelID, cause)
	return adoptionError{Code: code, Step: stepName, Cause: cause}
}

// reportInternal handles failures that happen BEFORE any saga step has
// been declared (idempotency-check errors etc.). Emits an
// ADOPT_INTERNAL error_event and returns the wrapped error.
func (o *Orchestrator) reportInternal(
	ctx context.Context,
	subscriptionID, userID uuid.UUID,
	requestID string,
	modelID uuid.UUID,
	stepName string,
	cause error,
) error {
	o.appendErrorEvent(ctx, subscriptionID, userID, requestID, codeAdoptInternal, stepName, modelID, cause)
	return adoptionError{Code: codeAdoptInternal, Step: stepName, Cause: cause}
}

// appendErrorEvent inserts one row into error_events with the ADOPT_*
// code + step / model_id context. Writes go to o.ErrorsPool, which is
// vector_artefacts post-PLA-0023-P1 (2026-05-13). Best-effort: if this
// insert fails too, the saga still returns the original error to the
// caller — we don't want a logging failure to mask the real bug.
func (o *Orchestrator) appendErrorEvent(
	ctx context.Context,
	subscriptionID, userID uuid.UUID,
	requestID, code, stepName string,
	modelID uuid.UUID,
	cause error,
) {
	payload := map[string]any{
		"handler":  "portfoliomodels.Adopt",
		"step":     stepName,
		"model_id": modelID.String(),
	}
	if cause != nil {
		// Truncate to keep error_events.context under the documented
		// ~4 KB cap. Most pgx errors are short; this is defensive.
		msg := cause.Error()
		if len(msg) > 1000 {
			msg = msg[:1000]
		}
		payload["detail"] = msg
	}
	ctxJSON, _ := json.Marshal(payload)

	var rid any
	if requestID != "" {
		rid = requestID
	}
	pool := o.ErrorsPool
	if pool == nil {
		pool = o.VectorPool // back-compat for callers that bypass NewOrchestrator
	}
	_, _ = pool.Exec(ctx, sqlInsertErrorEvent,
		subscriptionID, userID, code, ctxJSON, rid,
	)
}

// mirrorErrCode picks the right ADOPT_* code for a given step. The seed
// in `db/mmff_library/schema/008_error_codes.sql` only ships
// ADOPT_STEP_FAIL_LAYERS today; other mirror failures collapse onto
// ADOPT_INTERNAL until per-step codes are added to the seed.
func mirrorErrCode(stepName string) string {
	switch stepName {
	case stepLayers:
		return codeAdoptStepFailLayers
	default:
		return codeAdoptInternal
	}
}

// ──────────────────────────────────────────────────────────────────
// Sentinel errors — translated to HTTP status by the handler
// ──────────────────────────────────────────────────────────────────

type errAlreadyAdopted struct{ currentModel uuid.UUID }

func (e errAlreadyAdopted) Error() string {
	return "already adopted: subscription already has a completed adoption for " + e.currentModel.String()
}

type errInFlight struct{}

func (errInFlight) Error() string { return "another adoption is in progress for this subscription" }

type errSimInjected struct{ step string }

func (e errSimInjected) Error() string { return "sim-harness injected failure at step " + e.step }

// adoptionError is the public error type returned to the handler. Code
// is one of the ADOPT_* strings; Step is the failing step name.
type adoptionError struct {
	Code  string
	Step  string
	Cause error
}

func (e adoptionError) Error() string {
	return e.Code + " (" + e.Step + "): " + e.Cause.Error()
}

func (e adoptionError) Unwrap() error { return e.Cause }

// ──────────────────────────────────────────────────────────────────
// HTTP handler — thin wrapper around Adopt
// ──────────────────────────────────────────────────────────────────

// AdoptHandler holds the orchestrator. Padmin-equivalent gating is
// enforced by the chi middleware (RequirePermission(PortfolioList) —
// PLA-0007); this handler runs only after auth + permission.
type AdoptHandler struct {
	Orchestrator *Orchestrator
}

func NewAdoptHandler(libRO, vectorPool, vaPool *pgxpool.Pool, masterRecordSvc *portfolio.Service) *AdoptHandler {
	return &AdoptHandler{Orchestrator: NewOrchestrator(libRO, vectorPool, vaPool, masterRecordSvc)}
}

// Adopt — POST /api/portfolio-models/{id}/adopt
func (h *AdoptHandler) Adopt(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	modelID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, "invalid model id", http.StatusBadRequest)
		return
	}

	requestID := middleware.GetReqID(r.Context())

	res, err := h.Orchestrator.Adopt(
		r.Context(),
		u.SubscriptionID, u.ID, modelID,
		requestID,
		AdoptOptions{FailAtStep: adoptFailAtStepFromEnv()},
	)
	if err != nil {
		writeAdoptErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// writeAdoptErr maps orchestrator errors to HTTP envelopes. ADOPT_*
// codes are exposed verbatim in the JSON body so the UI can surface
// the user_message from `error_codes` (already cached in the library).
func writeAdoptErr(w http.ResponseWriter, err error) {
	w.Header().Set("Content-Type", "application/json")

	var (
		alreadyAdopted errAlreadyAdopted
		inFlight       errInFlight
		adoptErr       adoptionError
	)

	switch {
	case errors.As(err, &alreadyAdopted):
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"code":             "ADOPT_ALREADY_ADOPTED",
			"current_model_id": alreadyAdopted.currentModel,
		})
	case errors.As(err, &inFlight):
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "ADOPT_IN_FLIGHT"})
	case errors.As(err, &adoptErr):
		status := http.StatusInternalServerError
		if adoptErr.Code == codeAdoptBundleNotFound {
			status = http.StatusNotFound
		}
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"code": adoptErr.Code,
			"step": adoptErr.Step,
		})
	default:
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": codeAdoptInternal})
	}
}
