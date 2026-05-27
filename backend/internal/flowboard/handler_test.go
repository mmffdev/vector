package flowboard

import (
	"testing"
)

// TestNewHandler_NotNil verifies that NewHandler returns a non-nil Handler
// when wired to a service constructed with a nil pool (smoke test — no DB
// required, mirrors the zero-wiring pattern in topology/service_test.go).
func TestNewHandler_NotNil(t *testing.T) {
	h := NewHandler(NewService(nil))
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
}
