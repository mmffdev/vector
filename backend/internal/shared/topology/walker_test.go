package topology

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// testNode is the Go counterpart of the TS test type used to drive
// fixtures. Mirrors `{ id, parent_id, position, name }`.
type testNode struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id"`
	Position int     `json:"position"`
	Name     string  `json:"name"`
}

func (n testNode) GetID() string        { return n.ID }
func (n testNode) GetParentID() *string { return n.ParentID }

// fixturesDir resolves to dev/fixtures/shared/topology from the test's
// working directory (which Go sets to the package dir). We walk up to
// the repo root via the well-known path segments.
func fixturesDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// wd = .../backend/internal/shared/topology
	// repo root = wd with the last four segments stripped
	dir := wd
	for i := 0; i < 4; i++ {
		dir = filepath.Dir(dir)
	}
	return filepath.Join(dir, "dev", "fixtures", "shared", "topology")
}

type fixture struct {
	Input struct {
		Nodes     []testNode `json:"nodes"`
		Collapsed []string   `json:"collapsed"`
		Sort      string     `json:"sort"`
		MaxDepth  *int       `json:"maxDepth"`
	} `json:"input"`
	Expected struct {
		Rows         []FlattenedRow `json:"rows"`
		VisibleIDs   []string       `json:"visibleIds"`
		VisibleEdges []Edge         `json:"visibleEdges"`
	} `json:"expected"`
}

func loadFixture(t *testing.T, slug string) fixture {
	t.Helper()
	path := filepath.Join(fixturesDir(t), slug+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", slug, err)
	}
	var fx fixture
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("unmarshal fixture %s: %v", slug, err)
	}
	return fx
}

func TestWalk_GoldenFixtureParity(t *testing.T) {
	for _, slug := range []string{
		"flat-list",
		"single-root-deep",
		"multi-root-forest",
		"orphan-drop",
		"cycle-guard",
		"collapse-hides-subtree",
	} {
		slug := slug
		t.Run(slug, func(t *testing.T) {
			fx := loadFixture(t, slug)
			collapsed := make(map[string]struct{}, len(fx.Input.Collapsed))
			for _, id := range fx.Input.Collapsed {
				collapsed[id] = struct{}{}
			}

			var less func(a, b testNode) bool
			switch fx.Input.Sort {
			case "byLabel":
				less = func(a, b testNode) bool {
					la := a.Name
					if la == "" {
						la = a.ID
					}
					lb := b.Name
					if lb == "" {
						lb = b.ID
					}
					return strings.Compare(la, lb) < 0
				}
			default:
				less = func(a, b testNode) bool {
					if a.Position != b.Position {
						return a.Position < b.Position
					}
					return strings.Compare(a.ID, b.ID) < 0
				}
			}

			opts := Opts[testNode]{
				Collapsed: collapsed,
				Less:      less,
			}
			if fx.Input.MaxDepth != nil {
				opts.MaxDepth = *fx.Input.MaxDepth
			}

			got := Walk(fx.Input.Nodes, opts)

			// Rows: deep-equal, including empty slice vs nil. Normalise
			// to "always slice" before comparing so JSON-deserialised
			// expected matches the Go-constructed got.
			gotRows := normaliseRows(got.Rows)
			wantRows := normaliseRows(fx.Expected.Rows)
			if !reflect.DeepEqual(gotRows, wantRows) {
				t.Errorf("rows mismatch\n got:  %#v\n want: %#v", gotRows, wantRows)
			}

			// VisibleIDs: sets — compare as sorted slices.
			gotIDs := keys(got.VisibleIDs)
			wantIDs := append([]string{}, fx.Expected.VisibleIDs...)
			sort.Strings(gotIDs)
			sort.Strings(wantIDs)
			if !reflect.DeepEqual(gotIDs, wantIDs) {
				t.Errorf("visibleIds mismatch\n got:  %v\n want: %v", gotIDs, wantIDs)
			}

			// VisibleEdges: ordered, compare directly.
			gotEdges := normaliseEdges(got.VisibleEdges)
			wantEdges := normaliseEdges(fx.Expected.VisibleEdges)
			if !reflect.DeepEqual(gotEdges, wantEdges) {
				t.Errorf("visibleEdges mismatch\n got:  %v\n want: %v", gotEdges, wantEdges)
			}
		})
	}
}

func TestWalk_OrphanDrop_NoReRoot(t *testing.T) {
	pa := "a"
	pghost := "ghost"
	nodes := []testNode{
		{ID: "a", ParentID: nil, Position: 0, Name: "a"},
		{ID: "b", ParentID: &pghost, Position: 0, Name: "b"},
		{ID: "c", ParentID: &pa, Position: 0, Name: "c"},
	}
	r := Walk(nodes, Opts[testNode]{
		Collapsed: map[string]struct{}{},
		Less:      func(a, b testNode) bool { return a.Position < b.Position },
	})
	if _, ok := r.VisibleIDs["b"]; ok {
		t.Fatalf("orphan b should be dropped, not re-rooted")
	}
	if len(r.Rows) != 2 {
		t.Fatalf("want 2 rows (a, c), got %d", len(r.Rows))
	}
}

func TestWalk_CycleGuard_DepthCap(t *testing.T) {
	// Long chain a→b→c→…→g. maxDepth=3 should stop after emitting
	// depth-3 row (d).
	ids := []string{"a", "b", "c", "d", "e", "f", "g"}
	nodes := make([]testNode, len(ids))
	for i, id := range ids {
		var parent *string
		if i > 0 {
			p := ids[i-1]
			parent = &p
		}
		nodes[i] = testNode{ID: id, ParentID: parent, Position: 0, Name: id}
	}
	r := Walk(nodes, Opts[testNode]{
		Collapsed: map[string]struct{}{},
		Less:      func(a, b testNode) bool { return a.Position < b.Position },
		MaxDepth:  3,
	})
	if len(r.Rows) != 4 {
		t.Fatalf("want 4 rows at maxDepth=3, got %d", len(r.Rows))
	}
	if r.Rows[3].ID != "d" {
		t.Fatalf("want last row d, got %s", r.Rows[3].ID)
	}
}

// normaliseRows ensures every row's AncestorMoreChildren is a non-nil
// slice so reflect.DeepEqual doesn't trip on []bool{} vs nil.
func normaliseRows(rows []FlattenedRow) []FlattenedRow {
	out := make([]FlattenedRow, len(rows))
	for i, r := range rows {
		if r.AncestorMoreChildren == nil {
			r.AncestorMoreChildren = []bool{}
		}
		out[i] = r
	}
	return out
}

func normaliseEdges(edges []Edge) []Edge {
	if edges == nil {
		return []Edge{}
	}
	return edges
}

func keys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
