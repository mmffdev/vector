// Package addressables SQL constants.
//
// PLA-0048 / RF1.2.6 (consts) + RF1.4.2.pages (column-prefix rule,
// migration 182). Sole writer for pages_addressables and pages_help.
package addressables

const sqlSnapshotPageAddressables = `
		SELECT pages_addressables_id,
		       pages_addressables_id_parent,
		       pages_addressables_kind,
		       pages_addressables_name,
		       pages_addressables_address,
		       pages_addressables_page_route,
		       pages_addressables_source,
		       pages_addressables_id_custom_app,
		       pages_addressables_soft_archived,
		       pages_addressables_helpable
		  FROM pages_addressables
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_soft_archived = FALSE
		 ORDER BY pages_addressables_address
	`

const sqlSelectHelpForAddressableLocale = `
		SELECT pages_help_title,
		       pages_help_body_html,
		       pages_help_video_embeds,
		       pages_help_image_urls
		  FROM pages_help
		 WHERE pages_help_id_pages_addressable = $1
		   AND pages_help_locale = $2
		   AND pages_help_soft_archived = FALSE
		 LIMIT 1
	`

const sqlAdminListHelp = `
		SELECT
		    h.pages_help_id,
		    h.pages_help_id_pages_addressable,
		    a.pages_addressables_address,
		    a.pages_addressables_page_route,
		    a.pages_addressables_kind,
		    a.pages_addressables_name,
		    h.pages_help_locale,
		    h.pages_help_title,
		    h.pages_help_body_html,
		    h.pages_help_video_embeds,
		    h.pages_help_image_urls,
		    h.pages_help_seeded_from,
		    (h.pages_help_seeded_from = 'library' AND h.pages_help_id_user_updater IS NULL) AS is_library_default,
		    h.pages_help_updated_at,
		    u.email,
		    a.pages_addressables_helpable
		  FROM pages_help h
		  JOIN pages_addressables a
		    ON a.pages_addressables_id = h.pages_help_id_pages_addressable
		  LEFT JOIN users u ON u.id = h.pages_help_id_user_updater
		 WHERE h.pages_help_soft_archived = FALSE
		   AND a.pages_addressables_soft_archived = FALSE
		 ORDER BY a.pages_addressables_page_route,
		          a.pages_addressables_address,
		          h.pages_help_locale
	`

const sqlUpdateHelp = `
		UPDATE pages_help
		   SET pages_help_title = $1,
		       pages_help_body_html = $2,
		       pages_help_video_embeds = $3,
		       pages_help_image_urls = $4,
		       pages_help_updated_at = NOW(),
		       pages_help_id_user_updater = $5,
		       pages_help_seeded_from = 'manual',
		       pages_help_id_library_help_default = NULL
		 WHERE pages_help_id_pages_addressable = $6
		   AND pages_help_locale = $7
		   AND pages_help_soft_archived = FALSE
	`

const sqlArchiveHelp = `
		UPDATE pages_help
		   SET pages_help_soft_archived = TRUE,
		       pages_help_updated_at = NOW(),
		       pages_help_id_user_updater = $1
		 WHERE pages_help_id_pages_addressable = $2
		   AND pages_help_locale = $3
		   AND pages_help_soft_archived = FALSE
	`

const sqlUpdateHelpable = `
		UPDATE pages_addressables
		   SET pages_addressables_helpable = $1,
		       pages_addressables_updated_at = NOW()
		 WHERE pages_addressables_id = $2
		   AND pages_addressables_soft_archived = FALSE
	`

const sqlSelectAddressableSiblingRootForUpdate = `
		SELECT pages_addressables_id, pages_addressables_source
		  FROM pages_addressables
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_id_parent IS NULL
		   AND pages_addressables_kind = $2
		   AND pages_addressables_name = $3
		   AND pages_addressables_soft_archived = FALSE
		 FOR UPDATE
	`

const sqlSelectAddressableSiblingChildForUpdate = `
		SELECT pages_addressables_id, pages_addressables_source
		  FROM pages_addressables
		 WHERE pages_addressables_id_parent = $1
		   AND pages_addressables_kind = $2
		   AND pages_addressables_name = $3
		   AND pages_addressables_soft_archived = FALSE
		 FOR UPDATE
	`

const sqlTouchAddressableLastSeen = `
		UPDATE pages_addressables
		   SET pages_addressables_last_seen_at = NOW()
		 WHERE pages_addressables_id = $1
	`

const sqlInsertAddressable = `
		INSERT INTO pages_addressables (
		    pages_addressables_id_parent,
		    pages_addressables_kind,
		    pages_addressables_name,
		    pages_addressables_address,
		    pages_addressables_page_route,
		    pages_addressables_source,
		    pages_addressables_id_custom_app,
		    pages_addressables_last_seen_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		RETURNING pages_addressables_id
	`

const sqlListLiveBuildAddressableIDs = `
		SELECT pages_addressables_id
		  FROM pages_addressables
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_source = 'build'
		   AND pages_addressables_soft_archived = FALSE
	`

const sqlSoftArchiveAddressablesByID = `
		UPDATE pages_addressables
		   SET pages_addressables_soft_archived = TRUE
		 WHERE pages_addressables_id = ANY($1)
	`

const sqlSelectAddressableByRouteAndAddressWithHelpable = `
		SELECT pages_addressables_id, pages_addressables_helpable
		  FROM pages_addressables
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_address = $2
		   AND pages_addressables_soft_archived = FALSE
		 LIMIT 1
	`

const sqlExistsLiveAddressable = `
		SELECT EXISTS(
		    SELECT 1 FROM pages_addressables
		     WHERE pages_addressables_id = $1
		       AND pages_addressables_soft_archived = FALSE
		)
	`

const sqlSelectAddressableSiblingRootSourceID = `
		SELECT pages_addressables_source, pages_addressables_id
		  FROM pages_addressables
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_id_parent IS NULL
		   AND pages_addressables_kind = $2
		   AND pages_addressables_name = $3
		   AND pages_addressables_soft_archived = FALSE
		 LIMIT 1
	`

const sqlSelectAddressableSiblingChildSourceID = `
		SELECT pages_addressables_source, pages_addressables_id
		  FROM pages_addressables
		 WHERE pages_addressables_id_parent = $1
		   AND pages_addressables_kind = $2
		   AND pages_addressables_name = $3
		   AND pages_addressables_soft_archived = FALSE
		 LIMIT 1
	`

const sqlTouchAddressableSiblingRootLastSeen = `
		UPDATE pages_addressables
		   SET pages_addressables_last_seen_at = NOW()
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_id_parent IS NULL
		   AND pages_addressables_kind = $2
		   AND pages_addressables_name = $3
		   AND pages_addressables_soft_archived = FALSE
	`

const sqlTouchAddressableSiblingChildLastSeen = `
		UPDATE pages_addressables
		   SET pages_addressables_last_seen_at = NOW()
		 WHERE pages_addressables_id_parent = $1
		   AND pages_addressables_kind = $2
		   AND pages_addressables_name = $3
		   AND pages_addressables_soft_archived = FALSE
	`

const sqlSelectAddressableIDByRouteAndAddress = `
		SELECT pages_addressables_id
		  FROM pages_addressables
		 WHERE pages_addressables_page_route = $1
		   AND pages_addressables_address = $2
		   AND pages_addressables_soft_archived = FALSE
		 LIMIT 1
	`

const sqlSelectLibraryHelpDefault = `
		SELECT id, title, body_html, video_embeds, image_urls
		  FROM library_help_defaults
		 WHERE kind = $1 AND locale = 'en' AND name_pattern IN ($2, '*')
		 ORDER BY (name_pattern = $2) DESC
		 LIMIT 1
	`

const sqlInsertHelpPlaceholder = `
		INSERT INTO pages_help (
		    pages_help_id_pages_addressable,
		    pages_help_locale,
		    pages_help_title,
		    pages_help_body_html,
		    pages_help_video_embeds,
		    pages_help_image_urls,
		    pages_help_seeded_from,
		    pages_help_id_library_help_default,
		    pages_help_id_user_updater
		) VALUES ($1, 'en', NULL, $2, '[]'::jsonb, '[]'::jsonb, 'placeholder', NULL, NULL)
		ON CONFLICT (pages_help_id_pages_addressable, pages_help_locale)
		    WHERE pages_help_soft_archived = FALSE DO NOTHING
	`

const sqlInsertHelpFromLibrary = `
		INSERT INTO pages_help (
		    pages_help_id_pages_addressable,
		    pages_help_locale,
		    pages_help_title,
		    pages_help_body_html,
		    pages_help_video_embeds,
		    pages_help_image_urls,
		    pages_help_seeded_from,
		    pages_help_id_library_help_default
		) VALUES ($1, 'en', $2, $3, $4, $5, 'library', $6)
		ON CONFLICT (pages_help_id_pages_addressable, pages_help_locale)
		    WHERE pages_help_soft_archived = FALSE DO NOTHING
	`
