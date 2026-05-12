// Package topology is the Go mirror of app/lib/shared/topology/walker.ts.
//
// PLA-0044: single unified flatten of a parent_id-linked node forest with
// visibility, collapse, orphan-drop, cycle-guard, and sibling-spine
// encoding. Cross-runtime parity is enforced by golden fixtures at
// dev/fixtures/shared/topology — see walker_test.go which loads the
// same JSON files Vitest does and asserts byte-identical row projections.
//
// Catalogued in docs/c_shared_methods.md.
package topology

import "sort"

// Node is the minimum required shape. Callers wrap their domain type
// (e.g. orgdesign.Node, orgdesign.MyGrant) in an IDOf/ParentOf accessor
// pair so the walker can stay free of generics-on-fields.
type Node interface {
	GetID() string
	GetParentID() *string
}

// FlattenedRow mirrors app/lib/shared/topology/walker.ts FlattenedRow.
// ID is denormalised onto the row to make JSON-fixture comparison
// trivial across runtimes — callers can still reach the underlying
// Node via the typed walker wrappers below.
type FlattenedRow struct {
	ID                   string `json:"id"`
	Depth                int    `json:"depth"`
	HasChildren          bool   `json:"hasChildren"`
	Collapsed            bool   `json:"collapsed"`
	IsFirst              bool   `json:"isFirst"`
	IsLast               bool   `json:"isLast"`
	HasVisibleChildren   bool   `json:"hasVisibleChildren"`
	AncestorMoreChildren []bool `json:"ancestorMoreChildren"`
}

// Edge is an abstract parent→child pair. Coordinates are attached
// downstream by dagre / d3-zoom in the frontend.
type Edge struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

// Opts mirrors WalkOpts in TS.
//
// Collapsed: ids that emit their own row but suppress their subtree.
// Less: sibling sort comparator (sort.Slice convention — true means a
// comes before b). Filter: pre-walk predicate; returning false drops
// the node and its subtree. MaxDepth: cycle guard, default 12.
type Opts[T Node] struct {
	Collapsed map[string]struct{}
	Less      func(a, b T) bool
	Filter    func(n T) bool
	MaxDepth  int
}

// Result mirrors WalkResult in TS, minus ChildrenOf — callers that need
// it can construct it from the same sorted buckets via BuildChildrenOf.
type Result[T Node] struct {
	Rows         []FlattenedRow
	VisibleIDs   map[string]struct{}
	VisibleEdges []Edge
	ChildrenOf   map[string][]T // empty string key = roots (mirrors TS null)
}

const defaultMaxDepth = 12

// Walk traverses nodes and emits the same shape as the TS walker. See
// the package comment for parity guarantees.
func Walk[T Node](nodes []T, opts Opts[T]) Result[T] {
	maxDepth := opts.MaxDepth
	if maxDepth == 0 {
		maxDepth = defaultMaxDepth
	}

	// Pass 1: filter + index by id.
	byID := make(map[string]T, len(nodes))
	for _, n := range nodes {
		if opts.Filter != nil && !opts.Filter(n) {
			continue
		}
		byID[n.GetID()] = n
	}

	// Pass 2: bucket children. Orphan policy = drop (matches TS).
	childrenOf := make(map[string][]T)
	for _, n := range byID {
		pid := n.GetParentID()
		var key string
		if pid == nil {
			key = "" // root sentinel — matches TS null
		} else if _, ok := byID[*pid]; ok {
			key = *pid
		} else {
			continue // orphan — drop
		}
		childrenOf[key] = append(childrenOf[key], n)
	}
	for k, bucket := range childrenOf {
		b := bucket
		sort.SliceStable(b, func(i, j int) bool { return opts.Less(b[i], b[j]) })
		childrenOf[k] = b
	}

	// Pass 3: depth-first emission.
	rows := make([]FlattenedRow, 0, len(byID))
	visibleIDs := make(map[string]struct{}, len(byID))
	visibleEdges := make([]Edge, 0)

	var walk func(parentID string, depth int, pathMoreChildren []bool)
	walk = func(parentID string, depth int, pathMoreChildren []bool) {
		if depth > maxDepth {
			return
		}
		kids := childrenOf[parentID]
		for idx, node := range kids {
			id := node.GetID()
			childKids := childrenOf[id]
			hasChildren := len(childKids) > 0
			_, isCollapsed := opts.Collapsed[id]
			isFirst := idx == 0
			isLast := idx == len(kids)-1
			hasVisibleChildren := hasChildren && !isCollapsed
			visibleIDs[id] = struct{}{}
			if parentID != "" {
				visibleEdges = append(visibleEdges, Edge{Source: parentID, Target: id})
			}
			// Snapshot the path slice into a fresh backing array so
			// later appends in sibling subtrees don't mutate this
			// row's value. JSON-encoded as a stable []bool.
			amc := make([]bool, len(pathMoreChildren))
			copy(amc, pathMoreChildren)
			rows = append(rows, FlattenedRow{
				ID:                   id,
				Depth:                depth,
				HasChildren:          hasChildren,
				Collapsed:            isCollapsed,
				IsFirst:              isFirst,
				IsLast:               isLast,
				HasVisibleChildren:   hasVisibleChildren,
				AncestorMoreChildren: amc,
			})
			if hasVisibleChildren {
				childPath := append(amc[:len(amc):len(amc)], !isLast)
				walk(id, depth+1, childPath)
			}
		}
	}
	walk("", 0, []bool{})

	return Result[T]{
		Rows:         rows,
		VisibleIDs:   visibleIDs,
		VisibleEdges: visibleEdges,
		ChildrenOf:   childrenOf,
	}
}
