package librarydb

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Release-channel surface (Phase 3 of the mmff_library plan, §12).
//
// The model is split across two databases:
//
//   - mmff_library: library_releases, library_release_actions,
//     library_release_log (canonical release content, owned by MMFF).
//   - mmff_vector:  library_acknowledgements (per-subscription state,
//     keyed by release_id which is an app-enforced FK).
//
// The handler in internal/libraryreleases stitches the two together:
// list releases that are still outstanding for the caller's
// subscription, and write an ack row when the gadmin clicks an action.

// ErrReleaseNotFound is returned when a release_id doesn't exist or has
// been archived. Callers map this to 404; the row may be a stale link
// from an old notification.
var ErrReleaseNotFound = errors.New("librarydb: release not found")

// ErrInvalidAction is returned when AckRelease is called with an
// action_taken value outside the canonical CHECK set. Maps to 400.
var ErrInvalidAction = errors.New("librarydb: invalid action_taken")

// Severity vocabulary — keep in sync with the CHECK constraint in
// 006_release_channel.sql and the UI severity renderer in
// app/components/AppHeader.tsx (badge colour) + the releases page.
const (
	SeverityInfo     = "info"
	SeverityAction   = "action"
	SeverityBreaking = "breaking"
)

// Action vocabulary — kept in sync with the CHECK constraints in both
// library_release_actions (mmff_library) and library_acknowledgements
// (mmff_vector). Acks may use any of these values; "dismissed" is the
// universal "I've seen this, move on" outcome.
const (
	ActionUpgradeModel       = "upgrade_model"
	ActionReviewTerminology  = "review_terminology"
	ActionEnableFlag         = "enable_flag"
	ActionDismissed          = "dismissed"
)

// validActions is the wire-side guard for AckRelease. Mirrors the SQL
// CHECK; we reject early so the handler returns 400 instead of letting
// Postgres raise a constraint violation that bubbles up as 500.
var validActions = map[string]struct{}{
	ActionUpgradeModel:      {},
	ActionReviewTerminology: {},
	ActionEnableFlag:        {},
	ActionDismissed:         {},
}

// Release mirrors a row in mmff_library.library_releases. Audience
// fields are nullable arrays meaning "all" — empty/nil here means the
// release targets every tier / every subscription.
type Release struct {
	ID                       uuid.UUID
	LibraryVersion           string
	Title                    string
	SummaryMD                string
	BodyMD                   *string
	Severity                 string // info | action | breaking
	AudienceTier             []string
	AudienceSubscriptionIDs  []uuid.UUID
	AffectsModelFamilyID     *uuid.UUID
	ReleasedAt               time.Time
	ExpiresAt                *time.Time
	ArchivedAt               *time.Time
	CreatedAt                time.Time
	UpdatedAt                time.Time
	Actions                  []ReleaseAction
}

// ReleaseAction mirrors a row in mmff_library.library_release_actions.
type ReleaseAction struct {
	ID         uuid.UUID
	ReleaseID  uuid.UUID
	ActionKey  string
	Label      string
	Payload    []byte // raw jsonb
	SortOrder  int32
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Acknowledgement mirrors a row in mmff_vector.library_acknowledgements.
type Acknowledgement struct {
	SubscriptionID         uuid.UUID
	ReleaseID              uuid.UUID
	AcknowledgedAt         time.Time
	AcknowledgedByUserID   uuid.UUID
	ActionTaken            string
}

// IsValidAction reports whether the given action_taken value is one
// the CHECK constraint will accept. Used by handler validation.
func IsValidAction(s string) bool {
	_, ok := validActions[s]
	return ok
}

// ListReleasesSinceAck returns every active release visible to the
// given subscription that has NOT yet been acknowledged.
//
// Visibility rules (plan §12.5):
//   - archived_at IS NULL
//   - expires_at IS NULL OR expires_at > NOW()
//   - audience_tier IS NULL OR <subscription's tier> = ANY(audience_tier)
//   - audience_subscription_ids IS NULL OR <sub id> = ANY(audience_subscription_ids)
//   - no row in library_acknowledgements for (subscription_id, release_id)
//
// The two databases are queried in two passes (no cross-DB joins
// available): first pull every still-active release from mmff_library
// matching the audience filter, then strip out IDs already ack'd in
// mmff_vector. Cheap because the active-release set is tiny (operator
// authored, low volume per plan §12.7).
//
// libRO is the librarydb.Pools.RO pool; vectorPool is the main
// app pool (mmff_vector); subscriptionTier is the caller's
// subscriptions.tier value, fetched once at the API boundary.
func ListReleasesSinceAck(
	ctx context.Context,
	libRO *pgxpool.Pool,
	vectorPool *pgxpool.Pool,
	subscriptionID uuid.UUID,
	subscriptionTier string,
) ([]Release, error) {
	// Pass 1: candidate active releases targeting this subscription.
	releases, err := loadActiveReleases(ctx, libRO, subscriptionID, subscriptionTier)
	if err != nil {
		return nil, err
	}
	if len(releases) == 0 {
		return releases, nil
	}

	// Pass 2: which of those have already been acknowledged?
	releaseIDs := make([]uuid.UUID, 0, len(releases))
	for _, r := range releases {
		releaseIDs = append(releaseIDs, r.ID)
	}
	ackedSet, err := loadAckedSet(ctx, vectorPool, subscriptionID, releaseIDs)
	if err != nil {
		return nil, err
	}

	// Filter and load actions for the remainders. Loading actions
	// per-release would be N+1; do one IN-list query and slot them in.
	outstanding := make([]Release, 0, len(releases))
	outstandingIDs := make([]uuid.UUID, 0, len(releases))
	for _, r := range releases {
		if _, acked := ackedSet[r.ID]; acked {
			continue
		}
		outstanding = append(outstanding, r)
		outstandingIDs = append(outstandingIDs, r.ID)
	}
	if len(outstanding) == 0 {
		return outstanding, nil
	}

	actionsByRelease, err := loadActionsForReleases(ctx, libRO, outstandingIDs)
	if err != nil {
		return nil, err
	}
	for i := range outstanding {
		outstanding[i].Actions = actionsByRelease[outstanding[i].ID]
	}
	return outstanding, nil
}

const releaseCols = `id, library_version, title, summary_md, body_md, severity,
	audience_tier, audience_subscription_ids, affects_model_family_id,
	released_at, expires_at, archived_at, created_at, updated_at`

func loadActiveReleases(
	ctx context.Context,
	pool *pgxpool.Pool,
	subscriptionID uuid.UUID,
	subscriptionTier string,
) ([]Release, error) {
	rows, err := pool.Query(ctx, `
		SELECT `+releaseCols+`
		FROM library_releases
		WHERE archived_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		  AND (audience_tier IS NULL OR $1 = ANY(audience_tier))
		  AND (audience_subscription_ids IS NULL OR $2 = ANY(audience_subscription_ids))
		ORDER BY released_at DESC, id`,
		subscriptionTier, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query active releases: %w", err)
	}
	defer rows.Close()

	var out []Release
	for rows.Next() {
		var r Release
		if err := rows.Scan(
			&r.ID, &r.LibraryVersion, &r.Title, &r.SummaryMD, &r.BodyMD, &r.Severity,
			&r.AudienceTier, &r.AudienceSubscriptionIDs, &r.AffectsModelFamilyID,
			&r.ReleasedAt, &r.ExpiresAt, &r.ArchivedAt, &r.CreatedAt, &r.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan release: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func loadActionsForReleases(
	ctx context.Context,
	pool *pgxpool.Pool,
	releaseIDs []uuid.UUID,
) (map[uuid.UUID][]ReleaseAction, error) {
	out := make(map[uuid.UUID][]ReleaseAction, len(releaseIDs))
	if len(releaseIDs) == 0 {
		return out, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT id, release_id, action_key, label, payload, sort_order, created_at, updated_at
		FROM library_release_actions
		WHERE release_id = ANY($1)
		ORDER BY release_id, sort_order, action_key`, releaseIDs)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query release actions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var a ReleaseAction
		if err := rows.Scan(
			&a.ID, &a.ReleaseID, &a.ActionKey, &a.Label, &a.Payload, &a.SortOrder,
			&a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("librarydb: scan release action: %w", err)
		}
		out[a.ReleaseID] = append(out[a.ReleaseID], a)
	}
	return out, rows.Err()
}

func loadAckedSet(
	ctx context.Context,
	vectorPool *pgxpool.Pool,
	subscriptionID uuid.UUID,
	releaseIDs []uuid.UUID,
) (map[uuid.UUID]struct{}, error) {
	out := make(map[uuid.UUID]struct{}, len(releaseIDs))
	if len(releaseIDs) == 0 {
		return out, nil
	}
	rows, err := vectorPool.Query(ctx, `
		SELECT release_id
		FROM library_acknowledgements
		WHERE subscription_id = $1 AND release_id = ANY($2)`,
		subscriptionID, releaseIDs)
	if err != nil {
		return nil, fmt.Errorf("librarydb: query acks: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("librarydb: scan ack id: %w", err)
		}
		out[id] = struct{}{}
	}
	return out, rows.Err()
}

// AckRelease records an acknowledgement in mmff_vector.
//
// Idempotent: a second call with the same (subscription_id, release_id)
// is a no-op (ON CONFLICT DO NOTHING). Returns true if a row was
// inserted, false if it already existed — handler uses this to choose
// 201 vs 200.
//
// release_id is NOT validated against mmff_library here (no cross-DB
// FK). The handler validates by looking up the release in libRO before
// calling AckRelease, so a stale id from a malicious client returns
// 404 rather than landing as an orphan ack.
func AckRelease(
	ctx context.Context,
	vectorPool *pgxpool.Pool,
	subscriptionID uuid.UUID,
	releaseID uuid.UUID,
	userID uuid.UUID,
	actionTaken string,
) (bool, error) {
	if !IsValidAction(actionTaken) {
		return false, ErrInvalidAction
	}
	tag, err := vectorPool.Exec(ctx, `
		INSERT INTO library_acknowledgements (
		    subscription_id, release_id, acknowledged_by_user_id, action_taken
		) VALUES ($1, $2, $3, $4)
		ON CONFLICT (subscription_id, release_id) DO NOTHING`,
		subscriptionID, releaseID, userID, actionTaken)
	if err != nil {
		return false, fmt.Errorf("librarydb: insert ack: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// FindRelease loads a single release by id, including its actions.
// Used by the handler to validate the release_id before writing an ack
// (so 404 is returned for unknown ids instead of inserting orphan rows).
//
// Returns ErrReleaseNotFound for missing or archived rows.
func FindRelease(ctx context.Context, libRO *pgxpool.Pool, releaseID uuid.UUID) (*Release, error) {
	row := libRO.QueryRow(ctx, `
		SELECT `+releaseCols+`
		FROM library_releases
		WHERE id = $1 AND archived_at IS NULL`, releaseID)
	var r Release
	err := row.Scan(
		&r.ID, &r.LibraryVersion, &r.Title, &r.SummaryMD, &r.BodyMD, &r.Severity,
		&r.AudienceTier, &r.AudienceSubscriptionIDs, &r.AffectsModelFamilyID,
		&r.ReleasedAt, &r.ExpiresAt, &r.ArchivedAt, &r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrReleaseNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("librarydb: load release: %w", err)
	}
	actions, err := loadActionsForReleases(ctx, libRO, []uuid.UUID{r.ID})
	if err != nil {
		return nil, err
	}
	r.Actions = actions[r.ID]
	return &r, nil
}

// CountOutstandingForSubscription returns how many active, in-audience
// releases the caller has NOT yet acknowledged, and whether any of those
// outstanding releases have severity=breaking. Used by the reconciler to
// populate the badge count and blocking-gate flag.
func CountOutstandingForSubscription(
	ctx context.Context,
	libRO *pgxpool.Pool,
	vectorPool *pgxpool.Pool,
	subscriptionID uuid.UUID,
	subscriptionTier string,
) (count int, hasBlocking bool, err error) {
	releases, err := loadActiveReleases(ctx, libRO, subscriptionID, subscriptionTier)
	if err != nil {
		return 0, false, err
	}
	if len(releases) == 0 {
		return 0, false, nil
	}
	releaseIDs := make([]uuid.UUID, 0, len(releases))
	for _, r := range releases {
		releaseIDs = append(releaseIDs, r.ID)
	}
	acked, err := loadAckedSet(ctx, vectorPool, subscriptionID, releaseIDs)
	if err != nil {
		return 0, false, err
	}
	for _, r := range releases {
		if _, ok := acked[r.ID]; ok {
			continue
		}
		count++
		if r.Severity == SeverityBreaking {
			hasBlocking = true
		}
	}
	return count, hasBlocking, nil
}
