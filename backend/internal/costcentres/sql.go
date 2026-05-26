package costcentres

// SQL constants — named per the convention sqlVerbResource.
// All queries are subscription-scoped; the caller is expected to
// pass the actor's SubscriptionID from the verified session, never
// from the payload. See backend/internal/users/sql.go for the same
// pattern.

// sqlListBySubscription returns every live (non-archived) cost
// centre in the tenant, ordered by code for a stable list.
const sqlListBySubscription = `
	SELECT cost_centres_id, cost_centres_id_subscription, cost_centres_id_parent, cost_centres_code, cost_centres_name, cost_centres_is_active, cost_centres_archived_at, cost_centres_created_at, cost_centres_updated_at
	  FROM cost_centres
	 WHERE cost_centres_id_subscription = $1
	   AND cost_centres_archived_at IS NULL
	 ORDER BY cost_centres_code
`

// sqlInsertCostCentre inserts a new live cost centre. ON CONFLICT
// (cost_centres_id_subscription, cost_centres_code) WHERE cost_centres_archived_at IS NULL surfaces as
// 23505 — handler maps to 409.
const sqlInsertCostCentre = `
	INSERT INTO cost_centres (cost_centres_id_subscription, cost_centres_id_parent, cost_centres_code, cost_centres_name, cost_centres_is_active)
	VALUES ($1, $2, $3, $4, $5)
	RETURNING cost_centres_id, cost_centres_id_subscription, cost_centres_id_parent, cost_centres_code, cost_centres_name, cost_centres_is_active, cost_centres_archived_at, cost_centres_created_at, cost_centres_updated_at
`

// sqlUpdateCostCentre is a sparse update — only the columns we
// actually changed get re-written. Handler builds the SET clause
// dynamically (cf. users.Update). Kept as a template for the
// common case of just code/name/is_active.
const sqlUpdateCostCentreTemplate = `
	UPDATE cost_centres
	   SET %s, cost_centres_updated_at = NOW()
	 WHERE cost_centres_id = $1 AND cost_centres_id_subscription = $2 AND cost_centres_archived_at IS NULL
`

// sqlArchiveCostCentre soft-archives a cost centre. ON DELETE RESTRICT
// on the FK from users.cost_centre_id means the row stays referenceable
// from existing user assignments — archive is the right verb (and
// the operator can clean up FKs separately).
const sqlArchiveCostCentre = `
	UPDATE cost_centres
	   SET cost_centres_archived_at = NOW(), cost_centres_is_active = FALSE, cost_centres_updated_at = NOW()
	 WHERE cost_centres_id = $1 AND cost_centres_id_subscription = $2 AND cost_centres_archived_at IS NULL
`

// sqlSelectByID is the lean single-row read used by Update/Archive
// preflight to confirm cross-tenant isolation.
const sqlSelectByID = `
	SELECT cost_centres_id, cost_centres_id_subscription, cost_centres_id_parent, cost_centres_code, cost_centres_name, cost_centres_is_active, cost_centres_archived_at, cost_centres_created_at, cost_centres_updated_at
	  FROM cost_centres
	 WHERE cost_centres_id = $1 AND cost_centres_id_subscription = $2
`
