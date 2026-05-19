package costcentres

// SQL constants — named per the convention sqlVerbResource.
// All queries are subscription-scoped; the caller is expected to
// pass the actor's SubscriptionID from the verified session, never
// from the payload. See backend/internal/users/sql.go for the same
// pattern.

// sqlListBySubscription returns every live (non-archived) cost
// centre in the tenant, ordered by code for a stable list.
const sqlListBySubscription = `
	SELECT id, subscription_id, parent_id, code, name, is_active, archived_at, created_at, updated_at
	  FROM cost_centres
	 WHERE subscription_id = $1
	   AND archived_at IS NULL
	 ORDER BY code
`

// sqlInsertCostCentre inserts a new live cost centre. ON CONFLICT
// (subscription_id, code) WHERE archived_at IS NULL surfaces as
// 23505 — handler maps to 409.
const sqlInsertCostCentre = `
	INSERT INTO cost_centres (subscription_id, parent_id, code, name, is_active)
	VALUES ($1, $2, $3, $4, $5)
	RETURNING id, subscription_id, parent_id, code, name, is_active, archived_at, created_at, updated_at
`

// sqlUpdateCostCentre is a sparse update — only the columns we
// actually changed get re-written. Handler builds the SET clause
// dynamically (cf. users.Update). Kept as a template for the
// common case of just code/name/is_active.
const sqlUpdateCostCentreTemplate = `
	UPDATE cost_centres
	   SET %s, updated_at = NOW()
	 WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
`

// sqlArchiveCostCentre soft-archives a cost centre. ON DELETE RESTRICT
// on the FK from users.cost_centre_id means the row stays referenceable
// from existing user assignments — archive is the right verb (and
// the operator can clean up FKs separately).
const sqlArchiveCostCentre = `
	UPDATE cost_centres
	   SET archived_at = NOW(), is_active = FALSE, updated_at = NOW()
	 WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
`

// sqlSelectByID is the lean single-row read used by Update/Archive
// preflight to confirm cross-tenant isolation.
const sqlSelectByID = `
	SELECT id, subscription_id, parent_id, code, name, is_active, archived_at, created_at, updated_at
	  FROM cost_centres
	 WHERE id = $1 AND subscription_id = $2
`
