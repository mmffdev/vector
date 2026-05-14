package fields

// Service is the sole writer/reader boundary for the field-scope HTTP
// surface (PLA-0039 / Story 00526, B22.6). The handler in this package
// MUST go through Service for all DB I/O — `lint:no-db-in-handlers`
// enforces this. Two concrete capabilities live here:
//
//   - AssertCallerMayRead: tenancy + membership gate against mmff_vector
//     (master_record_workspaces + roles_workspaces).
//   - LoadAdmittedFields:  bulk lookup of admitted artefacts_fields_library
//     rows for a (workspace, tenant) pair against vector_artefacts.
//
// vectorPool MUST be non-nil. artefactsPool MAY be nil — when the
// VECTOR_ARTEFACTS_DB_URL is unset at boot the handler short-circuits
// to an empty fields slice rather than 500-ing. LoadAdmittedFields
// returns ErrArtefactsPoolMissing in that configuration so callers can
// distinguish "no pool wired" from "no rows match".

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// Sentinel errors. Handler maps these to HTTP statuses.
var (
	ErrWorkspaceNotFound     = errors.New("workspace not found")
	ErrForbidden             = errors.New("forbidden")
	ErrArtefactsPoolMissing  = errors.New("vector_artefacts pool not configured")
)

// Service holds the two pools and exposes capability methods. Construct
// via NewService — callers MUST NOT zero-init.
type Service struct {
	vectorPool    *pgxpool.Pool
	artefactsPool *pgxpool.Pool
}

// NewService wires the service. vectorPool is required; artefactsPool
// may be nil. Mirrors NewHandler's old contract one-for-one.
func NewService(vectorPool, artefactsPool *pgxpool.Pool) *Service {
	return &Service{vectorPool: vectorPool, artefactsPool: artefactsPool}
}

// HasArtefactsPool reports whether the vector_artefacts pool was wired
// at boot. The handler uses this to short-circuit to an empty response
// rather than calling LoadAdmittedFields and getting ErrArtefactsPoolMissing.
func (s *Service) HasArtefactsPool() bool { return s.artefactsPool != nil }

// FieldRow is the canonical service-layer shape for one admitted row.
// The handler renames json tags via fieldRowOut; the service stays
// transport-agnostic (struct tags are inert here).
type FieldRow struct {
	ID             uuid.UUID
	SubscriptionID *uuid.UUID
	FieldName      string
	Label          string
	FieldType      string
	OptionsJSON    json.RawMessage
	ConfigJSON     json.RawMessage
	Description    *string
	Scope          string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// AssertCallerMayRead returns nil iff the caller can read the field set
// for wsID. Returns ErrWorkspaceNotFound, ErrForbidden, or a plumbing
// error. See handler.go for the full rule semantics — this method is a
// straight extraction.
func (s *Service) AssertCallerMayRead(ctx context.Context, wsID uuid.UUID, u *roletypes.User) error {
	var wsTenant uuid.UUID
	err := s.vectorPool.QueryRow(ctx, sqlSelectWorkspaceTenant, wsID).Scan(&wsTenant)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if wsTenant != u.SubscriptionID {
		return ErrWorkspaceNotFound
	}
	if u.Role == roletypes.RoleGAdmin || u.Role == roletypes.RolePAdmin {
		return nil
	}
	var member bool
	err = s.vectorPool.QueryRow(ctx, sqlExistsActiveWorkspaceMembership, u.ID, wsID).Scan(&member)
	if err != nil {
		return err
	}
	if !member {
		return ErrForbidden
	}
	return nil
}

// LoadAdmittedFields runs the bulk admit query against vector_artefacts.
// MUST stay in lockstep with resolver.go ResolveField — handler_test.go
// exercises both layers with the same matrix.
func (s *Service) LoadAdmittedFields(ctx context.Context, wsID, tenantID uuid.UUID) ([]FieldRow, error) {
	if s.artefactsPool == nil {
		return nil, ErrArtefactsPoolMissing
	}
	rows, err := s.artefactsPool.Query(ctx, sqlLoadAdmittedFields, wsID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []FieldRow{}
	for rows.Next() {
		var (
			r           FieldRow
			optionsJSON []byte
			configJSON  []byte
		)
		if err := rows.Scan(
			&r.ID,
			&r.SubscriptionID,
			&r.FieldName,
			&r.Label,
			&r.FieldType,
			&optionsJSON,
			&configJSON,
			&r.Description,
			&r.Scope,
			&r.CreatedAt,
			&r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if len(optionsJSON) > 0 {
			r.OptionsJSON = json.RawMessage(optionsJSON)
		}
		if len(configJSON) > 0 {
			r.ConfigJSON = json.RawMessage(configJSON)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
