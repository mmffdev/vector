package panehelp

import "regexp"

// Targeted sanitisation for pane_help.body_html.
//
// Inputs come from gadmin only (PUT is gated by RequireRole(RoleGAdmin)),
// so this is defence-in-depth, not the primary security control. The two
// constructs explicitly required to be stripped by story 00241 are:
//
//   1. <script> ... </script> blocks (any casing, with or without attrs).
//   2. on*= event-handler attributes inside any tag (onclick, onload, ...).
//
// Tech debt (S2): when this surface starts accepting input from less
// trusted roles, swap this for a vetted allowlist sanitiser
// (e.g. github.com/microcosm-cc/bluemonday with the UGCPolicy()).
// Trigger: any non-gadmin role gains write access to pane_help.

var (
	// Strip the entire <script>...</script> element including content.
	// Matches malformed cases too (no closing tag) by anchoring at <script
	// and consuming up to the next </script> or end-of-string.
	scriptRE = regexp.MustCompile(`(?is)<script\b[^>]*>.*?(</script\s*>|$)`)

	// Strip on*= attributes (onclick=, onload=, onmouseover=, ...).
	// Handles single-quoted, double-quoted, or unquoted values.
	onEventRE = regexp.MustCompile(`(?i)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`)
)

// Sanitize strips <script> blocks and on*= handler attributes.
// Returns input as-is when no matches are found.
func Sanitize(in string) string {
	out := scriptRE.ReplaceAllString(in, "")
	out = onEventRE.ReplaceAllString(out, "")
	return out
}
