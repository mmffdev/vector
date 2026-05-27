package erd

import "testing"

func TestNormaliseType(t *testing.T) {
	cases := map[string]string{
		"character varying":         "text",
		"timestamp with time zone":  "timestamptz",
		"uuid":                      "uuid",
		"integer":                   "int4",
	}
	for in, want := range cases {
		if got := normaliseType(in); got != want {
			t.Errorf("normaliseType(%q) = %q, want %q", in, got, want)
		}
	}
}
