package roles

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/permissions"
)

// PLA-0007 AC #9 (audit smoke): role.created, role.updated,
// role.archived, role.permissions_granted, role.permissions_revoked all
// land in audit_log when the corresponding service write happens. Acts
// as the export contract: anyone who exports audit rows for compliance
// can assume these five action codes exist with this metadata shape.
func TestRolesService_auditTrailSmoke(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()

	subID, cleanup := mkTenant(t, pool, "audit-smoke")
	defer cleanup()

	actor := mkUser(t, pool, subID, models.RoleGAdmin)
	svc := New(pool, audit.New(pool))
	ctx := context.Background()

	// Create.
	r, err := svc.Create(ctx, CreateInput{
		Code:  "audit-smoke-" + uuid.NewString()[:8],
		Label: "Smoke",
		Rank:  100,
	}, subID, actor.ID, "127.0.0.1")
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	// Update.
	newLabel := "Smoke Updated"
	if _, err := svc.Update(ctx, r.ID, UpdateInput{Label: &newLabel}, subID, actor.ID, "127.0.0.1"); err != nil {
		t.Fatalf("update: %v", err)
	}

	// Look up a permission id and grant/revoke it.
	var permID uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT id FROM users_permissions WHERE code = $1`, string(permissions.RolesList),
	).Scan(&permID); err != nil {
		t.Fatalf("lookup perm: %v", err)
	}
	actorPerms := map[uuid.UUID]struct{}{permID: {}}

	if err := svc.AssignPermissions(ctx, r.ID, []uuid.UUID{permID}, subID, actor.ID, actorPerms, "127.0.0.1"); err != nil {
		t.Fatalf("assign: %v", err)
	}
	if err := svc.RevokePermissions(ctx, r.ID, []uuid.UUID{permID}, subID, actor.ID, "127.0.0.1"); err != nil {
		t.Fatalf("revoke: %v", err)
	}

	// Archive.
	if err := svc.Archive(ctx, r.ID, subID, actor.ID, "127.0.0.1"); err != nil {
		t.Fatalf("archive: %v", err)
	}

	// Pull all audit rows for this resource and assert the five action
	// codes are present.
	rows, err := pool.Query(ctx,
		`SELECT audit_logs_action FROM audit_logs WHERE audit_logs_resource_id = $1 ORDER BY audit_logs_created_at`,
		r.ID.String(),
	)
	if err != nil {
		t.Fatalf("audit query: %v", err)
	}
	defer rows.Close()
	var actions []string
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			t.Fatalf("scan: %v", err)
		}
		actions = append(actions, a)
	}

	want := map[string]bool{
		"role.created":             false,
		"role.updated":             false,
		"role.permissions_granted": false,
		"role.permissions_revoked": false,
		"role.archived":            false,
	}
	for _, a := range actions {
		if _, ok := want[a]; ok {
			want[a] = true
		}
	}
	for action, seen := range want {
		if !seen {
			t.Errorf("missing audit action %q (saw %v)", action, actions)
		}
	}
}
