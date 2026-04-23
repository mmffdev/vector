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

		var userID, tenantID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM users LIMIT 1`).Scan(&userID, &tenantID); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', gen_random_uuid(), $2, 'test')`,
			tenantID, userID)
		assertFKViolation(t, err)
	})

	t.Run("entity_stakeholders_accepts_valid_workspace_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var wsID, wsTenant uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant)
		if err == pgx.ErrNoRows {
			t.Skip("no live workspace in DB — cannot exercise valid-insert path")
		}
		if err != nil {
			t.Fatalf("seed workspace: %v", err)
		}
		var userID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, wsTenant).Scan(&userID); err != nil {
			if err := tx.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
				t.Fatalf("seed user: %v", err)
			}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', $2, $3, 'test_dispatch_lifecycle')`,
			wsTenant, wsID, userID)
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

		var wsID, wsTenant uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant)
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
			INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', $2, $3, 'test_dispatch_archived')`,
			wsTenant, wsID, userID)
		assertFKViolation(t, err)
	})

	t.Run("entity_stakeholders_rejects_cross_tenant", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var wsID, wsTenant uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant); err != nil {
			if err == pgx.ErrNoRows {
				t.Skip("no live workspace in DB")
			}
			t.Fatalf("seed workspace: %v", err)
		}
		// Synthesise a foreign tenant + foreign user
		var foreignTenant, foreignUser uuid.UUID
		if err := tx.QueryRow(ctx, `INSERT INTO tenants (name, slug) VALUES ('disp-test-'||gen_random_uuid(), 'disp-test-'||gen_random_uuid()) RETURNING id`).Scan(&foreignTenant); err != nil {
			t.Fatalf("seed foreign tenant: %v", err)
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO users (tenant_id, email, password_hash, role)
			VALUES ($1, 'disp-test-'||gen_random_uuid()||'@example.com', 'x', 'user')
			RETURNING id`, foreignTenant).Scan(&foreignUser); err != nil {
			t.Fatalf("seed foreign user: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
			VALUES ($1, 'workspace', $2, $3, 'test_dispatch_cross_tenant')`,
			foreignTenant, wsID, foreignUser)
		assertFKViolation(t, err)
	})

	t.Run("item_type_states_accepts_valid_portfolio_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var pitID, pitTenant uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM portfolio_item_types WHERE archived_at IS NULL LIMIT 1`).Scan(&pitID, &pitTenant)
		if err == pgx.ErrNoRows {
			t.Skip("no live portfolio_item_types in DB")
		}
		if err != nil {
			t.Fatalf("seed portfolio_item_types: %v", err)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
			VALUES ($1, $2, 'portfolio', 'test_dispatch_state', 'defined', 99)`,
			pitTenant, pitID)
		if err != nil {
			t.Fatalf("valid portfolio parent insert rejected: %v", err)
		}
	})

	t.Run("item_type_states_rejects_missing_parent", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var tenantID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT tenant_id FROM portfolio_item_types LIMIT 1`).Scan(&tenantID); err != nil {
			if err := tx.QueryRow(ctx, `SELECT id FROM tenants LIMIT 1`).Scan(&tenantID); err != nil {
				t.Fatalf("seed tenant: %v", err)
			}
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
			VALUES ($1, gen_random_uuid(), 'portfolio', 'test_dispatch_missing', 'defined', 99)`,
			tenantID)
		assertFKViolation(t, err)
	})

	t.Run("item_type_states_rejects_cross_kind", func(t *testing.T) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		defer tx.Rollback(ctx)

		var pitID, pitTenant uuid.UUID
		err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM portfolio_item_types WHERE archived_at IS NULL LIMIT 1`).Scan(&pitID, &pitTenant)
		if err == pgx.ErrNoRows {
			t.Skip("no live portfolio_item_types in DB")
		}
		if err != nil {
			t.Fatalf("seed portfolio_item_types: %v", err)
		}
		// portfolio_item_types id used with execution kind — execution
		// dispatch looks at execution_item_types, won't find it.
		_, err = tx.Exec(ctx, `
			INSERT INTO item_type_states (tenant_id, item_type_id, item_type_kind, name, canonical_code, sort_order)
			VALUES ($1, $2, 'execution', 'test_dispatch_crosskind', 'defined', 99)`,
			pitTenant, pitID)
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
		var tenantID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id FROM tenants LIMIT 1`).Scan(&tenantID); err != nil {
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
			INSERT INTO pages (tenant_id, key_enum, label, href, icon, tag_enum, kind)
			VALUES ($1, $2, 'dispatch-test', '/dispatch-test', 'bookmark', $3, 'entity')
			RETURNING id`, tenantID, "dispatch-test-"+suffix, tagEnum).Scan(&pageID)
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
