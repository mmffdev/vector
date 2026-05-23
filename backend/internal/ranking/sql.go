package ranking

// PLA060 B16.13 pay-down — SQL literals previously inline across
// service.go + position.go now live here as named printf-format
// constants. The ranking package's queries are generic over the
// resource's table name (cfg.Table) and scope column (cfg.ScopeColumn),
// so the constants are printf-format strings rather than plain SQL;
// callers compose final SQL via fmt.Sprintf at call time.
//
// Naming follows the project convention: sql<Verb><Resource>Fmt for
// printf-format constants. The "Fmt" suffix flags that the value
// needs fmt.Sprintf substitution before it can be passed to pgx.

const (
	// sqlUpdateRankPositionFmt rewrites a single row's position.
	// One %s slot: the resource's table name.
	// $1 = new position, $2 = row id.
	sqlUpdateRankPositionFmt = `UPDATE %s SET position = $1, updated_at = now() WHERE id = $2`

	// sqlSelectRankPositionFmt reads a single row's current position.
	// One %s slot: the resource's table name.
	// $1 = row id.
	sqlSelectRankPositionFmt = `SELECT position FROM %s WHERE id = $1`

	// sqlSelectRankRowForUpdateFmt locks one rank-row by id within a
	// subscription. Two %s slots: (scope column, table). Selects the
	// scope column dynamically so the caller doesn't have to.
	// $1 = row id, $2 = subscription id.
	sqlSelectRankRowForUpdateFmt = `
		SELECT id, subscription_id, %s, position
		FROM %s
		WHERE id = $1 AND subscription_id = $2 AND archived_at IS NULL
		FOR UPDATE`

	// sqlSelectRankCohortBacklogFmt locks the entire backlog cohort
	// (scope column IS NULL) for a subscription, ordered by position.
	// Three %s slots: (scope column for SELECT, table, scope column for WHERE NULL).
	// $1 = subscription id.
	sqlSelectRankCohortBacklogFmt = `
		SELECT id, subscription_id, %s, position
		FROM %s
		WHERE subscription_id = $1 AND %s IS NULL AND archived_at IS NULL
		ORDER BY position, id
		FOR UPDATE`

	// sqlSelectRankCohortScopedFmt locks the scoped cohort for a
	// (subscription, scope_id) pair, ordered by position.
	// Three %s slots: (scope column for SELECT, table, scope column for WHERE = $2).
	// $1 = subscription id, $2 = scope id.
	sqlSelectRankCohortScopedFmt = `
		SELECT id, subscription_id, %s, position
		FROM %s
		WHERE subscription_id = $1 AND %s = $2 AND archived_at IS NULL
		ORDER BY position, id
		FOR UPDATE`

	// sqlRebalanceRanksFmt rewrites every position in a scope to clean
	// gap-stepped values (defaultGap apart), preserving current order.
	// Four %d/%s slots: (gap, table, scope condition, table again).
	// `scope condition` is composed inline by the caller via a small
	// fmt.Sprintf because it varies by scope (IS NULL vs = $2).
	// $1 = subscription id, $2 = scope id (only when scoped).
	sqlRebalanceRanksFmt = `
		WITH ordered AS (
			SELECT id, row_number() OVER (ORDER BY position, id) * %d AS pos
			FROM %s
			WHERE subscription_id = $1 AND %s AND archived_at IS NULL
		)
		UPDATE %s t
		SET position = ordered.pos
		FROM ordered
		WHERE t.id = ordered.id`
)
