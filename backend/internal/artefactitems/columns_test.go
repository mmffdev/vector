package artefactitems

import (
	"encoding/json"
	"testing"
)

// Slice 2.5 of the ObjectTree refactor — pin the column-catalogue +
// projection contract. Unit tests; no DB, no HTTP.

func TestIsKnownArtefactItemColumn(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"id", true},
		{"title", true},
		{"flow_state_id", true},
		{"description_doc", true},
		{"owner", true},
		{"created_at", true},
		{"archived_at", true},
		{"nonexistent", false},
		{"", false},
		{"ID", false}, // case-sensitive — match JSON tags exactly
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsKnownArtefactItemColumn(tc.name); got != tc.want {
				t.Errorf("IsKnownArtefactItemColumn(%q) = %v; want %v", tc.name, got, tc.want)
			}
		})
	}
}

func TestAlwaysOnArtefactItemColumns(t *testing.T) {
	got := AlwaysOnArtefactItemColumns()
	if len(got) != 1 || got[0] != "id" {
		t.Errorf("AlwaysOnArtefactItemColumns() = %v; want exactly [\"id\"]", got)
	}
}

func TestParseFieldsParam_Empty(t *testing.T) {
	set, unknown, ok := parseFieldsParam("")
	if !ok {
		t.Fatalf("ok=false on empty input")
	}
	if set != nil {
		t.Errorf("expected nil set (no projection); got %v", set)
	}
	if unknown != "" {
		t.Errorf("unknown=%q on empty input", unknown)
	}
}

func TestParseFieldsParam_Valid(t *testing.T) {
	set, unknown, ok := parseFieldsParam("title,status,owner_id")
	if !ok {
		t.Fatalf("ok=false on valid input: unknown=%q", unknown)
	}
	want := map[string]bool{
		"title":    true,
		"status":   true,
		"owner_id": true,
		"id":       true, // always-on folded in
	}
	if len(set) != len(want) {
		t.Errorf("set has %d entries; want %d. set=%v", len(set), len(want), set)
	}
	for k := range want {
		if !set[k] {
			t.Errorf("missing key %q in set %v", k, set)
		}
	}
}

func TestParseFieldsParam_FoldsInIdEvenIfClientDidntAsk(t *testing.T) {
	set, _, ok := parseFieldsParam("title")
	if !ok {
		t.Fatal("ok=false")
	}
	if !set["id"] {
		t.Errorf("id should always be folded in; set=%v", set)
	}
}

func TestParseFieldsParam_Unknown(t *testing.T) {
	set, unknown, ok := parseFieldsParam("title,bogus")
	if ok {
		t.Fatalf("expected ok=false on unknown field; set=%v", set)
	}
	if unknown != "bogus" {
		t.Errorf("unknown=%q; want %q", unknown, "bogus")
	}
}

func TestParseFieldsParam_TrimsWhitespace(t *testing.T) {
	set, _, ok := parseFieldsParam(" title , status ")
	if !ok {
		t.Fatal("ok=false")
	}
	if !set["title"] || !set["status"] {
		t.Errorf("whitespace not trimmed; set=%v", set)
	}
}

func TestParseFieldsParam_SkipsEmptySegments(t *testing.T) {
	// Trailing comma is a common client mistake; should be tolerated.
	set, unknown, ok := parseFieldsParam("title,,status,")
	if !ok {
		t.Fatalf("ok=false; unknown=%q", unknown)
	}
	if !set["title"] || !set["status"] {
		t.Errorf("expected title+status; set=%v", set)
	}
}

func TestProjectItems_Nil(t *testing.T) {
	items := []WorkItem{{ID: "a", Title: "first"}, {ID: "b", Title: "second"}}
	out, err := projectItems(items, nil)
	if err != nil {
		t.Fatal(err)
	}
	// nil set = no projection; same slice returned.
	got, ok := out.([]WorkItem)
	if !ok {
		t.Fatalf("expected []WorkItem; got %T", out)
	}
	if len(got) != 2 {
		t.Errorf("len=%d; want 2", len(got))
	}
}

func TestProjectItems_FiltersToRequestedKeys(t *testing.T) {
	items := []WorkItem{
		{ID: "a", Title: "first", OwnerID: "u1", FlowStateID: "fs1"},
	}
	set := map[string]bool{
		"id":    true,
		"title": true,
	}
	out, err := projectItems(items, set)
	if err != nil {
		t.Fatal(err)
	}
	maps, ok := out.([]map[string]any)
	if !ok {
		t.Fatalf("expected []map[string]any; got %T", out)
	}
	if len(maps) != 1 {
		t.Fatalf("len=%d; want 1", len(maps))
	}
	m := maps[0]
	if m["id"] != "a" {
		t.Errorf("id=%v; want \"a\"", m["id"])
	}
	if m["title"] != "first" {
		t.Errorf("title=%v; want \"first\"", m["title"])
	}
	if _, present := m["owner_id"]; present {
		t.Errorf("owner_id should be filtered out; got %v", m["owner_id"])
	}
	if _, present := m["flow_state_id"]; present {
		t.Errorf("flow_state_id should be filtered out; got %v", m["flow_state_id"])
	}
}

func TestProjectItems_OutputIsValidJSON(t *testing.T) {
	// Defensive — the projection round-trips through json.Marshal /
	// Unmarshal; the output must re-marshal cleanly.
	items := []WorkItem{{ID: "a", Title: "first"}}
	set := map[string]bool{"id": true, "title": true}
	out, err := projectItems(items, set)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := json.Marshal(out); err != nil {
		t.Errorf("projected output failed to marshal: %v", err)
	}
}
