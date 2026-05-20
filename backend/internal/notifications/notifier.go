// Package notifications is the seam for outbound user notifications
// (mention pings, watcher digests, etc.). The runner that actually
// delivers them is not built yet — Notifier defines the surface so
// callers (mentions service, future watchers) can be wired now and
// the runner can swap in without handler changes.
package notifications

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Kind discriminates the notification trigger. New kinds are added by
// the producer that fires them; the runner (when built) inspects Kind
// to pick a template + channel set.
type Kind string

const (
	KindMention Kind = "mention"
)

// Event is the wire payload handed to Notifier.Enqueue. Fields are
// flat strings so the runner can log/persist without knowing the
// caller's struct types. ContextKind + ContextID identify the
// addressable artefact ("defect" + "DE-101"), ContextLabel is the
// human-readable resolver output ("DE-101 — Login fails on Safari").
// Snippet is the text surrounding the @-mention, capped server-side.
type Event struct {
	Kind            Kind
	SubscriptionID  uuid.UUID
	WorkspaceID     uuid.UUID
	AuthorUserID    uuid.UUID
	RecipientUserID uuid.UUID
	ContextKind     string
	ContextID       string
	ContextLabel    string
	Snippet         string
}

// Notifier is the interface the mentions service (and future
// producers) call. Implementations decide whether to enqueue to a
// table, push to a runner queue, fan out to email/in-app, etc.
type Notifier interface {
	Enqueue(ctx context.Context, e Event) error
}

// TxNotifier is the optional extension a Notifier may satisfy to
// support transactional-outbox semantics. Producers that own a tx
// (e.g. mentions.Service inserting users_mentions) type-assert to
// this and call EnqueueTx so the outbox write commits or rolls back
// with their domain write. Producers without a tx use plain Enqueue.
//
// DBNotifier satisfies TxNotifier; NoopNotifier does not (Enqueue
// suffices when there's no real broker).
type TxNotifier interface {
	Notifier
	EnqueueTx(ctx context.Context, tx pgx.Tx, e Event) error
}

// NoopNotifier satisfies Notifier without delivering anything. It
// logs at debug level so dev sessions can confirm the call site
// fired without polluting normal output.
type NoopNotifier struct {
	Logger *slog.Logger
}

// NewNoop returns a NoopNotifier. Pass slog.Default() in main.go.
func NewNoop(logger *slog.Logger) *NoopNotifier {
	return &NoopNotifier{Logger: logger}
}

// Enqueue logs the event and returns nil. The runner replacement
// will persist or push instead.
func (n *NoopNotifier) Enqueue(ctx context.Context, e Event) error {
	if n.Logger == nil {
		return nil
	}
	n.Logger.Debug("notifications: enqueue (noop)",
		"kind", string(e.Kind),
		"subscription_id", e.SubscriptionID.String(),
		"workspace_id", e.WorkspaceID.String(),
		"author_user_id", e.AuthorUserID.String(),
		"recipient_user_id", e.RecipientUserID.String(),
		"context_kind", e.ContextKind,
		"context_id", e.ContextID,
	)
	return nil
}
