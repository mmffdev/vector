package errorsreport

// Service is the sole DB boundary for error reporting (PLA-0039 /
// Story 00527, B22.7). The handler in this package validates input,
// pulls the auth user, and calls Service.Record — `lint:no-db-in-handlers`
// enforces no direct DB access from handler.go.
//
// Two databases are involved:
//   - LibRO  — read-only pool against mmff_library; used to validate
//     that the supplied code exists in error_codes.
//   - VectorPool — primary write pool. Wired to vector_artefacts.error_events
//     post-PLA-0023-P1 (2026-05-13); falls back to mmff_vector pool when
//     vaPool is unavailable. Field name kept as `vectorPool` for back-compat;
//     "vector" here means "the primary Vector write pool", not the literal
//     mmff_vector database.
//
// LibRO MAY be nil — when the library pool fails to initialise at boot
// (e.g. pre-cutover environments) the service treats CodeExists as
// returning ErrLibPoolMissing so the handler can surface a clean 503
// instead of a nil-deref panic. In normal dev/staging/production both
// pools are wired.

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors. The handler maps these to HTTP statuses.
var (
	ErrUnknownCode    = errors.New("unknown error code")
	ErrLibPoolMissing = errors.New("library pool not configured")
)

// Service holds the two pools needed for the cross-DB validate-then-
// write flow.
type Service struct {
	libRO      *pgxpool.Pool
	vectorPool *pgxpool.Pool
}

// NewService wires the service. libRO MAY be nil; vectorPool is
// required. Mirrors the previous handler constructor one-for-one.
func NewService(libRO, vectorPool *pgxpool.Pool) *Service {
	return &Service{libRO: libRO, vectorPool: vectorPool}
}

// CodeExists returns true iff the given code is present in
// mmff_library.error_codes. Returns ErrLibPoolMissing when libRO is nil.
func (s *Service) CodeExists(ctx context.Context, code string) (bool, error) {
	if s.libRO == nil {
		return false, ErrLibPoolMissing
	}
	var found int
	err := s.libRO.QueryRow(ctx, sqlSelectErrorCodeExists, code).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Event captures the fields the handler has parsed and is about to
// persist. The Service owns the SQL.
type Event struct {
	SubscriptionID uuid.UUID
	UserID         uuid.UUID
	Code           string
	// Context is JSONB — pass json.RawMessage for verbatim storage,
	// nil for SQL NULL.
	Context   json.RawMessage
	RequestID string
}

// Record inserts one row into error_events on s.vectorPool. Post-
// PLA-0023-P1 (2026-05-13) the canonical write target is vector_artefacts;
// main.go wires that via the errorsReportPool selection. Empty RequestID
// becomes SQL NULL; empty/"null" Context becomes SQL NULL.
func (s *Service) Record(ctx context.Context, ev Event) error {
	var ctxPayload any
	if len(ev.Context) > 0 && string(ev.Context) != "null" {
		ctxPayload = ev.Context
	}
	var reqID any
	if ev.RequestID != "" {
		reqID = ev.RequestID
	}
	_, err := s.vectorPool.Exec(ctx, sqlInsertErrorEvent,
		ev.SubscriptionID, ev.UserID, ev.Code, ctxPayload, reqID,
	)
	return err
}
