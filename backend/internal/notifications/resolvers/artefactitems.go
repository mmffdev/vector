// Package resolvers wires mention-context resolvers for the notification
// system. Lives next to broker/ and dispatchers/ so the whole
// notifications surface is one folder.
//
// Segregation note: this package depends ONLY on the public mentions
// resolver interface (mentions.ContextResolver) and a raw vaPool. It
// does NOT import the artefactitems package — the lookup is done via
// a single SQL constant inline, keeping the boundary between the
// notification surface and the ObjectTree-adjacent artefactitems
// package clean. When ObjectTree's refactor lands and the
// artefactitems Service surface changes, this package is unaffected;
// the only contract it depends on is the artefacts table shape
// (subscription_id + id + artefact_type_id → name/prefix/number/title)
// which is stable schema, not code.
//
// Resolver shape:
//   - context_kind  → maps to the artefact-type's `name` (lower-case
//     slug — "task", "story", "defect", "epic", "feature", "theme",
//     etc.). Matches the kind labels used by the mentions handler.
//   - context_id    → MUST be a UUID string. The artefact's id in
//     vector_artefacts.artefacts. The "DE-101" human handle is a
//     display convention, not a lookup key — UUID is the stable
//     contract (per design decision 2026-05-21).
//   - label         → "DE-101 — Title" (prefix + number + em-dash +
//     title). Same shape the mentions template renders into emails
//     and the InApp dispatcher.
//
// Subscription clamp: the SQL clamps on subscription_id, so a mention
// resolver cannot accidentally label an artefact from another tenant.
// Type-kind guardrail: the resolver factory asserts the looked-up
// row's lower(name) matches the registered kind — a payload trying
// to label a Defect UUID as a Story would resolve to "" + ErrNotFound
// rather than leak a different artefact's identity.

package resolvers

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/mentions"
)

// NewArtefactResolver builds a ContextResolver for one artefact kind
// (e.g. "task", "defect"). The returned function is safe to register
// with mentions.Service.RegisterContextResolver.
//
// The factory is parameterised by `kind` so the SAME resolver code
// serves every artefact kind — main.go calls it once per kind
// (RegisterArtefactResolvers below batches the well-known set).
//
// vaPool may be nil; the resolver returns a "no resolver" error
// shape (ContextResolver returning empty string + error) so the
// handler emits its normal unresolved-context message. Same fallback
// pattern as the rest of the notifications surface — every layer
// degrades gracefully when its dependency isn't wired.
func NewArtefactResolver(vaPool *pgxpool.Pool, kind string) mentions.ContextResolver {
	expectedSlug := strings.ToLower(strings.TrimSpace(kind))
	return func(rctx mentions.ResolveCtx, contextID string) (string, error) {
		if vaPool == nil {
			return "", fmt.Errorf("artefact resolver: vaPool not wired")
		}
		id, err := uuid.Parse(strings.TrimSpace(contextID))
		if err != nil {
			// Per design call 2026-05-21 the wire only carries UUIDs.
			// Anything else is malformed — same shape as a not-found
			// row (caller emits an unresolved-context error).
			return "", fmt.Errorf("artefact resolver: invalid uuid %q: %w", contextID, err)
		}
		var prefix, title, typeSlug string
		var keyNum int64
		err = vaPool.QueryRow(context.Background(), sqlSelectArtefactLabel,
			id, rctx.SubscriptionID,
		).Scan(&prefix, &keyNum, &title, &typeSlug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", fmt.Errorf("artefact resolver: %s/%s not found in tenant", kind, contextID)
			}
			return "", fmt.Errorf("artefact resolver: lookup %s: %w", contextID, err)
		}
		// Type-kind guardrail: a mention payload that says "kind:
		// defect" must resolve to a row that IS a defect. Without
		// this check the resolver would happily render any artefact
		// UUID with the wrong kind label — small leak, but cheap to
		// close.
		if typeSlug != expectedSlug {
			return "", fmt.Errorf("artefact resolver: id %s is not a %s (type=%s)", contextID, expectedSlug, typeSlug)
		}
		return fmt.Sprintf("%s-%d — %s", prefix, keyNum, title), nil
	}
}

// RegisterArtefactResolvers — convenience batch registrar. Walks the
// well-known artefact kinds and registers a resolver for each. Call
// from main.go after mentions.Service is constructed and vaPool is
// wired:
//
//	resolvers.RegisterArtefactResolvers(mentionsSvc, vaPool)
//
// New kinds added later (e.g. "risk", "decision") just need an entry
// in defaultArtefactKinds. Custom tenant types not in this list
// won't have mention support until they're added — single source of
// truth for "what artefact kinds can be @-mentioned right now."
func RegisterArtefactResolvers(svc *mentions.Service, vaPool *pgxpool.Pool) {
	if svc == nil {
		return
	}
	for _, kind := range defaultArtefactKinds {
		svc.RegisterContextResolver(kind, NewArtefactResolver(vaPool, kind))
	}
}

// defaultArtefactKinds — every artefact kind that has @-mention
// support out of the box. Matches the lowercase artefact-types name
// (slug) on the row, NOT the type prefix. The catalogue stores
// slugs lowercase (`task`, `story`, ...) which is why
// NewArtefactResolver compares via ToLower.
//
// Strategic ladder included so a user can @-mention a Theme or
// Feature in a discussion just like they can mention an Epic. The
// resolver doesn't apply any scope-based gating; that's the
// mentions handler's job (subscription clamp already in the SQL).
var defaultArtefactKinds = []string{
	// Execution
	"task",
	"story",
	"defect",
	"epic",
	// Strategy ladder (full list from the dev catalogue)
	"feature",
	"theme",
	"business outcome",
	"business objective",
	"business epic",
	"product",
	"initiative",
	"portfolio objective",
	"portfolio runway",
	"strategic objective",
	"strategy",
}
