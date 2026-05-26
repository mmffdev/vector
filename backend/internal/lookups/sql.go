package lookups

// sqlListUsersInScope returns active users in the caller's subscription
// projected to the slim shape consumed by inline pickers.
//
// Tenant clamp: subscription_id = $1 (non-negotiable).
// Order: display_name ASC so the dropdown lists alphabetically.
const sqlListUsersInScope = `
		SELECT
			users_id::text,
			COALESCE(NULLIF(TRIM(COALESCE(users_first_name,'') || ' ' || COALESCE(users_last_name,'')), ''), users_email) AS display_name,
			users_profile_image_url AS avatar_url
		FROM users
		WHERE users_id_subscription = $1
		  AND users_is_active = TRUE
		ORDER BY display_name ASC
	`
