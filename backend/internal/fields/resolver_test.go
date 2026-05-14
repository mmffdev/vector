package fields

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Integration test against the real vector_artefacts DB via the SSH
// tunnel on :5435. Per repo convention we do not mock the DB.
//
// The test seeds three artefacts_fields_library rows (one per scope),
// one workspaces_fields whitelist row, and exercises the
// 5-cell admit/deny matrix from R047 §5:
//
//   1. scope=global                                 → Admit
//   2. scope=tenant   AND subscription matches      → Admit
//   3. scope=tenant   AND subscription mismatches   → Deny
//   4. scope=workspace AND whitelist row exists     → Admit
//   5. scope=workspace AND no whitelist row         → Deny
//
// Plus a defensive case: unknown field id → ErrFieldNotFound.

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	for _, rel := range []string{".env.local", "../../.env.local"} {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}

	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
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
		t.Skipf("cannot ping vector_artefacts (tunnel down?): %v", err)
	}
	return pool
}

// fixture seeds three field_library rows (global / tenant / workspace)
// plus one whitelist row admitting the workspace-scoped field into
// workspaceA. Returns the four ids and a cleanup func.
type fixture struct {
	tenantA, tenantB     uuid.UUID
	workspaceA, otherWS  uuid.UUID
	globalFieldID        uuid.UUID
	tenantFieldID        uuid.UUID
	workspaceFieldID     uuid.UUID
}

func mkFixture(t *testing.T, pool *pgxpool.Pool) (fixture, func()) {
	t.Helper()
	ctx := context.Background()

	f := fixture{
		tenantA:    uuid.New(),
		tenantB:    uuid.New(),
		workspaceA: uuid.New(),
		otherWS:    uuid.New(),
	}

	suffix := uuid.NewString()[:8]

	// Global field — subscription_id MUST be NULL per chk_afl_global_no_subscription.
	err := pool.QueryRow(ctx, `
		INSERT INTO artefacts_fields_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES (NULL, $1, 'Global Field', 'textbox', 'global')
		RETURNING id`,
		"global_field_"+suffix,
	).Scan(&f.globalFieldID)
	if err != nil {
		t.Fatalf("seed global field: %v", err)
	}

	// Tenant field — bound to tenantA.
	err = pool.QueryRow(ctx, `
		INSERT INTO artefacts_fields_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES ($1, $2, 'Tenant Field', 'textbox', 'tenant')
		RETURNING id`,
		f.tenantA, "tenant_field_"+suffix,
	).Scan(&f.tenantFieldID)
	if err != nil {
		t.Fatalf("seed tenant field: %v", err)
	}

	// Workspace field — bound to tenantA, requires whitelist row to be
	// visible in any workspace.
	err = pool.QueryRow(ctx, `
		INSERT INTO artefacts_fields_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES ($1, $2, 'Workspace Field', 'textbox', 'workspace')
		RETURNING id`,
		f.tenantA, "workspace_field_"+suffix,
	).Scan(&f.workspaceFieldID)
	if err != nil {
		t.Fatalf("seed workspace field: %v", err)
	}

	// Whitelist the workspace field into workspaceA.
	if _, err := pool.Exec(ctx, `
		INSERT INTO workspaces_fields (workspace_id, field_library_id)
		VALUES ($1, $2)`,
		f.workspaceA, f.workspaceFieldID,
	); err != nil {
		t.Fatalf("seed whitelist: %v", err)
	}

	cleanup := func() {
		// CASCADE on field_library_id cleans up workspaces_fields.
		_, _ = pool.Exec(ctx,
			`DELETE FROM artefacts_fields_library WHERE id = ANY($1)`,
			[]uuid.UUID{f.globalFieldID, f.tenantFieldID, f.workspaceFieldID},
		)
	}
	return f, cleanup
}

func TestResolver_NilPool_ReturnsErrPoolMissing(t *testing.T) {
	r := New(nil)
	dec, err := r.ResolveField(context.Background(), uuid.New(), uuid.New(), uuid.New())
	if dec != Deny {
		t.Errorf("nil pool: want Deny, got %v", dec)
	}
	if err != ErrPoolMissing {
		t.Errorf("nil pool: want ErrPoolMissing, got %v", err)
	}
}

func TestResolver_NilUUID_DeniesWithoutDBHit(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	// Each case has at least one nil uuid; resolver must short-circuit
	// before any DB round-trip.
	r := New(pool)
	cases := []struct {
		name                                 string
		workspaceID, subscriptionID, fieldID uuid.UUID
	}{
		{"nil workspace", uuid.Nil, uuid.New(), uuid.New()},
		{"nil subscription", uuid.New(), uuid.Nil, uuid.New()},
		{"nil field", uuid.New(), uuid.New(), uuid.Nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dec, err := r.ResolveField(context.Background(), c.workspaceID, c.subscriptionID, c.fieldID)
			if dec != Deny {
				t.Errorf("want Deny, got %v", dec)
			}
			if err != nil {
				t.Errorf("want nil error, got %v", err)
			}
		})
	}
}

func TestResolveField_AdmitDenyMatrix(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	f, cleanup := mkFixture(t, pool)
	defer cleanup()

	r := New(pool)
	ctx := context.Background()

	type tc struct {
		name           string
		workspaceID    uuid.UUID
		subscriptionID uuid.UUID
		fieldID        uuid.UUID
		want           Decision
	}
	cases := []tc{
		// Cell 1 — global admits regardless of tenant/workspace.
		{"global → admit (tenantA)", f.workspaceA, f.tenantA, f.globalFieldID, Admit},
		{"global → admit (tenantB)", f.otherWS, f.tenantB, f.globalFieldID, Admit},

		// Cell 2 — tenant matches.
		{"tenant matching → admit", f.workspaceA, f.tenantA, f.tenantFieldID, Admit},

		// Cell 3 — tenant mismatch.
		{"tenant mismatch → deny", f.workspaceA, f.tenantB, f.tenantFieldID, Deny},

		// Cell 4 — workspace whitelisted.
		{"workspace whitelisted → admit", f.workspaceA, f.tenantA, f.workspaceFieldID, Admit},

		// Cell 5 — workspace not whitelisted.
		{"workspace not whitelisted → deny", f.otherWS, f.tenantA, f.workspaceFieldID, Deny},

		// Defence-in-depth: workspace field but caller acting as a different tenant.
		{"workspace cross-tenant → deny", f.workspaceA, f.tenantB, f.workspaceFieldID, Deny},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dec, err := r.ResolveField(ctx, c.workspaceID, c.subscriptionID, c.fieldID)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if dec != c.want {
				t.Errorf("want %v, got %v", c.want, dec)
			}
		})
	}
}

func TestResolveField_UnknownField_ReturnsErrFieldNotFound(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	r := New(pool)
	dec, err := r.ResolveField(
		context.Background(),
		uuid.New(), uuid.New(), uuid.New(),
	)
	if dec != Deny {
		t.Errorf("unknown field: want Deny, got %v", dec)
	}
	if err != ErrFieldNotFound {
		t.Errorf("unknown field: want ErrFieldNotFound, got %v", err)
	}
}

func TestResolveField_ArchivedField_ReturnsErrFieldNotFound(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	ctx := context.Background()
	suffix := uuid.NewString()[:8]
	tenantID := uuid.New()

	var fieldID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO artefacts_fields_library
			(subscription_id, field_name, label, field_type, scope, archived_at)
		VALUES ($1, $2, 'Archived', 'textbox', 'tenant', now())
		RETURNING id`,
		tenantID, "archived_field_"+suffix,
	).Scan(&fieldID)
	if err != nil {
		t.Fatalf("seed archived: %v", err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM artefacts_fields_library WHERE id = $1`, fieldID)
	}()

	r := New(pool)
	dec, err := r.ResolveField(ctx, uuid.New(), tenantID, fieldID)
	if dec != Deny {
		t.Errorf("archived field: want Deny, got %v", dec)
	}
	if err != ErrFieldNotFound {
		t.Errorf("archived field: want ErrFieldNotFound, got %v", err)
	}
}
