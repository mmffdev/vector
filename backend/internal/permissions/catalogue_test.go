package permissions

import "testing"

// TestAllNoDuplicates is a sanity check: each Code constant appears in All
// exactly once. Catches copy-paste errors in the All slice.
func TestAllNoDuplicates(t *testing.T) {
	seen := make(map[Code]int)
	for _, c := range All {
		seen[c]++
	}
	for c, n := range seen {
		if n > 1 {
			t.Errorf("duplicate code in All: %s (count=%d)", c, n)
		}
	}
}

// TestAllCodesNonEmpty guards against an accidentally-blank constant
// slipping into All — would parity-match a blank DB row instead of failing.
func TestAllCodesNonEmpty(t *testing.T) {
	for i, c := range All {
		if c == "" {
			t.Errorf("All[%d] is empty Code", i)
		}
	}
}
