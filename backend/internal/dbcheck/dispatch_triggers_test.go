package dbcheck

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// TestDispatchTriggers verifies migration 013's polymorphic dispatch
// triggers reject every category of bad write and accept the valid
// shape. See db/schema/013_polymorphic_dispatch_triggers.sql and
// docs/c_polymorphic_writes.md for the rules these triggers enforce.
//
// Each subtest opens its own transaction and rolls back at the end —
// no rows escape the test. Skips (don't fails) when the SSH tunnel is
// down, matching TestNoPolymorphicOrphans.
func TestDispatchTriggers(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	t.Run("entity_stakeholders_rejects_missing_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var userID, subscriptionID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id, subscription_id FROM users LIMIT 1`).Scan(&userID, &subscriptionID); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', gen_random_uuid(), $2, 'test')`,
			subscriptionID, userID)
		assertFKViolation(t, err)
	})

	t.Run("entity_stakeholders_accepts_valid_workspace_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var wsID, wsSubscription uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id, subscription_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsSubscription)
		if err == pgx.ErrNoRows {
			t.Skip("no live workspace in DB — cannot exercise valid-insert path")
		}
		if err != nil {
			t.Fatalf("seed workspace: %v", err)
		}
		var userID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE subscription_id = $1 LIMIT 1`, wsSubscription).Scan(&userID); err != nil {
			if err := tx.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
				t.Fatalf("seed user: %v", err)
			}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', $2, $3, 'test_dispatch_lifecycle')`,
			wsSubscription, wsID, userID)
		if err != nil {
			t.Fatalf("valid workspace parent insert rejected: %v", err)
		}
	})

	t.Run("entity_stakeholders_rejects_archived_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var wsID, wsSubscription uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id, subscription_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsSubscription)
		if err == pgx.ErrNoRows {
			t.Skip("no live workspace in DB — cannot exercise archive-rejection path")
		}
		if err != nil {
			t.Fatalf("seed workspace: %v", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE workspace SET archived_at = now() WHERE id = $1`, wsID); err != nil {
			t.Fatalf("archive workspace: %v", err)
		}
		var userID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', $2, $3, 'test_dispatch_archived')`,
			wsSubscription, wsID, userID)
		assertFKViolation(t, err)
	})

	t.Run("entity_stakeholders_rejects_cross_tenant", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var wsID, wsSubscription uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id, subscription_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsSubscription); err != nil {
			if err == pgx.ErrNoRows {
				t.Skip("no live workspace in DB")
			}
			t.Fatalf("seed workspace: %v", err)
		}
		// Synthesise a foreign tenant + foreign user
		var foreignTenant, foreignUser uuid.UUID
		if err := tx.QueryRow(ctx, `INSERT INTO subscriptions (name, slug) VALUES ('disp-test-'||gen_random_uuid(), 'disp-test-'||gen_random_uuid()) RETURNING id`).Scan(&foreignTenant); err != nil {
			t.Fatalf("seed foreign tenant: %v", err)
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO users (subscription_id, email, password_hash, role)
			VALUES ($1, 'disp-test-'||gen_random_uuid()||'@example.com', 'x', 'user')
			RETURNING id`, foreignTenant).Scan(&foreignUser); err != nil {
			t.Fatalf("seed foreign user: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (subscription_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', $2, $3, 'test_dispatch_cross_tenant')`,
			foreignTenant, wsID, foreignUser)
		assertFKViolation(t, err)
	})

	t.Run("page_entity_refs_rejects_missing_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		// Seed a tenant-scoped page so the trigger's NULL-tenant guard
		// doesn't fire first — we want to exercise the parent-missing
		// branch specifically.
		var subscriptionID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM subscriptions LIMIT 1`).Scan(&subscriptionID); err != nil {
			t.Fatalf("seed tenant: %v", err)
		}
		// page_tags has a fixed FK vocabulary; pick any existing tag.
		var tagEnum string
		if err := tx.QueryRow(ctx, `SELECT tag_enum FROM page_tags LIMIT 1`).Scan(&tagEnum); err != nil {
			t.Skipf("cannot read page_tags: %v", err)
		}
		var pageID uuid.UUID
		suffix := uuid.NewString()[:8]
		err = tx.QueryRow(ctx, `
			INSERT INTO pages (subscription_id, key_enum, label, href, icon, tag_enum, kind)
			VALUES ($1, $2, 'dispatch-test', '/dispatch-test', 'bookmark', $3, 'entity')
			RETURNING id`, subscriptionID, "dispatch-test-"+suffix, tagEnum).Scan(&pageID)
		if err != nil {
			t.Fatalf("seed page: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO page_entity_refs (page_id, entity_kind, entity_id)
			VALUES ($1, 'portfolio', gen_random_uuid())`,
			pageID)
		assertFKViolation(t, err)
	})
}

// assertFKViolation fails the test unless err is a Postgres
// foreign_key_violation (sqlstate 23503), which is what every dispatch
// trigger raises for any rejection it owns.
func assertFKViolation(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected foreign_key_violation, got nil (insert was not rejected)")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23503" {
		t.Fatalf("expected sqlstate 23503 (foreign_key_violation), got %s: %s", pgErr.Code, pgErr.Message)
	}
}
