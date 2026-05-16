// Package searchworker SQL constants.
//
// PLA-0048 / RF1.2.14. Background worker against vector_artefacts —
// claim/process artefacts_search_outbox rows, rewrite artefacts'
// search_index + content_embedding columns.
package searchworker

// sqlClaimNextOutboxRow claims the next unclaimed outbox row with
// FOR UPDATE SKIP LOCKED. attempts gate is parameterised so callers
// control max-attempts policy from Go.
const sqlClaimNextOutboxRow = `
		SELECT id, artefact_id
		FROM artefacts_search_outbox
		WHERE claimed_at IS NULL
		  AND attempts < $1
		ORDER BY enqueued_at
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`

// sqlMarkOutboxClaimed stamps claimed_at = NOW() on the claimed row
// inside the claim tx.
const sqlMarkOutboxClaimed = `
		UPDATE artefacts_search_outbox SET claimed_at = NOW()
		WHERE id = $1
	`

// sqlDeleteOutboxRow removes the outbox row on successful processing.
const sqlDeleteOutboxRow = `DELETE FROM artefacts_search_outbox WHERE id = $1`

// sqlSelectArtefactTitleAndDescription fetches the content fields used
// to compute TSVECTOR + embedding for one live artefact.
const sqlSelectArtefactTitleAndDescription = `
		SELECT title, description
		FROM artefacts WHERE id = $1 AND archived_at IS NULL
	`

// sqlComputeTsvector recomputes the TSVECTOR via Postgres so we don't
// pay round-trip costs for the tokenisation logic. Returns the text
// representation that the UPDATE below casts back to tsvector.
const sqlComputeTsvector = `SELECT to_tsvector('english', $1)::text`

// sqlUpdateArtefactSearchAndEmbedding writes both the TSVECTOR and
// pgvector columns back to the artefacts row in one shot.
const sqlUpdateArtefactSearchAndEmbedding = `
		UPDATE artefacts
		SET search_index       = $2::tsvector,
		    content_embedding  = $3::vector
		WHERE id = $1
	`

// sqlRecordOutboxFailure bumps attempts, stamps last_error, and
// clears claimed_at so the row becomes eligible for retry.
const sqlRecordOutboxFailure = `
		UPDATE artefacts_search_outbox
		SET attempts   = attempts + 1,
		    last_error = $2,
		    claimed_at = NULL
		WHERE id = $1
	`
