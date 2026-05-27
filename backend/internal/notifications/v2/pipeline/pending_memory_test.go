package pipeline

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/domain"
)

func TestInMemoryPendingStore_PushPopDue(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryPendingStore()

	now := time.Now()
	userID := uuid.New()
	eventID := uuid.New()

	early := PendingEntry{
		EventID:           eventID,
		RecipientUserID:   userID,
		Channel:           domain.ChannelEmail,
		DigestBucket:      "bucket-A",
		DueAt:             now.Add(-2 * time.Minute), // already due
		EffectivePriority: domain.PriorityMedium,
	}
	future := PendingEntry{
		EventID:           uuid.New(),
		RecipientUserID:   userID,
		Channel:           domain.ChannelInApp,
		DigestBucket:      "bucket-A",
		DueAt:             now.Add(10 * time.Minute), // not yet due
		EffectivePriority: domain.PriorityLow,
	}

	if err := s.Push(ctx, early); err != nil {
		t.Fatalf("Push early: %v", err)
	}
	if err := s.Push(ctx, future); err != nil {
		t.Fatalf("Push future: %v", err)
	}
	if s.Len() != 2 {
		t.Fatalf("want 2 entries, got %d", s.Len())
	}

	// PopDue should return only the entry that's already past due.
	due, err := s.PopDue(ctx, 10)
	if err != nil {
		t.Fatalf("PopDue: %v", err)
	}
	if len(due) != 1 {
		t.Fatalf("PopDue: want 1 entry, got %d", len(due))
	}
	if due[0].Channel != domain.ChannelEmail {
		t.Errorf("PopDue: want email channel, got %s", due[0].Channel)
	}

	// Future entry should still be in store.
	if s.Len() != 1 {
		t.Fatalf("after PopDue: want 1 remaining, got %d", s.Len())
	}
}

func TestInMemoryPendingStore_PopDueOrderByDueAt(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryPendingStore()

	now := time.Now()
	userID := uuid.New()

	// Push three entries with different due times, out of order.
	e1 := PendingEntry{EventID: uuid.New(), RecipientUserID: userID, Channel: domain.ChannelInApp, DigestBucket: "b", DueAt: now.Add(-3 * time.Minute)}
	e2 := PendingEntry{EventID: uuid.New(), RecipientUserID: userID, Channel: domain.ChannelEmail, DigestBucket: "b", DueAt: now.Add(-1 * time.Minute)}
	e3 := PendingEntry{EventID: uuid.New(), RecipientUserID: userID, Channel: domain.ChannelSSE, DigestBucket: "b", DueAt: now.Add(-2 * time.Minute)}

	for _, e := range []PendingEntry{e2, e3, e1} { // push out of order
		if err := s.Push(ctx, e); err != nil {
			t.Fatal(err)
		}
	}

	due, err := s.PopDue(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 3 {
		t.Fatalf("want 3 due, got %d", len(due))
	}
	// Expect ascending DueAt order: e1 (oldest), e3, e2 (newest).
	if due[0].Channel != domain.ChannelInApp {
		t.Errorf("want in_app first (oldest due), got %s", due[0].Channel)
	}
	if due[1].Channel != domain.ChannelSSE {
		t.Errorf("want sse second, got %s", due[1].Channel)
	}
	if due[2].Channel != domain.ChannelEmail {
		t.Errorf("want email third (newest due), got %s", due[2].Channel)
	}
}

func TestInMemoryPendingStore_PeekDigestBucket(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryPendingStore()

	userA := uuid.New()
	userB := uuid.New()

	eA1 := PendingEntry{EventID: uuid.New(), RecipientUserID: userA, Channel: domain.ChannelEmail, DigestBucket: "bucket-X", DueAt: time.Now().Add(5 * time.Minute)}
	eA2 := PendingEntry{EventID: uuid.New(), RecipientUserID: userA, Channel: domain.ChannelInApp, DigestBucket: "bucket-X", DueAt: time.Now().Add(10 * time.Minute)}
	eB := PendingEntry{EventID: uuid.New(), RecipientUserID: userB, Channel: domain.ChannelEmail, DigestBucket: "bucket-X", DueAt: time.Now().Add(5 * time.Minute)}

	for _, e := range []PendingEntry{eA1, eA2, eB} {
		if err := s.Push(ctx, e); err != nil {
			t.Fatal(err)
		}
	}

	// Peek should return only userA's entries for bucket-X.
	result, err := s.PeekDigestBucket(ctx, userA, "bucket-X")
	if err != nil {
		t.Fatalf("PeekDigestBucket: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("want 2 entries for userA bucket-X, got %d", len(result))
	}
	// Peek must NOT remove entries.
	if s.Len() != 3 {
		t.Errorf("Peek must not remove entries; want 3, got %d", s.Len())
	}

	// Wrong bucket returns nothing.
	empty, err := s.PeekDigestBucket(ctx, userA, "bucket-Y")
	if err != nil {
		t.Fatalf("PeekDigestBucket wrong bucket: %v", err)
	}
	if len(empty) != 0 {
		t.Errorf("want 0 for wrong bucket, got %d", len(empty))
	}
}

func TestInMemoryPendingStore_PopDueLimitRespected(t *testing.T) {
	ctx := context.Background()
	s := NewInMemoryPendingStore()

	userID := uuid.New()
	past := time.Now().Add(-1 * time.Minute)
	for i := 0; i < 5; i++ {
		_ = s.Push(ctx, PendingEntry{EventID: uuid.New(), RecipientUserID: userID, Channel: domain.ChannelEmail, DigestBucket: "b", DueAt: past})
	}

	due, err := s.PopDue(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(due) != 3 {
		t.Fatalf("want 3 (limit), got %d", len(due))
	}
	if s.Len() != 2 {
		t.Fatalf("want 2 remaining, got %d", s.Len())
	}
}
