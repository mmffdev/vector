// SQL constants for the resolvers package. Lives in its own file per
// the project's sql-in-sqlfile-only lint convention.

package resolvers

// sqlSelectArtefactLabel — single round-trip lookup driving the
// artefact-kind mention resolver. Returns the three columns the
// label template needs plus the artefact-type's `name`
// (lower-cased) so the caller can verify the row's type matches the
// declared kind.
//
// Clamps:
//   - subscription_id = $2 — tenant isolation, the gate that prevents
//     a mention resolver leaking labels across subscriptions.
//   - artefacts.archived_at IS NULL — archived rows aren't
//     addressable via new mentions.
//   - artefacts_types.archived_at IS NULL — defensive; a row of an
//     archived type shouldn't render either.
//
// Indexes already cover (id) and (subscription_id, id) on artefacts
// so the lookup is a single index probe.
const sqlSelectArtefactLabel = `
		SELECT
			at.artefacts_types_prefix AS prefix,
			a.number                  AS key_num,
			a.title                   AS title,
			lower(at.artefacts_types_name) AS type_slug
		FROM artefacts a
		JOIN artefacts_types at ON at.artefacts_types_id = a.artefact_type_id
		WHERE a.id = $1
		  AND a.subscription_id = $2
		  AND a.archived_at IS NULL
		  AND at.artefacts_types_archived_at IS NULL
	`
