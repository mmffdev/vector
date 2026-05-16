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

// TestExtendedCatalogue104Present asserts the five permission codes added
// by db/mmff_vector/schema/104_extend_permission_catalogue.sql (PLA-0007 / 00413) are
// present in the Go catalogue. If any of these go missing, VerifyParity
// would fail at server boot — but we'd rather catch it in unit tests.
func TestExtendedCatalogue104Present(t *testing.T) {
	required := []Code{
		LibraryReleasesView,
		PortfolioModelEdit,
		PortfolioSettingsView,
		PortfolioItemsView,
		WorkItemsSettingsEdit,
	}
	have := make(map[Code]bool, len(All))
	for _, c := range All {
		have[c] = true
	}
	for _, c := range required {
		if !have[c] {
			t.Errorf("migration-104 code %q missing from All", c)
		}
	}
}
