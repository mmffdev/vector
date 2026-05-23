// Re-sync — narrow path that re-runs the strategy + work-type writers
// against an already-adopted workspace without firing the full saga.
//
// Why this exists: the main Adopt() short-circuits when the same model
// is already adopted (status='completed'), so changes to the writers'
// SQL — e.g. new columns like layer_depth — never reach existing rows
// without a destructive re-adoption. Resync gives padmin a safe button:
// re-runs ONLY the type writers (idempotent inserts + their UPDATE
// passes), leaves flows / states / master record / state row untouched.
//
// Permission gating happens at the HTTP layer (mirrors /artefact-types
// PATCH; padmin is the de-facto floor today).

package portfoliomodels

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// ResyncResult is the wire shape returned by POST /_site/artefact-types/resync.
type ResyncResult struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	ModelID     uuid.UUID `json:"model_id"`
}

// Resync re-runs strategy + work-type writers for the caller's
// workspace using the model recorded in the active adoption state.
//
// Errors:
//   - ErrNoActiveAdoption — no completed adoption exists; caller must adopt first.
//   - any DB / writer error — surfaced verbatim for the handler to wrap.
func (o *Orchestrator) Resync(
	ctx context.Context,
	subscriptionID uuid.UUID,
) (*ResyncResult, error) {
	if o.VAPool == nil {
		return nil, ErrVAUnavailable
	}

	workspaceID, err := o.resolveWorkspaceID(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("resync: resolve workspace_id: %w", err)
	}
	if workspaceID == uuid.Nil {
		return nil, ErrNoActiveAdoption
	}

	// master_record_portfolios is the authoritative "what model did this
	// workspace adopt" table. artefacts_adoption_states is intentionally
	// not consulted: it may be archived or absent on legacy tenants that
	// adopted before that state table existed, but master_record persists
	// for every adopted workspace.
	var modelID uuid.UUID
	if err := o.VAPool.QueryRow(ctx, sqlSelectAdoptedModelForWorkspace, workspaceID).Scan(&modelID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoActiveAdoption
		}
		return nil, fmt.Errorf("resync: load adopted model: %w", err)
	}

	// Open the library snapshot the same way Adopt does — REPEATABLE READ
	// + READ ONLY for a stable view across the saga's two writers.
	libTx, err := o.LibRO.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return nil, fmt.Errorf("resync: open library snapshot: %w", err)
	}
	defer libTx.Rollback(ctx)

	bundle, err := librarydb.FetchTemplateByID(ctx, o.LibRO, modelID)
	if err != nil {
		return nil, fmt.Errorf("resync: fetch bundle: %w", err)
	}

	// Both writers run in one VA tx — atomic from the caller's POV.
	if err := o.runVAStep(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if err := writeStrategyArtefactTypes(ctx, tx, subscriptionID, workspaceID, bundle); err != nil {
			return fmt.Errorf("strategy writer: %w", err)
		}
		if err := writeWorkArtefactTypes(ctx, tx, subscriptionID, workspaceID); err != nil {
			return fmt.Errorf("work writer: %w", err)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	return &ResyncResult{
		WorkspaceID: workspaceID,
		ModelID:     modelID,
	}, nil
}

// ErrNoActiveAdoption — Resync was called on a workspace that has no
// completed adoption to re-sync from. Handler maps to 409.
var ErrNoActiveAdoption = errors.New("no active adoption to resync")

// ──────────────────────────────────────────────────────────────────
// HTTP handler
// ──────────────────────────────────────────────────────────────────

// ResyncHandler — POST /_site/artefact-types/resync
type ResyncHandler struct {
	Orchestrator *Orchestrator
}

func NewResyncHandler(libRO, vectorPool, vaPool *pgxpool.Pool) *ResyncHandler {
	return &ResyncHandler{Orchestrator: NewOrchestrator(libRO, vectorPool, vaPool, nil)}
}

func (h *ResyncHandler) Resync(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	res, err := h.Orchestrator.Resync(r.Context(), u.SubscriptionID)
	if err != nil {
		switch {
		case errors.Is(err, ErrNoActiveAdoption):
			http.Error(w, `{"code":"NO_ACTIVE_ADOPTION"}`, http.StatusConflict)
		case errors.Is(err, ErrVAUnavailable):
			http.Error(w, `{"code":"VA_UNAVAILABLE"}`, http.StatusServiceUnavailable)
		default:
			log.Printf("portfoliomodels.Resync: %v", err)
			http.Error(w, `{"code":"RESYNC_FAILED"}`, http.StatusInternalServerError)
		}
		return
	}
	writeJSON(w, http.StatusOK, res)
}
