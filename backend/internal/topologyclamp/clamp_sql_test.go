package topologyclamp

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/sentinel"
)

// The clamp adapter pins the four-state Sentinel contract:
//   - no middleware -> no-op
//   - resolved >=1 node -> = ANY
//   - resolved empty set -> fail closed
//   - deliberate bypass -> no-op

func TestSubtreeClause_NoClampReturnsEmpty(t *testing.T) {
	args := []any{"sub-id"}
	frag, out, n := SubtreeClause(context.Background(), "a.artefacts_id_topology_node", args, 2)
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

func TestSubtreeClause_BypassReturnsEmpty(t *testing.T) {
	base := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{uuid.New()},
		SubtreeResolved:   true,
	})
	ctx := sentinel.WithBypassedSubtreeClamp(base)
	args := []any{"sub-id"}
	frag, out, n := SubtreeClause(ctx, "a.artefacts_id_topology_node", args, 2)
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

func TestSubtreeClause_ResolvedEmptyFailsClosed(t *testing.T) {
	ctx := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{},
		SubtreeResolved:   true,
	})
	args := []any{"sub-id", "scope"}
	frag, out, n := SubtreeClause(ctx, "a.artefacts_id_topology_node", args, 3)
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
	ctx := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{id1, id2},
		SubtreeResolved:   true,
	})
	args := []any{"sub-id", "scope"}
	frag, out, n := SubtreeClause(ctx, "a.artefacts_id_topology_node", args, 3)
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

func TestSubtreeClause_UsesCallerColumn(t *testing.T) {
	ctx := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{uuid.New()},
		SubtreeResolved:   true,
	})
	frag, _, _ := SubtreeClause(ctx, "n.topology_nodes_id", nil, 1)
	want := " AND n.topology_nodes_id = ANY($1::uuid[])"
	if frag != want {
		t.Errorf("frag = %q, want %q", frag, want)
	}
}

func TestApplyClampToIDs_NoClampReturnsCallerListUnchanged(t *testing.T) {
	caller := []uuid.UUID{uuid.New(), uuid.New()}
	out := ApplyClampToIDs(context.Background(), caller)
	if len(out) != 2 || out[0] != caller[0] || out[1] != caller[1] {
		t.Errorf("got %v, want caller list unchanged %v", out, caller)
	}
}

func TestApplyClampToIDs_BypassReturnsCallerListUnchanged(t *testing.T) {
	base := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
		TenantID:          uuid.New(),
		UserID:            uuid.New(),
		AllowedSubtreeIDs: []uuid.UUID{uuid.New()},
		SubtreeResolved:   true,
	})
	ctx := sentinel.WithBypassedSubtreeClamp(base)
	caller := []uuid.UUID{uuid.New(), uuid.New()}
	out := ApplyClampToIDs(ctx, caller)
	if len(out) != 2 || out[0] != caller[0] || out[1] != caller[1] {
		t.Errorf("got %v, want caller list unchanged %v (bypass)", out, caller)
	}
}

func TestApplyClampToIDs_ResolvedEmptyReturnsEmpty(t *testing.T) {
	ctx := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
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

func TestApplyClampToIDs_IntersectsWithClamp(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	c := uuid.New()
	ctx := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
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

func TestApplyClampToIDs_NilCallerReturnsClampList(t *testing.T) {
	a := uuid.New()
	b := uuid.New()
	ctx := sentinel.TestingWithClamp(context.Background(), sentinel.Clamp{
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
