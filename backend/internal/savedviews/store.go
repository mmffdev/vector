package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ViewStore is the substrate boundary. The Service depends on this
// interface, never on *pgxpool.Pool directly, so a future Postgres
// swap is a constructor change in main.go, not a service rewrite.
type ViewStore interface {
	GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error)
	ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error)
	Insert(ctx context.Context, in CreateInput) (*View, error)
	UpdateBody(ctx context.Context, subID, viewID uuid.UUID, name *string, body json.RawMessage) (*View, error)
	UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error)
	Archive(ctx context.Context, subID, viewID uuid.UUID) error

	// VerifyUserInSubscription / Node / Workspace are tenant-integrity
	// probes called by the Service before any write. They live on the
	// store because they're SQL; the policy decision (call them, then
	// reject) lives on the Service.
	VerifyUserInSubscription(ctx context.Context, userID, subID uuid.UUID) (bool, error)
	VerifyNodeInSubscription(ctx context.Context, nodeID, subID uuid.UUID) (bool, error)
	VerifyWorkspaceInSubscription(ctx context.Context, wsID, subID uuid.UUID) (bool, error)
	VerifyNodeMembership(ctx context.Context, userID, nodeID uuid.UUID) (bool, error)
}

// PostgresViewStore is the default ViewStore impl backed by pgx.
type PostgresViewStore struct {
	pool *pgxpool.Pool
}

// NewPostgresViewStore wires a store around an existing pool. Main.go
// passes the vector_artefacts pool (vaPool).
func NewPostgresViewStore(pool *pgxpool.Pool) *PostgresViewStore {
	return &PostgresViewStore{pool: pool}
}

func scanView(row pgx.Row) (*View, error) {
	var v View
	if err := row.Scan(
		&v.ID, &v.SubscriptionID, &v.Kind, &v.Scope,
		&v.UserID, &v.NodeID, &v.WorkspaceID,
		&v.Target, &v.Name, &v.Body,
		&v.CreatedBy, &v.CreatedAt, &v.UpdatedAt, &v.ArchivedAt,
	); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *PostgresViewStore) GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlSelectViewByID, subID, viewID)
	v, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("savedviews.GetByID: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error) {
	out := make([]View, 0, 16)
	// User-scope.
	rows, err := s.pool.Query(ctx, sqlListVisibleByUser, q.SubscriptionID, q.ActorUserID, q.Kind, q.Target)
	if err != nil {
		return nil, fmt.Errorf("savedviews.ListVisibleToUser/user: %w", err)
	}
	for rows.Next() {
		v, err := scanView(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *v)
	}
	rows.Close()

	// Node-scope (any membership).
	if len(q.ActorNodeIDs) > 0 {
		rows, err = s.pool.Query(ctx, sqlListVisibleByNode, q.SubscriptionID, q.ActorNodeIDs, q.Kind, q.Target)
		if err != nil {
			return nil, fmt.Errorf("savedviews.ListVisibleToUser/node: %w", err)
		}
		for rows.Next() {
			v, err := scanView(rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, *v)
		}
		rows.Close()
	}

	// Workspace-scope.
	rows, err = s.pool.Query(ctx, sqlListVisibleByWorkspace, q.SubscriptionID, q.ActorWorkspace, q.Kind, q.Target)
	if err != nil {
		return nil, fmt.Errorf("savedviews.ListVisibleToUser/workspace: %w", err)
	}
	for rows.Next() {
		v, err := scanView(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, *v)
	}
	rows.Close()

	return out, nil
}

func (s *PostgresViewStore) Insert(ctx context.Context, in CreateInput) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlInsertView,
		in.SubscriptionID, in.Kind, in.Scope,
		in.UserID, in.NodeID, in.WorkspaceID,
		in.Target, in.Name, in.Body, in.ActorUserID,
	)
	v, err := scanView(row)
	if err != nil {
		return nil, fmt.Errorf("savedviews.Insert: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) UpdateBody(ctx context.Context, subID, viewID uuid.UUID, name *string, body json.RawMessage) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlUpdateBody, subID, viewID, name, body)
	v, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("savedviews.UpdateBody: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error) {
	row := s.pool.QueryRow(ctx, sqlUpdateScope,
		in.SubscriptionID, in.ViewID, in.NewScope,
		in.NewUserID, in.NewNodeID, in.NewWorkspaceID,
	)
	v, err := scanView(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("savedviews.UpdateScope: %w", err)
	}
	return v, nil
}

func (s *PostgresViewStore) Archive(ctx context.Context, subID, viewID uuid.UUID) error {
	ct, err := s.pool.Exec(ctx, sqlArchiveView, subID, viewID)
	if err != nil {
		return fmt.Errorf("savedviews.Archive: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresViewStore) VerifyUserInSubscription(ctx context.Context, userID, subID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyUserInSubscription, userID, subID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyUserInSubscription: %w", err)
	}
	return true, nil
}

func (s *PostgresViewStore) VerifyNodeInSubscription(ctx context.Context, nodeID, subID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyNodeInSubscription, nodeID, subID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyNodeInSubscription: %w", err)
	}
	return true, nil
}

func (s *PostgresViewStore) VerifyWorkspaceInSubscription(ctx context.Context, wsID, subID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyWorkspaceInSubscription, wsID, subID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyWorkspaceInSubscription: %w", err)
	}
	return true, nil
}

func (s *PostgresViewStore) VerifyNodeMembership(ctx context.Context, userID, nodeID uuid.UUID) (bool, error) {
	var one int
	err := s.pool.QueryRow(ctx, sqlVerifyNodeMembership, userID, nodeID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("savedviews.VerifyNodeMembership: %w", err)
	}
	return true, nil
}
