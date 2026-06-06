package devreports

import "testing"

func TestIsValidType_Architecture(t *testing.T) {
	if !isValidType("architecture") {
		t.Fatalf("expected \"architecture\" to be a valid report type")
	}
}

func TestIsValidType_Unknown(t *testing.T) {
	if isValidType("not-a-type") {
		t.Fatalf("expected \"not-a-type\" to be invalid")
	}
}
