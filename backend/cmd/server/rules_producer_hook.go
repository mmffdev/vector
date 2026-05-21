package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/mmffdev/vector-backend/internal/notifications"
	"github.com/mmffdev/vector-backend/internal/notifications/rules"
)

// rulesProducerHook bridges the artefact-write producer side
// (ArtefactChangedEvent) to the consumer side (notifications outbox).
// Holds both the rules.Evaluator (matching) and notifications.Notifier
// (fan-out) — keeps main.go as the only place that touches both.
//
// Why not in the rules package: rules.Evaluator must not import
// notifications.Notifier or we get a cycle (notifications imports
// nothing today and we want to keep it that way). Putting the
// adapter in main.go (a non-importable package) preserves the
// invariant.
type rulesProducerHook struct {
	evaluator *rules.Evaluator
	notifier  notifications.Notifier
	logger    *slog.Logger
}

func newRulesProducerHook(e *rules.Evaluator, n notifications.Notifier, l *slog.Logger) *rulesProducerHook {
	if l == nil {
		l = slog.Default()
	}
	return &rulesProducerHook{evaluator: e, notifier: n, logger: l}
}

// OnArtefactChanged is the producer's entry point. Loads matching
// rules, fans each match into the notifications outbox. Best-effort
// — any failure is logged but never bubbles back to the artefact
// write that triggered it (the artefactitems service already drops
// our errors on purpose).
func (h *rulesProducerHook) OnArtefactChanged(ctx context.Context, ev rules.ArtefactChangedEvent) {
	if h.evaluator == nil || h.notifier == nil {
		return
	}
	matched, err := h.evaluator.MatchEvent(ctx, ev)
	if err != nil {
		h.logger.Error("rules.producer-hook: evaluator failed", "err", err, "artefact_id", ev.ArtefactID)
		return
	}
	for _, r := range matched {
		// Each matched rule fires its own notification, addressed to
		// the rule's owner (user). The kind is "artefact" so the bell
		// inbox tag filter buckets it under the artefact tag.
		if r.UserID == nil {
			// Admin-scoped rules aren't wired today (see rules service
			// ErrAdminScopeUnwired); defensive skip.
			continue
		}
		// Skip self-notifications. If the rule's owner is the author
		// of the change, don't notify them about their own edit —
		// matches Slack / Linear / Jira default behaviour. Override
		// could be a future per-rule "notify me about my own changes"
		// toggle.
		if *r.UserID == ev.AuthorUserID {
			continue
		}
		event := notifications.Event{
			Kind:            notifications.Kind(string(r.Type)), // "artefact"
			SubscriptionID:  ev.SubscriptionID,
			WorkspaceID:     ev.WorkspaceID,
			AuthorUserID:    ev.AuthorUserID,
			RecipientUserID: *r.UserID,
			ContextKind:     ev.ArtefactType,
			ContextID:       ev.ArtefactID.String(),
			ContextLabel:    fmt.Sprintf("%s %s — rule: %s", ev.ArtefactType, ev.ArtefactID.String(), r.Name),
			Snippet:         fmt.Sprintf("Rule %q matched.", r.Name),
		}
		if err := h.notifier.Enqueue(ctx, event); err != nil {
			h.logger.Error("rules.producer-hook: notifier enqueue failed",
				"err", err, "rule_id", r.ID, "recipient", r.UserID)
		}
	}
}
