// Package navmap exposes the unfiltered nav spine (every bucket + every
// system page) for the <report> -a architecture site map. Unlike
// nav.Catalogue, which filters pages by the caller's role, navmap returns
// the COMPLETE tree so the architecture map covers the whole site
// (public-facing + dev-tools-facing). Read-only; dev-gated.
package navmap

// SpinePage is one row from the pages table, trimmed to the fields the
// architecture map needs.
type SpinePage struct {
	KeyEnum      string `json:"key_enum"`      // pages_key_enum — stable slug
	Label        string `json:"label"`         // pages_label — display name
	Href         string `json:"href"`          // pages_href — route path
	Kind         string `json:"kind"`          // pages_kind — system | entity | custom
	DefaultOrder int    `json:"default_order"` // pages_default_order — within bucket
}

// SpineBucket is one row from pages_tags with its child pages attached.
type SpineBucket struct {
	TagEnum string      `json:"tag_enum"` // pages_tags_tag_enum — stable slug
	Label   string      `json:"label"`    // bucket display name
	Order   int         `json:"order"`    // bucket order on Rail1
	Pages   []SpinePage `json:"pages"`
}

// SpineResponse is the top-level payload of GET /_site/admin/dev/architecture/spine.
type SpineResponse struct {
	Buckets []SpineBucket `json:"buckets"`
	// Untagged collects pages whose pages_tag_enum matches no bucket
	// (orphaned tag) — surfaced so the drift report can flag them.
	Untagged []SpinePage `json:"untagged"`
}
