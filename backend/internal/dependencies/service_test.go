package dependencies

import (
	"context"
	"testing"
)

// TestNewService_NilPool — constructor accepts a nil pool (legacy
// envs without vaPool) without panicking. VerifySchema then short-
// circuits to nil so server boot does not fail in those envs.
func TestNewService_NilPool(t *testing.T) {
	t.Parallel()
	s := NewService(nil)
	if s == nil {
		t.Fatal("NewService(nil) returned nil — expected a usable Service value")
	}
	if err := s.VerifySchema(context.Background()); err != nil {
		t.Fatalf("VerifySchema with nil pool: unexpected error %v", err)
	}
}

// TestEdgeKind_IsValid — the kind enum vocabulary pinned at the type
// layer matches the CHECK constraint on artefact_dependency_edges_kind.
// Adding a new kind requires updating both this test AND the
// migration's CHECK.
func TestEdgeKind_IsValid(t *testing.T) {
	t.Parallel()
	cases := []struct {
		kind  EdgeKind
		valid bool
	}{
		{EdgeKindFinishToStart, true},
		{EdgeKindParallel, true},
		{EdgeKind(""), false},
		{EdgeKind("blocks"), false},
		{EdgeKind("FINISH_TO_START"), false},
	}
	for _, c := range cases {
		if got := c.kind.IsValid(); got != c.valid {
			t.Errorf("EdgeKind(%q).IsValid() = %v, want %v", c.kind, got, c.valid)
		}
	}
}
