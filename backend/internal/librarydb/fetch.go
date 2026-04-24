package librarydb

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrBundleNotFound is returned when no spine row exists for the
// requested model id or family id.
var ErrBundleNotFound = errors.New("librarydb: bundle not found")

// FetchByModelID loads the full bundle for one model row id.
// Caller normally passes the RO pool; the fetcher only reads.
func FetchByModelID(ctx context.Context, pool *pgxpool.Pool, modelID uuid.UUID) (*Bundle, error) {
	return fetchInTx(ctx, pool, func(tx pgx.Tx) (*Model, error) {
		return loadModelByID(ctx, tx, modelID)
	})
}

// FetchLatestByFamily loads the highest non-archived version for a family.
func FetchLatestByFamily(ctx context.Context, pool *pgxpool.Pool, familyID uuid.UUID) (*Bundle, error) {
	return fetchInTx(ctx, pool, func(tx pgx.Tx) (*Model, error) {
		return loadLatestByFamily(ctx, tx, familyID)
	})
}

// fetchInTx wraps the 6 reads in a single REPEATABLE READ tx so the
// snapshot is consistent across spine + children.
func fetchInTx(ctx context.Context, pool *pgxpool.Pool, loadSpine func(pgx.Tx) (*Model, error)) (*Bundle, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return nil, fmt.Errorf("librarydb: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	model, err := loadSpine(tx)
	if err != nil {
		return nil, err
	}

	layers, err := loadLayers(ctx, tx, model.ID)
	if err != nil {
		return nil, err
	}
	workflows, err := loadWorkflows(ctx, tx, model.ID)
	if err != nil {
		return nil, err
	}
	transitions, err := loadTransitions(ctx, tx, model.ID)
	if err != nil {
		return nil, err
	}
	artifacts, err := loadArtifacts(ctx, tx, model.ID)
	if err != nil {
		return nil, err
	}
	terminology, err := loadTerminology(ctx, tx, model.ID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("librarydb: commit ro tx: %w", err)
	}

	return &Bundle{
		Model:       *model,
		Layers:      layers,
		Workflows:   workflows,
		Transitions: transitions,
		Artifacts:   artifacts,
		Terminology: terminology,
	}, nil
}

const modelCols = `id, model_family_id, key, name, description, instructions_md,
	scope, owner_subscription_id, visibility, feature_flags, default_view, icon,
	version, library_version, archived_at, created_at, updated_at`

func scanModel(row pgx.Row) (*Model, error) {
	var m Model
	err := row.Scan(
		&m.ID, &m.ModelFamilyID, &m.Key, &m.Name, &m.Description, &m.InstructionsMD,
		&m.Scope, &m.OwnerSubscriptionID, &m.Visibility, &m.FeatureFlags, &m.DefaultView, &m.Icon,
		&m.Version, &m.LibraryVersion, &m.ArchivedAt, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func loadModelByID(ctx context.Context, tx pgx.Tx, modelID uuid.UUID) (*Model, error) {
	row := tx.QueryRow(ctx, `SELECT `+modelCols+` FROM portfolio_models WHERE id = $1`, modelID)
	m, err := scanModel(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrBundleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("librarydb: load model by id: %w", err)
	}
	return m, nil
}

func loadLatestByFamily(ctx context.Context, tx pgx.Tx, familyID uuid.UUID) (*Model, error) {
	row := tx.QueryRow(ctx, `SELECT `+modelCols+`
		FROM portfolio_models
		WHERE model_family_id = $1 AND archived_at IS NULL
		ORDER BY version DESC
		LIMIT 1`, familyID)
	m, err := scanModel(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrBundleNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("librarydb: load latest by family: %w", err)
	}
	return m, nil
}

func loadLayers(ctx context.Context, tx pgx.Tx, modelID uuid.UUID) ([]Layer, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, model_id, name, tag, sort_order, parent_layer_id, icon, colour,
		       description_md, help_md, allows_children, is_leaf,
		       archived_at, created_at, updated_at
		FROM portfolio_model_layers
		WHERE model_id = $1
		ORDER BY sort_order, name`, modelID)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query layers: %w", err)
	}
	defer rows.Close()

	var out []Layer
	for rows.Next() {
		var l Layer
		if err := rows.Scan(
			&l.ID, &l.ModelID, &l.Name, &l.Tag, &l.SortOrder, &l.ParentLayerID, &l.Icon, &l.Colour,
			&l.DescriptionMD, &l.HelpMD, &l.AllowsChildren, &l.IsLeaf,
			&l.ArchivedAt, &l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan layer: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func loadWorkflows(ctx context.Context, tx pgx.Tx, modelID uuid.UUID) ([]Workflow, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, model_id, layer_id, state_key, state_label, sort_order,
		       is_initial, is_terminal, colour,
		       archived_at, created_at, updated_at
		FROM portfolio_model_workflows
		WHERE model_id = $1
		ORDER BY layer_id, sort_order, state_key`, modelID)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query workflows: %w", err)
	}
	defer rows.Close()

	var out []Workflow
	for rows.Next() {
		var w Workflow
		if err := rows.Scan(
			&w.ID, &w.ModelID, &w.LayerID, &w.StateKey, &w.StateLabel, &w.SortOrder,
			&w.IsInitial, &w.IsTerminal, &w.Colour,
			&w.ArchivedAt, &w.CreatedAt, &w.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan workflow: %w", err)
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

func loadTransitions(ctx context.Context, tx pgx.Tx, modelID uuid.UUID) ([]WorkflowTransition, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, model_id, from_state_id, to_state_id,
		       archived_at, created_at, updated_at
		FROM portfolio_model_workflow_transitions
		WHERE model_id = $1
		ORDER BY from_state_id, to_state_id`, modelID)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query transitions: %w", err)
	}
	defer rows.Close()

	var out []WorkflowTransition
	for rows.Next() {
		var t WorkflowTransition
		if err := rows.Scan(
			&t.ID, &t.ModelID, &t.FromStateID, &t.ToStateID,
			&t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan transition: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func loadArtifacts(ctx context.Context, tx pgx.Tx, modelID uuid.UUID) ([]Artifact, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, model_id, artifact_key, enabled, config,
		       archived_at, created_at, updated_at
		FROM portfolio_model_artifacts
		WHERE model_id = $1
		ORDER BY artifact_key`, modelID)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query artifacts: %w", err)
	}
	defer rows.Close()

	var out []Artifact
	for rows.Next() {
		var a Artifact
		if err := rows.Scan(
			&a.ID, &a.ModelID, &a.ArtifactKey, &a.Enabled, &a.Config,
			&a.ArchivedAt, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan artifact: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func loadTerminology(ctx context.Context, tx pgx.Tx, modelID uuid.UUID) ([]Terminology, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, model_id, key, value,
		       archived_at, created_at, updated_at
		FROM portfolio_model_terminology
		WHERE model_id = $1
		ORDER BY key`, modelID)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query terminology: %w", err)
	}
	defer rows.Close()

	var out []Terminology
	for rows.Next() {
		var t Terminology
		if err := rows.Scan(
			&t.ID, &t.ModelID, &t.Key, &t.Value,
			&t.ArchivedAt, &t.CreatedAt, &t.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan terminology: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
