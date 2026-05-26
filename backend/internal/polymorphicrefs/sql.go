package polymorphicrefs

// PLA060 B16.13 pay-down — SQL literals previously inline in service.go
// now live here as named constants. Two of the four are plain SQL
// (INSERT INTOs targeting fixed tables); the other two are printf-format
// constants because the table name is resolved dynamically from the
// polymorphic-parent registry (see parentTableFor / childRelationshipsFor).
//
// Naming follows the project convention: sql<Verb><Resource> for plain
// queries, sql<Verb><Resource>Fmt for printf-format strings that need
// fmt.Sprintf substitution before they can be passed to pgx.
//
// Safety note: the %s substitution slots in the Fmt constants accept
// hard-coded table / column names from the static registry, NEVER user
// input. The dispatch_polymorphic_parent trigger (migration 013) and
// the boundary tests both pin the closed set; if a future writer ever
// tries to splice an attacker-controlled string here, the registry
// lookup would reject it before reaching this layer.

const (
	// sqlSelectPolymorphicParentForUpdateFmt locks one row in a polymorphic
	// parent table for read-then-write. One %s slot: the parent table name
	// (from parentTableFor). $1 = entity id.
	sqlSelectPolymorphicParentForUpdateFmt = `SELECT subscription_id, archived_at FROM %s WHERE id = $1 FOR UPDATE`

	// sqlInsertEntityStakeholder writes one entity_stakeholders row,
	// idempotent on (kind, entity_id, user_id, role) via the
	// stakeholder_unique constraint. Caller passes role + ids.
	sqlInsertEntityStakeholder = `
		INSERT INTO subscriptions_stakeholders (
			subscriptions_stakeholders_id_subscription,
			subscriptions_stakeholders_entity_kind,
			subscriptions_stakeholders_entity_id,
			subscriptions_stakeholders_id_user,
			subscriptions_stakeholders_role
		) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (
			subscriptions_stakeholders_entity_kind,
			subscriptions_stakeholders_entity_id,
			subscriptions_stakeholders_id_user,
			subscriptions_stakeholders_role
		) DO UPDATE SET subscriptions_stakeholders_role = EXCLUDED.subscriptions_stakeholders_role
		RETURNING subscriptions_stakeholders_id`

	// sqlInsertPageEntityRef writes one page_entity_refs row, idempotent
	// on (page_entity_refs_entity_kind, page_entity_refs_entity_id).
	// $1 = page id, $2 = entity kind, $3 = entity id.
	sqlInsertPageEntityRef = `
		INSERT INTO page_entity_refs (page_entity_refs_id_page, page_entity_refs_entity_kind, page_entity_refs_entity_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (page_entity_refs_entity_kind, page_entity_refs_entity_id) DO NOTHING`

	// sqlDeletePolymorphicChildFmt removes child rows pointing at a
	// (kind, id) pair. Three %s slots: (child table, kind column,
	// id column) — all from childRelationshipsFor. $1 = entity kind,
	// $2 = entity id.
	sqlDeletePolymorphicChildFmt = `DELETE FROM %s WHERE %s = $1 AND %s = $2`
)
