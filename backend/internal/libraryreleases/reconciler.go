package libraryreleases

import (
	"context"
	"log"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// Reconciler maintains a per-subscription cache of outstanding-release
// counts. The badge endpoint reads from the cache; the reconciler
// refreshes it on a ticker (default 15m), on user login, and on demand
// when the cache misses or is stale.
//
// Why not query Postgres on every page load? Plan §12.7 sets a budget:
// the badge poll runs every 5 minutes per gadmin tab, and the cross-DB
// fan-out (release scan + ack scan) is cheap but not free. A 15m
// reconciler floor + on-login warm-up keeps the worst case bounded.
//
// Why in-process and not a separate worker binary? Phase 3 has zero
// other workers. Standing up systemd + a second binary for one ticker
// is over-engineering. When the worker pool grows (TD-LIB-003 cleanup
// jobs are next), this reconciler should move to that pool.
type Reconciler struct {
	libRO      *pgxpool.Pool
	vectorPool *pgxpool.Pool
	interval   time.Duration

	mu    sync.RWMutex
	cache map[uuid.UUID]cachedCount

	stop chan struct{}
}

type cachedCount struct {
	count       int
	tier        string
	refreshedAt time.Time
}

// cacheTTL is the freshness window before a cached count is treated as
// stale on read (badge handler will trigger an inline refresh).
const cacheTTL = 5 * time.Minute

// NewReconciler builds a reconciler. Read interval from
// LIBRARY_RECONCILER_INTERVAL (Go duration string, e.g. "15m"); default
// 15 minutes per plan §12.7.
func NewReconciler(libRO, vectorPool *pgxpool.Pool) *Reconciler {
	interval := 15 * time.Minute
	if v := os.Getenv("LIBRARY_RECONCILER_INTERVAL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			interval = d
		}
	}
	return &Reconciler{
		libRO:      libRO,
		vectorPool: vectorPool,
		interval:   interval,
		cache:      map[uuid.UUID]cachedCount{},
		stop:       make(chan struct{}),
	}
}

// Start spins up the background ticker. Returns immediately. Call
// Stop() during shutdown so the goroutine drains cleanly.
func (r *Reconciler) Start(ctx context.Context) {
	go r.run(ctx)
}

// Stop signals the ticker goroutine to exit.
func (r *Reconciler) Stop() {
	close(r.stop)
}

func (r *Reconciler) run(ctx context.Context) {
	t := time.NewTicker(r.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.stop:
			return
		case <-t.C:
			r.refreshAll(ctx)
		}
	}
}

// refreshAll re-counts every subscription that already has a cached
// entry. Cold subscriptions (never queried the badge) stay cold —
// they're warmed by Touch on login or by an inline read.
//
// On error (e.g. mmff_library down) we skip silently: the badge
// handler falls back to an inline read on the next request, and a
// transient outage shouldn't poison the cache.
func (r *Reconciler) refreshAll(ctx context.Context) {
	r.mu.RLock()
	subs := make([]uuid.UUID, 0, len(r.cache))
	tiers := make(map[uuid.UUID]string, len(r.cache))
	for id, c := range r.cache {
		subs = append(subs, id)
		tiers[id] = c.tier
	}
	r.mu.RUnlock()

	for _, id := range subs {
		count, err := librarydb.CountOutstandingForSubscription(
			ctx, r.libRO, r.vectorPool, id, tiers[id],
		)
		if err != nil {
			log.Printf("libraryreleases: reconciler refresh for %s: %v", id, err)
			continue
		}
		r.mu.Lock()
		r.cache[id] = cachedCount{
			count:       count,
			tier:        tiers[id],
			refreshedAt: time.Now().UTC(),
		}
		r.mu.Unlock()
	}
}

// Touch warms or refreshes the cache for a single subscription. Called
// on login (auth.Service.Login wires this) and on the first badge poll
// from a session. Errors are logged but not surfaced — a missing badge
// count degrades to "we don't know yet, try again", not a 500.
func (r *Reconciler) Touch(ctx context.Context, subscriptionID uuid.UUID, tier string) {
	count, err := librarydb.CountOutstandingForSubscription(
		ctx, r.libRO, r.vectorPool, subscriptionID, tier,
	)
	if err != nil {
		log.Printf("libraryreleases: touch %s: %v", subscriptionID, err)
		return
	}
	r.mu.Lock()
	r.cache[subscriptionID] = cachedCount{
		count:       count,
		tier:        tier,
		refreshedAt: time.Now().UTC(),
	}
	r.mu.Unlock()
}

// Invalidate drops the cache entry for a subscription. Called by the
// ack handler so the badge re-counts on the next poll instead of
// showing the now-stale count.
func (r *Reconciler) Invalidate(subscriptionID uuid.UUID) {
	r.mu.Lock()
	delete(r.cache, subscriptionID)
	r.mu.Unlock()
}

// Count returns the cached outstanding-release count for a subscription
// and a `fresh` flag indicating whether the cache hit was within the
// TTL. The badge handler treats `!fresh` as a hint to re-touch
// asynchronously while still returning the (slightly stale) count.
func (r *Reconciler) Count(subscriptionID uuid.UUID) (int, bool) {
	r.mu.RLock()
	c, ok := r.cache[subscriptionID]
	r.mu.RUnlock()
	if !ok {
		return 0, false
	}
	fresh := time.Since(c.refreshedAt) < cacheTTL
	return c.count, fresh
}
