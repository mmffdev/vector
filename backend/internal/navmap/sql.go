package navmap

// sqlListBuckets returns every bucket (pages_tags group) in Rail1 order.
// No role filter — this is the complete catalogue for the architecture map.
// Column names verified against backend/internal/nav/sql.go (sqlListPageTags).
const sqlListBuckets = `
	SELECT pages_tags_tag_enum,
	       pages_tags_display_name,
	       pages_tags_default_order
	  FROM pages_tags
	 ORDER BY pages_tags_default_order, pages_tags_display_name`

// sqlListAllPages returns every system-scoped page (pages_id_user_creator
// IS NULL), regardless of role grants, so the architecture map is complete.
// pages_kind is included so the drift report can classify system vs entity
// vs custom pages. Column names verified against backend/internal/nav/sql.go
// (sqlListSystemPagesWithRoles).
const sqlListAllPages = `
	SELECT p.pages_key_enum,
	       p.pages_label,
	       p.pages_href,
	       p.pages_kind,
	       p.pages_tag_enum,
	       p.pages_default_order
	  FROM pages p
	 WHERE p.pages_id_user_creator IS NULL
	 ORDER BY p.pages_tag_enum, p.pages_default_order, p.pages_label`
