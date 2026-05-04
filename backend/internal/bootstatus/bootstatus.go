// Package bootstatus is a tiny in-memory registry the boot sequence
// writes to and the /api/status/pipeline endpoint reads from. It exists
// so the backend can boot in degraded mode (e.g. migrations behind on
// staging — permissions table missing) without going dark; the UI badge
// reads the same data and tells the operator exactly what's degraded.
//
// Anything that used to be a log.Fatalf at boot is now a Set("foo",
// false, msg) call followed by continued startup. Lookups are constant
// time; the registry is process-local with a single sync.RWMutex.
package bootstatus

import (
	"sync"
	"time"
)

// Component is one named subsystem the boot sequence reports on.
type Component struct {
	Name   string    `json:"name"`
	OK     bool      `json:"ok"`
	Detail string    `json:"detail,omitempty"`
	At     time.Time `json:"at"`
}

var (
	mu    sync.RWMutex
	store = map[string]Component{}
)

// Set records the current state of a named component. Idempotent: a
// later Set on the same name overwrites. Time stamps the moment Set
// was called so the UI can show "OK 14m ago / Failed 2s ago".
func Set(name string, ok bool, detail string) {
	mu.Lock()
	defer mu.Unlock()
	store[name] = Component{Name: name, OK: ok, Detail: detail, At: time.Now().UTC()}
}

// All returns a snapshot copy. Caller may mutate freely.
func All() []Component {
	mu.RLock()
	defer mu.RUnlock()
	out := make([]Component, 0, len(store))
	for _, c := range store {
		out = append(out, c)
	}
	return out
}

// Healthy is true iff every recorded component is OK. An empty registry
// is healthy by definition (nothing has reported in yet).
func Healthy() bool {
	mu.RLock()
	defer mu.RUnlock()
	for _, c := range store {
		if !c.OK {
			return false
		}
	}
	return true
}
