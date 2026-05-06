package workitems_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/workitems"
)

// PLA-0021 / 00458 — handler-level coverage for the sprint join on
// GET /api/work-items. Seeds a real sprints row + 4 work-items pointing
// at it + 1 work-item with sprint_id=NULL, then asserts each row's
// sprint payload on the wire is either {id, alias} or null. Reuses
// testPool / pickAnyUser / seedRows from service_test.go.

// listRouter mounts the List handler against a minimal chi router with a
// withUser middleware that injects the supplied User into request context
// — same pattern as bulkRouter in handler_bulk_test.go.
func listRouter(h *workitems.Handler, u *models.User) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.WithUserForTest(req.Context(), u)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Get("/api/work-items", h.List)
	return r
}

// seedSprint inserts one sprints row for the subscription with the given
// alias (sprints.name on the wire is exposed as `alias` in the embedded
// SprintRef). Soft-archives via t.Cleanup so the test never leaves
// fixture data behind.
func seedSprint(t *testing.T, pool *pgxpool.Pool, subID, userID uuid.UUID, alias string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO sprints (subscription_id, name, status, created_by)
		VALUES ($1, $2, 'planned', $3)
		RETURNING id`,
		subID, alias, userID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seed sprint %q: %v", alias, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE sprints SET archived_at = now() WHERE id = $1`, id)
	})
	return id
}

// listResponse mirrors what handler.List writes for /api/work-items.
type listResponse struct {
	Items []workitems.WorkItem `json:"items"`
	Total int                  `json:"total"`
}

// TestList_SprintJoin_AliasAndNull seeds 4 rows pointing at a real sprint
// "S-1" + 1 row with sprint_id=NULL, GETs /api/work-items?limit=5 (filtered
// to the seeded titles via deterministic positions to guarantee the rows
// are in the response window), and asserts:
//   - 4 rows have sprint = {id: <seeded>, alias: "S-1"}
//   - 1 row has sprint = null
func TestList_SprintJoin_AliasAndNull(t *testing.T) {
	pool := testPool(t)
	defer pool.Close()
	ctx := context.Background()

	subID, userID := pickAnyUser(t, pool)
	svc := workitems.New(pool)
	h := workitems.NewHandler(svc)

	// Seed one real sprint with alias "S-1".
	sprintID := seedSprint(t, pool, subID, userID, "S-1")

	// Seed 5 rows: 4 with sprint_id pointing at sprintID, 1 with NULL.
	// Positions 9100..9500 keep them adjacent + ahead of any default seed
	// data that might have lower positions, so the limit=5 window does
	// not need a stable pre-condition on existing tenant data.
	pos := 9100
	rows := make([]seedRow, 5)
	for i := 0; i < 5; i++ {
		p := pos + i*100
		r := seedRow{
			title:      "sprint-join-row-" + string(rune('A'+i)),
			backlogPos: &p,
		}
		if i < 4 {
			// First 4 belong to the seeded sprint. Switch into sprint scope:
			// table CHECK requires exactly one of backlog_position /
			// sprint_position to be non-NULL when sprint_id is set.
			sp := p
			r.backlogPos = nil
			r.sprintPos = &sp
			s := sprintID
			r.sprintID = &s
		}
		rows[i] = r
	}
	ids := seedRows(t, ctx, pool, subID, userID, rows)

	user := &models.User{ID: userID, SubscriptionID: subID, IsActive: true}
	srv := httptest.NewServer(listRouter(h, user))
	defer srv.Close()

	// Filter the response down to our 5 seeded rows by sprint_id —
	// catches both the sprint=true and sprint=false rows in the same
	// page. (sprint_id NULL still passes through item_type filter.)
	// To get all 5 in one shot, query without sprint filter and look up
	// our seeded ids in the response set.
	resp, err := http.Get(srv.URL + "/api/work-items?limit=5000")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}
	var got listResponse
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Index by id so we don't depend on sort order.
	byID := make(map[string]workitems.WorkItem, len(got.Items))
	for _, it := range got.Items {
		byID[it.ID] = it
	}

	// Assert the 4 sprint-bearing rows.
	for i := 0; i < 4; i++ {
		idStr := ids[i].String()
		it, ok := byID[idStr]
		if !ok {
			t.Errorf("seeded row %s missing from response", idStr)
			continue
		}
		if it.Sprint == nil {
			t.Errorf("row %s: sprint is nil, want {%s, S-1}", idStr, sprintID)
			continue
		}
		if it.Sprint.ID != sprintID.String() {
			t.Errorf("row %s: sprint.id = %s, want %s", idStr, it.Sprint.ID, sprintID)
		}
		if it.Sprint.Alias != "S-1" {
			t.Errorf("row %s: sprint.alias = %q, want \"S-1\"", idStr, it.Sprint.Alias)
		}
	}

	// Assert the 5th row (sprint_id NULL) → sprint = null on the wire.
	idStr := ids[4].String()
	it, ok := byID[idStr]
	if !ok {
		t.Fatalf("seeded null-sprint row %s missing from response", idStr)
	}
	if it.Sprint != nil {
		t.Errorf("row %s: sprint = %+v, want nil", idStr, it.Sprint)
	}
	if it.SprintID != nil {
		t.Errorf("row %s: sprint_id = %v, want nil", idStr, *it.SprintID)
	}
}
