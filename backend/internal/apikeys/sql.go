package apikeys

// PLA060 B16.13.3 — proof-of-pattern conversion. Every SQL literal
// used by service code lives here as a named const. Service code
// references the constants only; no inline SQL outside this file.
//
// Naming: sql<Verb><Resource> in Go-idiomatic camelCase.
//
// dev.go is exempt from the SQL-placement ratchet (dev-path file
// excluded by lintchecks); its small queries stay inline for now to
// avoid splitting one short function across two files. If dev.go ever
// gains a third query, fold it in here.

const (
	// sqlInsertAdminAPIKey writes a new key row, returning its uuid.
	// Used by Service.Issue.
	sqlInsertAdminAPIKey = `INSERT INTO admin_api_keys (
		admin_api_keys_id_subscription,
		admin_api_keys_prefix,
		admin_api_keys_hash,
		admin_api_keys_scopes,
		admin_api_keys_expires_at
	) VALUES ($1, $2, $3, $4, $5)
	 RETURNING admin_api_keys_id`

	// sqlSelectAdminAPIKeyByHash fetches one key row for validation.
	// Used by Service.ValidateKey.
	sqlSelectAdminAPIKeyByHash = `SELECT admin_api_keys_id,
	        admin_api_keys_id_subscription,
	        admin_api_keys_prefix,
	        admin_api_keys_scopes,
	        admin_api_keys_created_at,
	        admin_api_keys_expires_at,
	        admin_api_keys_revoked_at,
	        admin_api_keys_last_used_at
	 FROM admin_api_keys
	 WHERE admin_api_keys_hash = $1 AND admin_api_keys_prefix = $2`

	// sqlUpdateAdminAPIKeyLastUsedAt stamps the validation timestamp.
	// Best-effort — failure is logged, not returned.
	sqlUpdateAdminAPIKeyLastUsedAt = `UPDATE admin_api_keys SET admin_api_keys_last_used_at = now() WHERE admin_api_keys_id = $1`

	// sqlSelectAdminAPIKeysBySubscription lists active keys for one
	// subscription, newest first. Used by Service.ListKeys.
	sqlSelectAdminAPIKeysBySubscription = `SELECT admin_api_keys_id,
	        admin_api_keys_id_subscription,
	        admin_api_keys_prefix,
	        admin_api_keys_scopes,
	        admin_api_keys_created_at,
	        admin_api_keys_expires_at,
	        admin_api_keys_revoked_at,
	        admin_api_keys_last_used_at
	 FROM admin_api_keys
	 WHERE admin_api_keys_id_subscription = $1 AND admin_api_keys_revoked_at IS NULL
	 ORDER BY admin_api_keys_created_at DESC`

	// sqlSelectAdminAPIKeyOwningSubscription returns the owning
	// subscription id for a key, regardless of revocation. Used by
	// LookupOwningSubscription on cross-tenant audit log paths.
	sqlSelectAdminAPIKeyOwningSubscription = `SELECT admin_api_keys_id_subscription::text FROM admin_api_keys WHERE admin_api_keys_id = $1`

	// sqlSoftArchiveAdminAPIKey revokes a key, scoped to the actor's
	// subscription. The tenant clamp is on the WHERE side so cross-
	// tenant attempts return 0 rows affected (mapped to ErrKeyNotFound).
	sqlSoftArchiveAdminAPIKey = `UPDATE admin_api_keys SET admin_api_keys_revoked_at = now()
	 WHERE admin_api_keys_id = $1
	   AND admin_api_keys_id_subscription = $2
	   AND admin_api_keys_revoked_at IS NULL`
)
