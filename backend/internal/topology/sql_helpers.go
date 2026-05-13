package topology

import "github.com/google/uuid"

// ApplyClamp helps a consuming list query honour the clamp predicate.
// Returns:
//
//   - extraSQL: a string to splice into a query's WHERE clause (already
//     starts with " AND " when non-empty, or "" when no extra SQL is
//     needed). For ClampEmpty it returns " AND FALSE" so the caller's
//     existing WHERE-and-LIMIT structure stays intact.
//   - args: the extra arguments to pass to pgx, in the order they appear
//     in extraSQL. Non-nil for ClampSubset; nil otherwise.
//   - usable: false when the middleware did not run for this request.
//     Callers should treat false as "refuse to serve a clamped query"
//     unless they know they are running outside the clamp boundary
//     (admin tools).
//
// The caller passes startIndex = the placeholder number to use for the
// first new arg (e.g. if the existing query already uses $1 and $2,
// pass 3). When extraSQL refers to a single array placeholder it uses
// `= ANY($N)` so pgx can pass the slice directly.
func ApplyClamp(c Clamp, startIndex int) (extraSQL string, args []any, usable bool) {
	switch c.Mode {
	case ClampUnscoped:
		return "", nil, false
	case ClampAll:
		return "", nil, true
	case ClampEmpty:
		return " AND FALSE", nil, true
	case ClampSubset:
		// pgx requires a typed slice for ANY — cast to []uuid.UUID,
		// not []any, so the driver picks uuid[] over text[].
		ids := make([]uuid.UUID, len(c.NodeIDs))
		copy(ids, c.NodeIDs)
		return " AND org_node_id = ANY($" + itoa(startIndex) + ")", []any{ids}, true
	}
	return "", nil, false
}

// itoa is a stack-allocated alternative to strconv.Itoa for the small
// positive integers we splice into SQL. Avoids the strconv import in a
// file otherwise free of stdlib deps.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
