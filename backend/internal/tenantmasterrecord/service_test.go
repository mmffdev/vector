package tenantmasterrecord

// Integration tests for the tenant-defaults service — TD-TEST-003 partial
// backfill (the inheritance read source). PLA-0050 + PLA-0051 shipped
// this package with zero automated tests; the workspacemasterrecord
// inheritance suite already covers the COALESCE merge that depends on
// THIS service's Get behaviour. These tests cover the local contract:
//
//   1. Get returns the row when present.
//   2. Get auto-seeds when the row is missing (the path that covered
//      mig 200's broken-trigger drop).
//   3. SeedForSubscription is idempotent (ON CONFLICT DO NOTHING).
//   4. Patch happy path — one valid field round-trips through read.
//   5. Patch validation — invalid data_region → ValidationError.
//   6. Patch validation — workdays must be non-empty, non-duplicate,
//      drawn from the day-code set.
//   7. Patch validation — invalid email.
//   8. Patch empty-string clears nullable text (notes → "" → NULL).
//   9. Patch aggregates multiple violations in one call.
//  10. Patch with no fields is a no-op (re-read, no UPDATE).
//
// Same skip-on-unreachable pattern the workspacemasterrecord package
// uses: missing VA_DB_* envs OR a down tunnel skips the test, never
// fails CI by surprise. Each test creates a fresh test subscription,
// runs its assertions, then DELETEs the row on cleanup.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// ─── fixture helpers ────────────────────────────────────────────────────

// vaPoolForTest mirrors workspacemasterrecord/service_inheritance_test.go.
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
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable application_name=tenantmasterrecord_service_test",
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

// makeSub returns a fresh subscription_id with a cleanup func that
// DELETEs the corresponding master_record_tenants row on test exit.
// Tests intentionally do NOT pre-seed — they exercise Get's auto-seed
// path explicitly via the cases that want it.
func makeSub(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, func()) {
	t.Helper()
	subID := uuid.New()
	cleanup := func() {
		_, _ = pool.Exec(context.Background(),
			`DELETE FROM master_record_tenants WHERE master_record_tenants_id_subscription = $1`,
			subID,
		)
	}
	return subID, cleanup
}

// ─── 1. Get returns the row when present ──────────────────────────────────
func TestGet_RowPresent_ReturnsSettings(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	// Seed explicitly so we know the row is there before Get sees it.
	if err := svc.SeedForSubscription(context.Background(), subID); err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := svc.Get(context.Background(), subID)
	if err != nil {
		t.Fatalf("Get returned error: %v", err)
	}
	if got == nil {
		t.Fatal("Get returned nil settings on a seeded row")
	}
	if got.TenantID != subID {
		t.Fatalf("TenantID mismatch: got %s, want %s", got.TenantID, subID)
	}
	// All non-nullable defaults should be present (set by the row's
	// column defaults — region/timezone/etc).
	if got.TenantDataRegion == "" {
		t.Error("TenantDataRegion should default to a non-empty region code")
	}
	if got.TenantTimezone == "" {
		t.Error("TenantTimezone should default to a non-empty zone")
	}
	if len(got.TenantWorkdays) == 0 {
		t.Error("TenantWorkdays should default to the working-week set")
	}
}

// ─── 2. Get auto-seeds when the row is missing ────────────────────────────
func TestGet_RowMissing_AutoSeedsAndReturns(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	// No SeedForSubscription call — Get must self-heal.
	svc := New(pool)
	got, err := svc.Get(context.Background(), subID)
	if err != nil {
		t.Fatalf("Get on missing row should auto-seed, got error: %v", err)
	}
	if got == nil {
		t.Fatal("Get returned nil after auto-seed")
	}
	if got.TenantID != subID {
		t.Fatalf("TenantID mismatch: got %s, want %s", got.TenantID, subID)
	}
	// Confirm the row really exists post-call.
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM master_record_tenants WHERE master_record_tenants_id_subscription = $1`,
		subID,
	).Scan(&count); err != nil {
		t.Fatalf("verify row exists: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one row after auto-seed, got %d", count)
	}
}

// ─── 3. SeedForSubscription is idempotent ─────────────────────────────────
func TestSeedForSubscription_Idempotent(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	for i := 0; i < 3; i++ {
		if err := svc.SeedForSubscription(context.Background(), subID); err != nil {
			t.Fatalf("seed call %d returned error: %v", i+1, err)
		}
	}
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM master_record_tenants WHERE master_record_tenants_id_subscription = $1`,
		subID,
	).Scan(&count); err != nil {
		t.Fatalf("verify row count: %v", err)
	}
	if count != 1 {
		t.Fatalf("repeated seed should produce exactly one row, got %d", count)
	}
}

// ─── 4. Patch happy path ──────────────────────────────────────────────────
func TestPatch_ValidDataRegion_RoundTrips(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	newRegion := "euw2"
	got, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{
		TenantDataRegion: &newRegion,
	})
	if err != nil {
		t.Fatalf("Patch returned error: %v", err)
	}
	if got.TenantDataRegion != newRegion {
		t.Fatalf("data_region not updated: got %q, want %q", got.TenantDataRegion, newRegion)
	}

	// Re-read independently to confirm DB-level persistence (not just
	// the post-Patch read).
	fresh, err := svc.Get(context.Background(), subID)
	if err != nil {
		t.Fatalf("re-read after Patch: %v", err)
	}
	if fresh.TenantDataRegion != newRegion {
		t.Fatalf("data_region didn't persist: got %q, want %q", fresh.TenantDataRegion, newRegion)
	}
}

// ─── 5. Patch validation — invalid data_region ────────────────────────────
func TestPatch_InvalidDataRegion_ReturnsValidationError(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	bad := "not-a-region"
	_, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{
		TenantDataRegion: &bad,
	})
	if err == nil {
		t.Fatal("expected ValidationError for invalid data_region, got nil")
	}
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T: %v", err, err)
	}
	if len(ve.Violations) != 1 || ve.Violations[0].Field != "tenant_data_region" {
		t.Fatalf("expected one violation on tenant_data_region, got %+v", ve.Violations)
	}
}

// ─── 6. Patch validation — workdays edge cases ────────────────────────────
func TestPatch_WorkdaysValidation(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	cases := []struct {
		name string
		days []string
		want string
	}{
		{"empty list", []string{}, "must include at least one day"},
		{"duplicate days", []string{"mon", "mon"}, "duplicates not allowed"},
		{"unknown code", []string{"funday"}, "must be drawn from"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := c.days
			_, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{TenantWorkdays: &d})
			if err == nil {
				t.Fatal("expected ValidationError, got nil")
			}
			var ve *ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("expected *ValidationError, got %T", err)
			}
			if len(ve.Violations) == 0 || ve.Violations[0].Field != "tenant_workdays" {
				t.Fatalf("expected violation on tenant_workdays, got %+v", ve.Violations)
			}
		})
	}
}

// ─── 7. Patch validation — invalid email ──────────────────────────────────
func TestPatch_InvalidEmail_ReturnsValidationError(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	bad := "not-an-email"
	_, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{
		TenantPrimaryContactEmail: &bad,
	})
	if err == nil {
		t.Fatal("expected ValidationError for invalid email, got nil")
	}
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if len(ve.Violations) != 1 || ve.Violations[0].Field != "tenant_primary_contact_email" {
		t.Fatalf("expected one violation on tenant_primary_contact_email, got %+v", ve.Violations)
	}
}

// ─── 8. Empty-string clears nullable text ─────────────────────────────────
func TestPatch_EmptyStringClearsNullableNotes(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	// First set a value, then clear it via "".
	withValue := "hello notes"
	if _, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{TenantNotes: &withValue}); err != nil {
		t.Fatalf("set notes: %v", err)
	}
	cleared := ""
	got, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{TenantNotes: &cleared})
	if err != nil {
		t.Fatalf("clear notes: %v", err)
	}
	if got.TenantNotes != nil {
		t.Fatalf("notes should be NULL after empty-string patch, got %q", *got.TenantNotes)
	}
}

// ─── 9. Multiple violations aggregate in one call ─────────────────────────
func TestPatch_MultipleViolations_Aggregate(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	badRegion := "not-a-region"
	badEmail := "not-an-email"
	_, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{
		TenantDataRegion:          &badRegion,
		TenantPrimaryContactEmail: &badEmail,
	})
	if err == nil {
		t.Fatal("expected ValidationError, got nil")
	}
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected *ValidationError, got %T", err)
	}
	if len(ve.Violations) != 2 {
		t.Fatalf("expected 2 violations aggregated, got %d: %+v", len(ve.Violations), ve.Violations)
	}
	fields := map[string]bool{}
	for _, v := range ve.Violations {
		fields[v.Field] = true
	}
	if !fields["tenant_data_region"] || !fields["tenant_primary_contact_email"] {
		t.Fatalf("expected violations on data_region + primary_contact_email, got fields=%v", fields)
	}
}

// ─── 10. Patch with no fields is a no-op (auto-seeds, re-reads) ───────────
func TestPatch_NoFields_NoOpReadsBack(t *testing.T) {
	pool := vaPoolForTest(t)
	defer pool.Close()
	subID, cleanup := makeSub(t, pool)
	defer cleanup()

	svc := New(pool)
	got, err := svc.Patch(context.Background(), subID, uuid.New(), PatchInput{})
	if err != nil {
		t.Fatalf("empty Patch should be a no-op, got error: %v", err)
	}
	if got == nil || got.TenantID != subID {
		t.Fatalf("empty Patch should still return the row, got %+v", got)
	}
}
