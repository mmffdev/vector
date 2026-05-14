// Package addressables SQL constants.
//
// PLA-0048 / RF1.2.6. Every SQL string literal used by the addressables
// package lives here as a named constant. service.go references these
// constants; it DOES NOT embed raw SQL.
//
// The addressables package is the sole writer for page_addressables and
// page_help — keeping SQL here makes that boundary trivially auditable
// (one file is the entire write surface).
//
// Pairs vs templates: writes that branch on `parent_id IS NULL` vs
// `parent_id = $N` use two distinct consts (the SQL shape differs by
// `IS NULL` vs `=`, which can't be parameterised). Naming carries the
// branch via the `Root` / `Child` suffix.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// All reads/writes target the mmff_vector pool — addressables is
// single-DB (page_addressables + page_help + library_help_defaults
// all live there).
package addressables

// ── Snapshot (Snapshot) ─────────────────────────────────────────────────────

// sqlSnapshotPageAddressables returns every live addressable for a page
// route ordered by canonical address. Used by the runtime <DomRegistry>
// to verify the live DOM matches what is declared.
const sqlSnapshotPageAddressables = `
		SELECT id, parent_id, kind, name, address, page_route, source, custom_app_id, soft_archived, helpable
		  FROM page_addressables
		 WHERE page_route = $1 AND soft_archived = FALSE
		 ORDER BY address
	`

// ── Help read (HelpFor) ────────────────────────────────────────────────────

// sqlSelectHelpForAddressableLocale returns the live page_help row for
// an (addressable_id, locale) pair. pgx.ErrNoRows → empty HelpDoc with
// found=false (no help authored is not an error).
const sqlSelectHelpForAddressableLocale = `
		SELECT title, body_html, video_embeds, image_urls
		  FROM page_help
		 WHERE addressable_id = $1 AND locale = $2 AND soft_archived = FALSE
		 LIMIT 1
	`

// ── Help admin (AdminListHelp / UpdateHelp / ArchiveHelp / UpdateHelpable)

// sqlAdminListHelp returns every live page_help row joined to its
// addressable + the editor's email, with the is_library_default flag
// derived in SQL. Used by the gadmin /dev/page-help editor.
const sqlAdminListHelp = `
		SELECT
			h.id, h.addressable_id, a.address, a.page_route, a.kind, a.name,
			h.locale, h.title, h.body_html, h.video_embeds, h.image_urls, h.seeded_from,
			(h.seeded_from = 'library' AND h.updated_by_user_id IS NULL) AS is_library_default,
			h.updated_at, u.email, a.helpable
		  FROM page_help h
		  JOIN page_addressables a ON a.id = h.addressable_id
		  LEFT JOIN users u ON u.id = h.updated_by_user_id
		 WHERE h.soft_archived = FALSE
		   AND a.soft_archived = FALSE
		 ORDER BY a.page_route, a.address, h.locale
	`

// sqlUpdateHelp rewrites the rich-content fields of a live page_help
// row, bumps updated_at + updated_by_user_id, flips seeded_from to
// 'manual', and clears library_ref so future library churn does NOT
// retro-apply gadmin edits.
const sqlUpdateHelp = `
		UPDATE page_help
		   SET title = $1,
		       body_html = $2,
		       video_embeds = $3,
		       image_urls = $4,
		       updated_at = NOW(),
		       updated_by_user_id = $5,
		       seeded_from = 'manual',
		       library_ref = NULL
		 WHERE addressable_id = $6
		   AND locale = $7
		   AND soft_archived = FALSE
	`

// sqlArchiveHelp soft-archives a live page_help row for an
// (addressable, locale). The addressable itself is untouched; registry
// archival is reconcile/GC only.
const sqlArchiveHelp = `
		UPDATE page_help
		   SET soft_archived = TRUE,
		       updated_at = NOW(),
		       updated_by_user_id = $1
		 WHERE addressable_id = $2
		   AND locale = $3
		   AND soft_archived = FALSE
	`

// sqlUpdateHelpable flips the per-row helpable bit on an addressable
// so gadmin can hide the help icon on a specific element without code
// changes.
const sqlUpdateHelpable = `
		UPDATE page_addressables
		   SET helpable = $1,
		       updated_at = NOW()
		 WHERE id = $2
		   AND soft_archived = FALSE
	`

// ── upsertAddressable internal helper (paired by parent_id branch) ──────────

// sqlSelectAddressableSiblingRootForUpdate is the existence-check used
// by upsertAddressable for the parent_id-NULL branch (root nodes).
// FOR UPDATE locks the row inside the reconcile tx so concurrent
// reconcilers don't race the same address.
const sqlSelectAddressableSiblingRootForUpdate = `
		SELECT id, source FROM page_addressables
		 WHERE page_route = $1 AND parent_id IS NULL AND kind = $2 AND name = $3 AND soft_archived = FALSE
		 FOR UPDATE
	`

// sqlSelectAddressableSiblingChildForUpdate is the existence-check used
// by upsertAddressable for the parent_id-bound branch. Same shape and
// lock semantics as the root variant.
const sqlSelectAddressableSiblingChildForUpdate = `
		SELECT id, source FROM page_addressables
		 WHERE parent_id = $1 AND kind = $2 AND name = $3 AND soft_archived = FALSE
		 FOR UPDATE
	`

// sqlTouchAddressableLastSeen refreshes last_seen_at on a known live row.
// Called inside the upsert tx when the existence check found an
// existing row.
const sqlTouchAddressableLastSeen = `UPDATE page_addressables SET last_seen_at = NOW() WHERE id = $1`

// sqlInsertAddressable creates a new page_addressables row stamped with
// last_seen_at = NOW(). Returns the new id.
const sqlInsertAddressable = `
		INSERT INTO page_addressables
		    (parent_id, kind, name, address, page_route, source, custom_app_id, last_seen_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		RETURNING id
	`

// ── archiveDroppedBuildRows internal helper ────────────────────────────────

// sqlListLiveBuildAddressableIDs returns every live build-source row id
// on a page route. Caller compares against the keepIDs set to compute
// the to-archive list.
const sqlListLiveBuildAddressableIDs = `
		SELECT id FROM page_addressables
		 WHERE page_route = $1 AND source = 'build' AND soft_archived = FALSE
	`

// sqlSoftArchiveAddressablesByID soft-archives a batch of addressables
// in one round-trip. No-op when the array is empty (pg's ANY() handles
// it cleanly).
const sqlSoftArchiveAddressablesByID = `UPDATE page_addressables SET soft_archived = TRUE WHERE id = ANY($1)`

// ── lookup helpers ─────────────────────────────────────────────────────────

// sqlSelectAddressableByRouteAndAddressWithHelpable returns id + helpable
// for a (page_route, address) pair. Used by lookupRowByAddress; the help
// handler needs the helpable flag to decide whether to render the icon.
const sqlSelectAddressableByRouteAndAddressWithHelpable = `
		SELECT id, helpable FROM page_addressables
		 WHERE page_route = $1 AND address = $2 AND soft_archived = FALSE
		 LIMIT 1
	`

// sqlExistsLiveAddressable reports whether a row is live for an id.
// Used to distinguish 404 (no addressable) from 200 with empty body
// (addressable known, no help authored).
const sqlExistsLiveAddressable = `
		SELECT EXISTS(
			SELECT 1 FROM page_addressables
			 WHERE id = $1 AND soft_archived = FALSE
		)
	`

// ── peekSibling internal helper (paired by parent_id branch) ───────────────

// sqlSelectAddressableSiblingRootSourceID returns the source + id of a
// live root sibling matching (page_route, kind, name). Used by
// RegisterFromRuntime to decide whether to refuse a custom_app over a
// build row.
const sqlSelectAddressableSiblingRootSourceID = `
		SELECT source, id FROM page_addressables
		 WHERE page_route = $1 AND parent_id IS NULL AND kind = $2 AND name = $3 AND soft_archived = FALSE
		 LIMIT 1
	`

// sqlSelectAddressableSiblingChildSourceID returns the source + id of a
// live child sibling matching (parent_id, kind, name).
const sqlSelectAddressableSiblingChildSourceID = `
		SELECT source, id FROM page_addressables
		 WHERE parent_id = $1 AND kind = $2 AND name = $3 AND soft_archived = FALSE
		 LIMIT 1
	`

// ── touchLastSeen internal helper (paired by parent_id branch) ─────────────

// sqlTouchAddressableSiblingRootLastSeen refreshes last_seen_at on a
// live root sibling (parent_id IS NULL) matching the (route, kind,
// name) triple.
const sqlTouchAddressableSiblingRootLastSeen = `
		UPDATE page_addressables SET last_seen_at = NOW()
		 WHERE page_route = $1 AND parent_id IS NULL AND kind = $2 AND name = $3 AND soft_archived = FALSE
	`

// sqlTouchAddressableSiblingChildLastSeen refreshes last_seen_at on a
// live child sibling matching (parent_id, kind, name).
const sqlTouchAddressableSiblingChildLastSeen = `
		UPDATE page_addressables SET last_seen_at = NOW()
		 WHERE parent_id = $1 AND kind = $2 AND name = $3 AND soft_archived = FALSE
	`

// ── lookupID (parent-address resolution in tx) ─────────────────────────────

// sqlSelectAddressableIDByRouteAndAddress returns the id for a
// (page_route, address) pair. Used by the in-tx parent-address resolver
// in RegisterFromRuntime. (lookupRowByAddress above also takes
// helpable; lookupID is id-only.)
const sqlSelectAddressableIDByRouteAndAddress = `
		SELECT id FROM page_addressables
		 WHERE page_route = $1 AND address = $2 AND soft_archived = FALSE
		 LIMIT 1
	`

// ── library defaults seed (seedLibraryDefault) ─────────────────────────────

// sqlSelectLibraryHelpDefault returns the longest-matching
// library_help_defaults row for (kind, name, locale='en'). Prefers an
// exact name_pattern match over the '*' wildcard via the ORDER BY.
const sqlSelectLibraryHelpDefault = `
		SELECT id, title, body_html, video_embeds, image_urls
		  FROM library_help_defaults
		 WHERE kind = $1 AND locale = 'en' AND name_pattern IN ($2, '*')
		 ORDER BY (name_pattern = $2) DESC
		 LIMIT 1
	`

// sqlInsertHelpPlaceholder seeds a placeholder page_help row when no
// library default matches. seeded_from='placeholder' so the gadmin
// editor can spot un-authored copy. ON CONFLICT DO NOTHING — re-seeding
// after a gadmin edit preserves the edit.
const sqlInsertHelpPlaceholder = `
		INSERT INTO page_help (addressable_id, locale, title, body_html, video_embeds, image_urls, seeded_from, library_ref, updated_by_user_id)
		VALUES ($1, 'en', NULL, $2, '[]'::jsonb, '[]'::jsonb, 'placeholder', NULL, NULL)
		ON CONFLICT (addressable_id, locale) WHERE soft_archived = FALSE DO NOTHING
	`

// sqlInsertHelpFromLibrary seeds a library-default page_help row when
// a matching library_help_defaults row was found. seeded_from='library'
// + library_ref points at the source row so the editor can render the
// "library default" badge. ON CONFLICT DO NOTHING preserves gadmin edits.
const sqlInsertHelpFromLibrary = `
		INSERT INTO page_help (addressable_id, locale, title, body_html, video_embeds, image_urls, seeded_from, library_ref)
		VALUES ($1, 'en', $2, $3, $4, $5, 'library', $6)
		ON CONFLICT (addressable_id, locale) WHERE soft_archived = FALSE DO NOTHING
	`
