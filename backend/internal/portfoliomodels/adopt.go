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
//   4. Final step flips `subscription_portfolio_model_state.status` to
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
//   Migration 026's `subscription_portfolio_model_state` row has no
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
)

// Adoption error codes — must match the seed in
// `db/library_schema/008_error_codes.sql`. Validation that each code is
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
// the switch in runSteps.
var stepOrder = []string{
	stepValidate,
	stepLayers,
	stepWorkflows,
	stepTransitions,
	stepArtifacts,
	stepTerminology,
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
}

// NewOrchestrator builds the adopt orchestrator.
func NewOrchestrator(libRO, vectorPool *pgxpool.Pool) *Orchestrator {
	return &Orchestrator{LibRO: libRO, VectorPool: vectorPool}
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

	// ── Idempotency check (BEFORE opening any tx) ────────────────
	// Migration 026's partial unique index keeps at most one
	// non-terminal (pending|in_progress|completed) row per
	// subscription. Failed/rolled_back rows are audit-only and do
	// not block a fresh attempt.
	existingState, err := o.loadActiveState(ctx, subscriptionID)
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
			// Different model already adopted → conflict. The Phase
			// 4 plan (§11) covers re-adoption via three-way merge,
			// which is out of scope for this card.
			return nil, errAlreadyAdopted{currentModel: existingState.ModelID}
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
				if err := o.archiveStaleFailedRow(ctx, existingState.ID); err != nil {
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
			if err := o.resetFailedToInProgress(ctx, existingState.ID); err != nil {
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
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, stepValidate, err, codeAdoptInternal)
	}

	bundle, err := librarydb.FetchByModelID(ctx, o.LibRO, modelID)
	// FetchByModelID opens its own short tx and commits — that's
	// fine; our libTx is the snapshot guarantee for re-reads inside
	// later steps. If the row was archived between our existence
	// check and now, FetchByModelID returns ErrBundleNotFound.
	if errors.Is(err, librarydb.ErrBundleNotFound) {
		hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, stepValidate, err, codeAdoptBundleNotFound)
	}
	if err != nil {
		hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, stepValidate, err, codeAdoptInternal)
	}

	// Pin the state row: either reuse the resumed row, or insert a
	// fresh `in_progress` row. Done in its own tenant tx so the
	// sentinel exists before any mirror write.
	stateID := uuid.UUID{}
	if existingState != nil {
		stateID = existingState.ID
	} else {
		newID, err := o.insertPendingState(ctx, subscriptionID, userID, modelID)
		if err != nil {
			hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end", Err: err})
			return nil, o.failSagaNoState(ctx, subscriptionID, userID, modelID, requestID, stepValidate, err, codeAdoptInternal)
		}
		stateID = newID
	}

	hook(ctx, StepEvent{Index: 0, Name: stepValidate, Phase: "end"})

	// ── Steps 2..6: mirror writes, each in its own tenant tx ────
	libVersion := bundle.Model.Version
	mirrorSteps := []struct {
		name string
		fn   func(ctx context.Context, tx pgx.Tx) error
	}{
		{stepLayers, func(ctx context.Context, tx pgx.Tx) error {
			return o.writeLayers(ctx, tx, subscriptionID, bundle, libVersion)
		}},
		{stepWorkflows, func(ctx context.Context, tx pgx.Tx) error {
			return o.writeWorkflows(ctx, tx, subscriptionID, bundle, libVersion)
		}},
		{stepTransitions, func(ctx context.Context, tx pgx.Tx) error {
			return o.writeTransitions(ctx, tx, subscriptionID, bundle, libVersion)
		}},
		{stepArtifacts, func(ctx context.Context, tx pgx.Tx) error {
			return o.writeArtifacts(ctx, tx, subscriptionID, bundle, libVersion)
		}},
		{stepTerminology, func(ctx context.Context, tx pgx.Tx) error {
			return o.writeTerminology(ctx, tx, subscriptionID, bundle, libVersion)
		}},
	}

	for i, step := range mirrorSteps {
		idx := i + 1 // stepValidate is index 0

		hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "start"})

		if opts.FailAtStep == step.name {
			err := errSimInjected{step: step.name}
			hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "end", Err: err})
			return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, step.name, err, mirrorErrCode(step.name))
		}

		if err := o.runMirrorStep(ctx, step.fn); err != nil {
			hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "end", Err: err})
			return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, step.name, err, mirrorErrCode(step.name))
		}

		hook(ctx, StepEvent{Index: idx, Name: step.name, Phase: "end"})
	}

	// ── Step 7: finalize — flip state row to `completed` ────────
	finalizeIdx := len(stepOrder) - 1
	hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "start"})

	if opts.FailAtStep == stepFinalize {
		err := errSimInjected{step: stepFinalize}
		hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, stepFinalize, err, codeAdoptInternal)
	}

	adoptedAt, err := o.markCompleted(ctx, stateID, userID)
	if err != nil {
		hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end", Err: err})
		return nil, o.failSaga(ctx, subscriptionID, userID, modelID, requestID, stepFinalize, err, codeAdoptInternal)
	}
	hook(ctx, StepEvent{Index: finalizeIdx, Name: stepFinalize, Phase: "end"})

	return &AdoptionResult{
		StateID:   stateID,
		ModelID:   modelID,
		Status:    "completed",
		AdoptedAt: adoptedAt,
	}, nil
}

// runMirrorStep wraps one mirror-table write in a fresh SERIALIZABLE
// tenant tx. Per AC: each step commits atomically.
func (o *Orchestrator) runMirrorStep(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := o.VectorPool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return fmt.Errorf("begin tenant tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tenant tx: %w", err)
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────
// State-row helpers (mmff_vector.subscription_portfolio_model_state)
// ──────────────────────────────────────────────────────────────────

type stateRow struct {
	ID        uuid.UUID
	ModelID   uuid.UUID
	Status    string
	AdoptedAt time.Time
}

// loadActiveState returns the live (archived_at IS NULL) state row for
// this subscription if any, otherwise nil. The partial unique index
// (migration 026) guarantees at most one such row per subscription.
func (o *Orchestrator) loadActiveState(ctx context.Context, subscriptionID uuid.UUID) (*stateRow, error) {
	var s stateRow
	err := o.VectorPool.QueryRow(ctx, `
		SELECT id, adopted_model_id, status, adopted_at
		  FROM subscription_portfolio_model_state
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 1`,
		subscriptionID,
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
	subscriptionID, userID, modelID uuid.UUID,
) (uuid.UUID, error) {
	var id uuid.UUID
	err := o.VectorPool.QueryRow(ctx, `
		INSERT INTO subscription_portfolio_model_state
		    (subscription_id, adopted_model_id, adopted_by_user_id, status)
		VALUES ($1, $2, $3, 'in_progress')
		RETURNING id`,
		subscriptionID, modelID, userID,
	).Scan(&id)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("insert state row: %w", err)
	}
	return id, nil
}

// archiveStaleFailedRow soft-archives a failed row for a *different*
// model so the partial unique index (archived_at IS NULL) admits a
// fresh row for the newly-selected model.
func (o *Orchestrator) archiveStaleFailedRow(ctx context.Context, stateID uuid.UUID) error {
	_, err := o.VectorPool.Exec(ctx, `
		UPDATE subscription_portfolio_model_state
		   SET archived_at = NOW()
		 WHERE id = $1
		   AND status = 'failed'
		   AND archived_at IS NULL`,
		stateID,
	)
	if err != nil {
		return fmt.Errorf("archive stale failed row: %w", err)
	}
	return nil
}

// resetFailedToInProgress flips a previously-failed row back to
// in_progress so the partial unique index admits the resumed saga.
// Called only when a prior attempt for the *same* model_id failed.
func (o *Orchestrator) resetFailedToInProgress(ctx context.Context, stateID uuid.UUID) error {
	_, err := o.VectorPool.Exec(ctx, `
		UPDATE subscription_portfolio_model_state
		   SET status = 'in_progress'
		 WHERE id = $1
		   AND status = 'failed'
		   AND archived_at IS NULL`,
		stateID,
	)
	if err != nil {
		return fmt.Errorf("reset failed state: %w", err)
	}
	return nil
}

// markCompleted flips the state row to `completed`, stamps adopted_at +
// adopted_by_user_id, returns the timestamp.
func (o *Orchestrator) markCompleted(ctx context.Context, stateID, userID uuid.UUID) (time.Time, error) {
	var ts time.Time
	err := o.VectorPool.QueryRow(ctx, `
		UPDATE subscription_portfolio_model_state
		   SET status = 'completed',
		       adopted_by_user_id = $2,
		       adopted_at = NOW()
		 WHERE id = $1
		 RETURNING adopted_at`,
		stateID, userID,
	).Scan(&ts)
	if err != nil {
		return time.Time{}, fmt.Errorf("mark completed: %w", err)
	}
	return ts, nil
}

// markFailed flips the state row to `failed`. Best-effort: if this
// fails too, we log via the error caller — there's no further state to
// roll back.
func (o *Orchestrator) markFailed(ctx context.Context, stateID uuid.UUID) {
	_, _ = o.VectorPool.Exec(ctx, `
		UPDATE subscription_portfolio_model_state
		   SET status = 'failed'
		 WHERE id = $1
		   AND archived_at IS NULL`,
		stateID,
	)
}

// ──────────────────────────────────────────────────────────────────
// Mirror-table writers
//
// Each writer:
//   - inserts every live (archived_at IS NULL) library row's mirror
//   - uses ON CONFLICT … DO NOTHING on the natural-key unique index so
//     a retry after partial failure is a no-op for already-landed rows
//   - returns a map of library_id → mirror_id for the next step's FK
//     resolution (only needed for layers and workflows whose ids feed
//     transitions and workflows respectively)
// ──────────────────────────────────────────────────────────────────

// loadLayerMap returns library_id → mirror_id for every live mirror
// layer in this subscription. Used by the workflows step to resolve
// `layer_id` from the bundle's library uuid into the mirror uuid.
func loadLayerMap(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		SELECT source_library_id, id
		  FROM subscription_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL`,
		subscriptionID,
	)
	if err != nil {
		return nil, fmt.Errorf("load layer map: %w", err)
	}
	defer rows.Close()
	m := make(map[uuid.UUID]uuid.UUID)
	for rows.Next() {
		var libID, mirID uuid.UUID
		if err := rows.Scan(&libID, &mirID); err != nil {
			return nil, fmt.Errorf("scan layer map: %w", err)
		}
		m[libID] = mirID
	}
	return m, rows.Err()
}

// loadWorkflowMap returns library_id → mirror_id for every live mirror
// workflow in this subscription. Used by the transitions step to
// resolve from_state_id / to_state_id.
func loadWorkflowMap(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID) (map[uuid.UUID]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `
		SELECT source_library_id, id
		  FROM subscription_workflows
		 WHERE subscription_id = $1
		   AND archived_at IS NULL`,
		subscriptionID,
	)
	if err != nil {
		return nil, fmt.Errorf("load workflow map: %w", err)
	}
	defer rows.Close()
	m := make(map[uuid.UUID]uuid.UUID)
	for rows.Next() {
		var libID, mirID uuid.UUID
		if err := rows.Scan(&libID, &mirID); err != nil {
			return nil, fmt.Errorf("scan workflow map: %w", err)
		}
		m[libID] = mirID
	}
	return m, rows.Err()
}

func (o *Orchestrator) writeLayers(
	ctx context.Context, tx pgx.Tx,
	subscriptionID uuid.UUID, bundle *librarydb.Bundle, libVersion int32,
) error {
	// Two passes: first insert top-level layers (parent_layer_id IS
	// NULL), then load the lib→mirror map and insert children with
	// translated parent_layer_id. The library returns layers ordered
	// by sort_order/name; we don't rely on that for parent ordering.
	//
	// ON CONFLICT (subscription_id, name) WHERE archived_at IS NULL
	// matches `idx_subscription_layers_name_unique` (migration 029).
	// We use the partial-unique index with `ON CONFLICT … DO NOTHING`
	// — supported by Postgres on a partial unique index when the
	// inserted row matches the predicate (archived_at IS NULL on a
	// fresh insert with default NULL).

	// Pass 1: roots only.
	for _, l := range bundle.Layers {
		if l.ArchivedAt != nil {
			continue
		}
		if l.ParentLayerID != nil {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_layers
			    (subscription_id, source_library_id, source_library_version,
			     name, tag, sort_order, parent_layer_id,
			     icon, colour, description_md, help_md,
			     allows_children, is_leaf)
			VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (subscription_id, name) WHERE archived_at IS NULL DO NOTHING`,
			subscriptionID, l.ID, libVersion,
			l.Name, l.Tag, l.SortOrder,
			l.Icon, l.Colour, l.DescriptionMD, l.HelpMD,
			l.AllowsChildren, l.IsLeaf,
		); err != nil {
			return fmt.Errorf("insert layer (root) %q: %w", l.Name, err)
		}
	}

	// Build library→mirror map after pass 1 so child inserts can
	// translate parent_layer_id.
	layerMap, err := loadLayerMap(ctx, tx, subscriptionID)
	if err != nil {
		return err
	}

	// Pass 2: children.
	for _, l := range bundle.Layers {
		if l.ArchivedAt != nil {
			continue
		}
		if l.ParentLayerID == nil {
			continue
		}
		mirParent, ok := layerMap[*l.ParentLayerID]
		if !ok {
			// Library row points at a parent that isn't live in our
			// mirror — either the library data is inconsistent
			// (parent archived before child) or our pass-1 missed
			// it. Either way we can't satisfy the FK.
			return fmt.Errorf("layer %q references unknown parent_layer_id %s", l.Name, l.ParentLayerID)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_layers
			    (subscription_id, source_library_id, source_library_version,
			     name, tag, sort_order, parent_layer_id,
			     icon, colour, description_md, help_md,
			     allows_children, is_leaf)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			ON CONFLICT (subscription_id, name) WHERE archived_at IS NULL DO NOTHING`,
			subscriptionID, l.ID, libVersion,
			l.Name, l.Tag, l.SortOrder, mirParent,
			l.Icon, l.Colour, l.DescriptionMD, l.HelpMD,
			l.AllowsChildren, l.IsLeaf,
		); err != nil {
			return fmt.Errorf("insert layer (child) %q: %w", l.Name, err)
		}
	}
	return nil
}

func (o *Orchestrator) writeWorkflows(
	ctx context.Context, tx pgx.Tx,
	subscriptionID uuid.UUID, bundle *librarydb.Bundle, libVersion int32,
) error {
	layerMap, err := loadLayerMap(ctx, tx, subscriptionID)
	if err != nil {
		return err
	}
	for _, wf := range bundle.Workflows {
		if wf.ArchivedAt != nil {
			continue
		}
		mirLayer, ok := layerMap[wf.LayerID]
		if !ok {
			return fmt.Errorf("workflow state %q references unknown layer_id %s", wf.StateKey, wf.LayerID)
		}
		// ON CONFLICT (subscription_id, layer_id, state_key) matches
		// `idx_subscription_workflows_state_unique` (migration 029).
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_workflows
			    (subscription_id, source_library_id, source_library_version,
			     layer_id, state_key, state_label, sort_order,
			     is_initial, is_terminal, colour)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (subscription_id, layer_id, state_key) WHERE archived_at IS NULL DO NOTHING`,
			subscriptionID, wf.ID, libVersion,
			mirLayer, wf.StateKey, wf.StateLabel, wf.SortOrder,
			wf.IsInitial, wf.IsTerminal, wf.Colour,
		); err != nil {
			return fmt.Errorf("insert workflow %q: %w", wf.StateKey, err)
		}
	}
	return nil
}

func (o *Orchestrator) writeTransitions(
	ctx context.Context, tx pgx.Tx,
	subscriptionID uuid.UUID, bundle *librarydb.Bundle, libVersion int32,
) error {
	wfMap, err := loadWorkflowMap(ctx, tx, subscriptionID)
	if err != nil {
		return err
	}
	for _, tr := range bundle.Transitions {
		if tr.ArchivedAt != nil {
			continue
		}
		mirFrom, ok := wfMap[tr.FromStateID]
		if !ok {
			return fmt.Errorf("transition references unknown from_state_id %s", tr.FromStateID)
		}
		mirTo, ok := wfMap[tr.ToStateID]
		if !ok {
			return fmt.Errorf("transition references unknown to_state_id %s", tr.ToStateID)
		}
		// ON CONFLICT (subscription_id, from_state_id, to_state_id)
		// matches `idx_subscription_workflow_transitions_pair_unique`.
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_workflow_transitions
			    (subscription_id, source_library_id, source_library_version,
			     from_state_id, to_state_id)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (subscription_id, from_state_id, to_state_id) WHERE archived_at IS NULL DO NOTHING`,
			subscriptionID, tr.ID, libVersion,
			mirFrom, mirTo,
		); err != nil {
			return fmt.Errorf("insert transition %s→%s: %w", mirFrom, mirTo, err)
		}
	}
	return nil
}

func (o *Orchestrator) writeArtifacts(
	ctx context.Context, tx pgx.Tx,
	subscriptionID uuid.UUID, bundle *librarydb.Bundle, libVersion int32,
) error {
	for _, a := range bundle.Artifacts {
		if a.ArchivedAt != nil {
			continue
		}
		var configJSON any
		if len(a.Config) == 0 {
			configJSON = []byte("{}")
		} else {
			configJSON = a.Config
		}
		// ON CONFLICT (subscription_id, artifact_key) matches
		// `idx_subscription_artifacts_key_unique`.
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_artifacts
			    (subscription_id, source_library_id, source_library_version,
			     artifact_key, enabled, config)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (subscription_id, artifact_key) WHERE archived_at IS NULL DO NOTHING`,
			subscriptionID, a.ID, libVersion,
			a.ArtifactKey, a.Enabled, configJSON,
		); err != nil {
			return fmt.Errorf("insert artifact %q: %w", a.ArtifactKey, err)
		}
	}
	return nil
}

func (o *Orchestrator) writeTerminology(
	ctx context.Context, tx pgx.Tx,
	subscriptionID uuid.UUID, bundle *librarydb.Bundle, libVersion int32,
) error {
	for _, t := range bundle.Terminology {
		if t.ArchivedAt != nil {
			continue
		}
		// ON CONFLICT (subscription_id, key) matches
		// `idx_subscription_terminology_key_unique`.
		if _, err := tx.Exec(ctx, `
			INSERT INTO subscription_terminology
			    (subscription_id, source_library_id, source_library_version,
			     key, value)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (subscription_id, key) WHERE archived_at IS NULL DO NOTHING`,
			subscriptionID, t.ID, libVersion,
			t.Key, t.Value,
		); err != nil {
			return fmt.Errorf("insert terminology %q: %w", t.Key, err)
		}
	}
	return nil
}

// ──────────────────────────────────────────────────────────────────
// Failure helpers — flip state, append error_event, build error
// ──────────────────────────────────────────────────────────────────

// failSaga is the unified failure path for any step that occurs after a
// state row has been pinned. Marks the row failed, appends an
// error_event with the matching ADOPT_* code, returns the wrapped
// error to the caller.
func (o *Orchestrator) failSaga(
	ctx context.Context,
	subscriptionID, userID, modelID uuid.UUID,
	requestID string,
	stepName string,
	cause error,
	code string,
) error {
	// Mark the most-recent live state row failed. We re-load by
	// (subscription, model) instead of carrying the id through every
	// helper signature.
	if s, err := o.loadActiveState(ctx, subscriptionID); err == nil && s != nil {
		o.markFailed(ctx, s.ID)
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

// appendErrorEvent inserts one row into mmff_vector.error_events with
// the ADOPT_* code + step / model_id context. Best-effort: if this
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
	_, _ = o.VectorPool.Exec(ctx, `
		INSERT INTO error_events (subscription_id, user_id, code, context, request_id)
		VALUES ($1, $2, $3, $4, $5)`,
		subscriptionID, userID, code, ctxJSON, rid,
	)
}

// mirrorErrCode picks the right ADOPT_* code for a given step. The seed
// in `db/library_schema/008_error_codes.sql` only ships
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

// AdoptHandler holds the orchestrator. Padmin gating is enforced by
// the chi middleware (RequireRole(RolePAdmin)); this handler runs only
// after auth + role.
type AdoptHandler struct {
	Orchestrator *Orchestrator
}

func NewAdoptHandler(libRO, vectorPool *pgxpool.Pool) *AdoptHandler {
	return &AdoptHandler{Orchestrator: NewOrchestrator(libRO, vectorPool)}
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
