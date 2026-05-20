// Package mentions owns the @-mention surface: typeahead search for
// mentionable users (scoped tenant- or team-wide per subscription
// setting), recording mention events when a textbox is submitted,
// and a per-user inbox the future notification runner can read from.
//
// The handler is mounted on both transports — /_site/mentions (BFF)
// and /samantha/v2/mentions (public API) — per PLA-0039.
package mentions

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound     = errors.New("mention not found")
	ErrInvalidInput = errors.New("invalid mention input")
	// ErrUnresolvedContext is returned when ContextKind has no
	// registered resolver. The handler treats this as a client
	// error (400) — the frontend sent a kind the backend doesn't
	// know how to label.
	ErrUnresolvedContext = errors.New("mention context could not be resolved")
)

// Mentionable is one entry returned by the picker search. Shape is
// deliberately thin — first/last/display name + email + id. The
// frontend uses ID for selection and DisplayName for the chip label.
type Mentionable struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	FirstName   *string   `json:"first_name,omitempty"`
	LastName    *string   `json:"last_name,omitempty"`
}

// SearchFilters narrows the typeahead. Q is a case-insensitive prefix
// match against email + first/last/display name. Limit is clamped
// server-side (1..25).
type SearchFilters struct {
	Q     string
	Limit int
}

// ScopeSetting controls who the picker can see. 'tenant' = anyone in
// the caller's subscription. 'team' = members of the caller's team(s)
// only. Default is 'tenant'; admins flip via tenant master record.
type ScopeSetting string

const (
	ScopeTenant ScopeSetting = "tenant"
	ScopeTeam   ScopeSetting = "team"
)

// Context identifies the artefact the mention lives on. Kind is a
// short string registered with the resolver registry (e.g. "defect",
// "story", "comment"). ID is whatever string the kind's resolver
// uses to look up its label.
type Context struct {
	Kind string `json:"context_kind"`
	ID   string `json:"context_id"`
}

// CreateMentionInput is the service-layer payload. Per fan-out
// target, the service writes one row to users_mentions.
type CreateMentionInput struct {
	SubscriptionID    uuid.UUID
	WorkspaceID       uuid.UUID
	AuthorUserID      uuid.UUID
	MentionedUserIDs  []uuid.UUID
	Context           Context
	Snippet           string
}

// Mention is the wire representation of one users_mentions row.
type Mention struct {
	ID              uuid.UUID  `json:"users_mentions_id"`
	SubscriptionID  uuid.UUID  `json:"users_mentions_id_subscription"`
	WorkspaceID     uuid.UUID  `json:"users_mentions_id_workspace"`
	AuthorUserID    uuid.UUID  `json:"users_mentions_id_user_author"`
	MentionedUserID uuid.UUID  `json:"users_mentions_id_user_mentioned"`
	ContextKind     string     `json:"users_mentions_context_kind"`
	ContextID       string     `json:"users_mentions_context_id"`
	ContextLabel    string     `json:"users_mentions_context_label"`
	Snippet         string     `json:"users_mentions_snippet"`
	CreatedAt       time.Time  `json:"users_mentions_created_at"`
	ReadAt          *time.Time `json:"users_mentions_read_at,omitempty"`
}

// InboxFilters narrows the inbox query.
type InboxFilters struct {
	OnlyUnread bool
	Limit      int
}

// ContextResolver returns the human-readable label for a (kind, id)
// pair. New artefact kinds register their resolver via
// Service.RegisterContextResolver. Returning an empty string + nil
// error is treated as "kind known, id not found" → ErrNotFound.
type ContextResolver func(ctx ResolveCtx, contextID string) (label string, err error)

// ResolveCtx carries the values a resolver needs without dragging in
// a *http.Request or stdlib context. SubscriptionID is required for
// every resolver — labels never leak across subscriptions.
type ResolveCtx struct {
	SubscriptionID uuid.UUID
	WorkspaceID    uuid.UUID
}
