package vectorfields

import "testing"

// FieldEntry is the unified registry row the reader returns. This test pins
// the shape; the DB-backed read is exercised against live backfilled data via
// a read-only psql check, not an inserting integration test.
func TestFieldEntry_Shape(t *testing.T) {
	e := FieldEntry{
		FieldKey:      "custom:abc",
		Label:         "Severity",
		Kind:          "custom",
		ValueLocation: "eav",
		Required:      true,
		IsCompulsory:  false,
	}
	if e.ValueLocation != "eav" {
		t.Fatalf("want eav, got %q", e.ValueLocation)
	}
	if e.FieldKey != "custom:abc" {
		t.Fatalf("want custom:abc, got %q", e.FieldKey)
	}
}
