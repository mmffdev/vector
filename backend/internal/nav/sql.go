// Package nav SQL constants.
//
// PLA-0048 / RF1.2.7. Every SQL string literal used by the nav package
// lives here as a named constant. bookmarks.go / entities.go /
// profiles.go / registry.go / service.go reference these constants;
// they DO NOT embed raw SQL.
//
// Naming: sqlVerbResource — sqlListUserPrefs, sqlInsertCustomGroup, etc.
// Templates with `%s` placeholders (e.g. the parametric-table lookup
// in bookmarks.loadEntity) carry the `Template` suffix.
//
// Lint contract: lint:sql-in-sqlfile-only fails the build if any
// non-sql.go file in this package contains raw SQL literals.
//
// Single DB: every read/write targets the mmff_vector pool (pages,
// page_tags, roles_pages, user_nav_*, page_entity_refs, portfolio,
// product, users).
package nav

// ── bookmarks.go ────────────────────────────────────────────────────────────

// sqlSelectEntityForBookmarkTemplate is the parameterised-by-table read
// used by Bookmarks.loadEntity. The `%s` placeholder is the table name —
// resolved from a hard-coded EntityKind switch, NEVER from user input,
// so substitution is safe. Returns name + subscription_id + archived_at
// (as text for nullable scan).
const sqlSelectEntityForBookmarkTemplate = `
		SELECT name, subscription_id, archived_at::text FROM %s WHERE id = $1
	`

// sqlPgAdvisoryXactLockForPin serialises concurrent Pin/Unpin calls for
// the same user inside the pin tx so the cap COUNT below sees all
// in-flight transactions. hashtextextended → bigint key; lock auto-
// releases at commit/rollback.
const sqlPgAdvisoryXactLockForPin = `
		SELECT pg_advisory_xact_lock(hashtextextended('nav-pin:'||$1::text, 0))
	`

// sqlCountUserEntityBookmarks counts existing entity bookmarks for a
// (user, subscription) — the cap probe before INSERTing a new pin.
// Filters by p.kind='entity' so the cap is independent of where the
// bookmark lands in tag groups (products → 'strategic', portfolios →
// 'bookmarks').
const sqlCountUserEntityBookmarks = `
		SELECT COUNT(*) FROM user_nav_prefs unp
		JOIN pages p ON p.key_enum = unp.item_key
		WHERE unp.user_id = $1 AND unp.subscription_id = $2 AND unp.profile_id IS NULL
		  AND p.kind = 'entity'
	`

// sqlUpsertSharedEntityPage get-or-creates the shared pages row backing
// an entity bookmark. The partial unique index
// pages_unique_key_shared_tenant covers (key_enum, subscription_id)
// WHERE created_by IS NULL, so concurrent Pin calls collapse onto one
// row instead of duplicating it.
const sqlUpsertSharedEntityPage = `
		INSERT INTO pages (key_enum, label, href, icon, tag_enum, kind,
		                   pinnable, default_pinned, default_order,
		                   created_by, subscription_id)
		VALUES ($1, $2, $3, $4, $5, 'entity', TRUE, FALSE, 0, NULL, $6)
		ON CONFLICT (key_enum, subscription_id) WHERE created_by IS NULL AND subscription_id IS NOT NULL DO UPDATE
		  SET label = EXCLUDED.label, updated_at = NOW()
		RETURNING id
	`

// sqlUpsertPageRoleGrant idempotently grants a role access to a page.
// Pin loops over the three role codes (user/padmin/gadmin) inside the
// pin tx; ON CONFLICT lets the second/third call be a quiet no-op.
const sqlUpsertPageRoleGrant = `
		INSERT INTO roles_pages (page_id, role) VALUES ($1, $2)
		ON CONFLICT (page_id, role) DO NOTHING
	`

// sqlNextUserNavPrefPosition returns the next free position for a
// user's pinned list (max(position) + 1 or 0 when empty). Profile-NULL
// scope (the legacy/Default lane) — Pin only touches that lane today.
const sqlNextUserNavPrefPosition = `
		SELECT COALESCE(MAX(position) + 1, 0)
		FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id IS NULL
	`

// sqlInsertUserNavPrefBookmark inserts the user_nav_prefs row that
// makes a bookmark visible in the user's pinned list. ON CONFLICT DO
// NOTHING — a second pin for the same key is friendlier as a no-op
// than as an error. profile_id is NULL (Default/legacy lane).
const sqlInsertUserNavPrefBookmark = `
		INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
		VALUES ($1, $2, NULL, $3, $4, FALSE)
		ON CONFLICT (user_id, subscription_id, profile_id, item_key) DO NOTHING
	`

// sqlSelectUserNavPrefPositionByKey reads the position of a specific
// bookmark in the user's pinned list. Used by Unpin so it can compact
// subsequent positions down by 1 in the same tx.
const sqlSelectUserNavPrefPositionByKey = `
		SELECT position FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id IS NULL AND item_key = $3
	`

// sqlDeleteUserNavPrefByKey removes one bookmark from the user's
// pinned list (profile-NULL lane). Compaction of trailing positions
// happens via sqlCompactUserNavPrefPositionsAbove.
const sqlDeleteUserNavPrefByKey = `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id IS NULL AND item_key = $3
	`

// sqlCompactUserNavPrefPositionsAbove shifts every position above the
// removed slot down by 1 so the user's pinned list stays contiguous
// 0..N-1. The unique index on (user, tenant, profile, position) is
// DEFERRABLE so the bulk shift commits without temp positions.
const sqlCompactUserNavPrefPositionsAbove = `
		UPDATE user_nav_prefs SET position = position - 1
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id IS NULL AND position > $3
	`

// sqlCountUserNavPrefByKey is the existence probe behind IsPinned —
// returns 0 or 1. COUNT(*) over the unique index is cheap.
const sqlCountUserNavPrefByKey = `
		SELECT COUNT(*) FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id IS NULL AND item_key = $3
	`

// ── entities.go ─────────────────────────────────────────────────────────────

// sqlListPortfoliosAndProductsInTenant unions the two entity tables
// for the /api/nav/entities surface. Used by EntitiesService.ListInTenant.
// No paging — demo volumes are tiny; revisit when crossing a few
// hundred rows.
const sqlListPortfoliosAndProductsInTenant = `
		SELECT 'portfolio' AS kind, id, name FROM portfolio
		 WHERE subscription_id = $1 AND archived_at IS NULL
		UNION ALL
		SELECT 'product' AS kind, id, name FROM product
		 WHERE subscription_id = $1 AND archived_at IS NULL
		ORDER BY kind, name
	`

// ── registry.go ─────────────────────────────────────────────────────────────

// sqlListPageTags returns the page_tags catalogue in default order.
// Used by LoadRegistry as the first hop before joining pages.
const sqlListPageTags = `
		SELECT tag_enum, display_name, default_order, is_admin_menu
		FROM page_tags
		ORDER BY default_order
	`

// sqlListSystemPagesWithRoles returns every system-scoped or
// tenant-scoped-entity page with its aggregated role list. The aggregate
// avoids N+1 against roles_pages. WHERE clause covers two catalogue
// shapes: system pages (created_by IS NULL AND subscription_id IS NULL)
// and tenant-scoped entity bookmarks (kind='entity').
const sqlListSystemPagesWithRoles = `
		SELECT p.key_enum, p.label, p.href, p.icon, p.tag_enum, p.kind,
		       p.pinnable, p.default_pinned, p.default_order, p.subscription_id,
		       COALESCE(array_agg(pr.role::text ORDER BY pr.role) FILTER (WHERE pr.role IS NOT NULL), '{}') AS roles
		FROM pages p
		LEFT JOIN roles_pages pr ON pr.page_id = p.id
		WHERE p.created_by IS NULL
		  AND (p.subscription_id IS NULL OR p.kind = 'entity')
		GROUP BY p.id
		ORDER BY p.tag_enum, p.default_order
	`

// ── profiles.go ─────────────────────────────────────────────────────────────

// sqlSelectProfileOwnedExists is the ownership probe behind
// RequireOwnedProfile. Returns 1 row when the profile exists, belongs
// to the user, and lives in the named subscription.
const sqlSelectProfileOwnedExists = `
		SELECT 1
		  FROM user_nav_profiles
		 WHERE id              = $1
		   AND user_id         = $2
		   AND subscription_id = $3
	`

// sqlListUserProfiles returns the user's nav profiles for a
// subscription, ordered by display position.
const sqlListUserProfiles = `
		SELECT id, label, position, is_default, start_page_key
		  FROM user_nav_profiles
		 WHERE user_id         = $1
		   AND subscription_id = $2
		 ORDER BY position, created_at, id
	`

// sqlCountUserProfiles is the cap probe before CreateProfile — used to
// enforce MaxProfilesPerSubscription.
const sqlCountUserProfiles = `
		SELECT COUNT(*)
		  FROM user_nav_profiles
		 WHERE user_id         = $1
		   AND subscription_id = $2
	`

// sqlInsertUserProfile creates a non-default profile at the named
// position with no start page. Default profiles are seeded by migration
// or EnsureDefaultProfile, never by this insert.
const sqlInsertUserProfile = `
		INSERT INTO user_nav_profiles
		    (user_id, subscription_id, label, position, is_default, start_page_key)
		VALUES ($1, $2, $3, $4, FALSE, NULL)
		RETURNING id, label, position, is_default, start_page_key
	`

// sqlSeedNewProfilePrefsFromDefault clones user_nav_prefs rows from the
// caller's Default profile into the freshly-created profile so a new
// profile inherits the user's current pinned/admin-group state instead
// of reading empty.
const sqlSeedNewProfilePrefsFromDefault = `
		INSERT INTO user_nav_prefs
		    (user_id, subscription_id, profile_id, item_key, position,
		     is_start_page, parent_item_key, group_id, icon_override)
		SELECT
		    src.user_id, src.subscription_id, $3,
		    src.item_key, src.position,
		    FALSE, src.parent_item_key, src.group_id, src.icon_override
		FROM user_nav_prefs src
		JOIN user_nav_profiles dp
		    ON dp.user_id = src.user_id
		   AND dp.subscription_id = src.subscription_id
		   AND dp.is_default = TRUE
		WHERE src.user_id = $1
		  AND src.subscription_id = $2
		  AND src.profile_id = dp.id
	`

// sqlSeedNewProfileGroupsFromDefault clones user_nav_profile_groups
// placements from the caller's Default profile so the rail/flyout
// section ordering carries over to the new profile.
const sqlSeedNewProfileGroupsFromDefault = `
		INSERT INTO user_nav_profile_groups
		    (profile_id, group_id, tag_enum, position, icon_override)
		SELECT
		    $3, src.group_id, src.tag_enum, src.position, src.icon_override
		FROM user_nav_profile_groups src
		JOIN user_nav_profiles dp
		    ON dp.id = src.profile_id
		   AND dp.is_default = TRUE
		WHERE dp.user_id = $1
		  AND dp.subscription_id = $2
	`

// sqlRenameUserProfile rewrites a profile's label. Ownership is folded
// into the WHERE clause so we never read a row owned by another user.
const sqlRenameUserProfile = `
		UPDATE user_nav_profiles
		   SET label = $1, updated_at = NOW()
		 WHERE id              = $2
		   AND user_id         = $3
		   AND subscription_id = $4
	`

// sqlSelectProfileIsDefault probes is_default on a profile owned by
// (user, subscription). Used by DeleteProfile to reject Default
// without leaking existence.
const sqlSelectProfileIsDefault = `
		SELECT is_default
		  FROM user_nav_profiles
		 WHERE id              = $1
		   AND user_id         = $2
		   AND subscription_id = $3
	`

// sqlDeleteNonDefaultProfile removes a non-default profile. The
// is_default=FALSE guard belt-and-braces the Default-protect check that
// already ran in Go.
const sqlDeleteNonDefaultProfile = `
		DELETE FROM user_nav_profiles
		 WHERE id              = $1
		   AND user_id         = $2
		   AND subscription_id = $3
		   AND is_default      = FALSE
	`

// sqlListUserProfileIDs returns just the ids of a user's profiles in a
// subscription — used by ReorderProfiles to validate the supplied order
// against the actual set.
const sqlListUserProfileIDs = `
		SELECT id
		  FROM user_nav_profiles
		 WHERE user_id         = $1
		   AND subscription_id = $2
	`

// sqlUpdateProfilePosition rewrites one profile's position +
// updated_at. ReorderProfiles loops over this inside a tx; the unique
// (user, subscription, position) index is DEFERRABLE so the swap is
// commit-safe in any order.
const sqlUpdateProfilePosition = `
		UPDATE user_nav_profiles
		   SET position = $1, updated_at = NOW()
		 WHERE id = $2
	`

// sqlSelectProfileOwnerAndSubscription reads owner + subscription for a
// profile id without any ownership filter. Used by SetActiveProfile so
// we can distinguish "not yours" from "wrong subscription" (the latter
// gets a clearer signal because the hot-desk caller may already know
// the id exists in a sibling subscription).
const sqlSelectProfileOwnerAndSubscription = `
		SELECT user_id, subscription_id
		  FROM user_nav_profiles
		 WHERE id = $1
	`

// sqlUpdateUserActiveProfile pins users.active_nav_profile_id to the
// named profile. SetActiveProfile has already verified ownership +
// subscription via sqlSelectProfileOwnerAndSubscription.
const sqlUpdateUserActiveProfile = `
		UPDATE users
		   SET active_nav_profile_id = $1
		 WHERE id = $2
	`

// sqlSelectActiveProfileScoped returns users.active_nav_profile_id ONLY
// when the active profile is owned by this user under this
// subscription. Otherwise the row scan misses and the caller falls
// back to Default.
const sqlSelectActiveProfileScoped = `
		SELECT p.id
		  FROM users u
		  JOIN user_nav_profiles p ON p.id = u.active_nav_profile_id
		 WHERE u.id = $1
		   AND p.user_id = $1
		   AND p.subscription_id = $2
	`

// sqlSelectDefaultProfileID returns the Default profile id for a
// (user, subscription). pgx.ErrNoRows triggers the lazy-seed branch in
// EnsureDefaultProfile.
const sqlSelectDefaultProfileID = `
		SELECT id
		  FROM user_nav_profiles
		 WHERE user_id         = $1
		   AND subscription_id = $2
		   AND is_default      = TRUE
	`

// sqlEnsureDefaultProfile lazy-seeds the Default profile for a
// (user, subscription). The partial unique index
// uq_user_nav_profiles_default_per_user makes the upsert race-safe —
// two concurrent first-reads both land on the same row.
const sqlEnsureDefaultProfile = `
		INSERT INTO user_nav_profiles
		    (user_id, subscription_id, label, position, is_default, start_page_key)
		VALUES ($1, $2, 'Default', 0, TRUE, NULL)
		ON CONFLICT (user_id, subscription_id) WHERE is_default = TRUE
		DO UPDATE SET updated_at = user_nav_profiles.updated_at
		RETURNING id
	`

// sqlSelectActiveOrDefaultProfile resolves the (active, default) pair
// in one round-trip so ResolveProfile never observes a partial state
// between writes.
const sqlSelectActiveOrDefaultProfile = `
		SELECT
		    (SELECT id FROM user_nav_profiles
		      WHERE user_id = $1 AND subscription_id = $2 AND id =
		            (SELECT active_nav_profile_id FROM users WHERE id = $1)) AS active_id,
		    (SELECT id FROM user_nav_profiles
		      WHERE user_id = $1 AND subscription_id = $2 AND is_default = TRUE) AS default_id
	`

// sqlListProfileGroupPlacements returns per-profile group placements
// in display order. Each row sets exactly one of group_id or tag_enum.
const sqlListProfileGroupPlacements = `
		SELECT group_id, tag_enum, position, icon_override
		  FROM user_nav_profile_groups
		 WHERE profile_id = $1
		 ORDER BY position
	`

// sqlCountOwnedNavGroupsByIDs counts how many of the supplied group ids
// are actually owned by the user. Used in SetProfileGroups to refuse a
// payload that references a group the user doesn't own.
const sqlCountOwnedNavGroupsByIDs = `
		SELECT COUNT(*) FROM user_nav_groups
		 WHERE user_id = $1 AND id = ANY($2)
	`

// sqlCountKnownTagEnums counts how many of the supplied tag_enum values
// actually exist in page_tags. Used in SetProfileGroups to reject
// unknown tags from a placement payload.
const sqlCountKnownTagEnums = `
		SELECT COUNT(*) FROM page_tags
		 WHERE tag_enum = ANY($1)
	`

// sqlDeleteProfileGroupPlacements wipes per-profile placements for one
// profile. Step 1 of SetProfileGroups's atomic replace.
const sqlDeleteProfileGroupPlacements = `
		DELETE FROM user_nav_profile_groups WHERE profile_id = $1
	`

// sqlInsertProfileGroupPlacement inserts one placement row. Step 2 of
// SetProfileGroups runs this in a pgx.Batch so all placements land in
// one round-trip. The position unique constraint is DEFERRABLE so any
// order is fine inside the tx.
const sqlInsertProfileGroupPlacement = `
		INSERT INTO user_nav_profile_groups (profile_id, group_id, tag_enum, position, icon_override)
		VALUES ($1, $2, $3, $4, $5)
	`

// ── service.go ──────────────────────────────────────────────────────────────

// sqlSeedNonDefaultPrefsFromDefaultOnFirstRead clones user_nav_prefs
// from the user's Default profile when this non-default profile reads
// empty for the first time. Covers profiles created before
// CreateProfile started cloning, plus any profile whose prefs were
// wiped externally.
const sqlSeedNonDefaultPrefsFromDefaultOnFirstRead = `
		WITH this_profile AS (
			SELECT id FROM user_nav_profiles
			WHERE id = $3 AND is_default = FALSE
		),
		is_empty AS (
			SELECT 1 FROM this_profile
			WHERE NOT EXISTS (
				SELECT 1 FROM user_nav_prefs
				WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3
			)
		),
		default_profile AS (
			SELECT id FROM user_nav_profiles
			WHERE user_id = $1 AND subscription_id = $2 AND is_default = TRUE
		)
		INSERT INTO user_nav_prefs (
			user_id, subscription_id, profile_id, item_key, position,
			is_start_page, parent_item_key, group_id, icon_override
		)
		SELECT
			src.user_id, src.subscription_id, $3, src.item_key, src.position,
			FALSE, src.parent_item_key, src.group_id, src.icon_override
		FROM user_nav_prefs src
		JOIN default_profile dp ON dp.id = src.profile_id
		WHERE EXISTS (SELECT 1 FROM is_empty)
		ON CONFLICT DO NOTHING
	`

// sqlSeedNonDefaultGroupPlacementsFromDefaultOnFirstRead clones
// user_nav_profile_groups placements from Default for a non-default
// profile that has none. WHERE NOT EXISTS rather than ON CONFLICT
// because the position unique constraint is deferrable and ON CONFLICT
// cannot use deferrable arbiters.
const sqlSeedNonDefaultGroupPlacementsFromDefaultOnFirstRead = `
		WITH default_profile AS (
			SELECT id FROM user_nav_profiles
			WHERE user_id = $2 AND subscription_id = $3 AND is_default = TRUE
		)
		INSERT INTO user_nav_profile_groups (profile_id, group_id, tag_enum, position, icon_override)
		SELECT $1, src.group_id, src.tag_enum, src.position, src.icon_override
		FROM user_nav_profile_groups src
		JOIN default_profile dp ON dp.id = src.profile_id
		WHERE NOT EXISTS (
			SELECT 1 FROM user_nav_profile_groups WHERE profile_id = $1
		)
		  AND NOT EXISTS (
			SELECT 1 FROM user_nav_profiles WHERE id = $1 AND is_default = TRUE
		)
	`

// sqlBackfillDefaultPinnedPages auto-pins any system page with
// default_pinned=TRUE that the user's role is allowed to see, when the
// user has no row for it on Default. One-time per (user, page, profile).
// Only fires for Default — custom profiles must explicitly choose what
// they show.
const sqlBackfillDefaultPinnedPages = `
		INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page)
		SELECT
			$1::uuid,
			$2::uuid,
			$4::uuid,
			p.key_enum,
			COALESCE(
				(SELECT MAX(unp.position) + 1
				 FROM user_nav_prefs unp
				 WHERE unp.user_id = $1::uuid
				   AND unp.subscription_id = $2::uuid
				   AND unp.profile_id = $4::uuid),
				0
			) + (ROW_NUMBER() OVER (ORDER BY p.default_order, p.key_enum) - 1),
			FALSE
		FROM pages p
		JOIN roles_pages pr ON pr.page_id = p.id
		JOIN user_nav_profiles d ON d.id = $4::uuid AND d.is_default = TRUE
		WHERE p.created_by IS NULL
		  AND p.subscription_id IS NULL
		  AND p.default_pinned = TRUE
		  AND p.pinnable = TRUE
		  AND pr.role = $3::user_role
		  AND NOT EXISTS (
			  SELECT 1 FROM user_nav_prefs unp
			  WHERE unp.user_id = $1::uuid
				AND unp.subscription_id = $2::uuid
				AND unp.profile_id = $4::uuid
				AND unp.item_key = p.key_enum
		  )
	`

// sqlLazySeedAdminNavGroups lazy-seeds the three admin nav groups
// (Workspace Admin, User Admin, Vector Admin) for Default if they're
// missing AND assigns group_id on existing prefs that landed without
// one. Self-healing after resets and for new users; idempotent so it
// can run on every Default read.
const sqlLazySeedAdminNavGroups = `
		WITH profile_check AS (
			SELECT id FROM user_nav_profiles WHERE id = $3 AND is_default = TRUE
		),
		existing AS (
			SELECT id, LOWER(label) AS lbl FROM user_nav_groups WHERE user_id = $1
		),
		seed AS (
			SELECT * FROM (VALUES
				('Workspace Admin', 0, 'cog',    ARRAY['ws-organisation','ws-workspaces','ws-portfolio-model','ws-artefact-types','ws-flow-states','ws-transition-rules','ws-custom-fields','ws-flow-states-v2']),
				('User Admin',      1, 'users',  ARRAY['user-management','um-permissions']),
				('Vector Admin',    2, 'shield', ARRAY['va-tenant-details','va-topology','va-topology-map','va-api-manager'])
			) AS t(label, pos, icon, pages)
			WHERE LOWER(t.label) NOT IN (SELECT lbl FROM existing)
		),
		inserted AS (
			INSERT INTO user_nav_groups (id, user_id, label, position, icon)
			SELECT gen_random_uuid(), $1, s.label, s.pos, s.icon FROM seed s, profile_check
			RETURNING id, LOWER(label) AS lbl
		),
		all_groups AS (
			SELECT id, lbl FROM inserted
			UNION ALL
			SELECT id, lbl FROM existing
		)
		UPDATE user_nav_prefs unp
		SET group_id = ag.id
		FROM all_groups ag
		JOIN (VALUES
			('workspace admin', ARRAY['ws-organisation','ws-workspaces','ws-portfolio-model','ws-artefact-types','ws-flow-states','ws-transition-rules','ws-custom-fields','ws-flow-states-v2']),
			('user admin',      ARRAY['user-management','um-permissions']),
			('vector admin',    ARRAY['va-tenant-details','va-topology','va-topology-map','va-api-manager'])
		) AS mapping(lbl, pages) ON mapping.lbl = ag.lbl
		WHERE unp.user_id = $1
		  AND unp.subscription_id = $2
		  AND unp.profile_id = $3
		  AND unp.item_key = ANY(mapping.pages)
		  AND unp.group_id IS NULL
	`

// sqlLazySeedDefaultProfileGroupPlacements seeds the Default profile's
// rail section order if it has none: tag buckets first (in
// default_order), then user_nav_groups (in their position).
const sqlLazySeedDefaultProfileGroupPlacements = `
		WITH profile_check AS (
			SELECT id FROM user_nav_profiles WHERE id = $1 AND is_default = TRUE
		),
		has_placements AS (
			SELECT 1 FROM user_nav_profile_groups WHERE profile_id = $1 LIMIT 1
		),
		combined AS (
			SELECT
				tag_enum::text AS tag_enum,
				NULL::uuid     AS group_id,
				ROW_NUMBER() OVER (ORDER BY default_order, tag_enum) - 1 AS pos
			FROM page_tags WHERE is_admin_menu = FALSE
			UNION ALL
			SELECT
				NULL,
				id,
				(SELECT COUNT(*) FROM page_tags WHERE is_admin_menu = FALSE) + position
			FROM user_nav_groups WHERE user_id = $2
		)
		INSERT INTO user_nav_profile_groups (profile_id, tag_enum, group_id, position)
		SELECT pc.id, c.tag_enum, c.group_id, c.pos
		FROM profile_check pc
		CROSS JOIN combined c
		WHERE NOT EXISTS (SELECT 1 FROM has_placements)
		ON CONFLICT DO NOTHING
	`

// sqlListUserNavPrefsForProfile returns the user_nav_prefs rows for one
// (user, subscription, profile) in display order.
const sqlListUserNavPrefsForProfile = `
		SELECT item_key, position, is_start_page, parent_item_key, group_id, icon_override
		FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3
		ORDER BY position
	`

// sqlListUserNavGroups returns the user's custom primary groups in
// user-defined order. user_nav_groups is per-user (shared across that
// user's profiles).
const sqlListUserNavGroups = `
		SELECT id, label, position, icon
		FROM user_nav_groups
		WHERE user_id = $1
		ORDER BY position
	`

// sqlSelectStartPageKeyForProfile returns the user's start_page item_key
// inside one profile. NULL/no-row both map to "no start page set" at
// the caller.
const sqlSelectStartPageKeyForProfile = `
		SELECT item_key FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3 AND is_start_page = TRUE
		LIMIT 1
	`

// sqlSelectProfileIsDefaultByID is the lean is_default-only probe used
// by ReplacePrefsForProfile and DeletePrefs. Different from
// sqlSelectProfileIsDefault above (which is ownership-scoped) — this
// variant is called only after ownership has already been established.
const sqlSelectProfileIsDefaultByID = `
		SELECT is_default FROM user_nav_profiles WHERE id = $1
	`

// sqlDeleteUserNavPrefsForProfile wipes user_nav_prefs for one profile.
// Used by both ReplacePrefsForProfile (step 1 of the atomic replace)
// and DeletePrefsForProfile.
const sqlDeleteUserNavPrefsForProfile = `
		DELETE FROM user_nav_prefs
		WHERE user_id = $1 AND subscription_id = $2 AND profile_id = $3
	`

// sqlDeleteUserNavGroupsForUser wipes the user's shared group pool.
// Only used when writing/resetting the Default profile — non-default
// profiles share the pool and cannot wipe it without clobbering
// siblings.
const sqlDeleteUserNavGroupsForUser = `DELETE FROM user_nav_groups WHERE user_id = $1`

// sqlUpsertUserNavGroup inserts or refreshes one custom group. The
// ON CONFLICT update makes re-sending an existing group's row
// idempotent (label/position/icon get refreshed, no PK clash). Queued
// inside a pgx.Batch from ReplacePrefsForProfile.
const sqlUpsertUserNavGroup = `
		INSERT INTO user_nav_groups (id, user_id, label, position, icon)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE
		SET label = EXCLUDED.label, position = EXCLUDED.position, icon = EXCLUDED.icon
	`

// sqlInsertUserNavPref inserts one user_nav_prefs row. Queued in a
// pgx.Batch from ReplacePrefsForProfile so the entire pinned list
// commits in one round-trip.
const sqlInsertUserNavPref = `
		INSERT INTO user_nav_prefs (user_id, subscription_id, profile_id, item_key, position, is_start_page, parent_item_key, group_id, icon_override)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
