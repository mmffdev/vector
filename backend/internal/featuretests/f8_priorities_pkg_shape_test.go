// F8 — artefactpriorities package shape. Promoted to the default test
// set once story 00596 created the artefactpriorities Go package.
//
// History: this file was gated behind the `f8_priorities_pkg` build
// tag while the package did not exist (importing it was a compile
// error that would have blocked every test in the featuretests
// package). Tag removed now that the package ships.
//
// Tracker group: `frontend-priority-customisation`, feature `F8`.

package featuretests_test

import (
	"testing"

	"github.com/mmffdev/vector-backend/internal/artefactpriorities"
)

// TestF8_PriorityPackage_Exists asserts the new Go package + its
// minimal public surface land in story 00596.
func TestF8_PriorityPackage_Exists(t *testing.T) {
	// Symbol references — compile checks the surface exists.
	svc := artefactpriorities.NewService(nil)
	if svc == nil {
		t.Errorf("artefactpriorities.NewService returned nil")
	}
	h := artefactpriorities.NewHandler(svc)
	if h == nil {
		t.Errorf("artefactpriorities.NewHandler returned nil")
	}
}
