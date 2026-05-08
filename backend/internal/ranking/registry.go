// Package ranking provides a generic, cross-cutting drag-and-drop
// reordering capability for any orderable resource (work items,
// defects, portfolio levels, library items, etc.).
//
// Resources opt in by registering once at process start via Register.
// The registry is compile-time-only — there is no runtime registration
// path, by design (security: a malicious request must not be able to
// graft a new resource type onto the rank API).
//
// Adoption checklist for a new resource:
//   1. Ensure the table has a `position INTEGER NOT NULL` column and a
//      nullable scope FK (e.g. `timebox_sprint_id UUID`). See
//      vector_artefacts migration 025 for the canonical pattern.
//   2. Attach `notify_rank_changed('<resource_type>')` trigger
//      (see mmff_vector migration 069 for the helper function).
//   3. Call ranking.Register("<resource_type>", ResourceConfig{...})
//      from the package's init() or wiring file.
//   4. Implement the PermissionChecker for that resource — the rank
//      service calls CanRank(ctx, subscriptionID, rowID) before
//      every move so authz lives with the resource, not here.
package ranking

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// ResourceConfig describes one orderable resource. All fields are
// required. The registry rejects partial configs at Register time.
type ResourceConfig struct {
	// Table is the schema-qualified or unqualified Postgres table name
	// (e.g. "artefacts"). The rank service writes the position column
	// directly against this table.
	Table string

	// ScopeColumn is the column whose value defines the "scope" a
	// position is unique within. For most adopters this is "sprint_id"
	// — items scope to a sprint when assigned, and to the org backlog
	// otherwise. Resources without a sprint concept may pass an empty
	// string to mean "always backlog scope".
	ScopeColumn string

	// Permissions returns whether the caller is allowed to rank this
	// row. Called once per move attempt, BEFORE the FOR UPDATE lock.
	// Implementations should be cheap (cached lookup, simple grant
	// check); they must not perform writes.
	Permissions PermissionChecker
}

// PermissionChecker decides whether the authenticated principal in
// ctx can change the rank of the given row. Returning (false, nil)
// causes the rank service to refuse with ErrForbidden; returning a
// non-nil error bubbles up as 500.
type PermissionChecker interface {
	CanRank(ctx context.Context, subscriptionID uuid.UUID, rowID uuid.UUID) (bool, error)
}

// PermissionCheckerFunc adapts an ordinary function to the interface.
type PermissionCheckerFunc func(ctx context.Context, subscriptionID, rowID uuid.UUID) (bool, error)

func (f PermissionCheckerFunc) CanRank(ctx context.Context, subscriptionID, rowID uuid.UUID) (bool, error) {
	return f(ctx, subscriptionID, rowID)
}

var (
	mu       sync.RWMutex
	registry = map[string]ResourceConfig{}
)

// Register makes a resource type known to the rank service. It MUST
// be called before any HTTP handler that touches the rank API is
// served — typically from main() or a package init.
//
// Re-registering the same name with a different config panics. Empty
// names or partial configs are rejected.
func Register(name string, cfg ResourceConfig) {
	if name == "" {
		panic("ranking.Register: resource name must not be empty")
	}
	if cfg.Table == "" {
		panic(fmt.Sprintf("ranking.Register(%q): Table is required", name))
	}
	if cfg.Permissions == nil {
		panic(fmt.Sprintf("ranking.Register(%q): Permissions is required", name))
	}

	mu.Lock()
	defer mu.Unlock()

	if existing, ok := registry[name]; ok && existing != cfg {
		panic(fmt.Sprintf("ranking.Register(%q): already registered with a different config", name))
	}
	registry[name] = cfg
}

// Lookup returns the config for a registered resource. Unknown names
// return ErrUnknownResource — handlers should map this to 400, not
// 500: the request is naming a resource the server doesn't expose.
func Lookup(name string) (ResourceConfig, error) {
	mu.RLock()
	defer mu.RUnlock()
	cfg, ok := registry[name]
	if !ok {
		return ResourceConfig{}, fmt.Errorf("%w: %q", ErrUnknownResource, name)
	}
	return cfg, nil
}

// ResetForTests clears the registry. Test-only — never call from
// production code paths.
func ResetForTests() {
	mu.Lock()
	defer mu.Unlock()
	registry = map[string]ResourceConfig{}
}
