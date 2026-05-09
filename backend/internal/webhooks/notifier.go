package webhooks

import (
	"context"
	"log"

	"github.com/google/uuid"
)

// Notifier is a thin fire-and-forget event emitter. Inject it into
// services that need to publish domain events without importing the
// full webhooks package. The zero value (nil pointer) is safe — Fire
// is a no-op when the Notifier is nil.
type Notifier struct {
	svc *Service
}

// NewNotifier wraps a Service. Pass nil to get a no-op notifier.
func NewNotifier(svc *Service) *Notifier {
	if svc == nil {
		return nil
	}
	return &Notifier{svc: svc}
}

// Fire enqueues an event for all matching subscriptions in the
// workspace. Runs in a detached goroutine — never blocks the caller.
func (n *Notifier) Fire(workspaceID uuid.UUID, eventType string, data any) {
	if n == nil || n.svc == nil {
		return
	}
	payload, err := MarshalEvent(workspaceID.String(), eventType, data)
	if err != nil {
		log.Printf("webhooks/notifier: marshal error for %s: %v", eventType, err)
		return
	}
	go func() {
		if err := n.svc.Enqueue(context.Background(), workspaceID, eventType, payload); err != nil {
			log.Printf("webhooks/notifier: enqueue error for %s: %v", eventType, err)
		}
	}()
}
