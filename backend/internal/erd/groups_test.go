package erd

import (
	"testing"
)

func TestLoadGroups_Known(t *testing.T) {
	g, err := loadGroupsFromPath("testdata/system_areas_min.yaml")
	if err != nil {
		t.Fatalf("loadGroupsFromPath: %v", err)
	}
	if got := g.GroupFor("users"); got != "sentinel" {
		t.Fatalf("GroupFor(users) = %q, want sentinel", got)
	}
	if got := g.GroupFor("topology_nodes"); got != "topology" {
		t.Fatalf("GroupFor(topology_nodes) = %q, want topology", got)
	}
}

func TestLoadGroups_Unknown(t *testing.T) {
	g, err := loadGroupsFromPath("testdata/system_areas_min.yaml")
	if err != nil {
		t.Fatalf("loadGroupsFromPath: %v", err)
	}
	if got := g.GroupFor("nonexistent_table"); got != "uncatalogued" {
		t.Fatalf("GroupFor(nonexistent_table) = %q, want uncatalogued", got)
	}
}

func TestLoadGroups_MissingFile(t *testing.T) {
	_, err := loadGroupsFromPath("testdata/does_not_exist.yaml")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
}

func TestLoadGroups_ListReturnsUncatalogued(t *testing.T) {
	g, err := loadGroupsFromPath("testdata/system_areas_min.yaml")
	if err != nil {
		t.Fatalf("loadGroupsFromPath: %v", err)
	}
	groups := g.List()
	var hasUncat bool
	for _, gr := range groups {
		if gr.ID == "uncatalogued" {
			hasUncat = true
		}
	}
	if !hasUncat {
		t.Fatal("List() missing 'uncatalogued' fallback group")
	}
}
