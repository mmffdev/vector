// Package entityrefs centralises the writer rules for the four
// app-enforced polymorphic FK relationships in mmff_vector
// (entity_stakeholders, item_type_states, item_state_history,
// page_entity_refs). Postgres CHECK enforces the kind vocabulary and
// migration 013's dispatch triggers enforce parent existence + tenant
// equality + non-archived parent at the database layer; this package
// is the corresponding Go layer that callers route through so the
// rules are expressed once and tested once.
//
// See docs/c_polymorphic_writes.md for the full pattern and
// db/mmff_vector/schema/013_polymorphic_dispatch_triggers.sql for the trigger
// implementations.
package polymorphicrefs

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EntityKind names a real-world parent table. The set of valid kinds
// for any given child relationship is narrower than this — see
// page_entity_refs and entity_stakeholders below — but the dispatch
// rules are identical, so we expose one type and gate per relationship.
//
// NOTE (CUT1.1.1 / PLA064): KindCompanyRoadmap, KindWorkspace, KindPortfolio,
// KindProduct were removed when the corresponding tables were dropped in
// migration 249. Any caller that used those kinds must be updated to remove
// the dead references.
type EntityKind string

// Sentinel errors. All four are returned in preference to the raw
// Postgres error so callers can switch on them without unpacking
// pgconn.PgError. The dispatch triggers will still raise a
// foreign_key_violation if the Go layer is bypassed — defence in depth.
var (
	ErrUnknownEntityKind = errors.New("unknown entity_kind")
	ErrEntityNotFound    = errors.New("entity not found or not visible")
	ErrEntityArchived    = errors.New("entity is archived")
)

// parentTableFor maps a kind to its parent table name. Hard-coded —
// never derived from user input — so the table name is always safe to
// interpolate into the SQL string. Returns ("", false) for any unknown
// kind; callers must treat that as ErrUnknownEntityKind.
//
// CUT1.1.1 (PLA064): company_roadmap, workspace, portfolio, product tables
// were dropped in migration 249 — those kinds are no longer valid.
func parentTableFor(kind EntityKind) (string, bool) {
	return "", false
}

// Service is the writer for polymorphic relationships. Stateless apart
// from the pool — every method takes either a fresh ctx or a caller-
// supplied tx, never starts its own outer transaction.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{Pool: pool}
}

// LoadParent runs the pre-flight load every polymorphic insert MUST
// perform: SELECT … FOR UPDATE on the parent row inside the same tx
// as the eventual insert, returning ErrEntityNotFound if the row is
// absent OR belongs to another tenant (existence is itself sensitive),
// and ErrEntityArchived if the row exists but is archived.
//
// Callers pass in their open pgx.Tx so the row lock is held until
// their commit/rollback. Returns the parent's subscription_id (always equal
// to callerSubscription on success — exposed so writers that derive other
// values from it don't need a second read).
func (s *Service) LoadParent(ctx context.Context, tx pgx.Tx, kind EntityKind, id uuid.UUID, callerSubscription uuid.UUID) (parentSubscription uuid.UUID, err error) {
	table, ok := parentTableFor(kind)
	if !ok {
		return uuid.Nil, ErrUnknownEntityKind
	}
	var subscriptionID uuid.UUID
	var archived *time.Time
	// table is a hard-coded enum, not user input — safe to interpolate.
	row := tx.QueryRow(ctx, fmt.Sprintf(sqlSelectPolymorphicParentForUpdateFmt, table), id)
	if err := row.Scan(&subscriptionID, &archived); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, ErrEntityNotFound
		}
		return uuid.Nil, err
	}
	if subscriptionID != callerSubscription {
		// Don't leak existence — same error as not-found.
		return uuid.Nil, ErrEntityNotFound
	}
	if archived != nil {
		return uuid.Nil, ErrEntityArchived
	}
	return subscriptionID, nil
}

// InsertEntityStakeholder writes one row to entity_stakeholders after
// validating the polymorphic parent. Caller passes the open tx so the
// FOR UPDATE lock and the insert sit in the same transaction. Returns
// the new stakeholder row id.
//
// Idempotent on (entity_kind, entity_id, user_id, role) per the
// stakeholder_unique constraint — re-inserting the same triple is a
// no-op (returns the existing id).
func (s *Service) InsertEntityStakeholder(ctx context.Context, tx pgx.Tx, kind EntityKind, entityID, userID, callerSubscription uuid.UUID, role string) (uuid.UUID, error) {
	if _, err := s.LoadParent(ctx, tx, kind, entityID, callerSubscription); err != nil {
		return uuid.Nil, err
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, sqlInsertEntityStakeholder,
		callerSubscription, string(kind), entityID, userID, role,
	).Scan(&id)
	return id, err
}

// InsertPageEntityRef writes one row to page_entity_refs after
// validating the polymorphic parent. Idempotent on (entity_kind,
// entity_id) — re-inserting collapses onto the existing ref.
//
// CUT1.1.1 (PLA064): portfolio and product tables were dropped in
// migration 249. page_entity_refs vocabulary is now empty — all kinds
// return ErrUnknownEntityKind. The method is kept to avoid breaking
// callers at compile time; callers should be updated to remove entity
// bookmark operations (TD-CUT1.1.1-BOOKMARK-SURFACE).
func (s *Service) InsertPageEntityRef(ctx context.Context, tx pgx.Tx, pageID uuid.UUID, kind EntityKind, entityID, callerSubscription uuid.UUID) error {
	{
		return ErrUnknownEntityKind
	}
	if _, err := s.LoadParent(ctx, tx, kind, entityID, callerSubscription); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, sqlInsertPageEntityRef,
		pageID, string(kind), entityID)
	return err
}

// CleanupChildren deletes every polymorphic child row pointing at
// (kind, id). Source of truth for the registry is the table in
// docs/c_polymorphic_writes.md — keep this map in sync. Called from
// every parent's archive/delete handler inside the same tx as the
// archive UPDATE.
//
// Returns the total number of rows deleted across all child tables for
// the kind, mostly so callers can log it. Unknown kinds return
// ErrUnknownEntityKind without touching the database.
//
// REGISTRY of archive handlers (TD-001 Phase 3, audit 2026-04-23):
//   - workspace        — no Go handler exists yet
//   - portfolio        — no Go handler exists yet
//   - product          — no Go handler exists yet
//   - company_roadmap  — no Go handler exists yet (auto-created, may
//                        never be archived per c_schema.md)
// Each future handler MUST call CleanupChildren in the same tx as its
// archive UPDATE. The dispatch trigger (migration 013) cannot enforce
// this — it only catches inserts. The canary TestNoPolymorphicOrphans
// is the post-deploy backstop.
func (s *Service) CleanupChildren(ctx context.Context, tx pgx.Tx, kind EntityKind, id uuid.UUID) (int64, error) {
	rels, ok := childRelationshipsFor(kind)
	if !ok {
		return 0, ErrUnknownEntityKind
	}
	var total int64
	for _, rel := range rels {
		// rel.table + rel.kindCol + rel.idCol are hard-coded — never user input.
		tag, err := tx.Exec(ctx,
			fmt.Sprintf(sqlDeletePolymorphicChildFmt, rel.table, rel.kindCol, rel.idCol),
			string(kind), id)
		if err != nil {
			return total, fmt.Errorf("cleanup %s: %w", rel.table, err)
		}
		total += tag.RowsAffected()
	}
	return total, nil
}

// childRel describes one (table, kind-column, id-column) tuple in the
// cleanup registry. Tables that pair the same parent kind with
// different child columns (e.g. an item_type_states row keyed by a
// future obj_strategy_types extension) need their own entry here.
type childRel struct {
	table   string
	kindCol string
	idCol   string
}

var (
	childRelStakeholders = childRel{table: "subscriptions_stakeholders", kindCol: "subscriptions_stakeholders_entity_kind", idCol: "subscriptions_stakeholders_entity_id"}
	childRelPageRefs     = childRel{table: "page_entity_refs", kindCol: "page_entity_refs_entity_kind", idCol: "page_entity_refs_entity_id"}
)

// childRelationshipsFor returns every polymorphic child table whose
// vocabulary accepts the given parent kind.
//
// CUT1.1.1 (PLA064): company_roadmap, workspace, portfolio, product tables
// were dropped in migration 249 — all kinds now return (nil, false).
func childRelationshipsFor(kind EntityKind) ([]childRel, bool) {
	return nil, false
}
