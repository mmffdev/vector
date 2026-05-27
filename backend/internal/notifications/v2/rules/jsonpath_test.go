package rules

import (
	"testing"
)

func TestResolvePath(t *testing.T) {
	data := map[string]any{
		"actor": map[string]any{
			"role":  "gadmin",
			"email": "admin@example.com",
		},
		"item": map[string]any{
			"priority": "high",
			"meta": map[string]any{
				"tag": "urgent",
			},
		},
		"count":   float64(42),
		"enabled": true,
		"nullval": nil,
	}

	tests := []struct {
		name      string
		path      string
		wantVal   any
		wantFound bool
	}{
		{
			name:      "top-level string",
			path:      "count",
			wantVal:   float64(42),
			wantFound: true,
		},
		{
			name:      "nested one level",
			path:      "actor.role",
			wantVal:   "gadmin",
			wantFound: true,
		},
		{
			name:      "nested two levels",
			path:      "item.meta.tag",
			wantVal:   "urgent",
			wantFound: true,
		},
		{
			name:      "top-level bool",
			path:      "enabled",
			wantVal:   true,
			wantFound: true,
		},
		{
			name:      "missing top-level key",
			path:      "missing",
			wantVal:   nil,
			wantFound: false,
		},
		{
			name:      "missing nested key",
			path:      "actor.phone",
			wantVal:   nil,
			wantFound: false,
		},
		{
			name:      "intermediate node is not a map",
			path:      "count.child",
			wantVal:   nil,
			wantFound: false,
		},
		{
			name:      "empty path",
			path:      "",
			wantVal:   nil,
			wantFound: false,
		},
		{
			name:      "nil value at key (key exists)",
			path:      "nullval",
			wantVal:   nil,
			wantFound: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, found := resolvePath(data, tc.path)
			if found != tc.wantFound {
				t.Errorf("resolvePath(%q): found=%v want %v", tc.path, found, tc.wantFound)
			}
			if found && got != tc.wantVal {
				t.Errorf("resolvePath(%q): got %v (%T), want %v (%T)",
					tc.path, got, got, tc.wantVal, tc.wantVal)
			}
		})
	}
}

func TestResolvePath_NilData(t *testing.T) {
	got, found := resolvePath(nil, "actor.role")
	if found || got != nil {
		t.Errorf("resolvePath(nil, ...): want (nil, false), got (%v, %v)", got, found)
	}
}
