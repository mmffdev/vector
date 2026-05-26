package sentinel

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// PLA062 S26 — SubtreeClause + ApplyClampToIDs unit tests.
//
// The clamp is the load-bearing procurement contract: a handler MUST
// see the SQL fragment + args when the middleware attached a Clamp,
// and MUST see a no-op when no clamp is present (admin / dev paths).
// These four cases pin the surface that 6 packages depend on.

func TestSubtreeClause_NoClampReturnsEmpty(t *testing.T) {
	args := []any{"sub-id"}
	frag, out, n := SubtreeClause(context.Background(), "a", args, 2)
	if frag != "" {
		t.Errorf("frag = %q, want empty (no clamp on ctx)", frag)
	}
	if len(out) != 1 || out[0] != "sub-id" {
		t.Errorf("args unexpectedly mutated: %v", out)
	}
	if n != 2 {
		t.Errorf("nextIdx = %d, want 2 (no advance when no clamp)", n)
	}
}

func TestSubtreeClause_ClampPresentSplicesFragment(t *testing.T) {
	id1 := uuid.New()
	id2 := uuid.New()
	ctx := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{id1, id2},
	})
	args := []any{"sub-id", "scope"}
	frag, out, n := SubtreeClause(ctx, "a", args, 3)
	want := " AND a.artefacts_id_topology_node = ANY($3::uuid[])"
	if frag != want {
		t.Errorf("frag = %q, want %q", frag, want)
	}
	if len(out) != 3 {
		t.Fatalf("args len = %d, want 3 (subscriptionID + scope + clamp slice)", len(out))
	}
	ids, ok := out[2].([]uuid.UUID)
	if !ok {
		t.Fatalf("out[2] type = %T, want []uuid.UUID", out[2])
	}
	if len(ids) != 2 || ids[0] != id1 || ids[1] != id2 {
		t.Errorf("clamp ids = %v, want %v", ids, []uuid.UUID{id1, id2})
	}
	if n != 4 {
		t.Errorf("nextIdx = %d, want 4 (one slot consumed)", n)
	}
}

func TestApplyClampToIDs_NoClampReturnsCallerListUnchanged(t *testing.T) {
	caller := []uuid.UUID{uuid.New(), uuid.New()}
	out := ApplyClampToIDs(context.Background(), caller)
	if len(out) != 2 || out[0] != caller[0] || out[1] != caller[1] {
		t.Errorf("got %v, want caller list unchanged %v", out, caller)
	}
}

func TestApplyClampToIDs_IntersectsWithClamp(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	c := uuid.New()
	// Clamp permits {a, b}. Caller asks for {b, c}. Result: {b}.
	ctx := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{a, b},
	})
	out := ApplyClampToIDs(ctx, []uuid.UUID{b, c})
	if len(out) != 1 || out[0] != b {
		t.Errorf("got %v, want [%v] (intersection)", out, b)
	}
}
