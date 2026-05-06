package workitems_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/workitems"
)

// PLA-0021 / 00459 — service-level coverage for the users LEFT JOIN on the
// work-items list. Seeds 4 rows pointing at userA + 1 row pointing at a
// freshly-inserted userB, then asserts each row's Owner payload matches
// the seeded user's derived display_name (and AvatarURL is nil — the users
// table has no avatar storage column today).
//
// Why two real users instead of "4 with owner / 1 with NULL": owner_id is
// NOT NULL on the work_items table (see schema 063 line 234). Adapting
// AC44's literal text would otherwise require dropping the FK constraint
// — out of scope for WS4-B. Two distinct owners still proves the JOIN
// resolves per-row rather than carrying a stale projection.

// seedExtraUser inserts one additional active user inside the same
// subscription so we can prove the owner join discriminates per row.
// first_name/last_name are populated so the COALESCE(NULLIF(TRIM(...))) /
// email fallback is exercised on the userA path while userB exercises the
// "first/last set → joined name" path.
func seedExtraUser(t *testing.T, pool *pgxpool.Pool, subID uuid.UUID, first, last string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	id := uuid.New()
	// SystemRoleUser UUID — see internal/roles/service.go. role_id is NOT
	// NULL after migration 088; legacy enum `role` is kept until PLA-0007 G4.
	systemRoleUser := uuid.MustParse("00000000-0000-0000-0000-00000000ad10")
	_, err := pool.Exec(ctx,
		`INSERT INTO users (id, email, password_hash, role, role_id, is_active, subscription_id, first_name, last_name)
		 VALUES ($1, $2, '!', 'user', $3, true, $4, $5, $6)`,
		id, "owner-join-"+id.String()+"@test.local", systemRoleUser, subID, first, last,
	)
	if err != nil {
		t.Skipf("cannot seed extra user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// fetchExpectedDisplayName mirrors the COALESCE/NULLIF/TRIM derivation the
// service query uses. The test reads it back from the DB rather than
// re-implementing in Go so a future change to the SQL stays the single
// source of truth.
func fetchExpectedDisplayName(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) string {
	t.Helper()
	var dn string
	err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email)
		 FROM users WHERE id = $1`, userID,
	).Scan(&dn)
	if err != nil {
		t.Fatalf("derive expected display_name: %v", err)
	}
	return dn
}

// TestList_OwnerJoin_DisplayNameAndAvatar seeds 4 rows owned by userA + 1
// row owned by userB, fetches the list via the service (handler-level
// httptest is unnecessary — the join lives in the service query, and a
// service-level call avoids depending on chi routing setup), and asserts:
//   - rows owned by userA: Owner != nil, Owner.ID == userA, DisplayName
//     matches the SQL derivation, AvatarURL == nil.
//   - rows owned by userB: Owner != nil, Owner.ID == userB,
//     DisplayName == "Bee Two" (per seeded first/last), AvatarURL == nil.
func TestList_OwnerJoin_DisplayNameAndAvatar(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subAID, userA := pickAnyUser(t, pool)
	svc := workitems.New(pool)

	userB := seedExtraUser(t, pool, subAID, "Bee", "Two")

	// Seed 5 rows: 4 owned by userA (default), 1 owned by userB. Positions
	// 12100..12500 keep them adjacent + ahead of generic seed data so a
	// limit-large-enough call is guaranteed to include them.
	pos := 12100
	rows := make([]seedRow, 5)
	for i := 0; i < 5; i++ {
		p := pos + i*100
		rows[i] = seedRow{
			title:      "owner-join-row-" + string(rune('A'+i)),
			backlogPos: &p,
		}
	}
	ids := seedRows(t, ctx, pool, subAID, userA, rows)

	// Re-owner the 5th row to userB; seedRows always seeds owner = userA.
	if _, err := pool.Exec(ctx,
		`UPDATE obj_work_items SET owner_id = $1 WHERE id = $2`,
		userB, ids[4],
	); err != nil {
		t.Fatalf("re-owner row 5: %v", err)
	}

	got, err := svc.ListWorkItems(ctx, subAID.String(), workitems.ListWorkItemsFilter{Limit: 5000})
	if err != nil {
		t.Fatalf("ListWorkItems: %v", err)
	}

	byID := make(map[string]workitems.WorkItem, len(got))
	for _, it := range got {
		byID[it.ID] = it
	}

	wantA := fetchExpectedDisplayName(t, pool, userA)
	wantB := fetchExpectedDisplayName(t, pool, userB)
	if wantB != "Bee Two" {
		// Catches a regression in the SQL derivation (e.g. dropped TRIM).
		t.Errorf("seed sanity: derived display_name for userB = %q, want %q", wantB, "Bee Two")
	}

	// Rows 1-4 → userA.
	for i := 0; i < 4; i++ {
		idStr := ids[i].String()
		it, ok := byID[idStr]
		if !ok {
			t.Errorf("seeded row %s missing from response", idStr)
			continue
		}
		if it.Owner == nil {
			t.Errorf("row %s: Owner is nil, want {%s, %q}", idStr, userA, wantA)
			continue
		}
		if it.Owner.ID != userA.String() {
			t.Errorf("row %s: Owner.ID = %s, want %s", idStr, it.Owner.ID, userA)
		}
		if it.Owner.DisplayName != wantA {
			t.Errorf("row %s: Owner.DisplayName = %q, want %q", idStr, it.Owner.DisplayName, wantA)
		}
		if it.Owner.AvatarURL != nil {
			t.Errorf("row %s: Owner.AvatarURL = %v, want nil (users table has no avatar column today)", idStr, *it.Owner.AvatarURL)
		}
		// OwnerID writer-facing field is preserved.
		if it.OwnerID != userA.String() {
			t.Errorf("row %s: OwnerID = %s, want %s", idStr, it.OwnerID, userA)
		}
	}

	// Row 5 → userB.
	idStr := ids[4].String()
	it, ok := byID[idStr]
	if !ok {
		t.Fatalf("seeded userB row %s missing from response", idStr)
	}
	if it.Owner == nil {
		t.Fatalf("row %s: Owner is nil, want userB ref", idStr)
	}
	if it.Owner.ID != userB.String() {
		t.Errorf("row %s: Owner.ID = %s, want %s", idStr, it.Owner.ID, userB)
	}
	if it.Owner.DisplayName != wantB {
		t.Errorf("row %s: Owner.DisplayName = %q, want %q", idStr, it.Owner.DisplayName, wantB)
	}
	if !strings.Contains(it.Owner.DisplayName, "Bee") {
		t.Errorf("row %s: Owner.DisplayName = %q, expected to contain seeded first_name", idStr, it.Owner.DisplayName)
	}
	if it.Owner.AvatarURL != nil {
		t.Errorf("row %s: Owner.AvatarURL = %v, want nil", idStr, *it.Owner.AvatarURL)
	}
}
