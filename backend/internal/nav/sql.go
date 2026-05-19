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
// page_tags, users_roles_pages, user_nav_*, page_entity_refs, portfolio,
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
// $1=userID, $2=subscriptionID, $3=profileID
const sqlCountUserEntityBookmarks = `
		SELECT COUNT(*) FROM users_nav_prefs unp
		JOIN pages p ON p.key_enum = unp.users_nav_prefs_item_key
		WHERE unp.users_nav_prefs_id_user = $1 AND unp.users_nav_prefs_id_subscription = $2 AND unp.users_nav_prefs_id_profile = $3
		  AND unp.users_nav_prefs_is_bookmark = TRUE
		  AND p.kind = 'entity'
	`

// sqlSelectStaticPageForBookmark validates that a page key exists, is static
// and pinnable, and is visible to the caller's subscription.
const sqlSelectStaticPageForBookmark = `
		SELECT key_enum FROM pages
		WHERE key_enum = $1
		  AND kind = 'static'
		  AND pinnable = TRUE
		  AND (subscription_id IS NULL OR subscription_id = $2)
	`

// sqlCountUserStaticBookmarks counts static-kind user bookmarks for the cap check.
// $1=userID, $2=subscriptionID, $3=profileID
const sqlCountUserStaticBookmarks = `
		SELECT COUNT(*) FROM users_nav_prefs unp
		JOIN pages p ON p.key_enum = unp.users_nav_prefs_item_key
		WHERE unp.users_nav_prefs_id_user = $1 AND unp.users_nav_prefs_id_subscription = $2 AND unp.users_nav_prefs_id_profile = $3
		  AND unp.users_nav_prefs_is_bookmark = TRUE
		  AND p.kind = 'static'
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
// PLA-0049: keyed by (id_page, id_role) UUID after mig 195/196.
// $1 = page UUID, $2 = role UUID.
const sqlUpsertPageRoleGrant = `
		INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role) VALUES ($1, $2)
		ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING
	`

// sqlListSystemPagesForGrantsAdmin returns every system page (created_by
// IS NULL AND subscription_id IS NULL) with its tag bucket position so
// the admin grid can group / order rows the same way the rail does.
// PLA-0049: roles are now UUIDs, not enum strings. The aggregate folds
// users_roles_pages_id_role into a sorted UUID array so the grid can
// match cells against role columns without N+1.
const sqlListSystemPagesForGrantsAdmin = `
		SELECT p.id, p.key_enum, p.label, p.href, p.tag_enum, p.default_order,
		       COALESCE(t.pages_tags_display_name, p.tag_enum)        AS bucket_label,
		       COALESCE(t.pages_tags_default_order, 9999)             AS bucket_order,
		       COALESCE(array_agg(pr.users_roles_pages_id_role ORDER BY pr.users_roles_pages_id_role)
		                FILTER (WHERE pr.users_roles_pages_id_role IS NOT NULL), '{}'::uuid[]) AS role_ids
		FROM pages p
		LEFT JOIN pages_tags t ON t.pages_tags_tag_enum = p.tag_enum
		LEFT JOIN users_roles_pages pr ON pr.users_roles_pages_id_page = p.id
		WHERE p.created_by IS NULL
		  AND p.subscription_id IS NULL
		GROUP BY p.id, t.pages_tags_display_name, t.pages_tags_default_order
		ORDER BY bucket_order, bucket_label, p.default_order, p.label
	`

// sqlDeletePageRoleGrant revokes one (page, role) pair. PLA-0049:
// role identified by UUID ($2). The admin handler refuses the
// grp_global UUID and avatar-bucket page UUIDs (Phase 1 invariants).
const sqlDeletePageRoleGrant = `
		DELETE FROM users_roles_pages
		 WHERE users_roles_pages_id_page = $1
		   AND users_roles_pages_id_role = $2
	`

// sqlPageExistsForGrantsAdmin probes that a page id refers to a system
// page. Tenant-scoped entity bookmarks are NOT editable from the admin
// grid — only system pages are.
const sqlPageExistsForGrantsAdmin = `
		SELECT 1 FROM pages
		 WHERE id = $1
		   AND created_by      IS NULL
		   AND subscription_id IS NULL
	`

// sqlPageTagEnumByID returns the tag_enum bucket for a page. Used by
// the avatar-floor guard: any DELETE against a page whose tag_enum is
// 'avatar_menu' is refused (409 ResourceLocked) so every role keeps
// access to their personal-account pages.
const sqlPageTagEnumByID = `
		SELECT tag_enum FROM pages WHERE id = $1
	`

// sqlBatchGrantSystemPagesByBucket inserts (page_id, role_id) for
// every system page whose tag_enum matches $1 that does not already
// have a grant for $2. ON CONFLICT DO NOTHING makes the call
// idempotent so a partial state (some children granted, some not)
// converges to all-on in a single statement.
const sqlBatchGrantSystemPagesByBucket = `
		INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
		SELECT p.id, $2
		  FROM pages p
		 WHERE p.tag_enum        = $1
		   AND p.created_by      IS NULL
		   AND p.subscription_id IS NULL
		ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING
	`

// sqlBatchRevokeSystemPagesByBucket deletes every (page_id, role_id)
// row for system pages in the named bucket. Used by the bucket-row
// "all off" toggle. Avatar bucket is REFUSED at the handler layer
// before this query is reached.
const sqlBatchRevokeSystemPagesByBucket = `
		DELETE FROM users_roles_pages
		 WHERE users_roles_pages_id_role = $2
		   AND users_roles_pages_id_page IN (
		     SELECT id FROM pages
		      WHERE tag_enum        = $1
		        AND created_by      IS NULL
		        AND subscription_id IS NULL
		   )
	`


// sqlNextUserNavPrefPosition returns the next free position for a
// user's pinned list (max(position) + 1 or 0 when empty).
// $1=userID, $2=subscriptionID, $3=profileID
const sqlNextUserNavPrefPosition = `
		SELECT COALESCE(MAX(users_nav_prefs_position) + 1, 0)
		FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3
	`

// sqlInsertUserNavPrefBookmark inserts the users_nav_prefs row that
// makes a bookmark visible in the user's pinned list. ON CONFLICT DO
// NOTHING — a second pin for the same key is friendlier as a no-op
// than as an error. is_bookmark=TRUE distinguishes this from section entries.
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey, $5=position
const sqlInsertUserNavPrefBookmark = `
		INSERT INTO users_nav_prefs (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position, users_nav_prefs_is_start_page, users_nav_prefs_is_bookmark)
		VALUES ($1, $2, $3, $4, $5, FALSE, TRUE)
		ON CONFLICT (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key) DO UPDATE SET users_nav_prefs_is_bookmark = TRUE
	`

// sqlSelectUserNavPrefPositionByKey reads the position of a specific
// bookmark in the user's pinned list. Used by Unpin so it can compact
// subsequent positions down by 1 in the same tx.
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey
const sqlSelectUserNavPrefPositionByKey = `
		SELECT users_nav_prefs_position FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3 AND users_nav_prefs_item_key = $4
	`

// sqlDeleteUserNavPrefByKey removes one bookmark from the user's
// pinned list. Compaction of trailing positions happens via
// sqlCompactUserNavPrefPositionsAbove.
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey
const sqlDeleteUserNavPrefByKey = `
		DELETE FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3 AND users_nav_prefs_item_key = $4
	`

// sqlClearPageBookmarkFlag clears is_bookmark on a pref row without deleting
// it — the row may also be the user's section nav entry.
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey
const sqlClearPageBookmarkFlag = `
		UPDATE users_nav_prefs SET users_nav_prefs_is_bookmark = FALSE
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3 AND users_nav_prefs_item_key = $4
	`

// sqlCompactUserNavPrefPositionsAbove shifts every position above the
// removed slot down by 1 so the user's pinned list stays contiguous
// 0..N-1. The unique index on (user, tenant, profile, position) is
// DEFERRABLE so the bulk shift commits without temp positions.
// $1=userID, $2=subscriptionID, $3=profileID, $4=removedPosition
const sqlCompactUserNavPrefPositionsAbove = `
		UPDATE users_nav_prefs SET users_nav_prefs_position = users_nav_prefs_position - 1
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3 AND users_nav_prefs_position > $4
	`

// sqlCountUserNavPrefByKey is the existence probe behind IsPinned —
// returns 0 or 1. COUNT(*) over the unique index is cheap.
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey
const sqlCountUserNavPrefByKey = `
		SELECT COUNT(*) FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3 AND users_nav_prefs_item_key = $4
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
// pages_tags_env_only is TD-NAV-001: env restriction (NULL = visible everywhere).
const sqlListPageTags = `
		SELECT pages_tags_tag_enum,
		       pages_tags_display_name,
		       pages_tags_default_order,
		       pages_tags_is_admin_menu,
		       pages_tags_env_only
		FROM pages_tags
		ORDER BY pages_tags_default_order
	`

// sqlListSystemPagesWithRoles returns every system-scoped or
// tenant-scoped-entity page with its aggregated role list. The aggregate
// avoids N+1 against users_roles_pages. WHERE clause covers two catalogue
// shapes: system pages (created_by IS NULL AND subscription_id IS NULL)
// and tenant-scoped entity bookmarks (kind='entity').
// PLA-0049: role identifier is now a UUID (id_role), not the dropped
// user_role enum. Aggregate emits uuid[] which the registry scans
// straight into []uuid.UUID on CatalogEntry.Roles.
const sqlListSystemPagesWithRoles = `
		SELECT p.key_enum, p.label, p.href, p.icon, p.tag_enum, p.kind,
		       p.pinnable, p.default_pinned, p.default_order, p.subscription_id,
		       COALESCE(array_agg(pr.users_roles_pages_id_role ORDER BY pr.users_roles_pages_id_role) FILTER (WHERE pr.users_roles_pages_id_role IS NOT NULL), '{}'::uuid[]) AS role_ids
		FROM pages p
		LEFT JOIN users_roles_pages pr ON pr.users_roles_pages_id_page = p.id
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
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id              = $1
		   AND users_nav_profiles_id_user         = $2
		   AND users_nav_profiles_id_subscription = $3
	`

// sqlListUserProfiles returns the user's nav profiles for a
// subscription, ordered by display position.
const sqlListUserProfiles = `
		SELECT users_nav_profiles_id, users_nav_profiles_label, users_nav_profiles_position, users_nav_profiles_is_default, users_nav_profiles_start_page_key
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id_user         = $1
		   AND users_nav_profiles_id_subscription = $2
		 ORDER BY users_nav_profiles_position, users_nav_profiles_created_at, users_nav_profiles_id
	`

// sqlCountUserProfiles is the cap probe before CreateProfile — used to
// enforce MaxProfilesPerSubscription.
const sqlCountUserProfiles = `
		SELECT COUNT(*)
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id_user         = $1
		   AND users_nav_profiles_id_subscription = $2
	`

// sqlInsertUserProfile creates a non-default profile at the named
// position with no start page. Default profiles are seeded by migration
// or EnsureDefaultProfile, never by this insert.
const sqlInsertUserProfile = `
		INSERT INTO users_nav_profiles
		    (users_nav_profiles_id_user, users_nav_profiles_id_subscription, users_nav_profiles_label, users_nav_profiles_position, users_nav_profiles_is_default, users_nav_profiles_start_page_key)
		VALUES ($1, $2, $3, $4, FALSE, NULL)
		RETURNING users_nav_profiles_id, users_nav_profiles_label, users_nav_profiles_position, users_nav_profiles_is_default, users_nav_profiles_start_page_key
	`

// sqlSeedNewProfilePrefsFromDefault clones users_nav_prefs rows from the
// caller's Default profile into the freshly-created profile so a new
// profile inherits the user's current pinned/admin-group state instead
// of reading empty.
const sqlSeedNewProfilePrefsFromDefault = `
		INSERT INTO users_nav_prefs
		    (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position,
		     users_nav_prefs_is_start_page, users_nav_prefs_parent_item_key, users_nav_prefs_id_group, users_nav_prefs_icon_override)
		SELECT
		    src.users_nav_prefs_id_user, src.users_nav_prefs_id_subscription, $3,
		    src.users_nav_prefs_item_key, src.users_nav_prefs_position,
		    FALSE, src.users_nav_prefs_parent_item_key, src.users_nav_prefs_id_group, src.users_nav_prefs_icon_override
		FROM users_nav_prefs src
		JOIN users_nav_profiles dp
		    ON dp.users_nav_profiles_id_user = src.users_nav_prefs_id_user
		   AND dp.users_nav_profiles_id_subscription = src.users_nav_prefs_id_subscription
		   AND dp.users_nav_profiles_is_default = TRUE
		WHERE src.users_nav_prefs_id_user = $1
		  AND src.users_nav_prefs_id_subscription = $2
		  AND src.users_nav_prefs_id_profile = dp.users_nav_profiles_id
	`

// sqlSeedNewProfileGroupsFromDefault clones users_nav_profile_groups
// placements from the caller's Default profile so the rail/flyout
// section ordering carries over to the new profile.
const sqlSeedNewProfileGroupsFromDefault = `
		INSERT INTO users_nav_profile_groups
		    (users_nav_profile_groups_id_profile, users_nav_profile_groups_id_group, users_nav_profile_groups_tag_enum, users_nav_profile_groups_position, users_nav_profile_groups_icon_override)
		SELECT
		    $3, src.users_nav_profile_groups_id_group, src.users_nav_profile_groups_tag_enum, src.users_nav_profile_groups_position, src.users_nav_profile_groups_icon_override
		FROM users_nav_profile_groups src
		JOIN users_nav_profiles dp
		    ON dp.users_nav_profiles_id = src.users_nav_profile_groups_id_profile
		   AND dp.users_nav_profiles_is_default = TRUE
		WHERE dp.users_nav_profiles_id_user = $1
		  AND dp.users_nav_profiles_id_subscription = $2
	`

// sqlRenameUserProfile rewrites a profile's label. Ownership is folded
// into the WHERE clause so we never read a row owned by another user.
const sqlRenameUserProfile = `
		UPDATE users_nav_profiles
		   SET users_nav_profiles_label = $1, users_nav_profiles_updated_at = NOW()
		 WHERE users_nav_profiles_id              = $2
		   AND users_nav_profiles_id_user         = $3
		   AND users_nav_profiles_id_subscription = $4
	`

// sqlSelectProfileIsDefault probes is_default on a profile owned by
// (user, subscription). Used by DeleteProfile to reject Default
// without leaking existence.
const sqlSelectProfileIsDefault = `
		SELECT users_nav_profiles_is_default
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id              = $1
		   AND users_nav_profiles_id_user         = $2
		   AND users_nav_profiles_id_subscription = $3
	`

// sqlDeleteNonDefaultProfile removes a non-default profile. The
// is_default=FALSE guard belt-and-braces the Default-protect check that
// already ran in Go.
const sqlDeleteNonDefaultProfile = `
		DELETE FROM users_nav_profiles
		 WHERE users_nav_profiles_id              = $1
		   AND users_nav_profiles_id_user         = $2
		   AND users_nav_profiles_id_subscription = $3
		   AND users_nav_profiles_is_default      = FALSE
	`

// sqlListUserProfileIDs returns just the ids of a user's profiles in a
// subscription — used by ReorderProfiles to validate the supplied order
// against the actual set.
const sqlListUserProfileIDs = `
		SELECT users_nav_profiles_id
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id_user         = $1
		   AND users_nav_profiles_id_subscription = $2
	`

// sqlUpdateProfilePosition rewrites one profile's position +
// updated_at. ReorderProfiles loops over this inside a tx; the unique
// (user, subscription, position) index is DEFERRABLE so the swap is
// commit-safe in any order.
const sqlUpdateProfilePosition = `
		UPDATE users_nav_profiles
		   SET users_nav_profiles_position = $1, users_nav_profiles_updated_at = NOW()
		 WHERE users_nav_profiles_id = $2
	`

// sqlSelectProfileOwnerAndSubscription reads owner + subscription for a
// profile id without any ownership filter. Used by SetActiveProfile so
// we can distinguish "not yours" from "wrong subscription" (the latter
// gets a clearer signal because the hot-desk caller may already know
// the id exists in a sibling subscription).
const sqlSelectProfileOwnerAndSubscription = `
		SELECT users_nav_profiles_id_user, users_nav_profiles_id_subscription
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id = $1
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
		SELECT p.users_nav_profiles_id
		  FROM users u
		  JOIN users_nav_profiles p ON p.users_nav_profiles_id = u.active_nav_profile_id
		 WHERE u.id = $1
		   AND p.users_nav_profiles_id_user = $1
		   AND p.users_nav_profiles_id_subscription = $2
	`

// sqlSelectDefaultProfileID returns the Default profile id for a
// (user, subscription). pgx.ErrNoRows triggers the lazy-seed branch in
// EnsureDefaultProfile.
const sqlSelectDefaultProfileID = `
		SELECT users_nav_profiles_id
		  FROM users_nav_profiles
		 WHERE users_nav_profiles_id_user         = $1
		   AND users_nav_profiles_id_subscription = $2
		   AND users_nav_profiles_is_default      = TRUE
	`

// sqlEnsureDefaultProfile lazy-seeds the Default profile for a
// (user, subscription). The partial unique index
// uq_user_nav_profiles_default_per_user makes the upsert race-safe —
// two concurrent first-reads both land on the same row.
const sqlEnsureDefaultProfile = `
		INSERT INTO users_nav_profiles
		    (users_nav_profiles_id_user, users_nav_profiles_id_subscription, users_nav_profiles_label, users_nav_profiles_position, users_nav_profiles_is_default, users_nav_profiles_start_page_key)
		VALUES ($1, $2, 'Default', 0, TRUE, NULL)
		ON CONFLICT (users_nav_profiles_id_user, users_nav_profiles_id_subscription) WHERE users_nav_profiles_is_default = TRUE
		DO UPDATE SET users_nav_profiles_updated_at = users_nav_profiles.users_nav_profiles_updated_at
		RETURNING users_nav_profiles_id
	`

// sqlSelectActiveOrDefaultProfile resolves the (active, default) pair
// in one round-trip so ResolveProfile never observes a partial state
// between writes.
const sqlSelectActiveOrDefaultProfile = `
		SELECT
		    (SELECT users_nav_profiles_id FROM users_nav_profiles
		      WHERE users_nav_profiles_id_user = $1 AND users_nav_profiles_id_subscription = $2 AND users_nav_profiles_id =
		            (SELECT active_nav_profile_id FROM users WHERE id = $1)) AS active_id,
		    (SELECT users_nav_profiles_id FROM users_nav_profiles
		      WHERE users_nav_profiles_id_user = $1 AND users_nav_profiles_id_subscription = $2 AND users_nav_profiles_is_default = TRUE) AS default_id
	`

// sqlListProfileGroupPlacements returns per-profile group placements
// in display order. Each row sets exactly one of group_id or tag_enum.
const sqlListProfileGroupPlacements = `
		SELECT users_nav_profile_groups_id_group, users_nav_profile_groups_tag_enum, users_nav_profile_groups_position, users_nav_profile_groups_icon_override
		  FROM users_nav_profile_groups
		 WHERE users_nav_profile_groups_id_profile = $1
		 ORDER BY users_nav_profile_groups_position
	`

// sqlCountOwnedNavGroupsByIDs counts how many of the supplied group ids
// are actually owned by the user. Used in SetProfileGroups to refuse a
// payload that references a group the user doesn't own.
const sqlCountOwnedNavGroupsByIDs = `
		SELECT COUNT(*) FROM users_nav_groups
		 WHERE users_nav_groups_id_user = $1 AND users_nav_groups_id = ANY($2)
	`

// sqlCountKnownTagEnums counts how many of the supplied tag_enum values
// actually exist in page_tags. Used in SetProfileGroups to reject
// unknown tags from a placement payload.
const sqlCountKnownTagEnums = `
		SELECT COUNT(*) FROM pages_tags
		 WHERE pages_tags_tag_enum = ANY($1)
	`

// sqlDeleteProfileGroupPlacements wipes per-profile placements for one
// profile. Step 1 of SetProfileGroups's atomic replace.
const sqlDeleteProfileGroupPlacements = `
		DELETE FROM users_nav_profile_groups WHERE users_nav_profile_groups_id_profile = $1
	`

// sqlInsertProfileGroupPlacement inserts one placement row. Step 2 of
// SetProfileGroups runs this in a pgx.Batch so all placements land in
// one round-trip. The position unique constraint is DEFERRABLE so any
// order is fine inside the tx.
const sqlInsertProfileGroupPlacement = `
		INSERT INTO users_nav_profile_groups (users_nav_profile_groups_id_profile, users_nav_profile_groups_id_group, users_nav_profile_groups_tag_enum, users_nav_profile_groups_position, users_nav_profile_groups_icon_override)
		VALUES ($1, $2, $3, $4, $5)
	`

// ── service.go ──────────────────────────────────────────────────────────────

// sqlSeedNonDefaultPrefsFromDefaultOnFirstRead clones users_nav_prefs
// from the user's Default profile when this non-default profile reads
// empty for the first time. Covers profiles created before
// CreateProfile started cloning, plus any profile whose prefs were
// wiped externally.
const sqlSeedNonDefaultPrefsFromDefaultOnFirstRead = `
		WITH this_profile AS (
			SELECT users_nav_profiles_id FROM users_nav_profiles
			WHERE users_nav_profiles_id = $3 AND users_nav_profiles_is_default = FALSE
		),
		is_empty AS (
			SELECT 1 FROM this_profile
			WHERE NOT EXISTS (
				SELECT 1 FROM users_nav_prefs
				WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3
			)
		),
		default_profile AS (
			SELECT users_nav_profiles_id FROM users_nav_profiles
			WHERE users_nav_profiles_id_user = $1 AND users_nav_profiles_id_subscription = $2 AND users_nav_profiles_is_default = TRUE
		)
		INSERT INTO users_nav_prefs (
			users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position,
			users_nav_prefs_is_start_page, users_nav_prefs_parent_item_key, users_nav_prefs_id_group, users_nav_prefs_icon_override
		)
		SELECT
			src.users_nav_prefs_id_user, src.users_nav_prefs_id_subscription, $3, src.users_nav_prefs_item_key, src.users_nav_prefs_position,
			FALSE, src.users_nav_prefs_parent_item_key, src.users_nav_prefs_id_group, src.users_nav_prefs_icon_override
		FROM users_nav_prefs src
		JOIN default_profile dp ON dp.users_nav_profiles_id = src.users_nav_prefs_id_profile
		WHERE EXISTS (SELECT 1 FROM is_empty)
		ON CONFLICT DO NOTHING
	`

// sqlSeedNonDefaultGroupPlacementsFromDefaultOnFirstRead clones
// users_nav_profile_groups placements from Default for a non-default
// profile that has none. WHERE NOT EXISTS rather than ON CONFLICT
// because the position unique constraint is deferrable and ON CONFLICT
// cannot use deferrable arbiters.
const sqlSeedNonDefaultGroupPlacementsFromDefaultOnFirstRead = `
		WITH default_profile AS (
			SELECT users_nav_profiles_id FROM users_nav_profiles
			WHERE users_nav_profiles_id_user = $2 AND users_nav_profiles_id_subscription = $3 AND users_nav_profiles_is_default = TRUE
		)
		INSERT INTO users_nav_profile_groups (users_nav_profile_groups_id_profile, users_nav_profile_groups_id_group, users_nav_profile_groups_tag_enum, users_nav_profile_groups_position, users_nav_profile_groups_icon_override)
		SELECT $1, src.users_nav_profile_groups_id_group, src.users_nav_profile_groups_tag_enum, src.users_nav_profile_groups_position, src.users_nav_profile_groups_icon_override
		FROM users_nav_profile_groups src
		JOIN default_profile dp ON dp.users_nav_profiles_id = src.users_nav_profile_groups_id_profile
		WHERE NOT EXISTS (
			SELECT 1 FROM users_nav_profile_groups WHERE users_nav_profile_groups_id_profile = $1
		)
		  AND NOT EXISTS (
			SELECT 1 FROM users_nav_profiles WHERE users_nav_profiles_id = $1 AND users_nav_profiles_is_default = TRUE
		)
	`

// sqlBackfillDefaultPinnedPages auto-pins any system page with
// default_pinned=TRUE that the user's role is allowed to see, when the
// user has no row for it on Default. One-time per (user, page, profile).
// Only fires for Default — custom profiles must explicitly choose what
// they show. PLA-0049: $3 is the user's role UUID (not the legacy
// user_role enum).
const sqlBackfillDefaultPinnedPages = `
		INSERT INTO users_nav_prefs (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position, users_nav_prefs_is_start_page)
		SELECT
			$1::uuid,
			$2::uuid,
			$4::uuid,
			p.key_enum,
			COALESCE(
				(SELECT MAX(unp.users_nav_prefs_position) + 1
				 FROM users_nav_prefs unp
				 WHERE unp.users_nav_prefs_id_user = $1::uuid
				   AND unp.users_nav_prefs_id_subscription = $2::uuid
				   AND unp.users_nav_prefs_id_profile = $4::uuid),
				0
			) + (ROW_NUMBER() OVER (ORDER BY p.default_order, p.key_enum) - 1),
			FALSE
		FROM pages p
		JOIN users_roles_pages pr ON pr.users_roles_pages_id_page = p.id
		JOIN users_nav_profiles d ON d.users_nav_profiles_id = $4::uuid AND d.users_nav_profiles_is_default = TRUE
		WHERE p.created_by IS NULL
		  AND p.subscription_id IS NULL
		  AND p.default_pinned = TRUE
		  AND p.pinnable = TRUE
		  AND pr.users_roles_pages_id_role = $3::uuid
		  AND NOT EXISTS (
			  SELECT 1 FROM users_nav_prefs unp
			  WHERE unp.users_nav_prefs_id_user = $1::uuid
				AND unp.users_nav_prefs_id_subscription = $2::uuid
				AND unp.users_nav_prefs_id_profile = $4::uuid
				AND unp.users_nav_prefs_item_key = p.key_enum
		  )
	`

// sqlLazySeedDefaultProfileGroupPlacements seeds the Default profile's
// rail section order if it has none: tag buckets first (in
// default_order), then users_nav_groups (in their position).
//
// Uses WHERE NOT EXISTS rather than ON CONFLICT because the position
// unique constraint (uq_users_nav_profile_groups_unique_position) is
// DEFERRABLE INITIALLY DEFERRED, and Postgres forbids ON CONFLICT
// arbitrating on a deferrable constraint. Mirrors the sibling
// sqlSeedNonDefaultGroupPlacementsFromDefaultOnFirstRead query.
const sqlLazySeedDefaultProfileGroupPlacements = `
		WITH profile_check AS (
			SELECT users_nav_profiles_id AS id FROM users_nav_profiles WHERE users_nav_profiles_id = $1 AND users_nav_profiles_is_default = TRUE
		),
		has_placements AS (
			SELECT 1 FROM users_nav_profile_groups WHERE users_nav_profile_groups_id_profile = $1 LIMIT 1
		),
		combined AS (
			SELECT
				pages_tags_tag_enum::text AS tag_enum,
				NULL::uuid                AS group_id,
				ROW_NUMBER() OVER (ORDER BY pages_tags_default_order, pages_tags_tag_enum) - 1 AS pos
			FROM pages_tags WHERE pages_tags_is_admin_menu = FALSE
			UNION ALL
			SELECT
				NULL,
				users_nav_groups_id,
				(SELECT COUNT(*) FROM pages_tags WHERE pages_tags_is_admin_menu = FALSE) + users_nav_groups_position
			FROM users_nav_groups WHERE users_nav_groups_id_user = $2
		)
		INSERT INTO users_nav_profile_groups (users_nav_profile_groups_id_profile, users_nav_profile_groups_tag_enum, users_nav_profile_groups_id_group, users_nav_profile_groups_position)
		SELECT pc.id, c.tag_enum, c.group_id, c.pos
		FROM profile_check pc
		CROSS JOIN combined c
		WHERE NOT EXISTS (SELECT 1 FROM has_placements)
	`

// sqlListUserNavPrefsForProfile returns the users_nav_prefs rows for one
// (user, subscription, profile) in display order.
const sqlListUserNavPrefsForProfile = `
		SELECT users_nav_prefs_item_key, users_nav_prefs_position, users_nav_prefs_is_start_page, users_nav_prefs_is_bookmark, users_nav_prefs_parent_item_key, users_nav_prefs_id_group, users_nav_prefs_icon_override
		FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3
		ORDER BY users_nav_prefs_position
	`

// sqlListUserNavGroups returns the user's custom primary groups in
// user-defined order. users_nav_groups is per-user (shared across that
// user's profiles).
const sqlListUserNavGroups = `
		SELECT users_nav_groups_id, users_nav_groups_label, users_nav_groups_position, users_nav_groups_icon
		FROM users_nav_groups
		WHERE users_nav_groups_id_user = $1
		ORDER BY users_nav_groups_position
	`

// sqlSelectStartPageKeyForProfile returns the user's start_page item_key
// inside one profile. NULL/no-row both map to "no start page set" at
// the caller.
const sqlSelectStartPageKeyForProfile = `
		SELECT users_nav_prefs_item_key FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3 AND users_nav_prefs_is_start_page = TRUE
		LIMIT 1
	`

// sqlSelectProfileIsDefaultByID is the lean is_default-only probe used
// by ReplacePrefsForProfile and DeletePrefs. Different from
// sqlSelectProfileIsDefault above (which is ownership-scoped) — this
// variant is called only after ownership has already been established.
const sqlSelectProfileIsDefaultByID = `
		SELECT users_nav_profiles_is_default FROM users_nav_profiles WHERE users_nav_profiles_id = $1
	`

// sqlDeleteUserNavPrefsForProfile wipes users_nav_prefs for one profile.
// Used by both ReplacePrefsForProfile (step 1 of the atomic replace)
// and DeletePrefsForProfile.
const sqlDeleteUserNavPrefsForProfile = `
		DELETE FROM users_nav_prefs
		WHERE users_nav_prefs_id_user = $1 AND users_nav_prefs_id_subscription = $2 AND users_nav_prefs_id_profile = $3
	`

// sqlResetUserNavProfilesForSubscription wipes ALL profiles for the
// (user, subscription). CASCADE drops users_nav_prefs +
// users_nav_profile_groups; users.active_nav_profile_id is nulled by
// ON DELETE SET NULL. Used by Service.ResetAllForUser (the Navigation
// page's manual reset button) to force a fresh lazy-seed on the next
// /_site/nav/prefs read.
const sqlResetUserNavProfilesForSubscription = `
		DELETE FROM users_nav_profiles
		 WHERE users_nav_profiles_id_user = $1
		   AND users_nav_profiles_id_subscription = $2
	`

// sqlDeleteUserNavGroupsForUser wipes the user's shared group pool.
// Only used when writing/resetting the Default profile — non-default
// profiles share the pool and cannot wipe it without clobbering
// siblings.
const sqlDeleteUserNavGroupsForUser = `DELETE FROM users_nav_groups WHERE users_nav_groups_id_user = $1`

// sqlUpsertUserNavGroup inserts or refreshes one custom group. The
// ON CONFLICT update makes re-sending an existing group's row
// idempotent (label/position/icon get refreshed, no PK clash). Queued
// inside a pgx.Batch from ReplacePrefsForProfile.
const sqlUpsertUserNavGroup = `
		INSERT INTO users_nav_groups (users_nav_groups_id, users_nav_groups_id_user, users_nav_groups_label, users_nav_groups_position, users_nav_groups_icon)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (users_nav_groups_id) DO UPDATE
		SET users_nav_groups_label = EXCLUDED.users_nav_groups_label, users_nav_groups_position = EXCLUDED.users_nav_groups_position, users_nav_groups_icon = EXCLUDED.users_nav_groups_icon
	`

// sqlInsertUserNavPref inserts one users_nav_prefs row. Queued in a
// pgx.Batch from ReplacePrefsForProfile so the entire pinned list
// commits in one round-trip.
const sqlInsertUserNavPref = `
		INSERT INTO users_nav_prefs (users_nav_prefs_id_user, users_nav_prefs_id_subscription, users_nav_prefs_id_profile, users_nav_prefs_item_key, users_nav_prefs_position, users_nav_prefs_is_start_page, users_nav_prefs_parent_item_key, users_nav_prefs_id_group, users_nav_prefs_icon_override)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
