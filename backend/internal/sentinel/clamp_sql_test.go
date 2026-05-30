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
//
// PLA062 S26 hardening — the helpers now distinguish FOUR states via
// Clamp.SubtreeResolved, not two:
//   - State 1 no middleware            (SubtreeResolved=false)       -> no-op
//   - State 2 resolved >=1 node        (true, len>0)                 -> = ANY
//   - State 3 resolved empty set       (true, len==0)                -> AND FALSE / empty slice (fail CLOSED)
//   - State 4 deliberate bypass        (false, AllowedSubtreeIDs=nil)-> no-op
// States 1 and 4 share SubtreeResolved=false; state 3 is the fail-open
// hole this pins shut.

// State 1 — no middleware attached a clamp: no clause, no arg advance.
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

// State 4 — deliberate bypass (WithBypassedSubtreeClamp clears
// SubtreeResolved): must stay a no-op so post-write reads return the row.
func TestSubtreeClause_BypassReturnsEmpty(t *testing.T) {
	// Seed a fully-resolved clamp, then bypass it.
	base := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{uuid.New()},
		SubtreeResolved:   true,
	})
	ctx := WithBypassedSubtreeClamp(base)
	args := []any{"sub-id"}
	frag, out, n := SubtreeClause(ctx, "a", args, 2)
	if frag != "" {
		t.Errorf("frag = %q, want empty (bypassed clamp)", frag)
	}
	if len(out) != 1 || out[0] != "sub-id" {
		t.Errorf("args unexpectedly mutated: %v", out)
	}
	if n != 2 {
		t.Errorf("nextIdx = %d, want 2 (no advance on bypass)", n)
	}
}

// State 3 — middleware resolved an EMPTY set: fail CLOSED with " AND FALSE",
// args and nextIdx unchanged. This is the fail-open hole being closed.
func TestSubtreeClause_ResolvedEmptyFailsClosed(t *testing.T) {
	ctx := TestingWithClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{},
		SubtreeResolved:   true,
	})
	args := []any{"sub-id", "scope"}
	frag, out, n := SubtreeClause(ctx, "a", args, 3)
	if frag != " AND FALSE" {
		t.Errorf("frag = %q, want %q (resolved-empty must fail closed)", frag, " AND FALSE")
	}
	if len(out) != 2 {
		t.Errorf("args unexpectedly mutated: %v (want unchanged, len 2)", out)
	}
	if n != 3 {
		t.Errorf("nextIdx = %d, want 3 (no slot consumed for AND FALSE)", n)
	}
}

func TestSubtreeClause_ClampPresentSplicesFragment(t *testing.T) {
	id1 := uuid.New()
	id2 := uuid.New()
	ctx := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{id1, id2},
		SubtreeResolved:   true,
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

// State 1 — no middleware: caller list passes through unchanged.
func TestApplyClampToIDs_NoClampReturnsCallerListUnchanged(t *testing.T) {
	caller := []uuid.UUID{uuid.New(), uuid.New()}
	out := ApplyClampToIDs(context.Background(), caller)
	if len(out) != 2 || out[0] != caller[0] || out[1] != caller[1] {
		t.Errorf("got %v, want caller list unchanged %v", out, caller)
	}
}

// State 4 — deliberate bypass: caller list passes through unchanged.
func TestApplyClampToIDs_BypassReturnsCallerListUnchanged(t *testing.T) {
	base := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{uuid.New()},
		SubtreeResolved:   true,
	})
	ctx := WithBypassedSubtreeClamp(base)
	caller := []uuid.UUID{uuid.New(), uuid.New()}
	out := ApplyClampToIDs(ctx, caller)
	if len(out) != 2 || out[0] != caller[0] || out[1] != caller[1] {
		t.Errorf("got %v, want caller list unchanged %v (bypass)", out, caller)
	}
}

// State 3 — middleware resolved an EMPTY set: intersection is empty,
// caller list must NOT pass through. Fail CLOSED.
func TestApplyClampToIDs_ResolvedEmptyReturnsEmpty(t *testing.T) {
	ctx := TestingWithClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{},
		SubtreeResolved:   true,
	})
	caller := []uuid.UUID{uuid.New(), uuid.New()}
	out := ApplyClampToIDs(ctx, caller)
	if len(out) != 0 {
		t.Errorf("got %v, want empty slice (resolved-empty must fail closed)", out)
	}
}

// State 2 — resolved >=1 node: intersection of caller list and clamp.
func TestApplyClampToIDs_IntersectsWithClamp(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	c := uuid.New()
	// Clamp permits {a, b}. Caller asks for {b, c}. Result: {b}.
	ctx := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{a, b},
		SubtreeResolved:   true,
	})
	out := ApplyClampToIDs(ctx, []uuid.UUID{b, c})
	if len(out) != 1 || out[0] != b {
		t.Errorf("got %v, want [%v] (intersection)", out, b)
	}
}

// State 2 with nil caller list — the clamp itself is the narrowing.
func TestApplyClampToIDs_NilCallerReturnsClampList(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	ctx := withClamp(context.Background(), Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{a, b},
		SubtreeResolved:   true,
	})
	out := ApplyClampToIDs(ctx, nil)
	if len(out) != 2 || out[0] != a || out[1] != b {
		t.Errorf("got %v, want clamp list %v", out, []uuid.UUID{a, b})
	}
}
