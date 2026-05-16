// Service-layer hub for the portfoliomodels package (PLA-0039 / Story
// 00530). Hosts all DB I/O for the HTTP read/write surfaces in this
// package so the corresponding handlers can be DB-free:
//
//	Handler                       — library bundle reads (mmff_library RO)
//	WorkspaceLayersHandler        — workspace strategy layers (vector_artefacts)
//
// Architectural target after PLA-0039:
//
//	handler  →  parse + auth + svc.Method() + render
//	service  →  pool ownership + SQL + business invariants
//
// One Service holds all three pools (library RO, mmff_vector,
// vector_artefacts). Each method is keyed off the caller's (subscription
// or workspace) scope so cross-tenant leakage stays impossible.
package portfoliomodels

import (
	"context"
	"errors"
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
)

// Service holds the pools used by every read/write in this package.
//
// libRO is the mmff_library RO pool (for bundle reads). vectorPool is
// the mmff_vector pool (for subscription layers + workspace tenancy /
// membership). vaPool is the vector_artefacts pool (for workspace
// artefacts_types). Any of the three may be nil at boot — methods that
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

// ── workspace strategy layers (vector_artefacts.artefacts_types) ──────

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
	err := s.vectorPool.QueryRow(ctx, sqlSelectWorkspaceSubscriptionID, workspaceID).Scan(&got)
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
	err := s.vectorPool.QueryRow(ctx, sqlExistsActiveWorkspaceMembership,
		workspaceID, userID,
	).Scan(&exists)
	return exists, err
}

// ListWorkspaceArtefactLayers returns the live strategy artefacts_types
// rows for the workspace. Returns ErrVAUnavailable when vaPool is nil
// (the handler renders 503 in that case).
func (s *Service) ListWorkspaceArtefactLayers(
	ctx context.Context, workspaceID uuid.UUID,
) ([]WorkspaceLayer, error) {
	if s.vaPool == nil {
		return nil, ErrVAUnavailable
	}
	rows, err := s.vaPool.Query(ctx, sqlListWorkspaceStrategyArtefactTypes, workspaceID)
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
// artefacts_types rows owned by the workspace. Each row is updated
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
		_, err := tx.Exec(ctx, sqlPatchWorkspaceStrategyArtefactType,
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
