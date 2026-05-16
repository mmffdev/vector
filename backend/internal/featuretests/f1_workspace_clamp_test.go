package featuretests_test

// F1 — Workspace clamp end-to-end via JWT claim.
//
// PLA-0053 feature test. Covers stories 00575–00579 (JWT claim,
// middleware reshape, schema, mount, service clamp). Tracker group:
// `backend-workspace-foundation`, feature `F1`.
//
// Written RED 2026-05-16. The assertions below FAIL on main because:
//   - auth.AccessClaims has no `workspace_id` field (story 00575 adds it)
//   - roletypes.User has no WorkspaceID field (story 00575 adds it)
//   - WorkspaceClampMiddleware reads ?ws= from URL, not the JWT claim
//     (story 00576 reshapes it to JWT-first with FirstLiveWorkspace fallback)
//   - artefact_types has no workspace_id column (story 00577 adds it)
//   - WorkspaceClampMiddleware is not mounted on /_site/artefact-types or
//     /_site/work-items (story 00578 mounts it)
//   - artefacttypes + artefactitems services don't read WorkspaceIDFromCtx
//     (story 00579 wires the clamp into the queries)
//
// Suite structure:
//
//   Tier A — unit tests, no DB. These can fail/pass independent of any
//   backend wiring. RED-on-main is fully exercised by Tier A.
//
//   Tier B — integration tests, require live dev DB + full handler
//   stack. Currently t.Skip()'d with TODO refs to the implementation
//   stories that unblock them. Story 00578 enables them by mounting
//   the middleware; story 00579 makes them actually pass.
//
// The feature test ships RED before any implementation story lands.
// Green threshold = all Tier-A + all Tier-B pass after story 00579.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/artefacttypes"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/topology"
)

// ──────────────────────────────────────────────────────────────────────
// Tier A — unit tests (no DB). RED on main; expected GREEN after stories
// 00575 (JWT claim) + 00576 (middleware reshape) land.
// ──────────────────────────────────────────────────────────────────────

// TestF1_JWTClaim_CarriesWorkspaceID verifies that AccessClaims has a
// WorkspaceID field that survives marshal/unmarshal. RED on main
// because AccessClaims today carries SubscriptionID only.
//
// Story 00575 — SEC: add workspace_id JWT claim to login + auth.User.
func TestF1_JWTClaim_CarriesWorkspaceID(t *testing.T) {
	workspaceID := uuid.New()
	subscriptionID := uuid.New()

	// Build a JWT body shaped the way story 00575 specifies:
	// subscription_id + workspace_id alongside the existing fields.
	body := []byte(`{
		"email":           "f1-test@example.com",
		"role":            "gadmin",
		"subscription_id": "` + subscriptionID.String() + `",
		"workspace_id":    "` + workspaceID.String() + `",
		"force_pwd_change": false
	}`)

	var c auth.AccessClaims
	if err := json.Unmarshal(body, &c); err != nil {
		t.Fatalf("unmarshal claims: %v", err)
	}

	// RED-causing assertion: AccessClaims today has no WorkspaceID field,
	// so this access fails to compile until story 00575 adds it.
	// Compile-time failure IS the red signal.
	got := c.WorkspaceID
	if got != workspaceID.String() {
		t.Errorf(
			"AccessClaims.WorkspaceID = %q, want %q (story 00575 must add the field + natural unmarshal must populate it from `workspace_id`)",
			got, workspaceID.String(),
		)
	}
}

// TestF1_SignAccessToken_IncludesWorkspaceID verifies that signing a
// token from a roletypes.User attaches the user's WorkspaceID. RED
// because roletypes.User has no WorkspaceID field today.
//
// Story 00575 — SEC: add workspace_id JWT claim to login + auth.User.
func TestF1_SignAccessToken_IncludesWorkspaceID(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "f1-test-secret")
	t.Setenv("JWT_ACCESS_TTL", "15m")

	workspaceID := uuid.New()
	u := &roletypes.User{
		ID:             uuid.New(),
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: uuid.New(),
		// RED-causing line: roletypes.User has no WorkspaceID field
		// until story 00575 adds it. Compile-time failure IS the red
		// signal on main.
		WorkspaceID: workspaceID,
	}

	signed, err := auth.SignAccessToken(u)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	c, err := auth.ParseAccessToken(signed)
	if err != nil {
		t.Fatalf("parse token: %v", err)
	}

	if c.WorkspaceID != workspaceID.String() {
		t.Errorf(
			"round-tripped JWT WorkspaceID = %q, want %q (story 00575 wires u.WorkspaceID into the signing path)",
			c.WorkspaceID, workspaceID.String(),
		)
	}

	// Sanity: subscription_id still works alongside the new field
	// (no regression in the existing claim).
	if c.SubscriptionID != u.SubscriptionID.String() {
		t.Errorf("subscription_id round-trip broken: got %q, want %q",
			c.SubscriptionID, u.SubscriptionID.String())
	}

	// Sanity: signing method is still HS256 (no inadvertent change).
	parsed, _ := jwt.Parse(signed, func(t *jwt.Token) (interface{}, error) {
		return []byte("f1-test-secret"), nil
	})
	if alg, _ := parsed.Header["alg"].(string); alg != "HS256" {
		t.Errorf("signing alg = %q, want HS256", alg)
	}
}

// TestF1_Middleware_JWTBeatsURL verifies that when both the JWT claim
// and ?ws= URL query are present, the JWT wins. RED on main because
// the middleware reads URL first.
//
// Story 00576 — SEC: WorkspaceClampMiddleware reads JWT claim (drop ?ws=).
func TestF1_Middleware_JWTBeatsURL(t *testing.T) {
	subscriptionID := uuid.New()
	userID := uuid.New()
	jwtWorkspace := uuid.New() // The one the JWT carries — should win
	urlWorkspace := uuid.New() // The one URL would resolve to — should be ignored

	lookup := &f1FakeLookup{
		// Wire URL-resolved workspace as a slug lookup; if middleware
		// still consults URL, this is what it would seed.
		bySlug:    map[string]uuid.UUID{subscriptionID.String() + "|other-ws": urlWorkspace},
		firstLive: map[uuid.UUID]uuid.UUID{subscriptionID: jwtWorkspace},
		// Both workspaces grant the user a role so the role check
		// doesn't preempt the assertion we're making.
		role: map[string]bool{
			jwtWorkspace.String() + "|" + userID.String(): true,
			urlWorkspace.String() + "|" + userID.String(): true,
		},
	}

	user := &roletypes.User{
		ID:             userID,
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: subscriptionID,
		// RED-causing line until story 00575 adds the field.
		WorkspaceID: jwtWorkspace,
	}

	seen := runClampForF1(t, lookup, user, "ws=other-ws")

	if seen.workspaceID != jwtWorkspace {
		t.Errorf(
			"middleware seeded workspaceID = %s, want %s (story 00576 must read from JWT before URL; got URL-resolved value instead)",
			seen.workspaceID, jwtWorkspace,
		)
	}
}

// TestF1_Middleware_JWTAbsent_FallsBackToFirstLive verifies that when
// the JWT has no workspace_id (legacy token during rollout), the
// middleware falls back to FirstLiveWorkspace. RED expectation:
// today's middleware reaches FirstLiveWorkspace via the no-?ws= path,
// so this CASE may pass on main — but it pins the behaviour so story
// 00576 keeps the fallback intact when it removes the URL surface.
//
// Story 00576 — fallback intact for legacy JWTs.
func TestF1_Middleware_JWTAbsent_FallsBackToFirstLive(t *testing.T) {
	subscriptionID := uuid.New()
	userID := uuid.New()
	firstLive := uuid.New()

	lookup := &f1FakeLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subscriptionID: firstLive},
		role:      map[string]bool{firstLive.String() + "|" + userID.String(): true},
	}

	user := &roletypes.User{
		ID:             userID,
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: subscriptionID,
		// Zero WorkspaceID = JWT did not carry the claim. After story
		// 00575 the field exists; before then this line is dead code
		// (compile error). Both states cover the legacy-token path.
		WorkspaceID: uuid.Nil,
	}

	seen := runClampForF1(t, lookup, user, "")

	if seen.workspaceID != firstLive {
		t.Errorf(
			"fallback FirstLiveWorkspace = %s, want %s (story 00576 must keep this fallback for legacy JWTs)",
			seen.workspaceID, firstLive,
		)
	}
}

// TestF1_Middleware_NoRoleStill403 verifies that even when the JWT
// carries a workspace_id, the role check still runs. This protects
// against a forged JWT (or a token issued before role-revocation)
// reaching a workspace the user has no active role on.
//
// Story 00576 — HasActiveRole check survives the JWT-mode reshape.
func TestF1_Middleware_NoRoleStill403(t *testing.T) {
	subscriptionID := uuid.New()
	userID := uuid.New()
	jwtWorkspace := uuid.New()

	lookup := &f1FakeLookup{
		firstLive: map[uuid.UUID]uuid.UUID{subscriptionID: jwtWorkspace},
		// Crucially: NO entry in role map → HasActiveRole returns false.
		role: map[string]bool{},
	}

	user := &roletypes.User{
		ID:             userID,
		Email:          "f1-test@example.com",
		Role:           roletypes.RoleGAdmin,
		SubscriptionID: subscriptionID,
		WorkspaceID:    jwtWorkspace,
	}

	rec := runClampForF1Rec(t, lookup, user, "")

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 (HasActiveRole must still run after JWT-mode resolution)", rec.Code)
	}
	if got := readErrCodeF1(t, rec); got != "no_workspace_role" {
		t.Errorf("error body = %q, want \"no_workspace_role\"", got)
	}
}

// ──────────────────────────────────────────────────────────────────────
// Tier B — integration tests (live DB + handler stack). Skipped until
// stories 00577 + 00578 + 00579 land. Structured so the unskip is a
// one-line change once the implementation is wired.
// ──────────────────────────────────────────────────────────────────────

// TestF1_Migration_ArtefactTypesWorkspaceIDNotNull verifies that the
// post-migration state has zero NULLs in
// artefacts_types.artefacts_types_id_workspace (the post-RF1.4.4
// column name; renamed from workspace_id by mig 066).
//
// Story 00577 — SQL: add workspace_id to artefact_types + backfill.
// SUBSTRATE-ALREADY-IN-PLACE: PLA-0026 mig 019 added the column +
// NOT NULL backfill; mig 066 renamed it to the column-prefix shape.
// This test verifies the in-DB invariant against the live dev pool.
//
// Skips gracefully when the tunnel is down (consistent with other
// integration tests in topology/middleware_workspace_test.go).
func TestF1_Migration_ArtefactTypesWorkspaceIDNotNull(t *testing.T) {
	dsn := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if dsn == "" {
		// Try loading the env file the dev launcher uses. Same
		// pattern as topology/middleware_workspace_test.go's testPool.
		for _, rel := range []string{"backend/.env.dev", "../../.env.dev", "../../../.env.dev"} {
			abs, _ := filepath.Abs(rel)
			if _, err := os.Stat(abs); err == nil {
				_ = godotenv.Load(abs)
				dsn = os.Getenv("VECTOR_ARTEFACTS_DB_URL")
				break
			}
		}
	}
	if dsn == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set (tunnel down or env missing)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot ping vector_artefacts (tunnel down?): %v", err)
	}

	var total, nullCount int
	row := pool.QueryRow(ctx, `
		SELECT
			COUNT(*) AS total,
			COUNT(*) FILTER (WHERE artefacts_types_id_workspace IS NULL) AS null_workspace
		  FROM artefacts_types
	`)
	if err := row.Scan(&total, &nullCount); err != nil {
		t.Fatalf("query artefacts_types: %v", err)
	}

	if total == 0 {
		t.Skip("artefacts_types is empty in dev — migration assertion skipped")
	}
	if nullCount != 0 {
		t.Errorf(
			"artefacts_types: %d rows have NULL workspace_id (total=%d); story 00577 (substrate via mig 019) must guarantee zero",
			nullCount, total,
		)
	}
}

// TestF1_GET_ArtefactTypes_WorkspaceScoped verifies that the
// artefacttypes service's workspace-clamped read returns only the
// caller's workspace rows. Exercises the SQL clamp predicate
// added by PLA-0053 / story 00579 directly against the live dev
// pool — handler-level integration is implicit (the handler just
// passes the JWT-derived workspace_id through to ListByWorkspace).
//
// Approach: pick two real subscriptions from the dev DB that each
// own at least one artefact_type. ListByWorkspace for sub-A's
// workspace must return only A's types; calling ListByWorkspace
// with sub-A but sub-B's workspace_id must return empty (defence-
// in-depth — the subscription_id AND workspace_id both narrow).
func TestF1_GET_ArtefactTypes_WorkspaceScoped(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	a, b, err := f1FindTwoDistinctWorkspaces(ctx, pool)
	if err != nil {
		t.Skipf("dev DB does not have two distinct (sub, workspace) pairs to compare: %v", err)
	}

	svc := artefacttypes.NewService(pool)

	typesA, err := svc.ListByWorkspace(ctx, a.subID, a.wsID)
	if err != nil {
		t.Fatalf("ListByWorkspace(A): %v", err)
	}
	if len(typesA) == 0 {
		t.Skipf("workspace A (%s) has zero live artefact_types", a.wsID)
	}

	// Defence-in-depth: A's subID + B's workspaceID must return zero
	// rows. The AND-of-clamps means even if a forged workspace_id
	// slipped through, the subscription_id still gates the read.
	mismatched, err := svc.ListByWorkspace(ctx, a.subID, b.wsID)
	if err != nil {
		t.Fatalf("ListByWorkspace(A.sub, B.ws): %v", err)
	}
	if len(mismatched) != 0 {
		t.Errorf("cross-subscription clamp leak: %d rows returned when querying sub-A with workspace-B", len(mismatched))
	}
}

// TestF1_GET_WorkItems_WorkspaceScoped verifies that the
// artefactitems service's ListWorkItems with Filters.WorkspaceID
// returns only artefacts whose artefact_type belongs to the
// clamped workspace.
func TestF1_GET_WorkItems_WorkspaceScoped(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	a, _, err := f1FindTwoDistinctWorkspaces(ctx, pool)
	if err != nil {
		t.Skipf("dev DB does not have two distinct (sub, workspace) pairs: %v", err)
	}

	svc := artefactitems.NewService(pool, nil, "work")
	wsStr := a.wsID.String()
	items, _, err := svc.ListWorkItems(ctx, a.subID, artefactitems.Filters{
		Limit:       50,
		WorkspaceID: &wsStr,
	})
	if err != nil {
		t.Fatalf("ListWorkItems with workspace clamp: %v", err)
	}

	// Every returned row's artefact_type_id must resolve to an
	// artefact_type whose workspace_id == a.wsID. Cross-check via
	// a direct query: count any row in the result whose artefact's
	// type belongs to a *different* workspace. Expect zero.
	if len(items) == 0 {
		t.Skipf("workspace A (%s) has zero live artefacts in scope=work", a.wsID)
	}
	leaks, err := f1CountCrossWorkspaceLeaks(ctx, pool, items, a.wsID)
	if err != nil {
		t.Fatalf("cross-workspace leak audit: %v", err)
	}
	if leaks != 0 {
		t.Errorf("workspace clamp leaked: %d returned artefacts belong to a different workspace than %s", leaks, a.wsID)
	}
}

// TestF1_GET_CrossWorkspace_ArtefactID_404 verifies that GetWorkItem
// with a workspace clamp returns ErrNotFound for an artefact in a
// different workspace. The handler translates ErrNotFound to HTTP
// 404 — no existence leak between workspaces.
func TestF1_GET_CrossWorkspace_ArtefactID_404(t *testing.T) {
	pool := vectorArtefactsPoolForF1(t)
	defer pool.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	a, b, err := f1FindTwoDistinctWorkspaces(ctx, pool)
	if err != nil {
		t.Skipf("dev DB does not have two distinct (sub, workspace) pairs: %v", err)
	}

	// Pick a real artefact ID from workspace B.
	bItemID, err := f1PickArtefactInWorkspace(ctx, pool, b.subID, b.wsID, "work")
	if err != nil {
		t.Skipf("workspace B has no live work-scope artefacts to pick: %v", err)
	}

	svc := artefactitems.NewService(pool, nil, "work")
	// Caller is in subscription A, clamped to workspace A. Asking
	// for an item from workspace B should not surface its existence.
	_, err = svc.GetWorkItemInWorkspace(ctx, a.subID, a.wsID, bItemID)
	if !errors.Is(err, artefactitems.ErrNotFound) {
		t.Errorf(
			"cross-workspace Get: want ErrNotFound (handler maps → 404), got %v (existence-leak risk)",
			err,
		)
	}
}

// ──────────────────────────────────────────────────────────────────────
// Helpers — live-DB integration scaffolding for the Tier-B tests above.
// All gated on the same tunnel-down skip as the Tier-A migration test.
// ──────────────────────────────────────────────────────────────────────

type f1WorkspaceFixture struct {
	subID uuid.UUID
	wsID  uuid.UUID
}

// vectorArtefactsPoolForF1 opens the dev vector_artefacts pool used by
// the Tier-B integration tests. Mirrors the migration test's logic so
// every Tier-B helper shares the same tunnel-down skip behaviour.
func vectorArtefactsPoolForF1(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VECTOR_ARTEFACTS_DB_URL")
	if dsn == "" {
		for _, rel := range []string{"backend/.env.dev", "../../.env.dev", "../../../.env.dev"} {
			abs, _ := filepath.Abs(rel)
			if _, err := os.Stat(abs); err == nil {
				_ = godotenv.Load(abs)
				dsn = os.Getenv("VECTOR_ARTEFACTS_DB_URL")
				break
			}
		}
	}
	if dsn == "" {
		t.Skip("VECTOR_ARTEFACTS_DB_URL not set (tunnel down or env missing)")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot open pool (tunnel down?): %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("cannot ping vector_artefacts (tunnel down?): %v", err)
	}
	return pool
}

// f1FindTwoDistinctWorkspaces walks artefacts_types looking for two
// (subscription_id, workspace_id) pairs that differ in BOTH fields.
// Returns ErrNoTwoDistinct when the dev DB has fewer than 2 distinct
// pairs — the caller's test t.Skip's gracefully in that case.
//
// Prefers pairs that have at least one live work-scope artefact each
// (so the work-items Tier-B tests have something to compare against);
// falls back to any two distinct pairs when no pair has artefacts.
func f1FindTwoDistinctWorkspaces(ctx context.Context, pool *pgxpool.Pool) (f1WorkspaceFixture, f1WorkspaceFixture, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			at.artefacts_types_id_subscription,
			at.artefacts_types_id_workspace,
			COUNT(a.id) AS artefact_count
		  FROM artefacts_types at
		  LEFT JOIN artefacts a ON a.artefact_type_id = at.artefacts_types_id
		                       AND a.archived_at IS NULL
		 WHERE at.artefacts_types_archived_at IS NULL
		   AND at.artefacts_types_scope = 'work'
		 GROUP BY at.artefacts_types_id_subscription, at.artefacts_types_id_workspace
		 ORDER BY artefact_count DESC
		 LIMIT 50
	`)
	if err != nil {
		return f1WorkspaceFixture{}, f1WorkspaceFixture{}, err
	}
	defer rows.Close()
	pairs := []f1WorkspaceFixture{}
	for rows.Next() {
		var p f1WorkspaceFixture
		var count int
		if err := rows.Scan(&p.subID, &p.wsID, &count); err != nil {
			return f1WorkspaceFixture{}, f1WorkspaceFixture{}, err
		}
		pairs = append(pairs, p)
	}
	for i := range pairs {
		for j := i + 1; j < len(pairs); j++ {
			if pairs[i].subID != pairs[j].subID && pairs[i].wsID != pairs[j].wsID {
				return pairs[i], pairs[j], nil
			}
		}
	}
	return f1WorkspaceFixture{}, f1WorkspaceFixture{}, errNoTwoDistinct
}

var errNoTwoDistinct = errors.New("fewer than 2 distinct (subscription, workspace) pairs in artefacts_types")

// f1CountCrossWorkspaceLeaks queries the DB to count how many of the
// returned artefacts have an artefact_type whose workspace_id != wantWS.
// Zero proves the service's workspace clamp is sound.
func f1CountCrossWorkspaceLeaks(ctx context.Context, pool *pgxpool.Pool, items []artefactitems.WorkItem, wantWS uuid.UUID) (int, error) {
	if len(items) == 0 {
		return 0, nil
	}
	ids := make([]uuid.UUID, 0, len(items))
	for _, it := range items {
		id, err := uuid.Parse(it.ID)
		if err != nil {
			continue
		}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return 0, nil
	}
	var leaks int
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM artefacts a
		  JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		 WHERE a.id = ANY($1::uuid[])
		   AND at.artefacts_types_id_workspace <> $2
	`, ids, wantWS).Scan(&leaks)
	return leaks, err
}

// f1PickArtefactInWorkspace returns the id of any live work-scope (or
// strategy-scope) artefact owned by the (sub, ws) pair. ErrNoRows when
// the fixture is empty (caller t.Skip's).
func f1PickArtefactInWorkspace(ctx context.Context, pool *pgxpool.Pool, subID, wsID uuid.UUID, scope string) (uuid.UUID, error) {
	var id uuid.UUID
	err := pool.QueryRow(ctx, `
		SELECT a.id
		  FROM artefacts a
		  JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		 WHERE a.subscription_id = $1
		   AND at.artefacts_types_id_workspace = $2
		   AND at.artefacts_types_scope = $3
		   AND a.archived_at IS NULL
		 LIMIT 1
	`, subID, wsID, scope).Scan(&id)
	return id, err
}

// ──────────────────────────────────────────────────────────────────────
// Helpers (file-local — featuretests package owns its harness, not
// imported from topology_test which is a separate test binary).
// ──────────────────────────────────────────────────────────────────────

// f1FakeLookup mirrors the topology_test.fakeWorkspaceLookup pattern.
// Kept local to this file (and package-private) so future feature
// tests can grow their own fakes without coupling to topology's tests.
type f1FakeLookup struct {
	firstLive map[uuid.UUID]uuid.UUID
	bySlug    map[string]uuid.UUID
	byID      map[string]uuid.UUID
	role      map[string]bool
}

func (f *f1FakeLookup) FirstLiveWorkspace(_ context.Context, sub uuid.UUID) (uuid.UUID, error) {
	id, ok := f.firstLive[sub]
	if !ok || id == uuid.Nil {
		return uuid.Nil, topology.ErrNoWorkspace
	}
	return id, nil
}

func (f *f1FakeLookup) ResolveSlug(_ context.Context, sub uuid.UUID, slug string) (uuid.UUID, error) {
	id, ok := f.bySlug[sub.String()+"|"+slug]
	if !ok {
		return uuid.Nil, topology.ErrWorkspaceNotFound
	}
	return id, nil
}

func (f *f1FakeLookup) ResolveRef(ctx context.Context, sub uuid.UUID, ref string) (uuid.UUID, error) {
	if id, err := uuid.Parse(ref); err == nil {
		key := sub.String() + "|" + id.String()
		got, ok := f.byID[key]
		if !ok {
			return uuid.Nil, topology.ErrWorkspaceNotFound
		}
		return got, nil
	}
	return f.ResolveSlug(ctx, sub, ref)
}

func (f *f1FakeLookup) HasActiveRole(_ context.Context, ws, u uuid.UUID) (bool, error) {
	return f.role[ws.String()+"|"+u.String()], nil
}

// seenCtx captures what the terminal handler observed from the
// workspace clamp.
type seenF1Ctx struct {
	workspaceID uuid.UUID
	hasClamp    bool
}

func runClampForF1(
	t *testing.T,
	lookup topology.WorkspaceLookup,
	user *roletypes.User,
	queryString string,
) *seenF1Ctx {
	t.Helper()
	rec, seen := runClampForF1Both(t, lookup, user, queryString)
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected non-200: %d (body=%q)", rec.Code, rec.Body.String())
	}
	return seen
}

func runClampForF1Rec(
	t *testing.T,
	lookup topology.WorkspaceLookup,
	user *roletypes.User,
	queryString string,
) *httptest.ResponseRecorder {
	t.Helper()
	rec, _ := runClampForF1Both(t, lookup, user, queryString)
	return rec
}

func runClampForF1Both(
	t *testing.T,
	lookup topology.WorkspaceLookup,
	user *roletypes.User,
	queryString string,
) (*httptest.ResponseRecorder, *seenF1Ctx) {
	t.Helper()
	seen := &seenF1Ctx{}
	terminal := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id, ok := topology.WorkspaceIDFromCtx(r.Context())
		seen.workspaceID = id
		seen.hasClamp = ok
		w.WriteHeader(http.StatusOK)
	})
	clamp := topology.WorkspaceClampMiddleware(lookup)(terminal)

	url := "/api/_site/artefact-types"
	if queryString != "" {
		url += "?" + queryString
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if user != nil {
		req = req.WithContext(auth.WithUserForTest(req.Context(), user))
	}
	rec := httptest.NewRecorder()
	clamp.ServeHTTP(rec, req)
	return rec, seen
}

func readErrCodeF1(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body: %v (body=%q)", err, rec.Body.String())
	}
	return body["error"]
}

