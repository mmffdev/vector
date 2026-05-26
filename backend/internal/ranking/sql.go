package ranking

// PLA060 B16.13 pay-down — SQL literals previously inline across
// service.go + position.go now live here as named printf-format
// constants. The ranking package's queries are generic over the
// resource's table name (cfg.Table) and scope column (cfg.ScopeColumn),
// so the constants are printf-format strings rather than plain SQL;
// callers compose final SQL via fmt.Sprintf at call time.
//
// RF1.5.7 — column-name placeholders added so prefix-swept tables
// (e.g. `artefacts` post-RF1.5.7: `artefacts_id`, `artefacts_position`,
// `artefacts_id_subscription`, `artefacts_updated_at`, `artefacts_archived_at`)
// can be served by the same generic queries. Callers compose via the
// columnsResolved() helper on ResourceConfig.
//
// Naming follows the project convention: sql<Verb><Resource>Fmt for
// printf-format constants. The "Fmt" suffix flags that the value
// needs fmt.Sprintf substitution before it can be passed to pgx.

const (
	// sqlUpdateRankPositionFmt rewrites a single row's position.
	// Slots: (table, posCol, updCol, idCol). $1 = new position, $2 = row id.
	sqlUpdateRankPositionFmt = `UPDATE %s SET %s = $1, %s = now() WHERE %s = $2`

	// sqlSelectRankPositionFmt reads a single row's current position.
	// Slots: (posCol, table, idCol). $1 = row id.
	sqlSelectRankPositionFmt = `SELECT %s FROM %s WHERE %s = $1`

	// sqlSelectRankRowForUpdateFmt locks one rank-row by id within a
	// subscription. Slots:
	//   (idCol, subCol, scopeCol, posCol, table, idCol, subCol, archCol).
	// $1 = row id, $2 = subscription id.
	sqlSelectRankRowForUpdateFmt = `
		SELECT %s, %s, %s, %s
		FROM %s
		WHERE %s = $1 AND %s = $2 AND %s IS NULL
		FOR UPDATE`

	// sqlSelectRankCohortBacklogFmt locks the entire backlog cohort
	// (scope column IS NULL) for a subscription, ordered by position.
	// Slots: (idCol, subCol, scopeCol, posCol, table, subCol, scopeCol, archCol, posCol, idCol).
	// $1 = subscription id.
	sqlSelectRankCohortBacklogFmt = `
		SELECT %s, %s, %s, %s
		FROM %s
		WHERE %s = $1 AND %s IS NULL AND %s IS NULL
		ORDER BY %s, %s
		FOR UPDATE`

	// sqlSelectRankCohortScopedFmt locks the scoped cohort for a
	// (subscription, scope_id) pair, ordered by position.
	// Slots: (idCol, subCol, scopeCol, posCol, table, subCol, scopeCol, archCol, posCol, idCol).
	// $1 = subscription id, $2 = scope id.
	sqlSelectRankCohortScopedFmt = `
		SELECT %s, %s, %s, %s
		FROM %s
		WHERE %s = $1 AND %s = $2 AND %s IS NULL
		ORDER BY %s, %s
		FOR UPDATE`

	// sqlRebalanceRanksFmt rewrites every position in a scope to clean
	// gap-stepped values (defaultGap apart), preserving current order.
	// Slots:
	//   gap (int), idCol, posCol, idCol,
	//   table, subCol, scopeCond, archCol, table, posCol,
	//   idCol, idCol.
	// `scope condition` is composed inline by the caller via a small
	// fmt.Sprintf because it varies by scope (IS NULL vs = $2).
	// $1 = subscription id, $2 = scope id (only when scoped).
	sqlRebalanceRanksFmt = `
		WITH ordered AS (
			SELECT %s, row_number() OVER (ORDER BY %s, %s) * %d AS pos
			FROM %s
			WHERE %s = $1 AND %s AND %s IS NULL
		)
		UPDATE %s t
		SET %s = ordered.pos
		FROM ordered
		WHERE t.%s = ordered.%s`
)
