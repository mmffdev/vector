package users

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"golang.org/x/crypto/bcrypt"
)

// PLA-0007 / Story 00307 — Protected-account preservation + bcrypt verification fixture.
//
// CLAUDE.md HARD RULE: the three protected human accounts —
//   gadmin@mmffdev.com
//   padmin@mmffdev.com
//   user@mmffdev.com
// — were last reset to plaintext password "password" on 2026-05-02.
// Their credential fields (email, password_hash, is_active,
// password_changed_at) MUST remain byte-for-byte unchanged unless the
// human operator says otherwise. The role_id field IS permitted to
// change (PLA-0007 / Story 00293 backfilled it from the legacy enum).
//
// This test asserts:
//   1. all three rows exist on the dev fixture subscription;
//   2. each password_hash bcrypt-verifies against plaintext "password";
//   3. is_active is true and email is unchanged;
//   4. role_id resolves to the seeded system role of the matching name
//      (gadmin → ad30, padmin → ad25, user → ad10).
//
// Read-only — no DB writes. Run via `go test ./internal/users -run TestProtectedAccountsPreserved`.
//
// If bcrypt verification fails, that is evidence of a HARD-RULE breach
// upstream. Stop and notify the human operator — do NOT "fix" by
// rewriting the hash.

const (
	fixtureSubscriptionID = "00000000-0000-0000-0000-000000000001"
	protectedPlaintext    = "password"

	// Stable seeded role UUIDs from migration 088_roles_permissions.sql.
	roleIDGAdmin = "00000000-0000-0000-0000-00000000ad30"
	roleIDPAdmin = "00000000-0000-0000-0000-00000000ad25"
	roleIDUser   = "00000000-0000-0000-0000-00000000ad10"
)

type protectedAccount struct {
	email       string
	roleCode    string // expected roles.code on the linked roles row
	expectedRID uuid.UUID
}

// protectedAccountsPool prefers `.env.dev` over `.env.local` because the
// PLA-0007 migrations 088 + 089 (which seed the `roles` table this test
// joins against) live on the dev DB. Falls back to `.env.local` if
// `.env.dev` is absent so the test still works on machines that mirror
// the older test convention.
func protectedAccountsPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	candidates := []string{
		".env.dev", "../../.env.dev",
		".env.local", "../../.env.local",
	}
	for _, rel := range candidates {
		abs, _ := filepath.Abs(rel)
		if _, err := os.Stat(abs); err == nil {
			_ = godotenv.Load(abs)
			break
		}
	}
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"),
		os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"),
	)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("cannot ping DB (tunnel down?): %v", err)
	}
	return pool
}

func TestProtectedAccountsPreserved(t *testing.T) {
	pool := protectedAccountsPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID := uuid.MustParse(fixtureSubscriptionID)

	expected := []protectedAccount{
		{email: "gadmin@mmffdev.com", roleCode: "gadmin", expectedRID: uuid.MustParse(roleIDGAdmin)},
		{email: "padmin@mmffdev.com", roleCode: "padmin", expectedRID: uuid.MustParse(roleIDPAdmin)},
		{email: "user@mmffdev.com", roleCode: "user", expectedRID: uuid.MustParse(roleIDUser)},
	}

	for _, want := range expected {
		t.Run(want.email, func(t *testing.T) {
			var (
				gotEmail        string
				gotPasswordHash string
				gotIsActive     bool
				gotRoleID       uuid.UUID
				gotRoleCode     string
			)
			err := pool.QueryRow(ctx, `
				SELECT u.email, u.password_hash, u.is_active, u.role_id, r.code
				FROM users u
				JOIN roles r ON r.id = u.role_id
				WHERE u.email = $1
				  AND u.subscription_id = $2
			`, want.email, subID).Scan(
				&gotEmail, &gotPasswordHash, &gotIsActive, &gotRoleID, &gotRoleCode,
			)
			if err != nil {
				t.Fatalf("protected account %q lookup failed: %v", want.email, err)
			}

			// 1. email round-trips exactly.
			if gotEmail != want.email {
				t.Fatalf("HARD-RULE BREACH: email drifted: got %q want %q", gotEmail, want.email)
			}

			// 2. is_active must be true.
			if !gotIsActive {
				t.Fatalf("HARD-RULE BREACH: %s is_active = false; humans expect login to work", want.email)
			}

			// 3. password_hash bcrypt-verifies against plaintext "password".
			//    If this fails, an upstream change rotated the hash —
			//    this is the canary that detects HARD-RULE breaches.
			if err := bcrypt.CompareHashAndPassword([]byte(gotPasswordHash), []byte(protectedPlaintext)); err != nil {
				t.Fatalf(
					"HARD-RULE BREACH: %s password_hash does NOT verify against plaintext %q: %v "+
						"(do NOT fix by rewriting the hash — notify the human operator)",
					want.email, protectedPlaintext, err,
				)
			}

			// 4. role_id resolves to the seeded system role of the matching name.
			if gotRoleID != want.expectedRID {
				t.Fatalf(
					"%s role_id drift: got %s want %s (seeded %s)",
					want.email, gotRoleID, want.expectedRID, want.roleCode,
				)
			}
			if gotRoleCode != want.roleCode {
				t.Fatalf(
					"%s role.code drift: got %q want %q",
					want.email, gotRoleCode, want.roleCode,
				)
			}
		})
	}
}
