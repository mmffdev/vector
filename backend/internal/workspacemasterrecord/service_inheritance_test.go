package workspacemasterrecord

// Integration tests for tenant→workspace inheritance — PLA-0051 / Story 1.
//
// These tests are written FIRST (red) before Service.Get gains its
// COALESCE-merge behaviour or the Settings struct gains *_source fields.
// Compilation will fail against the current code (no SourceFor helper,
// no inheritance behaviour) — that compile-fail IS the initial red
// signal. Stories 2–5 chase these to green.
//
// Skip-on-unreachable: the package's existing convention is integration
// tests against a live vector_artefacts pool, skipped when VA_DB_*
// envs are unset or the pool fails to ping. Same pattern as
// internal/workspaces/crossdb_integration_test.go.
//
// Test fixture strategy: each test creates a fresh test subscription +
// test workspace inside a single function-scoped transaction, runs its
// assertions, then ROLLBACKs to leave the live DB clean. The subscription
// auto-seeds its tenant defaults row via tenantmasterrecord.Get's
// ensure-row path (the same path that fixed the broken trigger in
// migration 200).
//
// NOTE on the eight cases (matches PLA-0051 work_item_backlog Story 1):
//   1. TestGet_WorkspaceOverridePresent_SourceIsWorkspace
//   2. TestGet_WorkspaceNullTenantPresent_SourceIsTenant
//   3. TestGet_BothNull_SourceIsSystemDefault
//   4. TestGet_AllInheritableFieldsCovered
//   5. TestPatch_ExplicitNullClearsOverride
//   6. TestPatch_ExplicitValueSetsOverride
//   7. TestGet_CrossSubscriptionIsolation
//   8. TestGet_TenantArchived_FallsToSystemDefault

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// ─── fixture helpers ────────────────────────────────────────────────────

// vaPoolForTest opens a pool against vector_artefacts. Skips the test
// if the tunnel is down or env vars are unset.
func vaPoolForTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	for _, rel := range []string{".env.local", "../../.env.local", "../../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=workspacemasterrecord_inheritance_test",
		os.Getenv("VA_DB_HOST"),
		os.Getenv("VA_DB_PORT"),
		os.Getenv("VA_DB_USER"),
		os.Getenv("VA_DB_PASSWORD"),
		os.Getenv("VA_DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open vector_artefacts pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts: %v", err)
	}
	return pool
}

// testFixture stages a subscription + a workspace + (optionally) overrides
// on either tier. The cleanup func DELETEs the test rows on completion so
// the live DB stays unpolluted.
type testFixture struct {
	pool           *pgxpool.Pool
	subscriptionID uuid.UUID
	workspaceID    uuid.UUID
	cleanup        func()
}

// makeFixture creates a fresh subscription + workspace pair. PLA-0051 Story 3
// will resolve subscription_id from workspace_id via the topology — until
// that lands, tests stash the subscription_id directly here.
func makeFixture(t *testing.T, pool *pgxpool.Pool) testFixture {
	t.Helper()
	subID := uuid.New()
	wsID := uuid.New()
	ctx := context.Background()

	// Auto-seed tenant defaults row for the subscription. PLA-0050 Story
	// 00569's SeedForSubscription path; calling _record_tenants_seed
	// inline keeps this test file independent of tenantmasterrecord's
	// Go surface.
	if _, err := pool.Exec(ctx,
		`INSERT INTO master_record_tenants (master_record_tenants_id_subscription) VALUES ($1)
			ON CONFLICT DO NOTHING`,
		subID,
	); err != nil {
		t.Fatalf("seed tenant row: %v", err)
	}

	// Create the workspace row. Post-mig-069 (PLA-0051 Story 2) the
	// inheritable columns default to NULL; pre-mig they default to system
	// defaults. Tests assert behaviour from the public Service.Get only,
	// so they're robust to either schema state.
	if _, err := pool.Exec(ctx,
		`INSERT INTO master_record_workspaces (master_record_workspaces_id_workspace)
			VALUES ($1) ON CONFLICT DO NOTHING`,
		wsID,
	); err != nil {
		// Likely failure: post-mig-069 the workspace_id column still has
		// no FK to a topology row, so this INSERT fails because no row
		// names this workspace. Story 3's COALESCE resolves
		// subscription_id via topology — extend the fixture then.
		t.Fatalf("seed workspace row (no topology link?): %v", err)
	}

	cleanup := func() {
		_, _ = pool.Exec(ctx, `DELETE FROM master_record_workspaces WHERE master_record_workspaces_id_workspace = $1`, wsID)
		_, _ = pool.Exec(ctx, `DELETE FROM master_record_tenants WHERE master_record_tenants_id_subscription = $1`, subID)
	}
	return testFixture{pool: pool, subscriptionID: subID, workspaceID: wsID, cleanup: cleanup}
}

// inheritableFields is the canonical list (matches what PLA-0051 mig 069
// drops NOT NULL on, and what Story 4 surfaces in the wire shape).
var inheritableFields = []string{
	"tenant_data_region",
	"tenant_timezone",
	"tenant_date_format",
	"tenant_datetime_format",
	"tenant_workdays",
	"tenant_week_start",
	"tenant_rank_method",
	"tenant_build_changeset_tracking",
	"tenant_primary_contact_email",
	"tenant_description",
	"tenant_notes",
}

// ─── fake inheritance wiring ──────────────────────────────────────────
//
// fakeSubsResolver returns a stashed workspace→subscription mapping.
// Production reads fdw_workspaces; tests just hand it the pair the
// fixture set up.
type fakeSubsResolver struct {
	mapping map[uuid.UUID]uuid.UUID
}

func (f *fakeSubsResolver) SubscriptionFor(_ context.Context, workspaceID uuid.UUID) (uuid.UUID, error) {
	if sub, ok := f.mapping[workspaceID]; ok {
		return sub, nil
	}
	return uuid.Nil, pgx.ErrNoRows
}

// dbTenantReader reads tenant defaults from vector_artefacts.master_record_tenants
// using the same pool tests already have. Adapts the raw DB row into the
// tenantSettings shape Service.mergeInheritance consumes.
type dbTenantReader struct{ pool *pgxpool.Pool }

func (r *dbTenantReader) Get(ctx context.Context, subscriptionID uuid.UUID) (*tenantSettings, error) {
	const q = `
		SELECT master_record_tenants_data_region,
		       master_record_tenants_timezone,
		       master_record_tenants_date_format,
		       master_record_tenants_datetime_format,
		       master_record_tenants_workdays,
		       master_record_tenants_week_start,
		       master_record_tenants_rank_method,
		       master_record_tenants_build_changeset_tracking,
		       master_record_tenants_primary_contact_email,
		       master_record_tenants_description,
		       master_record_tenants_notes,
		       master_record_tenants_archived_at
		  FROM master_record_tenants
		 WHERE master_record_tenants_id_subscription = $1`
	var t tenantSettings
	err := r.pool.QueryRow(ctx, q, subscriptionID).Scan(
		&t.DataRegion, &t.Timezone, &t.DateFormat, &t.DatetimeFormat,
		&t.Workdays, &t.WeekStart, &t.RankMethod, &t.BuildChangesetTracking,
		&t.PrimaryContactEmail, &t.Description, &t.Notes,
		&t.ArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// makeInheritingSvc wires a Service with a fake resolver + real DB
// tenant reader so the fixture's (workspace, subscription) pair lights
// up the inheritance path.
func makeInheritingSvc(pool *pgxpool.Pool, fx testFixture) *Service {
	return New(pool).WithInheritance(
		&fakeSubsResolver{mapping: map[uuid.UUID]uuid.UUID{fx.workspaceID: fx.subscriptionID}},
		&dbTenantReader{pool: pool},
	)
}

// ─── 1. workspace override → source=workspace ──────────────────────────

func TestGet_WorkspaceOverridePresent_SourceIsWorkspace(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()

	// Set an explicit workspace-level override on timezone.
	const override = "Europe/Paris"
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_workspaces SET master_record_workspaces_timezone = $1 WHERE master_record_workspaces_id_workspace = $2`,
		override, fx.workspaceID,
	); err != nil {
		t.Fatalf("seed override: %v", err)
	}

	svc := makeInheritingSvc(pool, fx)
	s, err := svc.Get(context.Background(), fx.workspaceID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if s.TenantTimezone != override {
		t.Errorf("TenantTimezone = %q, want %q", s.TenantTimezone, override)
	}
	if got := s.TenantTimezoneSource; got != "workspace" {
		t.Errorf("TenantTimezoneSource = %q, want %q (PLA-0051 Story 4 adds _source fields)", got, "workspace")
	}
}

// ─── 2. workspace NULL + tenant value → source=tenant ──────────────────

func TestGet_WorkspaceNullTenantPresent_SourceIsTenant(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()

	// Set the tenant-level value; leave the workspace value NULL.
	// (Post-mig-069: workspace column allows NULL; pre-mig: this UPDATE
	// will need to clear via the default-clearing pattern. Test asserts
	// the post-mig contract.)
	const tenantValue = "Asia/Tokyo"
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_tenants SET master_record_tenants_timezone = $1 WHERE master_record_tenants_id_subscription = $2`,
		tenantValue, fx.subscriptionID,
	); err != nil {
		t.Fatalf("seed tenant value: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_workspaces SET master_record_workspaces_timezone = NULL WHERE master_record_workspaces_id_workspace = $1`,
		fx.workspaceID,
	); err != nil {
		t.Fatalf("null workspace value (mig 069 should permit this): %v", err)
	}

	svc := makeInheritingSvc(pool, fx)
	s, err := svc.Get(context.Background(), fx.workspaceID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if s.TenantTimezone != tenantValue {
		t.Errorf("TenantTimezone = %q, want inherited %q", s.TenantTimezone, tenantValue)
	}
	if got := s.TenantTimezoneSource; got != "tenant" {
		t.Errorf("TenantTimezoneSource = %q, want %q", got, "tenant")
	}
}

// ─── 3. both NULL → source=system_default ──────────────────────────────

func TestGet_BothNull_SourceIsSystemDefault(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()

	// Null both tiers explicitly.
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_tenants SET master_record_tenants_timezone = NULL WHERE master_record_tenants_id_subscription = $1`,
		fx.subscriptionID,
	); err != nil {
		t.Fatalf("null tenant value: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE master_record_workspaces SET master_record_workspaces_timezone = NULL WHERE master_record_workspaces_id_workspace = $1`,
		fx.workspaceID,
	); err != nil {
		t.Fatalf("null workspace value: %v", err)
	}

	svc := makeInheritingSvc(pool, fx)
	s, err := svc.Get(context.Background(), fx.workspaceID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	// System default per the schema is 'Europe/London'.
	const systemDefault = "Europe/London"
	if s.TenantTimezone != systemDefault {
		t.Errorf("TenantTimezone = %q, want system default %q", s.TenantTimezone, systemDefault)
	}
	if got := s.TenantTimezoneSource; got != "system_default" {
		t.Errorf("TenantTimezoneSource = %q, want %q", got, "system_default")
	}
}

// ─── 4. every inheritable field has a _source marker ───────────────────

func TestGet_AllInheritableFieldsCovered(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()

	svc := makeInheritingSvc(pool, fx)
	s, err := svc.Get(context.Background(), fx.workspaceID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	// PLA-0051 Story 4: every inheritable field gains a {field}_source
	// sibling. Test asserts each is set to a non-empty value (one of
	// "workspace" | "tenant" | "system_default"). Tightens to the exact
	// expected value per field once the COALESCE logic lands.
	sources := map[string]string{
		"tenant_data_region":              s.TenantDataRegionSource,
		"tenant_timezone":                 s.TenantTimezoneSource,
		"tenant_date_format":              s.TenantDateFormatSource,
		"tenant_datetime_format":          s.TenantDatetimeFormatSource,
		"tenant_workdays":                 s.TenantWorkdaysSource,
		"tenant_week_start":               s.TenantWeekStartSource,
		"tenant_rank_method":              s.TenantRankMethodSource,
		"tenant_build_changeset_tracking": s.TenantBuildChangesetTrackingSource,
		"tenant_primary_contact_email":    s.TenantPrimaryContactEmailSource,
		"tenant_description":              s.TenantDescriptionSource,
		"tenant_notes":                    s.TenantNotesSource,
	}
	for field, src := range sources {
		if src == "" {
			t.Errorf("%s source is empty; expected one of workspace|tenant|system_default", field)
			continue
		}
		if src != "workspace" && src != "tenant" && src != "system_default" {
			t.Errorf("%s source = %q; expected one of workspace|tenant|system_default", field, src)
		}
	}
	// Belt-and-braces: confirm we tested all 11 inheritable fields.
	if got, want := len(sources), len(inheritableFields); got != want {
		t.Errorf("covered %d _source fields, expected %d (canonical list in inheritableFields)", got, want)
	}
}

// ─── 5. PATCH explicit null clears override ────────────────────────────

func TestPatch_ExplicitNullClearsOverride(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()
	ctx := context.Background()

	// Set tenant value + workspace override.
	const tenantValue = "Asia/Tokyo"
	const wsOverride = "Europe/Paris"
	if _, err := pool.Exec(ctx,
		`UPDATE master_record_tenants SET master_record_tenants_timezone = $1 WHERE master_record_tenants_id_subscription = $2`,
		tenantValue, fx.subscriptionID,
	); err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE master_record_workspaces SET master_record_workspaces_timezone = $1 WHERE master_record_workspaces_id_workspace = $2`,
		wsOverride, fx.workspaceID,
	); err != nil {
		t.Fatalf("seed override: %v", err)
	}

	svc := makeInheritingSvc(pool, fx)

	// PATCH with explicit null. PLA-0051 Story 5: PatchInput.TenantTimezone
	// is a tri-state (absent / explicit-null / value). Calling Patch with
	// an explicit-null in the field nulls the workspace column.
	if _, err := svc.Patch(ctx, fx.workspaceID, /* actorID */ uuid.Nil, PatchInput{
		ClearOverrides: []string{"tenant_timezone"},
	}); err != nil {
		t.Fatalf("Patch clear: %v", err)
	}

	s, err := svc.Get(ctx, fx.workspaceID)
	if err != nil {
		t.Fatalf("Get post-clear: %v", err)
	}
	if s.TenantTimezone != tenantValue {
		t.Errorf("post-clear TenantTimezone = %q, want inherited %q", s.TenantTimezone, tenantValue)
	}
	if got := s.TenantTimezoneSource; got != "tenant" {
		t.Errorf("post-clear TenantTimezoneSource = %q, want %q", got, "tenant")
	}
}

// ─── 6. PATCH explicit value sets override ─────────────────────────────

func TestPatch_ExplicitValueSetsOverride(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()
	ctx := context.Background()

	// Start with workspace inheriting (column NULL).
	if _, err := pool.Exec(ctx,
		`UPDATE master_record_workspaces SET master_record_workspaces_timezone = NULL WHERE master_record_workspaces_id_workspace = $1`,
		fx.workspaceID,
	); err != nil {
		t.Fatalf("null workspace value: %v", err)
	}

	svc := makeInheritingSvc(pool, fx)
	override := "Europe/Paris"
	if _, err := svc.Patch(ctx, fx.workspaceID, /* actorID */ uuid.Nil, PatchInput{
		TenantTimezone: &override,
	}); err != nil {
		t.Fatalf("Patch set: %v", err)
	}

	s, err := svc.Get(ctx, fx.workspaceID)
	if err != nil {
		t.Fatalf("Get post-set: %v", err)
	}
	if s.TenantTimezone != override {
		t.Errorf("post-set TenantTimezone = %q, want %q", s.TenantTimezone, override)
	}
	if got := s.TenantTimezoneSource; got != "workspace" {
		t.Errorf("post-set TenantTimezoneSource = %q, want %q", got, "workspace")
	}
}

// TestPatch_UpdatedAt_AdvancesOnValueChange (TD-TEST-003 final step):
// the master_record_workspaces table has a BEFORE UPDATE trigger that
// bumps updated_at on every row mutation. If that trigger is ever
// disabled or renamed away, this test catches the drift. A no-op Patch
// (no fields) must NOT advance updated_at — that path skips the UPDATE.
func TestPatch_UpdatedAt_AdvancesOnValueChange(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()
	ctx := context.Background()

	// Helper: read the row's updated_at directly (Settings DTO doesn't
	// expose the workspace-row updated_at, only the tenant's).
	readUpdatedAt := func() time.Time {
		t.Helper()
		var ts time.Time
		if err := pool.QueryRow(ctx,
			`SELECT master_record_workspaces_updated_at FROM master_record_workspaces WHERE master_record_workspaces_id_workspace = $1`,
			fx.workspaceID,
		).Scan(&ts); err != nil {
			t.Fatalf("read updated_at: %v", err)
		}
		return ts
	}

	svc := makeInheritingSvc(pool, fx)

	before := readUpdatedAt()
	time.Sleep(2 * time.Millisecond)

	override := "Europe/Berlin"
	if _, err := svc.Patch(ctx, fx.workspaceID, uuid.Nil, PatchInput{TenantTimezone: &override}); err != nil {
		t.Fatalf("Patch set: %v", err)
	}
	after := readUpdatedAt()
	if !after.After(before) {
		t.Fatalf("updated_at did not advance on value Patch: before=%v after=%v (trigger drift?)", before, after)
	}

	// No-op Patch (no fields) must NOT advance updated_at.
	if _, err := svc.Patch(ctx, fx.workspaceID, uuid.Nil, PatchInput{}); err != nil {
		t.Fatalf("Patch no-op: %v", err)
	}
	noop := readUpdatedAt()
	if !noop.Equal(after) {
		t.Fatalf("updated_at advanced on no-op Patch: after=%v noop=%v (should be no-op)", after, noop)
	}
}

// ─── 7. cross-subscription isolation ───────────────────────────────────

func TestGet_CrossSubscriptionIsolation(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fxA := makeFixture(t, pool)
	defer fxA.cleanup()
	fxB := makeFixture(t, pool)
	defer fxB.cleanup()
	ctx := context.Background()

	// Tenant A sets an unusual timezone; tenant B leaves system default.
	const tenantAValue = "Pacific/Auckland"
	if _, err := pool.Exec(ctx,
		`UPDATE master_record_tenants SET master_record_tenants_timezone = $1 WHERE master_record_tenants_id_subscription = $2`,
		tenantAValue, fxA.subscriptionID,
	); err != nil {
		t.Fatalf("seed tenant A: %v", err)
	}

	// Workspaces A + B both inherit (NULL).
	for _, ws := range []uuid.UUID{fxA.workspaceID, fxB.workspaceID} {
		if _, err := pool.Exec(ctx,
			`UPDATE master_record_workspaces SET master_record_workspaces_timezone = NULL WHERE master_record_workspaces_id_workspace = $1`,
			ws,
		); err != nil {
			t.Fatalf("null workspace value: %v", err)
		}
	}

	// Wire a resolver that knows both pairs so each workspace finds
	// its own tenant. Important: A must not silently fall to B's tenant.
	svc := New(pool).WithInheritance(
		&fakeSubsResolver{mapping: map[uuid.UUID]uuid.UUID{
			fxA.workspaceID: fxA.subscriptionID,
			fxB.workspaceID: fxB.subscriptionID,
		}},
		&dbTenantReader{pool: pool},
	)
	sA, err := svc.Get(ctx, fxA.workspaceID)
	if err != nil {
		t.Fatalf("Get A: %v", err)
	}
	sB, err := svc.Get(ctx, fxB.workspaceID)
	if err != nil {
		t.Fatalf("Get B: %v", err)
	}

	// Workspace A inherits from tenant A.
	if sA.TenantTimezone != tenantAValue {
		t.Errorf("workspace A TenantTimezone = %q, want %q (inherited from its own tenant)", sA.TenantTimezone, tenantAValue)
	}
	// Workspace B does NOT see tenant A's value — must fall to its own
	// tenant's value (which we didn't override = system default).
	if sB.TenantTimezone == tenantAValue {
		t.Errorf("workspace B TenantTimezone = %q — leaked from a different subscription's tenant", sB.TenantTimezone)
	}
}

// ─── 8. archived tenant → workspace falls to system_default ────────────

func TestGet_TenantArchived_FallsToSystemDefault(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	fx := makeFixture(t, pool)
	defer fx.cleanup()
	ctx := context.Background()

	// Tenant has a value, but is archived; workspace inherits.
	const tenantValue = "Asia/Tokyo"
	if _, err := pool.Exec(ctx,
		`UPDATE master_record_tenants
			SET master_record_tenants_timezone = $1,
			    master_record_tenants_archived_at = now()
		  WHERE master_record_tenants_id_subscription = $2`,
		tenantValue, fx.subscriptionID,
	); err != nil {
		t.Fatalf("seed archived tenant: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE master_record_workspaces SET master_record_workspaces_timezone = NULL WHERE master_record_workspaces_id_workspace = $1`,
		fx.workspaceID,
	); err != nil {
		t.Fatalf("null workspace value: %v", err)
	}

	svc := makeInheritingSvc(pool, fx)
	s, err := svc.Get(ctx, fx.workspaceID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	// Contract: archived tenant rows are treated as "no override at the
	// tenant tier" for inheritance — the read falls through to schema
	// default. Test will go red until Story 3 implements this clause.
	const systemDefault = "Europe/London"
	if s.TenantTimezone != systemDefault {
		t.Errorf("archived tenant: TenantTimezone = %q, want system default %q", s.TenantTimezone, systemDefault)
	}
	if got := s.TenantTimezoneSource; got != "system_default" {
		t.Errorf("archived tenant: TenantTimezoneSource = %q, want %q", got, "system_default")
	}
}
