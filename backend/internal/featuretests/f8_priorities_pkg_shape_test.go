//go:build f8_priorities_pkg
// +build f8_priorities_pkg

// F8 — artefactpriorities package shape (compile-time). Gated behind
// `f8_priorities_pkg` build tag.
//
// Story 00596 creates a new Go package
// `backend/internal/artefactpriorities/` with NewService + NewHandler
// + the Priority DTO. Until that package exists, the imports below
// are compile errors that would block every other test in the
// featuretests package.
//
// Tag OFF on main: this file is excluded; the rest of the suite builds
// and runs. Implementer of story 00596 removes the tag once the
// package lands.
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
