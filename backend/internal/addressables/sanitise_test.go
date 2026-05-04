package addressables

import (
	"strings"
	"testing"
)

func TestSanitiseHelpBodyHTML_PreservesAllowedTags(t *testing.T) {
	in := `<p>hello <strong>world</strong></p><ul><li>one</li><li>two</li></ul>`
	got := SanitiseHelpBodyHTML(in)
	if got != in {
		t.Fatalf("allowed-tag passthrough failed:\n  got:  %q\n  want: %q", got, in)
	}
}

func TestSanitiseHelpBodyHTML_StripsScript(t *testing.T) {
	in := `<p>safe</p><script>alert(1)</script><p>after</p>`
	got := SanitiseHelpBodyHTML(in)
	if strings.Contains(got, "<script") {
		t.Fatalf("script tag survived: %q", got)
	}
	// The text content of the script (the alert call) is emitted as
	// escaped text by the html tokenizer's TextToken branch — that's
	// safe (no <> means no execution). Only the tag wrapper must die.
	if !strings.Contains(got, "<p>safe</p>") || !strings.Contains(got, "<p>after</p>") {
		t.Fatalf("surrounding paragraphs lost: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_StripsStyleAndIframe(t *testing.T) {
	cases := []string{
		`<style>body{display:none}</style>`,
		`<iframe src="https://evil.example/"></iframe>`,
		`<object data="x"></object>`,
		`<embed src="x">`,
	}
	for _, in := range cases {
		got := SanitiseHelpBodyHTML(in)
		for _, bad := range []string{"<style", "<iframe", "<object", "<embed"} {
			if strings.Contains(got, bad) {
				t.Fatalf("disallowed tag %q survived for input %q -> %q", bad, in, got)
			}
		}
	}
}

func TestSanitiseHelpBodyHTML_StripsOnHandlersAndStyleAttr(t *testing.T) {
	in := `<p onclick="alert(1)" style="color:red">x</p>`
	got := SanitiseHelpBodyHTML(in)
	if strings.Contains(strings.ToLower(got), "onclick") {
		t.Fatalf("onclick handler survived: %q", got)
	}
	if strings.Contains(strings.ToLower(got), "style") {
		t.Fatalf("style attr survived: %q", got)
	}
	if got != "<p>x</p>" {
		t.Fatalf("unexpected output: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_StripsJavascriptHref(t *testing.T) {
	in := `<a href="javascript:alert(1)">click</a>`
	got := SanitiseHelpBodyHTML(in)
	if strings.Contains(strings.ToLower(got), "javascript:") {
		t.Fatalf("javascript: href survived: %q", got)
	}
	// The <a> tag itself is allowed but the bad attribute is dropped —
	// so we get a bare `<a>click</a>`.
	if got != "<a>click</a>" {
		t.Fatalf("unexpected output: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_KeepsHttpsHref(t *testing.T) {
	in := `<a href="https://example.com" target="_blank" rel="noreferrer">x</a>`
	got := SanitiseHelpBodyHTML(in)
	if !strings.Contains(got, `href="https://example.com"`) {
		t.Fatalf("https href dropped: %q", got)
	}
	if !strings.Contains(got, `target="_blank"`) {
		t.Fatalf("target=_blank dropped: %q", got)
	}
	if !strings.Contains(got, `rel="noreferrer"`) {
		t.Fatalf("rel dropped: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_RejectsTargetOtherThanBlank(t *testing.T) {
	in := `<a href="https://example.com" target="_top">x</a>`
	got := SanitiseHelpBodyHTML(in)
	if strings.Contains(got, "target") {
		t.Fatalf("target=_top should have been dropped: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_KeepsMailto(t *testing.T) {
	in := `<a href="mailto:hi@example.com">mail</a>`
	got := SanitiseHelpBodyHTML(in)
	if !strings.Contains(got, `href="mailto:hi@example.com"`) {
		t.Fatalf("mailto dropped: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_DropsDataHref(t *testing.T) {
	in := `<a href="data:text/html,<script>1</script>">x</a>`
	got := SanitiseHelpBodyHTML(in)
	if strings.Contains(strings.ToLower(got), "data:") {
		t.Fatalf("data: href survived: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_VoidElements(t *testing.T) {
	in := `line1<br>line2<hr>line3`
	got := SanitiseHelpBodyHTML(in)
	// Both br and hr are void — single `<br>` / `<hr>` token, no closer.
	if !strings.Contains(got, "<br>") || strings.Contains(got, "</br>") {
		t.Fatalf("br emitted incorrectly: %q", got)
	}
	if !strings.Contains(got, "<hr>") || strings.Contains(got, "</hr>") {
		t.Fatalf("hr emitted incorrectly: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_EscapesText(t *testing.T) {
	in := `<p>a & b < c</p>`
	got := SanitiseHelpBodyHTML(in)
	if !strings.Contains(got, "&amp;") {
		t.Fatalf("ampersand not escaped: %q", got)
	}
	if !strings.Contains(got, "&lt;") {
		t.Fatalf("less-than not escaped: %q", got)
	}
}

func TestSanitiseHelpBodyHTML_Empty(t *testing.T) {
	if got := SanitiseHelpBodyHTML(""); got != "" {
		t.Fatalf("empty input must return empty, got %q", got)
	}
}

// ─────────────────────────────────────────────────────────────────────
// ValidateYouTubeURL
// ─────────────────────────────────────────────────────────────────────

func TestValidateYouTubeURL_Accepts(t *testing.T) {
	cases := map[string]string{
		"https://www.youtube.com/watch?v=dQw4w9WgXcQ":  "dQw4w9WgXcQ",
		"http://youtube.com/watch?v=dQw4w9WgXcQ":       "dQw4w9WgXcQ",
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ":    "dQw4w9WgXcQ",
		"https://www.youtube.com/embed/dQw4w9WgXcQ":    "dQw4w9WgXcQ",
		"https://www.youtube.com/shorts/dQw4w9WgXcQ":   "dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ":                 "dQw4w9WgXcQ",
		"https://www.youtube.com/watch?v=abc-_DEF123":  "abc-_DEF123",
	}
	for raw, want := range cases {
		got, err := ValidateYouTubeURL(raw)
		if err != nil {
			t.Fatalf("%q rejected: %v", raw, err)
		}
		if got != want {
			t.Fatalf("%q → %q, want %q", raw, got, want)
		}
	}
}

func TestValidateYouTubeURL_Rejects(t *testing.T) {
	cases := []string{
		"",
		"   ",
		"not-a-url",
		"javascript:alert(1)",
		"data:text/html,<script>1</script>",
		"ftp://youtube.com/watch?v=dQw4w9WgXcQ",
		"https://evil.example/watch?v=dQw4w9WgXcQ",
		"https://www.youtube.com/watch",                  // no v param
		"https://www.youtube.com/watch?v=",                // empty v
		"https://www.youtube.com/watch?v=tooShort",        // 8 chars
		"https://www.youtube.com/watch?v=this_is_too_long", // 16 chars
		"https://youtu.be/",                               // empty path
		"https://youtu.be/<script>alert</script>",         // garbage
		"https://www.youtube.com/embed/",                  // empty embed
		"https://www.youtube.com/results?search=hi",       // not a video
	}
	for _, raw := range cases {
		if _, err := ValidateYouTubeURL(raw); err == nil {
			t.Fatalf("%q should have been rejected", raw)
		}
	}
}
