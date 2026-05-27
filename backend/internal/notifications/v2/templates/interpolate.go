// Package templates provides DB-backed notification template lookup and
// interpolation for the Notifications v2 pipeline.
//
// Template bodies + subjects use {{ data.X }} placeholders that are resolved
// at render time from the event's hydrated data map. See Interpolate for the
// full substitution rules.
package templates

import (
	"fmt"
	"regexp"
	"strings"
)

// placeholderRe matches {{ data.X }} and {{ data.nested.Y }} placeholders.
// The pattern is linear-safe (no backtracking catastrophe): it matches
// two opening braces, optional whitespace, a dot-separated alphanumeric
// path, optional whitespace, two closing braces.
//
// Spec: `\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`
var placeholderRe = regexp.MustCompile(`\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`)

// Interpolate substitutes {{ data.X }} (and {{ data.nested.Y }}) placeholders
// in tmpl with values resolved from data.
//
// Rules:
//   - Path is dot-separated. "data.actor.name" resolves by stripping the
//     leading "data." segment and walking nested map[string]any values.
//   - Missing fields render as empty string — the literal {{ ... }} is removed,
//     never left in the output.
//   - Values are formatted with fmt.Sprintf("%v", val). Boolean → "true"/"false",
//     numeric → decimal representation, slice/map → Go default %v.
//   - Whitespace inside braces is tolerated: {{ data.x }} == {{data.x}}.
func Interpolate(tmpl string, data map[string]any) string {
	if tmpl == "" || !strings.Contains(tmpl, "{{") {
		return tmpl
	}
	return placeholderRe.ReplaceAllStringFunc(tmpl, func(match string) string {
		// Extract the path from the capture group.
		sub := placeholderRe.FindStringSubmatch(match)
		if len(sub) < 2 {
			return ""
		}
		path := sub[1]
		val, ok := resolvePath(path, data)
		if !ok {
			return ""
		}
		return fmt.Sprintf("%v", val)
	})
}

// resolvePath walks path (dot-separated) into data.
// The leading "data." segment is optional and stripped automatically so that
// both "data.actor.name" and "actor.name" resolve from the same root.
func resolvePath(path string, data map[string]any) (any, bool) {
	segments := strings.Split(path, ".")

	// Strip leading "data" segment if present, so the template author can
	// write {{ data.actor.name }} and the engine resolves from data["actor"]["name"].
	if len(segments) > 0 && segments[0] == "data" {
		segments = segments[1:]
	}

	if len(segments) == 0 {
		return nil, false
	}

	var cur any = data
	for _, seg := range segments {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		cur, ok = m[seg]
		if !ok {
			return nil, false
		}
	}
	return cur, true
}
