package lookups

// sqlListUsersInScope returns active users in the caller's subscription
// projected to the slim shape consumed by inline pickers.
//
// Tenant clamp: subscription_id = $1 (non-negotiable).
// Order: display_name ASC so the dropdown lists alphabetically.
const sqlListUsersInScope = `
		SELECT
			id::text,
			COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email) AS display_name,
			profile_image_url AS avatar_url
		FROM users
		WHERE subscription_id = $1
		  AND is_active = TRUE
		ORDER BY display_name ASC
	`
