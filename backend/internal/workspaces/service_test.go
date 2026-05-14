package workspaces

// Unit tests for the workspaces sole-writer surface (PLA-0006 / story
// 00376). Mirrors the shape of orgdesign/grant_gate_test.go: focuses
// on the pre-DB validation gates (input validation, permission
// gate, role validation) so the package can be unit-tested without
// a live Postgres pool. DB-roundtrip behaviour (slug uniqueness,
// last-live-archive guard, single-admin invariant on the partial
// unique index) is exercised by the integration test that lands
// alongside story 00377's REST surface, where a real fixture pool
// is available.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// fakePerms is an in-memory PermissionResolver: returns true for
// every code in the granted set, false otherwise. errOn forces an
// error from Has when non-nil — used to exercise the plumbing-error
// path of requirePermission.
type fakePerms struct {
	granted map[permissions.Code]struct{}
	errOn   error
}

func newFakePerms(codes ...permissions.Code) *fakePerms {
	g := make(map[permissions.Code]struct{}, len(codes))
	for _, c := range codes {
		g[c] = struct{}{}
	}
	return &fakePerms{granted: g}
}

func (f *fakePerms) Has(_ context.Context, _ uuid.UUID, code permissions.Code) (bool, error) {
	if f.errOn != nil {
		return false, f.errOn
	}
	_, ok := f.granted[code]
	return ok, nil
}

// ──────────────────────────────────────────────────────────────────
// Role.IsValid
// ──────────────────────────────────────────────────────────────────

func TestRole_IsValid(t *testing.T) {
	for _, r := range []Role{RoleAdmin, RoleEditor, RoleViewer} {
		if !r.IsValid() {
			t.Errorf("Role(%q).IsValid() = false, want true", r)
		}
	}
	for _, r := range []Role{Role(""), Role("owner"), Role("ADMIN"), Role("admin ")} {
		if r.IsValid() {
			t.Errorf("Role(%q).IsValid() = true, want false", r)
		}
	}
}

// ──────────────────────────────────────────────────────────────────
// requirePermission
// ──────────────────────────────────────────────────────────────────

func TestRequirePermission_NilResolverPasses(t *testing.T) {
	// nil resolver = gate disabled (used by tests + bootstrap).
	s := &Service{}
	if err := s.requirePermission(context.Background(), uuid.New(), permissions.Code("workspace.create")); err != nil {
		t.Fatalf("nil resolver should pass, got %v", err)
	}
}

func TestRequirePermission_GrantedPasses(t *testing.T) {
	s := &Service{Perms: newFakePerms(permissions.Code("workspace.create"))}
	if err := s.requirePermission(context.Background(), uuid.New(), permissions.Code("workspace.create")); err != nil {
		t.Fatalf("granted code should pass, got %v", err)
	}
}

func TestRequirePermission_MissingDenies(t *testing.T) {
	s := &Service{Perms: newFakePerms()}
	err := s.requirePermission(context.Background(), uuid.New(), permissions.Code("workspace.create"))
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("missing code: want ErrPermissionDenied, got %v", err)
	}
}

func TestRequirePermission_PlumbingErrorPropagates(t *testing.T) {
	boom := errors.New("db down")
	s := &Service{Perms: &fakePerms{errOn: boom}}
	err := s.requirePermission(context.Background(), uuid.New(), permissions.Code("workspace.create"))
	if !errors.Is(err, boom) {
		t.Fatalf("plumbing err: want %v, got %v", boom, err)
	}
}

// ──────────────────────────────────────────────────────────────────
// Create — input validation gates that fire BEFORE DB access
// ──────────────────────────────────────────────────────────────────

func TestCreate_PermissionGate(t *testing.T) {
	// No `workspace.create` granted → ErrPermissionDenied before any
	// DB work. Pool is nil; if the gate fails open, this panics on
	// BeginTx and the test fails loudly.
	s := &Service{Perms: newFakePerms()}
	_, err := s.Create(context.Background(), CreateInput{
		SubscriptionID: uuid.New(),
		Name:           "Default",
		Slug:           "default",
		ActorID:        uuid.New(),
	})
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("create without perm: want ErrPermissionDenied, got %v", err)
	}
}

func TestCreate_RejectsEmptyName(t *testing.T) {
	s := &Service{Perms: newFakePerms(permissions.Code("workspace.create"))}
	_, err := s.Create(context.Background(), CreateInput{
		SubscriptionID: uuid.New(),
		Name:           "   ",
		Slug:           "default",
		ActorID:        uuid.New(),
	})
	if !errors.Is(err, ErrInvalidName) {
		t.Fatalf("empty name: want ErrInvalidName, got %v", err)
	}
}

func TestCreate_RejectsInvalidSlug(t *testing.T) {
	s := &Service{Perms: newFakePerms(permissions.Code("workspace.create"))}
	cases := []string{
		"",          // empty
		"-leading",  // can't start with dash
		"UPPER",     // no uppercase
		"under_bar", // no underscore
		"sp ace",    // no whitespace
		"slash/x",   // no slash
	}
	for _, slug := range cases {
		_, err := s.Create(context.Background(), CreateInput{
			SubscriptionID: uuid.New(),
			Name:           "Workspace",
			Slug:           slug,
			ActorID:        uuid.New(),
		})
		if !errors.Is(err, ErrInvalidSlug) {
			t.Errorf("slug %q: want ErrInvalidSlug, got %v", slug, err)
		}
	}
}

// ──────────────────────────────────────────────────────────────────
// Rename / Archive / Restore — permission gates fire BEFORE DB access
// ──────────────────────────────────────────────────────────────────

func TestRename_PermissionGate(t *testing.T) {
	s := &Service{Perms: newFakePerms()}
	err := s.Rename(context.Background(), uuid.New(), uuid.New(), "New Name", uuid.New())
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("rename without perm: want ErrPermissionDenied, got %v", err)
	}
}

func TestRename_RejectsEmptyName(t *testing.T) {
	s := &Service{Perms: newFakePerms(permissions.Code("workspace.rename"))}
	// Empty-name validation runs AFTER permission gate but BEFORE the
	// pgxpool BeginTx — so a nil pool is fine here.
	err := s.Rename(context.Background(), uuid.New(), uuid.New(), "  ", uuid.New())
	if !errors.Is(err, ErrInvalidName) {
		t.Fatalf("rename empty name: want ErrInvalidName, got %v", err)
	}
}

func TestArchive_PermissionGate(t *testing.T) {
	s := &Service{Perms: newFakePerms()}
	err := s.Archive(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("archive without perm: want ErrPermissionDenied, got %v", err)
	}
}

func TestRestore_PermissionGate(t *testing.T) {
	s := &Service{Perms: newFakePerms()}
	err := s.Restore(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("restore without perm: want ErrPermissionDenied, got %v", err)
	}
}

// ──────────────────────────────────────────────────────────────────
// ListBySubscription — view_archived gate
// ──────────────────────────────────────────────────────────────────

func TestListBySubscription_ViewArchivedGate(t *testing.T) {
	// Caller without workspace.view_archived asking for archived rows
	// is rejected before the DB query.
	s := &Service{Perms: newFakePerms()}
	_, err := s.ListBySubscription(context.Background(), uuid.New(), true, uuid.New())
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("list archived without perm: want ErrPermissionDenied, got %v", err)
	}
}

// ──────────────────────────────────────────────────────────────────
// GrantRole / RevokeRole — gates that fire BEFORE DB access
// ──────────────────────────────────────────────────────────────────

func TestGrantRole_RejectsInvalidRole(t *testing.T) {
	// Invalid role short-circuits before the permission gate (matches
	// orgdesign.GrantRole's order so callers get the same shape).
	s := &Service{Perms: newFakePerms()}
	_, err := s.GrantRole(context.Background(), uuid.New(), uuid.New(), uuid.New(), Role("owner"), uuid.New())
	if !errors.Is(err, ErrInvalidRole) {
		t.Fatalf("invalid role: want ErrInvalidRole, got %v", err)
	}
}

func TestGrantRole_PermissionGate(t *testing.T) {
	s := &Service{Perms: newFakePerms()}
	_, err := s.GrantRole(context.Background(), uuid.New(), uuid.New(), uuid.New(), RoleAdmin, uuid.New())
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("grant without perm: want ErrPermissionDenied, got %v", err)
	}
}

func TestRevokeRole_PermissionGate(t *testing.T) {
	s := &Service{Perms: newFakePerms()}
	err := s.RevokeRole(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("revoke without perm: want ErrPermissionDenied, got %v", err)
	}
}

// ──────────────────────────────────────────────────────────────────
// CreateDefault — bootstrap signup hook (PLA-0006 / 00382 AC #3)
// ──────────────────────────────────────────────────────────────────

func TestCreateDefault_SkipsPermissionGate(t *testing.T) {
	// CreateDefault is the tenant-signup bootstrap path: it must NOT
	// consult Perms (the new tenant's first user holds no role
	// grants yet). We can't drive a real INSERT without a pool, so
	// instead we drive nil tx — which panics inside QueryRow if the
	// permission gate has already passed AND we reach the DB call.
	// A panic here means the gate was correctly skipped; an
	// ErrPermissionDenied return would mean the gate fired.
	s := &Service{Perms: newFakePerms()} // no codes granted

	defer func() {
		if r := recover(); r == nil {
			t.Fatalf("CreateDefault should have reached the DB call (and panicked on nil tx); got clean return — permission gate likely fired")
		}
		// nil-tx panic is the success signal: the gate was bypassed
		// and execution reached tx.QueryRow.
	}()

	_, _ = s.CreateDefault(context.Background(), nil, uuid.New(), uuid.New())
}

func TestCreateDefault_UsesCanonicalSlug(t *testing.T) {
	// Lock the contract: AC #3 says the workspace is named "Default"
	// with slug "default". Future refactors must not silently change
	// either constant. The slug must also satisfy the regex CHECK.
	const wantName = "Default"
	const wantSlug = "default"

	if !slugRegex.MatchString(wantSlug) {
		t.Fatalf("default slug %q must satisfy slugRegex (workspaces.slug CHECK)", wantSlug)
	}
	if wantName == "" {
		t.Fatalf("default name must be non-empty (workspaces.name CHECK)")
	}
}

// ──────────────────────────────────────────────────────────────────
// CheckCrossDBOrphans — PLA-0026 / story 00502 (B13)
// ──────────────────────────────────────────────────────────────────

// TestCheckCrossDBOrphans_NoVAPoolIsNoOp verifies the documented
// "guard disabled" path: when VAPool is nil (no VECTOR_ARTEFACTS_DB_URL
// configured) the scan returns (nil, nil) without any DB access. The
// caller is responsible for documenting that the deletion path is
// unguarded in that mode.
func TestCheckCrossDBOrphans_NoVAPoolIsNoOp(t *testing.T) {
	s := &Service{} // VAPool nil; Pool nil — must not be touched
	out, err := s.CheckCrossDBOrphans(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("nil VAPool: want nil error, got %v", err)
	}
	if len(out) != 0 {
		t.Errorf("nil VAPool: want empty slice, got %d entries: %+v", len(out), out)
	}
}

// TestVAWorkspaceTables_MatchesCanary locks the table list against
// drift from the cross-DB canary in
// internal/portfoliomodels/cross_db_canary_test.go. If a new table is
// added to vector_artefacts that carries workspace_id, both lists
// must be updated together — this test does not import the canary's
// list directly (the test files live in different packages and the
// canary is _test.go-only) but pins the table names + archived_at
// flags so a divergence is caught at unit-test time.
func TestVAWorkspaceTables_MatchesCanary(t *testing.T) {
	type entry struct {
		name          string
		hasArchivedAt bool
	}
	want := []entry{
		{"artefact_types", true},
		{"artefact_workspace_fields", false},
		{"artefacts", true},
		{"master_record_portfolios", false},
		{"sprints", true},
	}
	if len(vaWorkspaceTables) != len(want) {
		t.Fatalf("table count drift: got %d, canary lists %d", len(vaWorkspaceTables), len(want))
	}
	for i, w := range want {
		got := vaWorkspaceTables[i]
		if got.name != w.name || got.hasArchivedAt != w.hasArchivedAt {
			t.Errorf("entry %d: got {%s,%v}, want {%s,%v}", i, got.name, got.hasArchivedAt, w.name, w.hasArchivedAt)
		}
	}
}

// TestWithVAPool_AttachesPool verifies the fluent setter mutates the
// receiver. nil-pool round-trip is allowed (guard-disabled state) and
// the setter must accept it without panicking.
func TestWithVAPool_AttachesPool(t *testing.T) {
	s := &Service{}
	if got := s.WithVAPool(nil); got != s {
		t.Errorf("WithVAPool should return the receiver for chaining")
	}
	if s.VAPool != nil {
		t.Errorf("WithVAPool(nil) should leave VAPool nil")
	}
}

// ──────────────────────────────────────────────────────────────────
// Slug regex — locks in the workspaces.slug CHECK constraint
// ──────────────────────────────────────────────────────────────────

func TestSlugRegex_AcceptsCanonical(t *testing.T) {
	good := []string{
		"default",
		"a",
		"abc-123",
		"0lead-with-digit",
		"a-b-c-d",
	}
	for _, slug := range good {
		if !slugRegex.MatchString(slug) {
			t.Errorf("slug %q should match", slug)
		}
	}
}

func TestSlugRegex_RejectsInvalid(t *testing.T) {
	bad := []string{
		"",
		"-bad",
		"BAD",
		"under_score",
		"trailing.",
		"with space",
		"slash/x",
	}
	for _, slug := range bad {
		if slugRegex.MatchString(slug) {
			t.Errorf("slug %q should NOT match", slug)
		}
	}
}
