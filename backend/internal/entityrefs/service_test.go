package entityrefs

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

// Integration tests against the live mmff_vector schema via the SSH
// tunnel. Each test opens its own transaction and rolls back on
// cleanup so no rows escape.

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
		os.Getenv("DB_HOST"), os.Getenv("DB_PORT"),
		os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"),
		os.Getenv("DB_NAME"))
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

func TestParentTableFor(t *testing.T) {
	cases := []struct {
		kind  EntityKind
		table string
		ok    bool
	}{
		{KindCompanyRoadmap, "company_roadmap", true},
		{KindWorkspace, "workspace", true},
		{KindPortfolio, "portfolio", true},
		{KindProduct, "product", true},
		{EntityKind("bogus"), "", false},
		{EntityKind(""), "", false},
	}
	for _, c := range cases {
		got, ok := parentTableFor(c.kind)
		if got != c.table || ok != c.ok {
			t.Errorf("parentTableFor(%q) = (%q, %v) want (%q, %v)", c.kind, got, ok, c.table, c.ok)
		}
	}
}

func TestChildRelationshipsFor(t *testing.T) {
	// Vocabulary mirror: workspace yields stakeholders only because
	// page_entity_refs CHECK is {portfolio, product}. Bug here would
	// silently produce orphans on workspace archive.
	cases := []struct {
		kind  EntityKind
		want  []string // table names, ordered as CleanupChildren iterates
		ok    bool
	}{
		{KindCompanyRoadmap, []string{"entity_stakeholders"}, true},
		{KindWorkspace, []string{"entity_stakeholders"}, true},
		{KindPortfolio, []string{"entity_stakeholders", "page_entity_refs"}, true},
		{KindProduct, []string{"entity_stakeholders", "page_entity_refs"}, true},
		{EntityKind("bogus"), nil, false},
	}
	for _, c := range cases {
		got, ok := childRelationshipsFor(c.kind)
		if ok != c.ok {
			t.Errorf("childRelationshipsFor(%q) ok=%v want %v", c.kind, ok, c.ok)
			continue
		}
		if !ok {
			continue
		}
		if len(got) != len(c.want) {
			t.Errorf("childRelationshipsFor(%q) returned %d rels, want %d", c.kind, len(got), len(c.want))
			continue
		}
		for i, rel := range got {
			if rel.table != c.want[i] {
				t.Errorf("childRelationshipsFor(%q)[%d].table = %q, want %q", c.kind, i, rel.table, c.want[i])
			}
		}
	}
}

func TestLoadParent_NotFound(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())

	svc := New(pool)
	_, err = svc.LoadParent(context.Background(), tx, KindWorkspace, uuid.New(), uuid.New())
	if !errors.Is(err, ErrEntityNotFound) {
		t.Fatalf("expected ErrEntityNotFound, got %v", err)
	}
}

func TestLoadParent_UnknownKind(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())

	svc := New(pool)
	_, err = svc.LoadParent(context.Background(), tx, EntityKind("bogus"), uuid.New(), uuid.New())
	if !errors.Is(err, ErrUnknownEntityKind) {
		t.Fatalf("expected ErrUnknownEntityKind, got %v", err)
	}
}

func TestLoadParent_CrossTenantHidesAsNotFound(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var wsID, wsTenant uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant)
	if err == pgx.ErrNoRows {
		t.Skip("no live workspace in DB")
	}
	if err != nil {
		t.Fatalf("seed workspace: %v", err)
	}

	svc := New(pool)
	// Caller passes a different tenant — must come back as not-found,
	// not as some "wrong tenant" error that leaks existence.
	_, err = svc.LoadParent(ctx, tx, KindWorkspace, wsID, uuid.New())
	if !errors.Is(err, ErrEntityNotFound) {
		t.Fatalf("expected ErrEntityNotFound (tenant leak guard), got %v", err)
	}
}

func TestLoadParent_ArchivedRejected(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var wsID, wsTenant uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant)
	if err == pgx.ErrNoRows {
		t.Skip("no live workspace in DB")
	}
	if err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE workspace SET archived_at = now() WHERE id = $1`, wsID); err != nil {
		t.Fatalf("archive workspace: %v", err)
	}

	svc := New(pool)
	_, err = svc.LoadParent(ctx, tx, KindWorkspace, wsID, wsTenant)
	if !errors.Is(err, ErrEntityArchived) {
		t.Fatalf("expected ErrEntityArchived, got %v", err)
	}
}

func TestLoadParent_HappyPath(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var wsID, wsTenant uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant)
	if err == pgx.ErrNoRows {
		t.Skip("no live workspace in DB")
	}
	if err != nil {
		t.Fatalf("seed workspace: %v", err)
	}

	svc := New(pool)
	got, err := svc.LoadParent(ctx, tx, KindWorkspace, wsID, wsTenant)
	if err != nil {
		t.Fatalf("LoadParent: %v", err)
	}
	if got != wsTenant {
		t.Fatalf("LoadParent returned tenant %v, want %v", got, wsTenant)
	}
}

func TestCleanupChildren_UnknownKind(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(context.Background())

	svc := New(pool)
	_, err = svc.CleanupChildren(context.Background(), tx, EntityKind("bogus"), uuid.New())
	if !errors.Is(err, ErrUnknownEntityKind) {
		t.Fatalf("expected ErrUnknownEntityKind, got %v", err)
	}
}

func TestCleanupChildren_DeletesPortfolioStakeholdersAndPageRefs(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	// Find a portfolio (any tenant) we can synthesise stakeholder +
	// page_entity_refs rows for, all rolled back at end of test.
	var portID, portTenant uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM portfolio LIMIT 1`).Scan(&portID, &portTenant)
	if err == pgx.ErrNoRows {
		// Seed a minimal portfolio inside the tx so the test still runs
		// on DBs without one. portfolio requires
		// (tenant_id, workspace_id, key_num, name, owner_user_id) — all
		// NOT NULL with no defaults. Anchor on an existing workspace +
		// user so foreign keys hold.
		var wsID, wsTenant, ownerID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant); err != nil {
			t.Skipf("no live workspace in DB to anchor portfolio seed: %v", err)
		}
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, wsTenant).Scan(&ownerID); err != nil {
			t.Skipf("no user in workspace tenant to own seeded portfolio: %v", err)
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO portfolio (tenant_id, workspace_id, name, owner_user_id, key_num)
			VALUES ($1, $2, 'cleanup-test-'||gen_random_uuid(), $3,
			        COALESCE((SELECT max(key_num) + 1 FROM portfolio WHERE tenant_id = $1), 1))
			RETURNING id, tenant_id`,
			wsTenant, wsID, ownerID).Scan(&portID, &portTenant)
		if err != nil {
			t.Skipf("cannot seed portfolio (schema may differ): %v", err)
		}
	} else if err != nil {
		t.Fatalf("seed portfolio: %v", err)
	}

	// Seed a stakeholder row pointing at this portfolio.
	var userID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, portTenant).Scan(&userID); err != nil {
		if err := tx.QueryRow(ctx, `SELECT id FROM users LIMIT 1`).Scan(&userID); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO entity_stakeholders (tenant_id, entity_kind, entity_id, user_id, role)
		VALUES ($1, 'portfolio', $2, $3, 'cleanup-test')`,
		portTenant, portID, userID); err != nil {
		t.Fatalf("seed stakeholder: %v", err)
	}

	// Seed a page + page_entity_refs row pointing at this portfolio.
	var tagEnum string
	if err := tx.QueryRow(ctx, `SELECT tag_enum FROM page_tags LIMIT 1`).Scan(&tagEnum); err != nil {
		t.Fatalf("read page_tags: %v", err)
	}
	var pageID uuid.UUID
	suffix := uuid.NewString()[:8]
	err = tx.QueryRow(ctx, `
		INSERT INTO pages (tenant_id, key_enum, label, href, icon, tag_enum, kind)
		VALUES ($1, $2, 'cleanup-test', '/cleanup-test', 'folder', $3, 'entity')
		RETURNING id`, portTenant, "cleanup-test-"+suffix, tagEnum).Scan(&pageID)
	if err != nil {
		t.Fatalf("seed page: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO page_entity_refs (page_id, entity_kind, entity_id)
		VALUES ($1, 'portfolio', $2)`, pageID, portID); err != nil {
		t.Fatalf("seed page_entity_refs: %v", err)
	}

	svc := New(pool)
	deleted, err := svc.CleanupChildren(ctx, tx, KindPortfolio, portID)
	if err != nil {
		t.Fatalf("CleanupChildren: %v", err)
	}
	if deleted < 2 {
		t.Errorf("CleanupChildren deleted %d rows, expected at least 2 (stakeholder + page_ref)", deleted)
	}

	// Confirm both child tables now have zero rows for this portfolio.
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM entity_stakeholders WHERE entity_kind = 'portfolio' AND entity_id = $1`, portID).Scan(&n); err != nil {
		t.Fatalf("recount stakeholders: %v", err)
	}
	if n != 0 {
		t.Errorf("entity_stakeholders still has %d rows for portfolio %v", n, portID)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM page_entity_refs WHERE entity_kind = 'portfolio' AND entity_id = $1`, portID).Scan(&n); err != nil {
		t.Fatalf("recount page_entity_refs: %v", err)
	}
	if n != 0 {
		t.Errorf("page_entity_refs still has %d rows for portfolio %v", n, portID)
	}
}

func TestCleanupChildren_WorkspaceSkipsPageRefs(t *testing.T) {
	// Regression guard for the vocabulary drift caught in Phase 0.5:
	// page_entity_refs CHECK rejects 'workspace', so cleanup for
	// workspace MUST NOT touch page_entity_refs (else CHECK error).
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	// Run against a non-existent workspace id — no rows match in any
	// child table, but the function MUST still complete cleanly. If it
	// were to issue `DELETE FROM page_entity_refs WHERE entity_kind =
	// 'workspace'`, Postgres would not complain (DELETEs against a
	// CHECK-rejected value just return zero rows), but the symmetry
	// matters: the registry says "no workspace → page_entity_refs"
	// because no insert can ever land there.
	svc := New(pool)
	deleted, err := svc.CleanupChildren(ctx, tx, KindWorkspace, uuid.New())
	if err != nil {
		t.Fatalf("CleanupChildren(workspace): %v", err)
	}
	if deleted != 0 {
		t.Fatalf("expected 0 rows deleted for synthetic workspace id, got %d", deleted)
	}
}

func TestInsertEntityStakeholder_HappyPathAndIdempotent(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var wsID, wsTenant uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant); err != nil {
		t.Skipf("no live workspace in DB: %v", err)
	}
	var userID uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, wsTenant).Scan(&userID); err != nil {
		t.Skipf("no user in workspace tenant: %v", err)
	}

	svc := New(pool)

	id1, err := svc.InsertEntityStakeholder(ctx, tx, KindWorkspace, wsID, userID, wsTenant, "test-insert-happy")
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}
	if id1 == uuid.Nil {
		t.Fatal("first insert returned uuid.Nil")
	}

	// Idempotent: same (entity_kind, entity_id, user_id, role) tuple
	// must collapse onto the existing row, not error and not duplicate.
	id2, err := svc.InsertEntityStakeholder(ctx, tx, KindWorkspace, wsID, userID, wsTenant, "test-insert-happy")
	if err != nil {
		t.Fatalf("second insert (idempotent path): %v", err)
	}
	if id2 != id1 {
		t.Errorf("idempotent re-insert returned a different id: first=%v second=%v", id1, id2)
	}

	var n int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM entity_stakeholders
		WHERE entity_kind = 'workspace' AND entity_id = $1 AND user_id = $2 AND role = 'test-insert-happy'`,
		wsID, userID).Scan(&n); err != nil {
		t.Fatalf("recount: %v", err)
	}
	if n != 1 {
		t.Errorf("expected exactly 1 stakeholder row after idempotent re-insert, got %d", n)
	}
}

func TestInsertEntityStakeholder_RejectsCrossTenant(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	var wsID, wsTenant uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant); err != nil {
		t.Skipf("no live workspace in DB: %v", err)
	}
	var foreignTenant, foreignUser uuid.UUID
	if err := tx.QueryRow(ctx, `INSERT INTO tenants (name, slug) VALUES ('insert-xt-'||gen_random_uuid(), 'insert-xt-'||gen_random_uuid()) RETURNING id`).Scan(&foreignTenant); err != nil {
		t.Fatalf("seed foreign tenant: %v", err)
	}
	if err := tx.QueryRow(ctx, `
		INSERT INTO users (tenant_id, email, password_hash, role)
		VALUES ($1, 'insert-xt-'||gen_random_uuid()||'@example.com', 'x', 'user')
		RETURNING id`, foreignTenant).Scan(&foreignUser); err != nil {
		t.Fatalf("seed foreign user: %v", err)
	}

	svc := New(pool)
	_, err = svc.InsertEntityStakeholder(ctx, tx, KindWorkspace, wsID, foreignUser, foreignTenant, "test-xt")
	if !errors.Is(err, ErrEntityNotFound) {
		t.Fatalf("expected ErrEntityNotFound (existence-hiding), got %v", err)
	}
}

func TestInsertPageEntityRef_HappyPathAndIdempotent(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	// Anchor on a real portfolio (page_entity_refs vocab is portfolio|product).
	var portID, portTenant uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id, tenant_id FROM portfolio WHERE archived_at IS NULL LIMIT 1`).Scan(&portID, &portTenant)
	if err == pgx.ErrNoRows {
		var wsID, wsTenant, ownerID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT id, tenant_id FROM workspace WHERE archived_at IS NULL LIMIT 1`).Scan(&wsID, &wsTenant); err != nil {
			t.Skipf("no live workspace to anchor portfolio seed: %v", err)
		}
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, wsTenant).Scan(&ownerID); err != nil {
			t.Skipf("no user in workspace tenant: %v", err)
		}
		err = tx.QueryRow(ctx, `
			INSERT INTO portfolio (tenant_id, workspace_id, name, owner_user_id, key_num)
			VALUES ($1, $2, 'insert-pref-'||gen_random_uuid(), $3,
			        COALESCE((SELECT max(key_num) + 1 FROM portfolio WHERE tenant_id = $1), 1))
			RETURNING id, tenant_id`, wsTenant, wsID, ownerID).Scan(&portID, &portTenant)
		if err != nil {
			t.Skipf("cannot seed portfolio: %v", err)
		}
	} else if err != nil {
		t.Fatalf("seed portfolio: %v", err)
	}

	// Seed a page so we have a real page_id (page_entity_refs.page_id is PK + FK).
	var tagEnum string
	if err := tx.QueryRow(ctx, `SELECT tag_enum FROM page_tags LIMIT 1`).Scan(&tagEnum); err != nil {
		t.Fatalf("read page_tags: %v", err)
	}
	var pageID uuid.UUID
	suffix := uuid.NewString()[:8]
	if err := tx.QueryRow(ctx, `
		INSERT INTO pages (tenant_id, key_enum, label, href, icon, tag_enum, kind)
		VALUES ($1, $2, 'insert-pref', '/insert-pref', 'folder', $3, 'entity')
		RETURNING id`, portTenant, "insert-pref-"+suffix, tagEnum).Scan(&pageID); err != nil {
		t.Fatalf("seed page: %v", err)
	}

	svc := New(pool)

	if err := svc.InsertPageEntityRef(ctx, tx, pageID, KindPortfolio, portID, portTenant); err != nil {
		t.Fatalf("first insert: %v", err)
	}
	// Second call with the same (pageID, kind, entityID) — must be a
	// silent no-op via ON CONFLICT (entity_kind, entity_id) DO NOTHING.
	if err := svc.InsertPageEntityRef(ctx, tx, pageID, KindPortfolio, portID, portTenant); err != nil {
		t.Fatalf("second insert (idempotent path): %v", err)
	}
	var n int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM page_entity_refs
		WHERE entity_kind = 'portfolio' AND entity_id = $1`, portID).Scan(&n); err != nil {
		t.Fatalf("recount: %v", err)
	}
	if n != 1 {
		t.Errorf("expected exactly 1 page_entity_refs row, got %d", n)
	}
}

func TestInsertPageEntityRef_RejectsWorkspaceVocabulary(t *testing.T) {
	// page_entity_refs CHECK is {portfolio, product} — workspace must
	// be rejected by the service before it ever reaches the DB.
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	svc := New(pool)
	err = svc.InsertPageEntityRef(ctx, tx, uuid.New(), KindWorkspace, uuid.New(), uuid.New())
	if !errors.Is(err, ErrUnknownEntityKind) {
		t.Fatalf("expected ErrUnknownEntityKind for workspace vocabulary, got %v", err)
	}
}
