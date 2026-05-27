package flowboard

import (
	"testing"
)

// TestNewService_NotNil verifies that NewService returns a non-nil Service
// when called with a nil pool (smoke test — no DB required, mirrors the
// zero-wiring pattern in topology/service_test.go).
func TestNewService_NotNil(t *testing.T) {
	svc := NewService(nil)
	if svc == nil {
		t.Fatal("NewService returned nil")
	}
}
