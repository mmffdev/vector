package orgdesign

// Level surface for the Topology canvas (PLA-0006 / 00313).
//
// org_levels is a sole-writer table — same boundary as the other
// three tables in this package (see service.go preamble + the
// boundary_test.go regex).
//
// The depth invariant — node.level.depth must equal the node's
// computed tree depth — lives at the service layer. CreateNode
// and MoveNode call resolveLevelForDepth to attach the right
// level_id. resolveLevelForDepth auto-creates a "Level N" row when
// no level yet exists for a deeper depth than the seeded three.

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Level is one row of org_levels — the horizontal "row" the
// canvas draws nodes onto.
type Level struct {
	ID             uuid.UUID  `json:"id"`
	SubscriptionID uuid.UUID  `json:"subscription_id"`
	Depth          int        `json:"depth"`
	Name           string     `json:"name"`
	Position       int        `json:"position"`
	ArchivedAt     *time.Time `json:"archived_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// CreateLevelInput is the payload for an explicit gadmin "add a
// new level" action. Most level rows are created implicitly via
// resolveLevelForDepth during node create/move — this is for the
// case where a tenant wants to pre-name a deeper level before
// any node lives there.
type CreateLevelInput struct {
	SubscriptionID uuid.UUID
	Depth          int
	Name           string
	Position       int
}

// CreateLevel inserts a new level row. Idempotent on
// (subscription_id, depth) — re-creating the same depth returns
// the existing row instead of erroring.
func (s *Service) CreateLevel(ctx context.Context, in CreateLevelInput) (Level, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return Level{}, ErrInvalidName
	}
	if in.Depth < 0 {
		return Level{}, ErrInvalidLevelDepth
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return Level{}, err
	}
	defer tx.Rollback(ctx)

	// Idempotent: same (subscription, depth) returns the existing row.
	var existing Level
	err = tx.QueryRow(ctx, `
		SELECT id, subscription_id, depth, name, position, archived_at, created_at, updated_at
		  FROM org_levels
		 WHERE subscription_id = $1 AND depth = $2 AND archived_at IS NULL
	`, in.SubscriptionID, in.Depth).Scan(
		&existing.ID, &existing.SubscriptionID, &existing.Depth, &existing.Name,
		&existing.Position, &existing.ArchivedAt, &existing.CreatedAt, &existing.UpdatedAt,
	)
	if err == nil {
		if err := tx.Commit(ctx); err != nil {
			return Level{}, err
		}
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Level{}, err
	}

	pos := in.Position
	if pos == 0 {
		pos = in.Depth
	}

	var l Level
	err = tx.QueryRow(ctx, `
		INSERT INTO org_levels (subscription_id, depth, name, position)
		VALUES ($1, $2, $3, $4)
		RETURNING id, subscription_id, depth, name, position, archived_at, created_at, updated_at
	`, in.SubscriptionID, in.Depth, name, pos).Scan(
		&l.ID, &l.SubscriptionID, &l.Depth, &l.Name,
		&l.Position, &l.ArchivedAt, &l.CreatedAt, &l.UpdatedAt,
	)
	if err != nil {
		return Level{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Level{}, err
	}
	return l, nil
}

// RenameLevel updates the level's display name.
func (s *Service) RenameLevel(ctx context.Context, subscriptionID, levelID uuid.UUID, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return ErrInvalidName
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE org_levels SET name = $1
		 WHERE id = $2 AND subscription_id = $3 AND archived_at IS NULL
	`, name, levelID, subscriptionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrLevelNotFound
	}
	return nil
}

// ListLevels returns every live level for a subscription, ordered
// by depth ascending. Empty slice when the tenant has no levels
// yet (shouldn't happen post-091 backfill, but defensive).
func (s *Service) ListLevels(ctx context.Context, subscriptionID uuid.UUID) ([]Level, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id, subscription_id, depth, name, position, archived_at, created_at, updated_at
		  FROM org_levels
		 WHERE subscription_id = $1 AND archived_at IS NULL
		 ORDER BY depth ASC
	`, subscriptionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Level{}
	for rows.Next() {
		var l Level
		if err := rows.Scan(
			&l.ID, &l.SubscriptionID, &l.Depth, &l.Name,
			&l.Position, &l.ArchivedAt, &l.CreatedAt, &l.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// resolveLevelForDepth returns the level_id matching the given
// depth, creating a generic "Level N" row when none exists. Used
// by CreateNode and MoveNode inside their transactions so the
// depth invariant holds at write time.
//
// The auto-create path is rare: only fires when a tenant builds
// past the seeded depth-2 (Division) without first naming a deeper
// level. The generic name keeps the row valid; a gadmin can
// rename it via RenameLevel later.
func (s *Service) resolveLevelForDepth(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID, depth int) (uuid.UUID, error) {
	if depth < 0 {
		return uuid.Nil, ErrInvalidLevelDepth
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `
		SELECT id FROM org_levels
		 WHERE subscription_id = $1 AND depth = $2 AND archived_at IS NULL
		 LIMIT 1
	`, subscriptionID, depth).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}
	// Auto-create a generic level for this depth.
	name := "Level " + itoa(depth+1)
	err = tx.QueryRow(ctx, `
		INSERT INTO org_levels (subscription_id, depth, name, position)
		VALUES ($1, $2, $3, $2)
		RETURNING id
	`, subscriptionID, depth, name).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// computeDepthForParent returns the tree depth a new node would
// occupy. Root (parentID == nil) → depth 0. Otherwise, parent's
// depth + 1.
func (s *Service) computeDepthForParent(ctx context.Context, tx pgx.Tx, subscriptionID uuid.UUID, parentID *uuid.UUID) (int, error) {
	if parentID == nil {
		return 0, nil
	}
	var depth int
	err := tx.QueryRow(ctx, `
		WITH RECURSIVE up AS (
		    SELECT id, parent_id, 0 AS d FROM org_nodes
		     WHERE id = $1 AND subscription_id = $2
		    UNION ALL
		    SELECT p.id, p.parent_id, up.d + 1
		      FROM org_nodes p
		      JOIN up ON up.parent_id = p.id
		     WHERE p.subscription_id = $2
		)
		SELECT MAX(d) FROM up
	`, *parentID, subscriptionID).Scan(&depth)
	if err != nil {
		return 0, err
	}
	// Parent's own depth + 1 → child depth. The CTE above counts
	// hops from parent to root (inclusive of parent), so the
	// returned MAX is parent_depth → child = MAX + 1.
	return depth + 1, nil
}

