package templates

import "testing"

func TestInterpolate(t *testing.T) {
	t.Parallel()

	data := map[string]any{
		"actor_display_name": "Alice",
		"artefact_name":      "DEF-42",
		"snippet":            "Hello world",
		"count":              7,
		"ratio":              3.14,
		"enabled":            true,
		"tags":               []string{"red", "blue"},
		"actor": map[string]any{
			"name":  "Bob",
			"email": "bob@example.com",
		},
		"scores": map[string]any{
			"total": 99,
		},
	}

	tests := []struct {
		name string
		tmpl string
		data map[string]any
		want string
	}{
		{
			name: "empty template",
			tmpl: "",
			data: data,
			want: "",
		},
		{
			name: "no placeholders",
			tmpl: "Hello, world!",
			data: data,
			want: "Hello, world!",
		},
		{
			name: "single placeholder present",
			tmpl: "{{ data.actor_display_name }} mentioned you",
			data: data,
			want: "Alice mentioned you",
		},
		{
			name: "single placeholder missing → empty string",
			tmpl: "Hello {{ data.unknown_field }}!",
			data: data,
			want: "Hello !",
		},
		{
			name: "multiple placeholders all present",
			tmpl: "{{ data.actor_display_name }} mentioned you in {{ data.artefact_name }}",
			data: data,
			want: "Alice mentioned you in DEF-42",
		},
		{
			name: "nested path data.actor.name",
			tmpl: "Message from {{ data.actor.name }}",
			data: data,
			want: "Message from Bob",
		},
		{
			name: "nested path data.scores.total",
			tmpl: "Score: {{ data.scores.total }}",
			data: data,
			want: "Score: 99",
		},
		{
			name: "whitespace variant no spaces",
			tmpl: "{{data.actor_display_name}} signed in",
			data: data,
			want: "Alice signed in",
		},
		{
			name: "whitespace variant extra spaces",
			tmpl: "{{  data.actor_display_name  }} signed in",
			data: data,
			want: "Alice signed in",
		},
		{
			name: "integer value renders as decimal",
			tmpl: "Count: {{ data.count }}",
			data: data,
			want: "Count: 7",
		},
		{
			name: "float value renders via %v",
			tmpl: "Ratio: {{ data.ratio }}",
			data: data,
			want: "Ratio: 3.14",
		},
		{
			name: "bool true renders as true",
			tmpl: "Enabled: {{ data.enabled }}",
			data: data,
			want: "Enabled: true",
		},
		{
			name: "bool false renders as false",
			tmpl: "Active: {{ data.active }}",
			data: map[string]any{"active": false},
			want: "Active: false",
		},
		{
			name: "slice value renders via %v",
			tmpl: "Tags: {{ data.tags }}",
			data: data,
			want: "Tags: [red blue]",
		},
		{
			name: "template with no {{ → fast path, unchanged",
			tmpl: "No placeholders here at all",
			data: data,
			want: "No placeholders here at all",
		},
		{
			name: "path without data. prefix resolves from root",
			tmpl: "{{ actor_display_name }} mentioned you",
			data: data,
			want: "Alice mentioned you",
		},
		{
			name: "nested missing intermediate → empty string",
			tmpl: "{{ data.missing.nested }}",
			data: data,
			want: "",
		},
		{
			name: "nil data map → all missing → empty",
			tmpl: "Hello {{ data.name }}",
			data: nil,
			want: "Hello ",
		},
		{
			name: "multiline template",
			tmpl: "{{ data.actor_display_name }} mentioned you\nIn: {{ data.artefact_name }}\n{{ data.snippet }}",
			data: data,
			want: "Alice mentioned you\nIn: DEF-42\nHello world",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := Interpolate(tc.tmpl, tc.data)
			if got != tc.want {
				t.Errorf("Interpolate(%q, ...) = %q; want %q", tc.tmpl, got, tc.want)
			}
		})
	}
}
