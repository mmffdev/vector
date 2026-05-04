package addressables

// PLA-0008 / 00330 — HTML sanitiser + YouTube URL validator.
//
// The page-help write path accepts a body_html string from gadmin (or
// from the library seed). Before it is persisted we strip everything
// outside a small allowlist so a stored XSS in body_html cannot escape
// into a Panel popover or /help/<id> page rendered via
// dangerouslySetInnerHTML.
//
// Policy is hand-rolled (no bluemonday dep). Tokens come from
// golang.org/x/net/html — already a transitive dep — so we stay on the
// standard parser instead of regexes that miss self-closing oddities.
//
// Allowlist (tag → permitted attributes):
//
//	p, br, hr, blockquote, strong, b, em, i, u, code, pre,
//	ul, ol, li, h2, h3, h4 → no attributes
//	a → href (http/https/mailto only), title, rel, target=_blank
//
// Everything else (script, style, iframe, img, object, embed, on*
// handlers, javascript: URLs, data: URLs in href, css inline styles)
// is dropped. The output is always re-emitted from the parsed token
// stream — even malformed input is normalised.

import (
	"errors"
	"net/url"
	"strings"

	"golang.org/x/net/html"
)

// Tags whose start/end tokens are kept verbatim.
var allowedTags = map[string]bool{
	"p":          true,
	"br":         true,
	"hr":         true,
	"blockquote": true,
	"strong":     true,
	"b":          true,
	"em":         true,
	"i":          true,
	"u":          true,
	"code":       true,
	"pre":        true,
	"ul":         true,
	"ol":         true,
	"li":         true,
	"h2":         true,
	"h3":         true,
	"h4":         true,
	"a":          true,
}

// Self-closing / void elements — emit `<tag>` with no closing tag.
var voidTags = map[string]bool{
	"br": true,
	"hr": true,
}

// Per-tag attribute allowlists. A tag absent from this map is treated
// as "no attributes allowed".
var allowedAttrs = map[string]map[string]bool{
	"a": {
		"href":   true,
		"title":  true,
		"rel":    true,
		"target": true,
	},
}

// SanitiseHelpBodyHTML enforces the allowlist on `body_html` before it
// reaches the database. Empty input returns empty output. The function
// is deterministic and side-effect-free.
func SanitiseHelpBodyHTML(in string) string {
	if in == "" {
		return ""
	}
	tokenizer := html.NewTokenizer(strings.NewReader(in))
	var out strings.Builder
	for {
		tt := tokenizer.Next()
		switch tt {
		case html.ErrorToken:
			return out.String()
		case html.TextToken:
			out.WriteString(html.EscapeString(string(tokenizer.Text())))
		case html.StartTagToken:
			tn, hasAttr := tokenizer.TagName()
			tag := strings.ToLower(string(tn))
			if !allowedTags[tag] {
				continue
			}
			out.WriteByte('<')
			out.WriteString(tag)
			if hasAttr {
				writeAllowedAttrs(&out, tokenizer, tag)
			}
			out.WriteByte('>')
		case html.EndTagToken:
			tn, _ := tokenizer.TagName()
			tag := strings.ToLower(string(tn))
			if !allowedTags[tag] {
				continue
			}
			if voidTags[tag] {
				continue
			}
			out.WriteString("</")
			out.WriteString(tag)
			out.WriteByte('>')
		case html.SelfClosingTagToken:
			tn, hasAttr := tokenizer.TagName()
			tag := strings.ToLower(string(tn))
			if !allowedTags[tag] {
				continue
			}
			out.WriteByte('<')
			out.WriteString(tag)
			if hasAttr {
				writeAllowedAttrs(&out, tokenizer, tag)
			}
			out.WriteByte('>')
		}
	}
}

// writeAllowedAttrs walks the tokenizer's attribute list for the
// current tag and emits each allowed (key, value) pair with the value
// HTML-escaped. on* handlers, style, and disallowed URL schemes are
// silently dropped.
func writeAllowedAttrs(out *strings.Builder, t *html.Tokenizer, tag string) {
	allowed := allowedAttrs[tag]
	for {
		k, v, more := t.TagAttr()
		key := strings.ToLower(string(k))
		val := string(v)
		if allowed[key] {
			if (tag == "a" && key == "href") && !isSafeHref(val) {
				if !more {
					return
				}
				continue
			}
			if tag == "a" && key == "target" {
				if val != "_blank" {
					if !more {
						return
					}
					continue
				}
			}
			out.WriteByte(' ')
			out.WriteString(key)
			out.WriteString(`="`)
			out.WriteString(html.EscapeString(val))
			out.WriteByte('"')
		}
		if !more {
			return
		}
	}
}

// isSafeHref accepts http://, https://, and mailto: URLs only. Empty
// hrefs and javascript:/data: schemes are rejected.
func isSafeHref(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false
	}
	low := strings.ToLower(raw)
	if strings.HasPrefix(low, "javascript:") || strings.HasPrefix(low, "data:") || strings.HasPrefix(low, "vbscript:") {
		return false
	}
	if strings.HasPrefix(low, "mailto:") {
		return true
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	return scheme == "http" || scheme == "https"
}

// ─────────────────────────────────────────────────────────────────────
// YouTube URL validator (replaces the inline isYouTubeURL helper)
// ─────────────────────────────────────────────────────────────────────

// ErrInvalidYouTubeURL is returned by ValidateYouTubeURL when the URL
// is not a recognisable youtube.com or youtu.be video link.
var ErrInvalidYouTubeURL = errors.New("not a recognised youtube URL")

// ValidateYouTubeURL parses a video URL and returns the canonical
// 11-char video ID on success. Recognised forms:
//
//	https://www.youtube.com/watch?v=<id>
//	https://m.youtube.com/watch?v=<id>
//	https://youtube.com/watch?v=<id>
//	https://www.youtube.com/embed/<id>
//	https://www.youtube.com/shorts/<id>
//	https://youtu.be/<id>
//
// Anything else (including bare strings, javascript: schemes, malformed
// URLs, or hosts outside the youtube allowlist) returns
// ErrInvalidYouTubeURL. The function is the single source of truth for
// the backend write path; isYouTubeURL above is kept only as a thin
// boolean wrapper around it.
func ValidateYouTubeURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ErrInvalidYouTubeURL
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "", ErrInvalidYouTubeURL
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return "", ErrInvalidYouTubeURL
	}
	host := strings.ToLower(u.Host)
	switch host {
	case "youtu.be":
		id := strings.Trim(u.Path, "/")
		if !isYouTubeID(id) {
			return "", ErrInvalidYouTubeURL
		}
		return id, nil
	case "youtube.com", "www.youtube.com", "m.youtube.com":
		// /watch?v=<id>
		if id := u.Query().Get("v"); isYouTubeID(id) {
			return id, nil
		}
		// /embed/<id> or /shorts/<id>
		segs := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(segs) == 2 && (segs[0] == "embed" || segs[0] == "shorts") && isYouTubeID(segs[1]) {
			return segs[1], nil
		}
		return "", ErrInvalidYouTubeURL
	default:
		return "", ErrInvalidYouTubeURL
	}
}

// isYouTubeID checks the conventional 11-char [A-Za-z0-9_-] shape.
// YouTube has not officially published an ID grammar but has used 11
// chars for over a decade — accepting wider strings here would let
// `?v=<script>` slip through.
func isYouTubeID(id string) bool {
	if len(id) != 11 {
		return false
	}
	for _, r := range id {
		if r >= 'A' && r <= 'Z' {
			continue
		}
		if r >= 'a' && r <= 'z' {
			continue
		}
		if r >= '0' && r <= '9' {
			continue
		}
		if r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}
