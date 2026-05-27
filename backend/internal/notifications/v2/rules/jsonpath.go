package rules

import "strings"

// resolvePath traverses data using a dot-separated path and returns the
// value at that path, plus a boolean indicating whether the path existed.
//
// Supports only map[string]any nodes; array indexing is not supported.
// An empty path returns (nil, false).
//
// Examples:
//
//	data = {"actor": {"role": "gadmin"}}
//	resolvePath(data, "actor.role")  → ("gadmin", true)
//	resolvePath(data, "actor.email") → (nil, false)
//	resolvePath(data, "missing")     → (nil, false)
func resolvePath(data map[string]any, path string) (any, bool) {
	if path == "" || data == nil {
		return nil, false
	}

	// Split once on the first dot.
	dot := strings.IndexByte(path, '.')
	if dot < 0 {
		// Leaf segment.
		v, ok := data[path]
		return v, ok
	}

	head := path[:dot]
	tail := path[dot+1:]

	child, ok := data[head]
	if !ok {
		return nil, false
	}

	childMap, ok := child.(map[string]any)
	if !ok {
		// Node exists but is not a map — cannot descend further.
		return nil, false
	}

	return resolvePath(childMap, tail)
}
