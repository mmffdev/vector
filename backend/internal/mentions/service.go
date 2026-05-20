package mentions

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/notifications"
)

// snippetMax caps how much of the surrounding text we persist. Keeps
// the row small and prevents an attacker from stuffing the whole
// document into a notification.
const snippetMax = 280

// Service is the mentions domain. It writes to users_mentions on the
// mmff_vector pool, reads the mentions-scope setting from
// master_record_tenants on vaPool (PLA-0050), resolves context labels
// via a per-kind registry, and hands the fanned-out events to the
// notifier interface for the (not-yet-built) runner to pick up.
type Service struct {
	pool     *pgxpool.Pool         // mmff_vector — users + users_mentions
	vaPool   *pgxpool.Pool         // vector_artefacts — master_record_tenants
	notifier notifications.Notifier

	mu        sync.RWMutex
	resolvers map[string]ContextResolver
}

// NewService constructs a Service. vaPool and notifier may be nil —
// scope defaults to 'tenant' when vaPool is nil, and a nil notifier
// is treated as no-op (the same as NoopNotifier).
func NewService(pool, vaPool *pgxpool.Pool, notifier notifications.Notifier) *Service {
	return &Service{
		pool:      pool,
		vaPool:    vaPool,
		notifier:  notifier,
		resolvers: make(map[string]ContextResolver),
	}
}

// RegisterContextResolver wires a resolver for a context kind. Call
// from main.go (or a kind's package init) before requests arrive.
// Re-registering a kind overwrites the previous resolver — the last
// caller wins, which matches the wider Vector pattern (e.g. ranking).
func (s *Service) RegisterContextResolver(kind string, r ContextResolver) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolvers[kind] = r
}

// resolveLabel looks up the human-readable label for (kind, id).
// Returns ErrUnresolvedContext if no resolver is registered or the
// resolver itself reports the id is unknown.
func (s *Service) resolveLabel(rctx ResolveCtx, c Context) (string, error) {
	s.mu.RLock()
	r, ok := s.resolvers[c.Kind]
	s.mu.RUnlock()
	if !ok {
		return "", fmt.Errorf("%w: kind %q has no resolver", ErrUnresolvedContext, c.Kind)
	}
	label, err := r(rctx, c.ID)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrUnresolvedContext, err)
	}
	if strings.TrimSpace(label) == "" {
		return "", fmt.Errorf("%w: empty label for %s/%s", ErrUnresolvedContext, c.Kind, c.ID)
	}
	return label, nil
}

// MentionsScope returns the active scope setting for the
// subscription. Reads vaPool.master_record_tenants; falls back to
// ScopeTenant when vaPool is unavailable or the row is missing.
func (s *Service) MentionsScope(ctx context.Context, subscriptionID uuid.UUID) (ScopeSetting, error) {
	if s.vaPool == nil {
		return ScopeTenant, nil
	}
	var raw string
	err := s.vaPool.QueryRow(ctx, sqlGetMentionsScopeSetting, subscriptionID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return ScopeTenant, nil
	}
	if err != nil {
		return ScopeTenant, fmt.Errorf("read mentions scope: %w", err)
	}
	switch ScopeSetting(raw) {
	case ScopeTeam:
		return ScopeTeam, nil
	default:
		return ScopeTenant, nil
	}
}

// SearchMentionables returns up to filters.Limit users matching the
// prefix in filters.Q. Tenant-scoped by subscriptionID. When the
// subscription's mentions_scope = 'team', narrows to users sharing a
// team with callerUserID.
func (s *Service) SearchMentionables(
	ctx context.Context,
	subscriptionID uuid.UUID,
	callerUserID uuid.UUID,
	filters SearchFilters,
) ([]Mentionable, error) {
	q := strings.TrimSpace(filters.Q)
	if q == "" {
		return []Mentionable{}, nil
	}
	limit := filters.Limit
	if limit <= 0 || limit > 25 {
		limit = 10
	}
	pattern := q + "%"

	scope, err := s.MentionsScope(ctx, subscriptionID)
	if err != nil {
		return nil, err
	}

	// Scope=team relies on users_teams_members, which the teams feature
	// will introduce later. Until that table exists, the query errors;
	// the service degrades to tenant scope rather than 500-ing the
	// picker. Safe because admins can only opt-in to team scope after
	// they've installed the teams feature.
	var rows pgx.Rows
	switch scope {
	case ScopeTeam:
		rows, err = s.pool.Query(ctx, sqlSearchMentionablesTeam, subscriptionID, pattern, limit, callerUserID)
		if err != nil {
			rows, err = s.pool.Query(ctx, sqlSearchMentionablesTenant, subscriptionID, pattern, limit)
		}
	default:
		rows, err = s.pool.Query(ctx, sqlSearchMentionablesTenant, subscriptionID, pattern, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("search mentionables: %w", err)
	}
	defer rows.Close()

	out := make([]Mentionable, 0, limit)
	for rows.Next() {
		var m Mentionable
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.FirstName, &m.LastName); err != nil {
			return nil, fmt.Errorf("scan mentionable: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Create writes one users_mentions row per mentioned user (fan-out
// at write time so the inbox query stays a flat index seek), then
// hands each row to the notifier. Errors are returned per-call;
// a partial failure rolls the whole batch back.
func (s *Service) Create(ctx context.Context, in CreateMentionInput) ([]Mention, error) {
	if err := validateCreate(in); err != nil {
		return nil, err
	}
	label, err := s.resolveLabel(
		ResolveCtx{SubscriptionID: in.SubscriptionID, WorkspaceID: in.WorkspaceID},
		in.Context,
	)
	if err != nil {
		return nil, err
	}
	snippet := truncate(in.Snippet, snippetMax)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin create-mentions tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// If the notifier supports transactional outbox (DBNotifier does),
	// we'll write outbox rows inside this tx so the mentions + outbox
	// commit atomically — that's the canonical transactional-outbox
	// guarantee. NoopNotifier doesn't; for it we fall back to a
	// post-commit Enqueue (which is a no-op anyway).
	txNotifier, _ := s.notifier.(notifications.TxNotifier)

	results := make([]Mention, 0, len(in.MentionedUserIDs))
	for _, recipient := range in.MentionedUserIDs {
		if recipient == in.AuthorUserID {
			continue // self-mention is a no-op, not an error
		}
		row := tx.QueryRow(ctx, sqlInsertMention,
			in.SubscriptionID,
			in.WorkspaceID,
			in.AuthorUserID,
			recipient,
			in.Context.Kind,
			in.Context.ID,
			label,
			snippet,
		)
		m, err := scanMention(row)
		if err != nil {
			return nil, fmt.Errorf("insert mention for %s: %w", recipient, err)
		}
		results = append(results, *m)

		// Outbox write inside the same tx (transactional outbox).
		if txNotifier != nil {
			if err := txNotifier.EnqueueTx(ctx, tx, notifications.Event{
				Kind:            notifications.KindMention,
				SubscriptionID:  m.SubscriptionID,
				WorkspaceID:     m.WorkspaceID,
				AuthorUserID:    m.AuthorUserID,
				RecipientUserID: m.MentionedUserID,
				ContextKind:     m.ContextKind,
				ContextID:       m.ContextID,
				ContextLabel:    m.ContextLabel,
				Snippet:         m.Snippet,
			}); err != nil {
				return nil, fmt.Errorf("enqueue notification for %s: %w", recipient, err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit create-mentions: %w", err)
	}

	// Fallback for non-tx notifiers (NoopNotifier in dev without RMQ).
	// Skipped when we already enqueued inside the tx above.
	if txNotifier == nil && s.notifier != nil {
		for _, m := range results {
			_ = s.notifier.Enqueue(ctx, notifications.Event{
				Kind:            notifications.KindMention,
				SubscriptionID:  m.SubscriptionID,
				WorkspaceID:     m.WorkspaceID,
				AuthorUserID:    m.AuthorUserID,
				RecipientUserID: m.MentionedUserID,
				ContextKind:     m.ContextKind,
				ContextID:       m.ContextID,
				ContextLabel:    m.ContextLabel,
				Snippet:         m.Snippet,
			})
		}
	}
	return results, nil
}

// ListInbox returns the caller's mentions, newest first. Tenant
// isolation: rows are double-fenced — by subscription_id AND by
// user_mentioned = callerUserID.
func (s *Service) ListInbox(ctx context.Context, subscriptionID, callerUserID uuid.UUID, f InboxFilters) ([]Mention, error) {
	limit := f.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	conds := []string{
		"users_mentions_id_subscription = $1",
		"users_mentions_id_user_mentioned = $2",
	}
	args := []any{subscriptionID, callerUserID}
	if f.OnlyUnread {
		conds = append(conds, "users_mentions_read_at IS NULL")
	}
	q := fmt.Sprintf(sqlListInboxTemplate, strings.Join(conds, " AND "), len(args)+1)
	args = append(args, limit)

	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list inbox: %w", err)
	}
	defer rows.Close()

	out := []Mention{}
	for rows.Next() {
		m, err := scanMention(rows)
		if err != nil {
			return nil, fmt.Errorf("scan inbox row: %w", err)
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// MarkRead flips read_at for one mention, asserting ownership.
// Returns ErrNotFound when the row doesn't exist, isn't owned by the
// caller, or was already read.
func (s *Service) MarkRead(ctx context.Context, mentionID, callerUserID uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, sqlMarkRead, mentionID, callerUserID)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func validateCreate(in CreateMentionInput) error {
	if in.SubscriptionID == uuid.Nil {
		return fmt.Errorf("%w: subscription_id is required", ErrInvalidInput)
	}
	if in.AuthorUserID == uuid.Nil {
		return fmt.Errorf("%w: author_user_id is required", ErrInvalidInput)
	}
	if len(in.MentionedUserIDs) == 0 {
		return fmt.Errorf("%w: at least one mentioned_user_id is required", ErrInvalidInput)
	}
	if strings.TrimSpace(in.Context.Kind) == "" {
		return fmt.Errorf("%w: context_kind is required", ErrInvalidInput)
	}
	if strings.TrimSpace(in.Context.ID) == "" {
		return fmt.Errorf("%w: context_id is required", ErrInvalidInput)
	}
	return nil
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

type scannable interface {
	Scan(dest ...any) error
}

func scanMention(row scannable) (*Mention, error) {
	var m Mention
	err := row.Scan(
		&m.ID,
		&m.SubscriptionID,
		&m.WorkspaceID,
		&m.AuthorUserID,
		&m.MentionedUserID,
		&m.ContextKind,
		&m.ContextID,
		&m.ContextLabel,
		&m.Snippet,
		&m.CreatedAt,
		&m.ReadAt,
	)
	if err != nil {
		return nil, err
	}
	return &m, nil
}
