package artefactitems_test

// Rank-placement tests for CreateWorkItem (spec
// docs/superpowers/specs/2026-06-06-new-artefact-rank-placement.md).
//
// Verifies the three RankPlacement options compute artefacts_position so a new
// artefact lands top / bottom / under-a-source in the dense Prio. DB-backed
// (reuses vaPool / mainPool / pickTestSubscription); skips when the dev DB or
// an active user isn't reachable, matching the other integration tests here.

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
)

// positionOf reads the raw artefacts_position for an artefact id. The dense
// Prio is relative to the whole filtered set, so the underlying integer
// position is the deterministic thing to assert on.
func positionOf(t *testing.T, va *pgxpool.Pool, id string) int {
	t.Helper()
	var p int
	if err := va.QueryRow(context.Background(),
		`SELECT artefacts_position FROM artefacts WHERE artefacts_id=$1`, id,
	).Scan(&p); err != nil {
		t.Fatalf("read position for %s: %v", id, err)
	}
	return p
}

func TestCreateWorkItem_RankPlacement(t *testing.T) {
	va := vaPool(t)
	mp := mainPool(t)
	sub := pickTestSubscription(t, va)
	svc := artefactitems.NewService(va, mp, "work")
	ctx := context.Background()

	var ownerID uuid.UUID
	if err := mp.QueryRow(ctx,
		`SELECT users_id FROM users WHERE users_id_subscription=$1 AND users_is_active=true LIMIT 1`, sub,
	).Scan(&ownerID); err != nil {
		t.Skipf("no active user: %v", err)
	}
	owner := ownerID.String()

	mk := func(title, placement string, after *string) *artefactitems.WorkItem {
		wi, err := svc.CreateWorkItem(ctx, sub, artefactitems.CreateWorkItemInput{
			ItemType:        "story",
			Title:           title,
			OwnerID:         owner,
			CreatedBy:       owner,
			RankPlacement:   placement,
			AfterArtefactID: after,
		})
		if err != nil {
			t.Fatalf("create %q (%s): %v", title, placement, err)
		}
		return wi
	}

	// Two baseline rows at the bottom establish a min/max window for this type.
	base1 := mk("rank-base-1", "bottom", nil)
	base2 := mk("rank-base-2", "bottom", nil)
	p1 := positionOf(t, va, base1.ID)
	p2 := positionOf(t, va, base2.ID)
	if p2 <= p1 {
		t.Fatalf("bottom inserts not ascending: base1=%d base2=%d", p1, p2)
	}

	// TOP — must sort before every existing same-type row (position < current min).
	top := mk("rank-top", "top", nil)
	pTop := positionOf(t, va, top.ID)
	if pTop >= p1 {
		t.Errorf("top placement not above existing min: top=%d min=%d", pTop, p1)
	}

	// BOTTOM — must sort after every existing same-type row (position > current max).
	// At this point the max is base2 (top went below). Recompute max guardedly.
	bottom := mk("rank-bottom", "bottom", nil)
	pBottom := positionOf(t, va, bottom.ID)
	if pBottom <= p2 {
		t.Errorf("bottom placement not below existing max: bottom=%d prevMax=%d", pBottom, p2)
	}

	// AFTER — duplicate-style insert directly beneath base1. Its position must be
	// strictly greater than base1 and strictly less than base1's next sibling
	// (base2, the next position up at creation time).
	src := base1.ID
	after := mk("rank-after", "after", &src)
	pAfter := positionOf(t, va, after.ID)
	if !(pAfter > p1 && pAfter < p2) {
		t.Errorf("after placement not between source and next sibling: src=%d after=%d next=%d", p1, pAfter, p2)
	}

	// DEFAULT (field omitted) — back-compat: must behave as bottom.
	def := mk("rank-default", "", nil)
	pDef := positionOf(t, va, def.ID)
	if pDef <= pBottom {
		t.Errorf("default (omitted) placement should be bottom-most: default=%d prevBottom=%d", pDef, pBottom)
	}

	// Cleanup — archive the rows we created so we don't pollute the dev set.
	for _, id := range []string{base1.ID, base2.ID, top.ID, bottom.ID, after.ID, def.ID} {
		_, _ = va.Exec(ctx, `UPDATE artefacts SET artefacts_archived_at=now() WHERE artefacts_id=$1`, id)
	}
}
