package panehelp

import (
	"strings"
	"testing"
)

func TestSanitizeStripsScript(t *testing.T) {
	in := `<p>safe</p><script>alert(1)</script><p>tail</p>`
	out := Sanitize(in)
	if strings.Contains(strings.ToLower(out), "<script") {
		t.Fatalf("expected <script> stripped, got %q", out)
	}
	if !strings.Contains(out, "safe") || !strings.Contains(out, "tail") {
		t.Fatalf("expected surrounding text preserved, got %q", out)
	}
}

func TestSanitizeStripsOnclick(t *testing.T) {
	in := `<a href="/" onclick="alert(1)">x</a>`
	out := Sanitize(in)
	if strings.Contains(strings.ToLower(out), "onclick") {
		t.Fatalf("expected onclick stripped, got %q", out)
	}
}

func TestSanitizePassesCleanInput(t *testing.T) {
	in := `<p>plain <code>text</code></p>`
	out := Sanitize(in)
	if out != in {
		t.Fatalf("expected unchanged, got %q", out)
	}
}

func TestSanitizeStripsScriptCaseAndAttrs(t *testing.T) {
	in := `<SCRIPT type="text/javascript">x</SCRIPT>`
	out := Sanitize(in)
	if strings.Contains(strings.ToLower(out), "<script") {
		t.Fatalf("expected case-insensitive strip, got %q", out)
	}
}

func TestSanitizeStripsMultipleOnHandlers(t *testing.T) {
	in := `<div onmouseover='x' onload="y">hi</div>`
	out := Sanitize(in)
	low := strings.ToLower(out)
	if strings.Contains(low, "onmouseover") || strings.Contains(low, "onload") {
		t.Fatalf("expected on* attrs stripped, got %q", out)
	}
}
