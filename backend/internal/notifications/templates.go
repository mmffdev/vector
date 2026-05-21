package notifications

import (
	"fmt"
	"sync"
)

// Templates renders an Event into a per-channel (title, body) pair.
// Kinds register a Template at boot (e.g. mentions does
// `templates.Register(KindMention, ...)`); the dispatchers call
// Render at delivery time.
//
// Defaults fire when a kind has no registered template — produces
// a generic "<context_label> — <kind>" pair so nothing 500s if a
// new kind ships without a template.
type Templates struct {
	mu        sync.RWMutex
	templates map[Kind]Template
}

func NewTemplates() *Templates {
	return &Templates{templates: make(map[Kind]Template)}
}

// Template renders the event for one channel.
type Template func(e Event, channel string) (title, body string)

func (t *Templates) Register(kind Kind, tmpl Template) {
	t.mu.Lock()
	t.templates[kind] = tmpl
	t.mu.Unlock()
}

func (t *Templates) Render(e Event, channel string) (title, body string) {
	t.mu.RLock()
	tmpl, ok := t.templates[e.Kind]
	t.mu.RUnlock()
	if !ok {
		return defaultTemplate(e, channel)
	}
	return tmpl(e, channel)
}

func defaultTemplate(e Event, _ string) (string, string) {
	if e.ContextLabel != "" {
		return fmt.Sprintf("%s — %s", e.ContextLabel, e.Kind), e.Snippet
	}
	return fmt.Sprintf("New %s", e.Kind), e.Snippet
}

// KindArtefact is the rule-fired-on-artefact-write notification kind.
// Same string value as the rules.RuleType "artefact" so the
// dispatcher's bell-tag derivation routes both through the artefact
// bucket. Declared here to keep the kind catalogue in one file.
const KindArtefact Kind = "artefact"

// RegisterMentionDefault wires the canonical mention template. Called
// from main.go after the Templates registry is created. Producers can
// override later by calling Register again with the same kind.
func RegisterMentionDefault(t *Templates) {
	t.Register(KindMention, func(e Event, channel string) (string, string) {
		// Title: "You were mentioned in <context-label>"
		// Body:  the snippet (in_app shows it inline; email may wrap it)
		title := "You were mentioned"
		if e.ContextLabel != "" {
			title = fmt.Sprintf("You were mentioned in %s", e.ContextLabel)
		}
		return title, e.Snippet
	})
}

// RegisterArtefactDefault wires the rule-fired-on-artefact-write
// template. The rules producer-hook synthesises ContextLabel with
// the rule name + artefact type/id, so the title is reasonably
// informative even without per-rule template customisation.
func RegisterArtefactDefault(t *Templates) {
	t.Register(KindArtefact, func(e Event, channel string) (string, string) {
		// Title format chosen to lead with the most recognisable bit
		// (the artefact context) since the bell only shows the title:
		//   "Defect <id> matched 'High-severity defects'"
		title := "An artefact changed"
		if e.ContextLabel != "" {
			title = e.ContextLabel
		}
		return title, e.Snippet
	})
}
