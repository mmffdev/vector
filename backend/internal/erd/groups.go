package erd

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

const (
	UncatalogedID    = "uncatalogued"
	UncatalogedLabel = "Uncatalogued"
)

type Groups struct {
	areas   []Group
	tableTo map[string]string // table name -> group id
}

type areaFile struct {
	Areas []struct {
		ID     string   `yaml:"id"`
		Label  string   `yaml:"label"`
		Tables []string `yaml:"tables"`
	} `yaml:"areas"`
}

func loadGroupsFromPath(path string) (*Groups, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("erd: read %s: %w", path, err)
	}
	var af areaFile
	if err := yaml.Unmarshal(b, &af); err != nil {
		return nil, fmt.Errorf("erd: parse %s: %w", path, err)
	}

	g := &Groups{
		tableTo: map[string]string{},
		areas: []Group{
			{ID: UncatalogedID, Label: UncatalogedLabel, Source: "fallback"},
		},
	}
	for _, a := range af.Areas {
		g.areas = append(g.areas, Group{ID: a.ID, Label: a.Label, Source: "erd_groups.yaml"})
		for _, t := range a.Tables {
			g.tableTo[t] = a.ID
		}
	}
	return g, nil
}

// GroupFor returns the group id for a table, or UncatalogedID if not catalogued.
func (g *Groups) GroupFor(table string) string {
	if id, ok := g.tableTo[table]; ok {
		return id
	}
	return UncatalogedID
}

// List returns all groups including the Uncatalogued fallback.
func (g *Groups) List() []Group {
	out := make([]Group, len(g.areas))
	copy(out, g.areas)
	return out
}
