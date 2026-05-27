package pipeline

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
)

// InMemoryPendingStore is an in-process PendingStore implementation for use in
// unit and integration tests. It is NOT a production substitute for the Valkey
// ZSET implementation (S12). It is safe for concurrent use.
type InMemoryPendingStore struct {
	mu      sync.Mutex
	entries []PendingEntry
}

// NewInMemoryPendingStore constructs an empty InMemoryPendingStore.
func NewInMemoryPendingStore() *InMemoryPendingStore {
	return &InMemoryPendingStore{}
}

// Push adds entry to the in-memory store. Always succeeds; never returns
// ErrPendingUnavailable (unavailability is only relevant for the Valkey impl).
func (s *InMemoryPendingStore) Push(_ context.Context, entry PendingEntry) error {
	if entry.EnqueuedAt.IsZero() {
		entry.EnqueuedAt = time.Now()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.entries = append(s.entries, entry)
	return nil
}

// PopDue returns and removes up to limit entries whose DueAt <= now().
// Returned entries are ordered by DueAt ascending (earliest first).
func (s *InMemoryPendingStore) PopDue(_ context.Context, limit int) ([]PendingEntry, error) {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()

	var due []PendingEntry
	var remaining []PendingEntry
	for _, e := range s.entries {
		if !e.DueAt.After(now) && len(due) < limit {
			due = append(due, e)
		} else {
			remaining = append(remaining, e)
		}
	}
	sort.Slice(due, func(i, j int) bool {
		return due[i].DueAt.Before(due[j].DueAt)
	})
	s.entries = remaining
	return due, nil
}

// PeekDigestBucket returns all entries for (userID, bucket) without removing them.
// Returned entries are ordered by DueAt ascending.
func (s *InMemoryPendingStore) PeekDigestBucket(_ context.Context, userID uuid.UUID, bucket string) ([]PendingEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var out []PendingEntry
	for _, e := range s.entries {
		if e.RecipientUserID == userID && e.DigestBucket == bucket {
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].DueAt.Before(out[j].DueAt)
	})
	return out, nil
}

// Len returns the total number of entries currently in the store.
// Useful for test assertions.
func (s *InMemoryPendingStore) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries)
}
