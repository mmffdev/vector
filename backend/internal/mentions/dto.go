package mentions

// MapPublicMention is the PLA-0039 lint seam. Public + internal shapes
// are currently identical; if a divergence appears (e.g. stripping
// subscription_id for external callers) it lands here, not in handler
// call sites. Enforced by lint:public-dto-mapper.
func MapPublicMention(m Mention) Mention {
	return m
}

// MapPublicMentionable is the same seam for the picker search result.
func MapPublicMentionable(m Mentionable) Mentionable {
	return m
}
