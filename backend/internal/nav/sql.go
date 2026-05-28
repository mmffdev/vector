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
// page_tags, users_roles_pages, users_nav_*, page_entity_refs, portfolio,
// product, users).
package nav

// ── bookmarks.go ────────────────────────────────────────────────────────────

// sqlSelectEntityForBookmarkTemplate — DEAD-CODE per refactorDB
// Pillar 3 step 1 (2026-05-26). The original caller (Bookmarks.loadEntity)
// was deleted with TD-CUT1.1.1-BOOKMARK-SURFACE — see
// bookmarks.go header. No Go code references this constant; it is
// retained as the documented dropping point and will be removed in a
// follow-up commit once the lint:sql-in-sqlfile-only check confirms
// no other reference materialises.
//
// Pre-deletion template: returned name + subscription_id +
// archived_at for a parameterised entity table. Kept verbatim below
// for archaeological reference.
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
// Post-141: bookmarks live in users_nav_bookmarks (their own table).
// $1=userID, $2=subscriptionID, $3=profileID
const sqlCountUserEntityBookmarks = `
		SELECT COUNT(*) FROM users_nav_bookmarks unb
		JOIN pages p ON p.pages_key_enum = unb.users_nav_bookmarks_item_key
		WHERE unb.users_nav_bookmarks_id_user = $1 AND unb.users_nav_bookmarks_id_subscription = $2 AND unb.users_nav_bookmarks_id_profile = $3
		  AND p.pages_kind = 'entity'
	`

// sqlSelectStaticPageForBookmark validates that a page key exists, is static
// and pinnable, and is visible to the caller's subscription.
const sqlSelectStaticPageForBookmark = `
		SELECT pages_key_enum FROM pages
		WHERE pages_key_enum = $1
		  AND pages_kind = 'static'
		  AND pages_pinnable = TRUE
		  AND (pages_id_subscription IS NULL OR pages_id_subscription = $2)
	`

// sqlCountUserStaticBookmarks counts static-kind user bookmarks for the cap check.
// Post-141: bookmarks live in users_nav_bookmarks (their own table).
// $1=userID, $2=subscriptionID, $3=profileID
const sqlCountUserStaticBookmarks = `
		SELECT COUNT(*) FROM users_nav_bookmarks unb
		JOIN pages p ON p.pages_key_enum = unb.users_nav_bookmarks_item_key
		WHERE unb.users_nav_bookmarks_id_user = $1 AND unb.users_nav_bookmarks_id_subscription = $2 AND unb.users_nav_bookmarks_id_profile = $3
		  AND p.pages_kind = 'static'
	`

// sqlUpsertSharedEntityPage get-or-creates the shared pages row backing
// an entity bookmark. The partial unique index
// pages_key_enum_id_subscription_shared_unique covers
// (pages_key_enum, pages_id_subscription) WHERE pages_id_user_creator
// IS NULL, so concurrent Pin calls collapse onto one row instead of
// duplicating it.
const sqlUpsertSharedEntityPage = `
		INSERT INTO pages (pages_key_enum, pages_label, pages_href, pages_icon, pages_tag_enum, pages_kind,
		                   pages_pinnable, pages_default_pinned, pages_default_order,
		                   pages_id_user_creator, pages_id_subscription)
		VALUES ($1, $2, $3, $4, $5, 'entity', TRUE, FALSE, 0, NULL, $6)
		ON CONFLICT (pages_key_enum, pages_id_subscription) WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NOT NULL DO UPDATE
		  SET pages_label = EXCLUDED.pages_label, pages_updated_at = NOW()
		RETURNING pages_id
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
		SELECT p.pages_id, p.pages_key_enum, p.pages_label, p.pages_href, p.pages_tag_enum, p.pages_default_order,
		       COALESCE(t.pages_tags_display_name, p.pages_tag_enum)  AS bucket_label,
		       COALESCE(t.pages_tags_default_order, 9999)             AS bucket_order,
		       COALESCE(array_agg(pr.users_roles_pages_id_role ORDER BY pr.users_roles_pages_id_role)
		                FILTER (WHERE pr.users_roles_pages_id_role IS NOT NULL), '{}'::uuid[]) AS role_ids
		FROM pages p
		LEFT JOIN pages_tags t ON t.pages_tags_tag_enum = p.pages_tag_enum
		LEFT JOIN users_roles_pages pr ON pr.users_roles_pages_id_page = p.pages_id
		WHERE p.pages_id_user_creator IS NULL
		  AND p.pages_id_subscription IS NULL
		GROUP BY p.pages_id, t.pages_tags_display_name, t.pages_tags_default_order
		ORDER BY bucket_order, bucket_label, p.pages_default_order, p.pages_label
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
		 WHERE pages_id              = $1
		   AND pages_id_user_creator IS NULL
		   AND pages_id_subscription IS NULL
	`

// sqlPageTagEnumByID returns the tag_enum bucket for a page. Used by
// the avatar-floor guard: any DELETE against a page whose tag_enum is
// 'avatar_menu' is refused (409 ResourceLocked) so every role keeps
// access to their personal-account pages.
const sqlPageTagEnumByID = `
		SELECT pages_tag_enum FROM pages WHERE pages_id = $1
	`

// sqlBatchGrantSystemPagesByBucket inserts (page_id, role_id) for
// every system page whose tag_enum matches $1 that does not already
// have a grant for $2. ON CONFLICT DO NOTHING makes the call
// idempotent so a partial state (some children granted, some not)
// converges to all-on in a single statement.
const sqlBatchGrantSystemPagesByBucket = `
		INSERT INTO users_roles_pages (users_roles_pages_id_page, users_roles_pages_id_role)
		SELECT p.pages_id, $2
		  FROM pages p
		 WHERE p.pages_tag_enum        = $1
		   AND p.pages_id_user_creator IS NULL
		   AND p.pages_id_subscription IS NULL
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
		     SELECT pages_id FROM pages
		      WHERE pages_tag_enum        = $1
		        AND pages_id_user_creator IS NULL
		        AND pages_id_subscription IS NULL
		   )
	`


// sqlNextUserNavBookmarkPosition returns the next free position for a
// user's bookmark list (max(position) + 1 or 0 when empty). Post-141
// bookmarks have their own position sequence — they no longer share
// the pinned list's positions.
// $1=userID, $2=subscriptionID, $3=profileID
const sqlNextUserNavBookmarkPosition = `
		SELECT COALESCE(MAX(users_nav_bookmarks_position) + 1, 0)
		FROM users_nav_bookmarks
		WHERE users_nav_bookmarks_id_user = $1 AND users_nav_bookmarks_id_subscription = $2 AND users_nav_bookmarks_id_profile = $3
	`

// sqlInsertUserNavBookmark inserts a row into users_nav_bookmarks.
// ON CONFLICT DO NOTHING — a second pin for the same key is friendlier
// as a no-op than as an error. Bookmark-ness is table membership; the
// old is_bookmark discriminator column is gone with the 141 split.
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey, $5=position
const sqlInsertUserNavBookmark = `
		INSERT INTO users_nav_bookmarks (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_item_key, users_nav_bookmarks_position, users_nav_bookmarks_is_start_page)
		VALUES ($1, $2, $3, $4, $5, FALSE)
		ON CONFLICT (users_nav_bookmarks_id_user, users_nav_bookmarks_id_subscription, users_nav_bookmarks_id_profile, users_nav_bookmarks_item_key) DO NOTHING
	`

// sqlDeleteUserNavBookmarkByKey removes one bookmark by item_key. This
// is the unpin operation post-141: a bookmark is its own row in
// users_nav_bookmarks, so removing one is a plain DELETE (no
// is_bookmark flag to flip, no shared-row coexistence with section
// pref rows).
// $1=userID, $2=subscriptionID, $3=profileID, $4=itemKey
const sqlDeleteUserNavBookmarkByKey = `
		DELETE FROM users_nav_bookmarks
		WHERE users_nav_bookmarks_id_user = $1 AND users_nav_bookmarks_id_subscription = $2 AND users_nav_bookmarks_id_profile = $3 AND users_nav_bookmarks_item_key = $4
	`

// ── registry.go ─────────────────────────────────────────────────────────────

// sqlListPageTags returns the page_tags catalogue in default order.
// Used by LoadRegistry as the first hop before joining pages.
// pages_tags_env_only is TD-NAV-001: env restriction (NULL = visible everywhere).
// pages_tags_min_auth_level is INERT as of migration 228 (PLA-0053) —
// the tier gate has been collapsed; tag visibility is derived from
// page-grant fan-out in Registry.TagsFor. Column is not scanned.
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
		SELECT p.pages_key_enum, p.pages_label, p.pages_href, p.pages_icon, p.pages_tag_enum, p.pages_kind,
		       p.pages_pinnable, p.pages_default_pinned, p.pages_default_order, p.pages_id_subscription,
		       COALESCE(array_agg(pr.users_roles_pages_id_role ORDER BY pr.users_roles_pages_id_role) FILTER (WHERE pr.users_roles_pages_id_role IS NOT NULL), '{}'::uuid[]) AS role_ids
		FROM pages p
		LEFT JOIN users_roles_pages pr ON pr.users_roles_pages_id_page = p.pages_id
		WHERE p.pages_id_user_creator IS NULL
		  AND (p.pages_id_subscription IS NULL OR p.pages_kind = 'entity')
		GROUP BY p.pages_id
		ORDER BY p.pages_tag_enum, p.pages_default_order
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

// sqlSeedNewProfilePrefsFromDefault clones users_nav_pinned rows from the
// caller's Default profile into the freshly-created profile so a new
// profile inherits the user's current pinned/admin-group state instead
// of reading empty.
const sqlSeedNewProfilePrefsFromDefault = `
		INSERT INTO users_nav_pinned
		    (users_nav_pinned_id_user, users_nav_pinned_id_subscription, users_nav_pinned_id_profile, users_nav_pinned_item_key, users_nav_pinned_position,
		     users_nav_pinned_is_start_page, users_nav_pinned_parent_item_key, users_nav_pinned_id_group, users_nav_pinned_icon_override)
		SELECT
		    src.users_nav_pinned_id_user, src.users_nav_pinned_id_subscription, $3,
		    src.users_nav_pinned_item_key, src.users_nav_pinned_position,
		    FALSE, src.users_nav_pinned_parent_item_key, src.users_nav_pinned_id_group, src.users_nav_pinned_icon_override
		FROM users_nav_pinned src
		JOIN users_nav_profiles dp
		    ON dp.users_nav_profiles_id_user = src.users_nav_pinned_id_user
		   AND dp.users_nav_profiles_id_subscription = src.users_nav_pinned_id_subscription
		   AND dp.users_nav_profiles_is_default = TRUE
		WHERE src.users_nav_pinned_id_user = $1
		  AND src.users_nav_pinned_id_subscription = $2
		  AND src.users_nav_pinned_id_profile = dp.users_nav_profiles_id
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
		   SET users_id_active_nav_profile = $1
		 WHERE users_id = $2
	`

// sqlSelectActiveProfileScoped returns users.users_id_active_nav_profile ONLY
// when the active profile is owned by this user under this
// subscription. Otherwise the row scan misses and the caller falls
// back to Default.
const sqlSelectActiveProfileScoped = `
		SELECT p.users_nav_profiles_id
		  FROM users u
		  JOIN users_nav_profiles p ON p.users_nav_profiles_id = u.users_id_active_nav_profile
		 WHERE u.users_id = $1
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
		            (SELECT users_id_active_nav_profile FROM users WHERE users_id = $1)) AS active_id,
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

// sqlSeedNonDefaultPrefsFromDefaultOnFirstRead clones users_nav_pinned
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
				SELECT 1 FROM users_nav_pinned
				WHERE users_nav_pinned_id_user = $1 AND users_nav_pinned_id_subscription = $2 AND users_nav_pinned_id_profile = $3
			)
		),
		default_profile AS (
			SELECT users_nav_profiles_id FROM users_nav_profiles
			WHERE users_nav_profiles_id_user = $1 AND users_nav_profiles_id_subscription = $2 AND users_nav_profiles_is_default = TRUE
		)
		INSERT INTO users_nav_pinned (
			users_nav_pinned_id_user, users_nav_pinned_id_subscription, users_nav_pinned_id_profile, users_nav_pinned_item_key, users_nav_pinned_position,
			users_nav_pinned_is_start_page, users_nav_pinned_parent_item_key, users_nav_pinned_id_group, users_nav_pinned_icon_override
		)
		SELECT
			src.users_nav_pinned_id_user, src.users_nav_pinned_id_subscription, $3, src.users_nav_pinned_item_key, src.users_nav_pinned_position,
			FALSE, src.users_nav_pinned_parent_item_key, src.users_nav_pinned_id_group, src.users_nav_pinned_icon_override
		FROM users_nav_pinned src
		JOIN default_profile dp ON dp.users_nav_profiles_id = src.users_nav_pinned_id_profile
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
		INSERT INTO users_nav_pinned (users_nav_pinned_id_user, users_nav_pinned_id_subscription, users_nav_pinned_id_profile, users_nav_pinned_item_key, users_nav_pinned_position, users_nav_pinned_is_start_page)
		SELECT
			$1::uuid,
			$2::uuid,
			$4::uuid,
			p.pages_key_enum,
			COALESCE(
				(SELECT MAX(unp.users_nav_pinned_position) + 1
				 FROM users_nav_pinned unp
				 WHERE unp.users_nav_pinned_id_user = $1::uuid
				   AND unp.users_nav_pinned_id_subscription = $2::uuid
				   AND unp.users_nav_pinned_id_profile = $4::uuid),
				0
			) + (ROW_NUMBER() OVER (ORDER BY p.pages_default_order, p.pages_key_enum) - 1),
			FALSE
		FROM pages p
		JOIN users_roles_pages pr ON pr.users_roles_pages_id_page = p.pages_id
		JOIN users_nav_profiles d ON d.users_nav_profiles_id = $4::uuid AND d.users_nav_profiles_is_default = TRUE
		WHERE p.pages_id_user_creator IS NULL
		  AND p.pages_id_subscription IS NULL
		  AND p.pages_default_pinned = TRUE
		  AND p.pages_pinnable = TRUE
		  AND pr.users_roles_pages_id_role = $3::uuid
		  AND NOT EXISTS (
			  SELECT 1 FROM users_nav_pinned unp
			  WHERE unp.users_nav_pinned_id_user = $1::uuid
				AND unp.users_nav_pinned_id_subscription = $2::uuid
				AND unp.users_nav_pinned_id_profile = $4::uuid
				AND unp.users_nav_pinned_item_key = p.pages_key_enum
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

// sqlListUserNavPrefsForProfile returns the user's pinned + bookmark
// rows for one (user, subscription, profile), merged into one result
// set so the wire shape stays one list per profile with an is_bookmark
// discriminator (preserved post-141 schema split).
//
// pinned-section rows come from users_nav_pinned (is_bookmark = false
// literal). bookmark rows come from users_nav_bookmarks (is_bookmark =
// true literal). The two tables have independent position sequences;
// pinned rows sort first (within their own position), bookmarks after
// (within theirs) — matching the frontend's expectation that the
// pinned list and the bookmark list are separate groups in the rail
// even though they ride the same wire shape.
//
// is_bookmark is the 4th projected column to match the rows.Scan order
// in service.go (kept stable across the schema split).
const sqlListUserNavPrefsForProfile = `
		SELECT item_key, position, is_start_page, is_bookmark, parent_item_key, id_group, icon_override
		  FROM (
		    SELECT users_nav_pinned_item_key        AS item_key,
		           users_nav_pinned_position        AS position,
		           users_nav_pinned_is_start_page   AS is_start_page,
		           FALSE                            AS is_bookmark,
		           users_nav_pinned_parent_item_key AS parent_item_key,
		           users_nav_pinned_id_group        AS id_group,
		           users_nav_pinned_icon_override   AS icon_override,
		           0                                AS sort_bucket
		      FROM users_nav_pinned
		     WHERE users_nav_pinned_id_user = $1
		       AND users_nav_pinned_id_subscription = $2
		       AND users_nav_pinned_id_profile = $3
		    UNION ALL
		    SELECT users_nav_bookmarks_item_key        AS item_key,
		           users_nav_bookmarks_position        AS position,
		           users_nav_bookmarks_is_start_page   AS is_start_page,
		           TRUE                                AS is_bookmark,
		           users_nav_bookmarks_parent_item_key AS parent_item_key,
		           users_nav_bookmarks_id_group        AS id_group,
		           users_nav_bookmarks_icon_override   AS icon_override,
		           1                                   AS sort_bucket
		      FROM users_nav_bookmarks
		     WHERE users_nav_bookmarks_id_user = $1
		       AND users_nav_bookmarks_id_subscription = $2
		       AND users_nav_bookmarks_id_profile = $3
		  ) merged
		 ORDER BY sort_bucket, position
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
		SELECT users_nav_pinned_item_key FROM users_nav_pinned
		WHERE users_nav_pinned_id_user = $1 AND users_nav_pinned_id_subscription = $2 AND users_nav_pinned_id_profile = $3 AND users_nav_pinned_is_start_page = TRUE
		LIMIT 1
	`

// sqlSelectProfileIsDefaultByID is the lean is_default-only probe used
// by ReplacePrefsForProfile and DeletePrefs. Different from
// sqlSelectProfileIsDefault above (which is ownership-scoped) — this
// variant is called only after ownership has already been established.
const sqlSelectProfileIsDefaultByID = `
		SELECT users_nav_profiles_is_default FROM users_nav_profiles WHERE users_nav_profiles_id = $1
	`

// sqlDeleteUserNavPinnedForProfile wipes users_nav_pinned for one
// profile. Used by:
//   - DeletePrefs            ("Reset to defaults" — user intent is "nuke section nav")
//   - DeletePrefsForProfile  ("delete this whole profile")
//   - ReplacePrefsForProfile (the PUT /nav/prefs wipe-and-replace step)
//
// Post-141: bookmarks live in users_nav_bookmarks and are untouched by
// this delete. The PUT-prefs payload only carries pinned-section rows
// and groups, so wiping ONLY pinned is correct. Bookmarks have their
// own lifecycle via the Bookmarks handler. The "spare bookmarks"
// surgical filter (sqlDeleteUserNavPrefsForProfileExceptBookmarks) is
// gone — the split makes it structurally impossible to clobber
// bookmarks via this code path.
//
// For "delete this whole profile" the profile-level CASCADE FKs on
// both users_nav_pinned and users_nav_bookmarks drop the bookmark
// rows alongside the pinned rows; this constant only handles the
// "reset pinned without touching the profile row" case.
const sqlDeleteUserNavPinnedForProfile = `
		DELETE FROM users_nav_pinned
		WHERE users_nav_pinned_id_user = $1 AND users_nav_pinned_id_subscription = $2 AND users_nav_pinned_id_profile = $3
	`

// sqlResetUserNavProfilesForSubscription wipes ALL profiles for the
// (user, subscription). CASCADE drops users_nav_pinned +
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

// sqlInsertUserNavPref inserts one users_nav_pinned row. Queued in a
// pgx.Batch from ReplacePrefsForProfile so the entire pinned list
// commits in one round-trip.
const sqlInsertUserNavPref = `
		INSERT INTO users_nav_pinned (users_nav_pinned_id_user, users_nav_pinned_id_subscription, users_nav_pinned_id_profile, users_nav_pinned_item_key, users_nav_pinned_position, users_nav_pinned_is_start_page, users_nav_pinned_parent_item_key, users_nav_pinned_id_group, users_nav_pinned_icon_override)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
