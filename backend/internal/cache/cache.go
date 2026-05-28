// Package cache wraps the Valkey client used across the backend for
// per-tenant read-side caches. First consumer: sentinel resolver's
// ResolveSubtree (the recursive topology-CTE answer is stable until a
// topology_nodes write fires an invalidation).
//
// Design contract (set 2026-05-28 with the user):
//
//   - Single backend Valkey client (no per-package clients) — this
//     wrapper is the only point of contact.
//   - All cached values get a 1-hour safety TTL even when an explicit
//     invalidation hook exists. The TTL is the orphan-eviction backstop:
//     if a future code path writes data without publishing the
//     corresponding DEL, the stale value evicts itself within the hour.
//   - Failure mode is fall-back-to-source: if Valkey is unavailable
//     (network error, AUTH failed, circuit open), every cache op
//     returns ErrCacheUnavailable and the caller MUST execute the
//     uncached path. Service stays up; perf reverts.
//   - On cache miss OR Valkey error, the caller fires the source-of-
//     truth query and tries to write-through. Write failures are
//     swallowed (logged) — the read result is what matters.
//
// Reuse target: notifications-v2 PendingStore (S12 of PLA067) and any
// future read-side cache. The Get/Set/Del/Publish surface here is the
// minimum subset all three known consumers will need; we'll grow it
// as new consumers land, not before.
package cache

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/valkey-io/valkey-go"
)

// DefaultSafetyTTL is the orphan-eviction TTL applied to every Set call
// unless the caller passes an explicit TTL. 1 hour matches the design
// decision: invalidation is primary, TTL is the backstop for missed
// invalidation hooks.
const DefaultSafetyTTL = 1 * time.Hour

// ErrCacheUnavailable signals that the cache layer is in fall-back
// mode (Valkey unreachable, circuit open, or AUTH failed at startup).
// Callers handle it by running the uncached query path.
var ErrCacheUnavailable = errors.New("cache: unavailable")

// ErrMiss is returned by Get when the key exists in the cache but the
// value is absent (cache miss). Distinct from ErrCacheUnavailable so
// callers can distinguish "cache works, no entry" from "cache broken,
// fall back to SQL."
var ErrMiss = errors.New("cache: miss")

// Config is the runtime configuration read from env in main.go.
type Config struct {
	// Addr is host:port (e.g. "localhost:6379"). Required.
	Addr string
	// Password is the Valkey AUTH password. Empty means no AUTH.
	Password string
	// ConnectTimeout caps the initial connection + AUTH handshake.
	// 2 seconds is generous for a local Unix socket; tune up if the
	// runtime ever moves cross-VPC.
	ConnectTimeout time.Duration
}

// Client is the cache surface. Construct via New(); the zero value is
// not usable. All methods are safe for concurrent use.
//
// When client == nil OR the circuit breaker is open, every method
// returns ErrCacheUnavailable. Callers MUST handle this — see the
// `sentinel.PoolResolver.ResolveSubtree` caching path for the canonical
// "miss / unavailable both fall through to SQL" shape.
type Client struct {
	v valkey.Client
	// available is the circuit-breaker state. 0 = open (Valkey
	// unreachable, all ops short-circuit to ErrCacheUnavailable);
	// 1 = closed (normal operation). Toggled by the background
	// health probe. atomic for lockless read on every op.
	available atomic.Int32
}

// New constructs a Client and verifies connectivity by issuing a PING.
// On PING failure, returns the client AND the connection error — the
// caller decides whether to fail startup or proceed with a degraded
// client (every op will return ErrCacheUnavailable until the health
// probe sees Valkey recover).
//
// Default behaviour in main.go: log the error, hand the returned client
// to consumers anyway. They fall back to source-of-truth queries.
func New(ctx context.Context, cfg Config) (*Client, error) {
	if cfg.ConnectTimeout == 0 {
		cfg.ConnectTimeout = 2 * time.Second
	}

	v, err := valkey.NewClient(valkey.ClientOption{
		InitAddress: []string{cfg.Addr},
		Password:    cfg.Password,
		// Pool sizing — the Go backend serves a handful of
		// concurrent requests in dev; 8 connections is comfortable.
		// Tune up if benchmarks show contention.
		BlockingPoolSize: 8,
	})
	if err != nil {
		// Construction failed (bad address, etc.) — return a nil
		// client so callers must explicitly check, AND the error so
		// main.go can log it.
		return nil, fmt.Errorf("cache.New: construct client: %w", err)
	}

	c := &Client{v: v}

	// Verify with PING. The ConnectTimeout context guards the
	// blocking handshake — without it, a misconfigured Valkey AUTH
	// password hangs startup.
	pingCtx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancel()
	if err := c.ping(pingCtx); err != nil {
		// Don't close the client — the background probe will retry.
		// Return both client and error so the caller decides.
		return c, fmt.Errorf("cache.New: ping: %w", err)
	}
	c.available.Store(1)
	return c, nil
}

// ping does a PING-PONG. Used by New() at startup and by the health
// probe goroutine to flip the circuit breaker on recovery.
func (c *Client) ping(ctx context.Context) error {
	resp := c.v.Do(ctx, c.v.B().Ping().Build())
	if err := resp.Error(); err != nil {
		return err
	}
	s, err := resp.ToString()
	if err != nil {
		return err
	}
	if s != "PONG" {
		return fmt.Errorf("cache: unexpected PING reply: %q", s)
	}
	return nil
}

// IsAvailable reports whether the circuit breaker is closed. Cheap;
// safe to call per-request. Returns false on a nil receiver so callers
// that hold a possibly-nil *Client can guard with `if c.IsAvailable()`
// without crashing.
func (c *Client) IsAvailable() bool {
	if c == nil {
		return false
	}
	return c.available.Load() == 1
}

// Health is the human-readable status used by the /admin/dev/cache-health
// endpoint. Returns "available" or "unavailable: <reason>".
func (c *Client) Health(ctx context.Context) string {
	if c == nil {
		return "unavailable: no client"
	}
	if err := c.ping(ctx); err != nil {
		c.available.Store(0)
		return fmt.Sprintf("unavailable: %v", err)
	}
	c.available.Store(1)
	return "available"
}

// Get reads a key. Returns ErrMiss when the key doesn't exist,
// ErrCacheUnavailable when Valkey is down. The value is the raw bytes
// stored by Set — callers handle serialisation.
func (c *Client) Get(ctx context.Context, key string) ([]byte, error) {
	if c == nil || c.available.Load() == 0 {
		return nil, ErrCacheUnavailable
	}
	resp := c.v.Do(ctx, c.v.B().Get().Key(key).Build())
	if err := resp.Error(); err != nil {
		if valkey.IsValkeyNil(err) {
			return nil, ErrMiss
		}
		// Real I/O error — trip the breaker. The next op short-circuits
		// without hitting the wire; the health probe (when wired)
		// re-closes the breaker on recovery.
		c.available.Store(0)
		log.Printf("cache.Get key=%s: %v (breaker opened)", key, err)
		return nil, ErrCacheUnavailable
	}
	b, err := resp.AsBytes()
	if err != nil {
		return nil, fmt.Errorf("cache.Get key=%s: decode: %w", key, err)
	}
	return b, nil
}

// Set writes a key with the DefaultSafetyTTL. Returns ErrCacheUnavailable
// on Valkey error. Write failures should be LOGGED by the caller but
// NOT propagated — a failed write-through means the next read is a miss,
// which is the correct safe behaviour.
//
// The 1-hour safety TTL is non-negotiable — it's the orphan-eviction
// backstop. Use SetWithTTL only when a caller has a documented reason
// to deviate (e.g. notifications PendingStore's debounce ZSETs which
// have natural lifetime semantics).
func (c *Client) Set(ctx context.Context, key string, value []byte) error {
	return c.SetWithTTL(ctx, key, value, DefaultSafetyTTL)
}

// SetWithTTL is Set with a caller-specified TTL. Pass DefaultSafetyTTL
// or longer for the "invalidation-primary, TTL-backstop" pattern. Pass
// a shorter TTL for caches with natural expiry (e.g. rate-limit windows).
func (c *Client) SetWithTTL(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if c == nil || c.available.Load() == 0 {
		return ErrCacheUnavailable
	}
	if ttl <= 0 {
		return fmt.Errorf("cache.Set key=%s: TTL must be positive (got %v)", key, ttl)
	}
	resp := c.v.Do(ctx,
		c.v.B().Set().Key(key).Value(string(value)).Ex(ttl).Build())
	if err := resp.Error(); err != nil {
		c.available.Store(0)
		log.Printf("cache.Set key=%s: %v (breaker opened)", key, err)
		return ErrCacheUnavailable
	}
	return nil
}

// Del removes one or more keys. Used by invalidation hooks (e.g.
// topology writes that invalidate sentinel subtree caches). Missing
// keys are not an error — Valkey's DEL silently returns 0 for them.
//
// Bulk-DEL because most invalidation surfaces have multiple shapes
// (scope_up=true/false × scope_down=true/false × focus_id combinations)
// and the caller knows the exact set to evict.
func (c *Client) Del(ctx context.Context, keys ...string) error {
	if c == nil || c.available.Load() == 0 {
		return ErrCacheUnavailable
	}
	if len(keys) == 0 {
		return nil
	}
	resp := c.v.Do(ctx, c.v.B().Del().Key(keys...).Build())
	if err := resp.Error(); err != nil {
		c.available.Store(0)
		log.Printf("cache.Del keys=%v: %v (breaker opened)", keys, err)
		return ErrCacheUnavailable
	}
	return nil
}

// DelPattern removes every key matching the glob pattern. Used by
// invalidation hooks that don't know the exact key set (e.g. "invalidate
// every cached subtree for tenant X"). Implemented via SCAN + DEL in
// batches because Valkey's KEYS command is forbidden in production
// (blocks the event loop on large keyspaces).
//
// Pattern syntax: standard Valkey glob — `*`, `?`, `[abc]`, `[a-z]`.
// Example: `sentinel:subtree:${tenant}:*`
//
// Returns the count of keys deleted. The operation is best-effort:
// on any error mid-scan, returns what was deleted so far + the error.
func (c *Client) DelPattern(ctx context.Context, pattern string) (int, error) {
	if c == nil || c.available.Load() == 0 {
		return 0, ErrCacheUnavailable
	}
	var cursor uint64
	total := 0
	for {
		resp := c.v.Do(ctx,
			c.v.B().Scan().Cursor(cursor).Match(pattern).Count(100).Build())
		if err := resp.Error(); err != nil {
			c.available.Store(0)
			log.Printf("cache.DelPattern pattern=%s: scan: %v (breaker opened)", pattern, err)
			return total, ErrCacheUnavailable
		}
		entry, err := resp.AsScanEntry()
		if err != nil {
			return total, fmt.Errorf("cache.DelPattern pattern=%s: decode scan: %w", pattern, err)
		}
		if len(entry.Elements) > 0 {
			delResp := c.v.Do(ctx, c.v.B().Del().Key(entry.Elements...).Build())
			if err := delResp.Error(); err != nil {
				c.available.Store(0)
				log.Printf("cache.DelPattern pattern=%s: del: %v (breaker opened)", pattern, err)
				return total, ErrCacheUnavailable
			}
			n, _ := delResp.AsInt64()
			total += int(n)
		}
		cursor = entry.Cursor
		if cursor == 0 {
			break
		}
	}
	return total, nil
}

// Close shuts down the underlying client. Idempotent.
func (c *Client) Close() {
	if c == nil || c.v == nil {
		return
	}
	c.v.Close()
}
