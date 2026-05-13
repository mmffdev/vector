// Service-layer hub for the portfoliomodels package (PLA-0039 / Story
// 00530). Hosts all DB I/O for the three HTTP read/write surfaces in
// this package so the corresponding handlers can be DB-free:
//
//	Handler                       — library bundle reads (mmff_library RO)
//	LayersBatchHandler            — live subscription strategy layers (mmff_vector)
//	WorkspaceLayersHandler        — workspace strategy layers (mmff_vector + vector_artefacts)
//
// Architectural target after PLA-0039:
//
//	handler  →  parse + auth + svc.Method() + render
//	service  →  pool ownership + SQL + business invariants
//
// One Service holds all three pools (library RO, mmff_vector,
// vector_artefacts). Each method is keyed off the caller's (subscription
// or workspace) scope so cross-tenant leakage stays impossible.
//
// Validation errors flow as field-level *ValidationError instances so
// handlers can render a 422 envelope without re-running rules.
package portfoliomodels

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// Sentinel errors. Handlers translate these to HTTP statuses.
var (
	// ErrWorkspaceNotFound — workspace does not exist OR is in a
	// different tenant. The two cases are intentionally collapsed so
	// existence is not leaked across tenants.
	ErrWorkspaceNotFound = errors.New("workspace not found")
	// ErrVAUnavailable — vector_artefacts pool not configured.
	ErrVAUnavailable = errors.New("vector_artefacts unavailable")
	// ErrLayerCountMismatch — payload is not the complete set of live
	// layers for the subscription.
	ErrLayerCountMismatch = errors.New("payload size does not match live layer count")
	// ErrLayerUnknown — payload references an id that is not a live
	// layer for this subscription.
	ErrLayerUnknown = errors.New("layer id is not live for this subscription")
)

// FieldViolation is one element of a ValidationError. Mirrors the
// fieldError wire shape used by the legacy handler so the handler can
// render a 422 envelope without re-running rules.
type FieldViolation struct {
	Index   int    `json:"index"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationError aggregates per-row violations produced by
// PatchLiveSubscriptionLayers. Handlers render this as 422 JSON.
type ValidationError struct {
	Violations []FieldViolation
}

func (v *ValidationError) Error() string {
	if len(v.Violations) == 0 {
		return "validation failed"
	}
	return fmt.Sprintf("validation failed (%d violations)", len(v.Violations))
}

// Service holds the pools used by every read/write in this package.
//
// libRO is the mmff_library RO pool (for bundle reads). vectorPool is
// the mmff_vector pool (for subscription layers + workspace tenancy /
// membership). vaPool is the vector_artefacts pool (for workspace
// artefact_types). Any of the three may be nil at boot — methods that
// touch a missing pool surface a sentinel error rather than panicking.
type Service struct {
	libRO      *pgxpool.Pool
	vectorPool *pgxpool.Pool
	vaPool     *pgxpool.Pool
}

// NewService constructs a Service. Any of the pools may be nil; the
// corresponding method group will then return its sentinel error.
func NewService(libRO, vectorPool, vaPool *pgxpool.Pool) *Service {
	return &Service{libRO: libRO, vectorPool: vectorPool, vaPool: vaPool}
}

// WithVAPool attaches the vector_artefacts pool after construction. Used
// at boot so a single Service can be shared across the bundle handler
// (constructed early) and the workspace-layers handler (which needs
// vaPool — wired after the vaPool block in main.go).
func (s *Service) WithVAPool(p *pgxpool.Pool) *Service {
	s.vaPool = p
	return s
}

// ── library bundle reads ────────────────────────────────────────────

// FetchTemplate returns the published bundle for the given template ID.
// Wraps librarydb.FetchTemplateByID so handlers do not import librarydb
// or hold the RO pool directly.
func (s *Service) FetchTemplate(ctx context.Context, templateID uuid.UUID) (*librarydb.Bundle, error) {
	if s.libRO == nil {
		return nil, ErrVAUnavailable
	}
	return librarydb.FetchTemplateByID(ctx, s.libRO, templateID)
}

// ListPublishedModels returns the catalogue of MMFF-published bundles.
// Wraps librarydb.ListPublishedModels for the same reason.
func (s *Service) ListPublishedModels(ctx context.Context) ([]librarydb.ModelSummary, error) {
	if s.libRO == nil {
		return nil, ErrVAUnavailable
	}
	return librarydb.ListPublishedModels(ctx, s.libRO)
}

// ── live subscription layers (mmff_vector.obj_strategy_types_layers) ──

// SubscriptionLayer mirrors the wire shape used by the legacy handler
// (subscriptionLayerDTO). Service returns it directly so the handler
// can JSON-encode without further mapping.
type SubscriptionLayer struct {
	ID              uuid.UUID  `json:"id"`
	SourceLibraryID uuid.UUID  `json:"source_library_id"`
	Name            string     `json:"name"`
	Tag             string     `json:"tag"`
	SortOrder       int32      `json:"sort_order"`
	ParentLayerID   *uuid.UUID `json:"parent_layer_id"`
	Icon            *string    `json:"icon"`
	Colour          *string    `json:"colour"`
	DescriptionMD   *string    `json:"description_md"`
	HelpMD          *string    `json:"help_md"`
	AllowsChildren  bool       `json:"allows_children"`
	IsLeaf          bool       `json:"is_leaf"`
	ArchivedAt      *time.Time `json:"archived_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// LayerPatch is one row of the PATCH payload. Mirrors layerPatchInput
// so the handler can decode straight into Service-owned types.
type LayerPatch struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Tag           string    `json:"tag"`
	SortOrder     int32     `json:"sort_order"`
	DescriptionMD *string   `json:"description_md"`
}

// ListLiveSubscriptionLayers returns every live (archived_at IS NULL)
// strategy-layer row owned by the subscription, ordered by sort_order.
// Returns ([], nil) when the subscription has no live layers.
func (s *Service) ListLiveSubscriptionLayers(
	ctx context.Context, subscriptionID uuid.UUID,
) ([]SubscriptionLayer, error) {
	if s.vectorPool == nil {
		return nil, ErrVAUnavailable
	}
	rows, err := s.vectorPool.Query(ctx, `
		SELECT id, source_library_id, name, tag, sort_order,
		       parent_layer_id, icon, colour,
		       description_md, help_md,
		       allows_children, is_leaf,
		       archived_at, created_at, updated_at
		  FROM obj_strategy_types_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY sort_order`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SubscriptionLayer{}
	for rows.Next() {
		var d SubscriptionLayer
		if err := rows.Scan(
			&d.ID, &d.SourceLibraryID, &d.Name, &d.Tag, &d.SortOrder,
			&d.ParentLayerID, &d.Icon, &d.Colour,
			&d.DescriptionMD, &d.HelpMD,
			&d.AllowsChildren, &d.IsLeaf,
			&d.ArchivedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// PatchLiveSubscriptionLayers applies the rename/retag/reorder payload
// atomically. The payload MUST be the complete set of live layers for
// the subscription:
//
//   - Returns ErrLayerCountMismatch when len(inputs) != live-layer count.
//   - Returns ErrLayerUnknown when an id in the payload is not live for
//     this subscription.
//   - Returns *ValidationError when any row fails per-row rules
//     (tag length, empty name, duplicate name/tag within payload).
//
// On success returns the updated layer set, ordered by (sort_order,
// name) so the frontend can render without a follow-up GET.
func (s *Service) PatchLiveSubscriptionLayers(
	ctx context.Context, subscriptionID uuid.UUID, inputs []LayerPatch,
) ([]SubscriptionLayer, error) {
	if s.vectorPool == nil {
		return nil, ErrVAUnavailable
	}

	// Fetch live IDs for the subscription.
	rows, err := s.vectorPool.Query(ctx, `
		SELECT id
		  FROM obj_strategy_types_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}
	liveIDs := make(map[uuid.UUID]struct{})
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		liveIDs[id] = struct{}{}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(inputs) != len(liveIDs) {
		return nil, fmt.Errorf("%w: payload=%d live=%d",
			ErrLayerCountMismatch, len(inputs), len(liveIDs))
	}
	for i, inp := range inputs {
		if _, ok := liveIDs[inp.ID]; !ok {
			return nil, fmt.Errorf("%w: index=%d id=%s",
				ErrLayerUnknown, i, inp.ID)
		}
	}

	// Per-row validation — collect all violations before any writes.
	var violations []FieldViolation
	seenNames := make(map[string]int)
	seenTags := make(map[string]int)
	for i, inp := range inputs {
		if len(inp.Tag) < 2 || len(inp.Tag) > 4 {
			violations = append(violations, FieldViolation{
				Index:   i,
				Field:   "tag",
				Message: fmt.Sprintf("tag %q must be 2–4 characters", inp.Tag),
			})
		}
		if inp.Name == "" {
			violations = append(violations, FieldViolation{
				Index: i, Field: "name", Message: "name must not be empty",
			})
		}
		if firstIdx, seen := seenNames[inp.Name]; seen {
			violations = append(violations, FieldViolation{
				Index:   i,
				Field:   "name",
				Message: fmt.Sprintf("duplicate name %q; first seen at index %d", inp.Name, firstIdx),
			})
		} else {
			seenNames[inp.Name] = i
		}
		if firstIdx, seen := seenTags[inp.Tag]; seen {
			violations = append(violations, FieldViolation{
				Index:   i,
				Field:   "tag",
				Message: fmt.Sprintf("duplicate tag %q; first seen at index %d", inp.Tag, firstIdx),
			})
		} else {
			seenTags[inp.Tag] = i
		}
	}
	if len(violations) > 0 {
		return nil, &ValidationError{Violations: violations}
	}

	// Atomic write under SERIALIZABLE — matches the legacy contract
	// (story 00062 / handler_layers.go).
	tx, err := s.vectorPool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	for _, inp := range inputs {
		if _, err := tx.Exec(ctx, `
			UPDATE obj_strategy_types_layers
			   SET name           = $1,
			       tag            = $2,
			       sort_order     = $3,
			       description_md = $4
			 WHERE id             = $5
			   AND subscription_id = $6
			   AND archived_at IS NULL`,
			inp.Name, inp.Tag, inp.SortOrder, inp.DescriptionMD,
			inp.ID, subscriptionID,
		); err != nil {
			return nil, err
		}
	}

	updatedRows, err := tx.Query(ctx, `
		SELECT id, source_library_id, name, tag, sort_order,
		       parent_layer_id, icon, colour,
		       description_md, help_md,
		       allows_children, is_leaf,
		       archived_at, created_at, updated_at
		  FROM obj_strategy_types_layers
		 WHERE subscription_id = $1
		   AND archived_at IS NULL
		 ORDER BY sort_order, name`,
		subscriptionID,
	)
	if err != nil {
		return nil, err
	}

	out := []SubscriptionLayer{}
	for updatedRows.Next() {
		var d SubscriptionLayer
		if err := updatedRows.Scan(
			&d.ID, &d.SourceLibraryID, &d.Name, &d.Tag, &d.SortOrder,
			&d.ParentLayerID, &d.Icon, &d.Colour,
			&d.DescriptionMD, &d.HelpMD,
			&d.AllowsChildren, &d.IsLeaf,
			&d.ArchivedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			updatedRows.Close()
			return nil, err
		}
		out = append(out, d)
	}
	updatedRows.Close()
	if err := updatedRows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

// ── workspace strategy layers (vector_artefacts.artefact_types) ──────

// WorkspaceLayer mirrors workspaceLayerDTO so the handler can JSON-
// encode without further mapping.
type WorkspaceLayer struct {
	ID              uuid.UUID  `json:"id"`
	WorkspaceID     uuid.UUID  `json:"workspace_id"`
	SourceLibraryID *uuid.UUID `json:"source_library_id"`
	Name            string     `json:"name"`
	Tag             string     `json:"tag"`
	SortOrder       int32      `json:"sort_order"`
	ParentLayerID   *uuid.UUID `json:"parent_layer_id"`
	Icon            *string    `json:"icon"`
	Colour          *string    `json:"colour"`
	DescriptionMD   *string    `json:"description_md"`
	HelpMD          *string    `json:"help_md"`
	AllowsChildren  bool       `json:"allows_children"`
	IsLeaf          bool       `json:"is_leaf"`
	IsPlaceholder   bool       `json:"is_placeholder"`
	ArchivedAt      *time.Time `json:"archived_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// AssertWorkspaceInTenant returns ErrWorkspaceNotFound if the workspace
// does not exist OR belongs to a different tenant. Existence is not
// leaked — same error either way.
func (s *Service) AssertWorkspaceInTenant(
	ctx context.Context, workspaceID, subscriptionID uuid.UUID,
) error {
	if s.vectorPool == nil {
		return ErrVAUnavailable
	}
	var got uuid.UUID
	err := s.vectorPool.QueryRow(ctx,
		`SELECT subscription_id FROM master_record_workspaces WHERE id = $1`, workspaceID,
	).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if got != subscriptionID {
		return ErrWorkspaceNotFound
	}
	return nil
}

// IsWorkspaceMember reports whether the user holds any live (revoked_at
// IS NULL) roles_workspaces row for the workspace.
func (s *Service) IsWorkspaceMember(
	ctx context.Context, workspaceID, userID uuid.UUID,
) (bool, error) {
	if s.vectorPool == nil {
		return false, ErrVAUnavailable
	}
	var exists bool
	err := s.vectorPool.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1
		      FROM roles_workspaces
		     WHERE workspace_id = $1
		       AND user_id      = $2
		       AND revoked_at  IS NULL
		)`, workspaceID, userID,
	).Scan(&exists)
	return exists, err
}

// ListWorkspaceArtefactLayers returns the live strategy artefact_types
// rows for the workspace. Returns ErrVAUnavailable when vaPool is nil
// (the handler renders 503 in that case).
func (s *Service) ListWorkspaceArtefactLayers(
	ctx context.Context, workspaceID uuid.UUID,
) ([]WorkspaceLayer, error) {
	if s.vaPool == nil {
		return nil, ErrVAUnavailable
	}
	rows, err := s.vaPool.Query(ctx, `
		SELECT id, workspace_id,
		       library_layer_id,
		       name, prefix, sort_order,
		       parent_type_id,
		       description, allows_children,
		       is_placeholder,
		       archived_at, created_at, updated_at
		  FROM artefact_types
		 WHERE workspace_id = $1
		   AND scope         = 'strategy'
		   AND archived_at  IS NULL
		 ORDER BY (parent_type_id IS NOT NULL),
		          sort_order,
		          name`,
		workspaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WorkspaceLayer{}
	for rows.Next() {
		var d WorkspaceLayer
		if err := rows.Scan(
			&d.ID, &d.WorkspaceID,
			&d.SourceLibraryID,
			&d.Name, &d.Tag, &d.SortOrder,
			&d.ParentLayerID,
			&d.DescriptionMD, &d.AllowsChildren,
			&d.IsPlaceholder,
			&d.ArchivedAt, &d.CreatedAt, &d.UpdatedAt,
		); err != nil {
			return nil, err
		}
		// Derived: parity with legacy subscriptionLayerDTO.is_leaf.
		d.IsLeaf = !d.AllowsChildren
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// PatchWorkspaceArtefactLayerInput is the per-row update payload from the
// frontend LayersTable batch confirm.
type PatchWorkspaceArtefactLayerInput struct {
	ID          uuid.UUID `json:"id"`
	Name        string    `json:"name"`
	Tag         string    `json:"tag"`
	SortOrder   int32     `json:"sort_order"`
	Description *string   `json:"description_md"`
}

// PatchWorkspaceArtefactLayers applies a batch update to strategy
// artefact_types rows owned by the workspace. Each row is updated
// individually inside a single transaction; the full updated set is
// returned so the frontend can replace its local state.
func (s *Service) PatchWorkspaceArtefactLayers(
	ctx context.Context,
	workspaceID uuid.UUID,
	inputs []PatchWorkspaceArtefactLayerInput,
) ([]WorkspaceLayer, error) {
	if s.vaPool == nil {
		return nil, ErrVAUnavailable
	}

	tx, err := s.vaPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	for _, inp := range inputs {
		_, err := tx.Exec(ctx, `
			UPDATE artefact_types
			   SET name        = $1,
			       prefix      = $2,
			       sort_order  = $3,
			       description = $4
			 WHERE id           = $5
			   AND workspace_id = $6
			   AND scope        = 'strategy'
			   AND archived_at IS NULL`,
			inp.Name, inp.Tag, inp.SortOrder, inp.Description,
			inp.ID, workspaceID,
		)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return s.ListWorkspaceArtefactLayers(ctx, workspaceID)
}
