package devtools

// flow_reseed.go — the flow-reseed action of the devtools framework.
//
// The job: rebuild contaminated flow definitions back to the canonical spine
// (see spine.go) for every in-scope standard artefact type, across BOTH halves
// of the flow model:
//
//   - the SNAPSHOT half  — flows_defaults / flows_states_defaults /
//     flows_transitions_defaults (the materialised "factory default" cache the
//     flows.Reset feature reads from). RebuildSnapshotForType rewrites this.
//   - the LIVE half       — flows / flows_states / flows_transitions (the rows
//     the product actually runs against). ReseedFlowToSpine rewrites this.
//
// All raw SQL lives in sql.go (sql-in-sqlfile-only lint); the runtime calls and
// the ordering logic live here.
//
// THE ORDERING CONSTRAINT (this is the load-bearing part of this file).
//
// artefacts.artefacts_id_flow_state → flows_states.flows_states_id is an
// ON DELETE RESTRICT foreign key. A live state row that any artefact currently
// sits on CANNOT be deleted — Postgres rejects the DELETE. At the same time,
// flows_states carries a partial unique index
// uq_flows_states_one_initial_per_flow (flows_states_id_flow WHERE is_initial
// AND archived_at IS NULL): a flow may have AT MOST ONE live initial state.
//
// These two constraints pull in opposite directions during a rebuild. We must
// (a) insert a fresh canonical initial state — but the old initial state is
// still live and still flagged initial, so a naive insert collides with the
// partial-unique index; and (b) delete the old states — but artefacts still
// reference them, so a naive delete trips the RESTRICT FK.
//
// The order that satisfies BOTH, used by ReseedFlowToSpine:
//
//	1. Demote every OLD live state on this flow to is_initial = false. This
//	   clears the partial-unique-initial index so a new initial can be inserted.
//	   (Old states are still live and still referenced by artefacts here — that
//	   is fine; we have not touched the RESTRICT FK yet.)
//	2. INSERT the canonical states (including the new initial). Capture
//	   name → new id. The unique-initial index is now free, so this succeeds.
//	3. REPOINT every artefact off the old states onto the new canonical INITIAL
//	   state: UPDATE artefacts SET id_flow_state = <new initial>
//	   WHERE id_flow_state IN (old state ids of this flow). After this no
//	   artefact references any old state, so the RESTRICT FK is satisfiable.
//	4. DELETE the old transitions (they reference old states; FK cascade would
//	   also drop them, but we delete explicitly so the count is honest), then
//	   DELETE the old states. Both are now unreferenced — RESTRICT is happy.
//	5. INSERT the canonical adjacent-bidirectional transitions over the new
//	   state ids.
//
// REPOINT-BEFORE-DELETE is therefore mandatory: step 4's DELETE of old states
// is only legal because step 3 moved every artefact off them first. Inverting
// 3 and 4 trips the RESTRICT FK on the very first artefact still parked on an
// old state.
//
// HARD DELETE, not archive. This is a dev rebuild on a throwaway DB (the action
// is gated by devEnvAllowed()). Archiving old states would leave the flow
// cluttered with dead pills and complicate the partial-unique reasoning; a hard
// delete yields a clean canonical flow with exactly the spine's states. The
// transaction is owned by the caller, so a failure at any step rolls back the
// whole rebuild atomically.

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TypeRef identifies one in-scope canonical artefact type. Subscription and
// workspace ids are non-pointer because artefacts_types pins both NOT NULL.
type TypeRef struct {
	ID             uuid.UUID
	Name           string
	SubscriptionID uuid.UUID
	WorkspaceID    uuid.UUID
}

// ReseedFlowResult counts the mutations one ReseedFlowToSpine call performed.
type ReseedFlowResult struct {
	ArtefactsRebound   int `json:"artefacts_rebound"`
	StatesArchived     int `json:"states_archived"` // hard-deleted old states (named per the result contract)
	StatesInserted     int `json:"states_inserted"`
	TransitionsRebuilt int `json:"transitions_rebuilt"`
}

// ReseedResult is the aggregate of a whole ReseedScope run.
type ReseedResult struct {
	TypesProcessed     int `json:"types_processed"`
	SnapshotsRebuilt   int `json:"snapshots_rebuilt"`
	FlowsRebuilt       int `json:"flows_rebuilt"`
	ArtefactsRebound   int `json:"artefacts_rebound"`
	StatesDeleted      int `json:"states_deleted"`
	StatesInserted     int `json:"states_inserted"`
	TransitionsRebuilt int `json:"transitions_rebuilt"`
}

// ReseedPreview is the read-only pre-flight count the handler surfaces before
// the operator confirms. It mutates nothing.
type ReseedPreview struct {
	Types            int  `json:"types"`
	DefaultFlows     int  `json:"default_flows"`
	CustomFlows      int  `json:"custom_flows"`
	FlowsTotal       int  `json:"flows_total"`
	ArtefactsRepoint int  `json:"artefacts_repoint"`
	IncludeCustom    bool `json:"include_custom_flows"`
}

// ---------------------------------------------------------------------------
// 1. Type selection
// ---------------------------------------------------------------------------

// ScopedCanonicalTypeIDs returns every live artefacts_types row whose NAME is
// in the canonical reseed set (spine.go) AND that falls within scope s.
//
// Scope narrowing for TYPES (not artefacts — types aren't node-scoped):
//   - SubscriptionID set → filter artefacts_types_id_subscription
//   - WorkspaceID set    → filter artefacts_types_id_workspace
//   - ArtefactTypeID set → restrict to that one type id (it must still be in
//     the canonical set, else it is dropped)
//   - TopologyNodeID     → IGNORED (types have no node dimension)
//
// Canonical-name membership is enforced in Go (SpineForTypeName) rather than in
// SQL so the closed set lives in exactly one place (spine.go).
func ScopedCanonicalTypeIDs(ctx context.Context, tx pgx.Tx, s Scope) ([]TypeRef, error) {
	clauses := []string{"artefacts_types_archived_at IS NULL"}
	var args []any
	n := 1
	if s.SubscriptionID != nil {
		clauses = append(clauses, fmt.Sprintf("artefacts_types_id_subscription = $%d", n))
		args = append(args, *s.SubscriptionID)
		n++
	}
	if s.WorkspaceID != nil {
		clauses = append(clauses, fmt.Sprintf("artefacts_types_id_workspace = $%d", n))
		args = append(args, *s.WorkspaceID)
		n++
	}
	if s.ArtefactTypeID != nil {
		clauses = append(clauses, fmt.Sprintf("artefacts_types_id = $%d", n))
		args = append(args, *s.ArtefactTypeID)
		n++
	}

	query := sqlSelectScopedTypesHead + strings.Join(clauses, " AND ") + sqlSelectScopedTypesTail

	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("devtools: scan scoped types: %w", err)
	}
	defer rows.Close()

	var out []TypeRef
	for rows.Next() {
		var r TypeRef
		if err := rows.Scan(&r.ID, &r.Name, &r.SubscriptionID, &r.WorkspaceID); err != nil {
			return nil, fmt.Errorf("devtools: scan type row: %w", err)
		}
		// Canonical-name gate — drop anything outside the reseed set.
		if _, ok := SpineForTypeName(r.Name); !ok {
			continue
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("devtools: iterate type rows: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// 2. Snapshot (defaults) rebuild
// ---------------------------------------------------------------------------

// RebuildSnapshotForType rewrites the flows_defaults / flows_states_defaults /
// flows_transitions_defaults rows for ONE type to the canonical spine for
// typeName. No artefacts reference the defaults tables, so there is no RESTRICT
// FK to dance around here — a straight delete-and-reinsert is safe.
//
// Steps:
//  1. Upsert the flows_defaults row for the type (one-per-type unique index);
//     name it "<typeName> default flow".
//  2. Delete existing flows_states_defaults for that flow_default —
//     flows_transitions_defaults cascade away via their ON DELETE CASCADE FK.
//  3. Insert the canonical states, capturing index → new default-state id.
//  4. Insert the adjacent-bidirectional transitions_defaults.
func RebuildSnapshotForType(ctx context.Context, tx pgx.Tx, typeID uuid.UUID, typeName string) error {
	spine, ok := SpineForTypeName(typeName)
	if !ok {
		return fmt.Errorf("devtools: %q is not a canonical reseed type", typeName)
	}
	flowName := typeName + " default flow"

	// 1. Upsert the default flow row, capture its id.
	var flowDefaultID uuid.UUID
	if err := tx.QueryRow(ctx, sqlUpsertFlowDefault, typeID, flowName).Scan(&flowDefaultID); err != nil {
		return fmt.Errorf("devtools: upsert flows_defaults for %q: %w", typeName, err)
	}

	// 2. Clear existing default states (transitions cascade).
	if _, err := tx.Exec(ctx, sqlDeleteFlowStatesDefaults, flowDefaultID); err != nil {
		return fmt.Errorf("devtools: clear flows_states_defaults for %q: %w", typeName, err)
	}

	// 3. Insert canonical default states, capturing index → id.
	stateIDByIdx := make([]uuid.UUID, len(spine.States))
	for i, st := range spine.States {
		var sid uuid.UUID
		if err := tx.QueryRow(ctx, sqlInsertFlowStateDefault,
			flowDefaultID, st.Name, st.Kind, st.SortOrder, st.IsInitial, st.IsPullable,
		).Scan(&sid); err != nil {
			return fmt.Errorf("devtools: insert default state %q for %q: %w", st.Name, typeName, err)
		}
		stateIDByIdx[i] = sid
	}

	// 4. Insert adjacent-bidirectional default transitions.
	for _, e := range spine.AdjacentTransitions() {
		if _, err := tx.Exec(ctx, sqlInsertFlowTransitionDefault,
			flowDefaultID, stateIDByIdx[e[0]], stateIDByIdx[e[1]],
		); err != nil {
			return fmt.Errorf("devtools: insert default transition for %q: %w", typeName, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// 3. Live flow rebuild (RESTRICT-FK-safe)
// ---------------------------------------------------------------------------

// ReseedFlowToSpine rebuilds ONE live flow's states + transitions to the spine.
// See the package doc at the top of this file for the full ordering rationale;
// the short version is the numbered steps below. The caller owns the tx.
func ReseedFlowToSpine(ctx context.Context, tx pgx.Tx, flowID uuid.UUID, spine SpineDef) (ReseedFlowResult, error) {
	var res ReseedFlowResult

	// 1. Demote every existing live initial state on this flow so the
	//    partial-unique-initial index is free before we insert the new one.
	if _, err := tx.Exec(ctx, sqlDemoteOldInitialStates, flowID); err != nil {
		return res, fmt.Errorf("devtools: demote old initial state on flow %s: %w", flowID, err)
	}

	// 2. Insert the canonical states; capture index → new id and remember the
	//    new initial state id for the artefact repoint.
	newStateIDByIdx := make([]uuid.UUID, len(spine.States))
	var newInitialID uuid.UUID
	haveInitial := false
	for i, st := range spine.States {
		var sid uuid.UUID
		if err := tx.QueryRow(ctx, sqlInsertLiveFlowState,
			flowID, st.Name, st.Kind, st.SortOrder, st.IsInitial, st.IsPullable,
		).Scan(&sid); err != nil {
			return res, fmt.Errorf("devtools: insert live state %q on flow %s: %w", st.Name, flowID, err)
		}
		newStateIDByIdx[i] = sid
		res.StatesInserted++
		if st.IsInitial {
			newInitialID = sid
			haveInitial = true
		}
	}
	if !haveInitial {
		// A spine with no initial state cannot anchor the artefact repoint;
		// this is a spine-definition bug, surface it rather than orphan rows.
		return res, fmt.Errorf("devtools: spine for flow %s has no initial state", flowID)
	}

	// 3. Repoint every artefact off the OLD states onto the new initial state.
	//    The subquery selects the old states (everything on this flow that is
	//    NOT one of the ids we just inserted). After this UPDATE no artefact
	//    references an old state, so the RESTRICT FK is satisfiable in step 4.
	tag, err := tx.Exec(ctx, sqlRepointArtefactsToInitial, newInitialID, flowID, newStateIDByIdx)
	if err != nil {
		return res, fmt.Errorf("devtools: repoint artefacts on flow %s: %w", flowID, err)
	}
	res.ArtefactsRebound = int(tag.RowsAffected())

	// 4. Delete OLD transitions, then OLD states (now unreferenced).
	//    Deleting all transitions on the flow is safe: the new states have no
	//    transitions yet, so this only removes stale edges between old states.
	if _, err := tx.Exec(ctx, sqlDeleteFlowTransitionsForFlow, flowID); err != nil {
		return res, fmt.Errorf("devtools: delete old transitions on flow %s: %w", flowID, err)
	}
	delTag, err := tx.Exec(ctx, sqlDeleteOldFlowStates, flowID, newStateIDByIdx)
	if err != nil {
		return res, fmt.Errorf("devtools: delete old states on flow %s: %w", flowID, err)
	}
	res.StatesArchived = int(delTag.RowsAffected())

	// 5. Insert canonical adjacent-bidirectional transitions over the new ids.
	for _, e := range spine.AdjacentTransitions() {
		if _, err := tx.Exec(ctx, sqlInsertLiveFlowTransition,
			flowID, newStateIDByIdx[e[0]], newStateIDByIdx[e[1]],
		); err != nil {
			return res, fmt.Errorf("devtools: insert transition on flow %s: %w", flowID, err)
		}
		res.TransitionsRebuilt++
	}

	return res, nil
}

// ---------------------------------------------------------------------------
// 4. Top-level engine
// ---------------------------------------------------------------------------

// ReseedScope is the top-level reseed engine. For each in-scope canonical type
// it rebuilds the snapshot, then rebuilds each live flow for that type to the
// type's canonical spine. When includeCustomFlows is false only the default
// flow (flows_is_default = true) is rebuilt; when true every live flow for the
// type is rebuilt. The caller owns the transaction.
func ReseedScope(ctx context.Context, tx pgx.Tx, s Scope, includeCustomFlows bool) (ReseedResult, error) {
	var res ReseedResult

	types, err := ScopedCanonicalTypeIDs(ctx, tx, s)
	if err != nil {
		return res, err
	}

	for _, t := range types {
		spine, ok := SpineForTypeName(t.Name)
		if !ok {
			// ScopedCanonicalTypeIDs already filtered to canonical names, so
			// this is unreachable — guard anyway rather than index a bad spine.
			continue
		}

		// Snapshot half.
		if err := RebuildSnapshotForType(ctx, tx, t.ID, t.Name); err != nil {
			return res, err
		}
		res.SnapshotsRebuilt++
		res.TypesProcessed++

		// Live half — collect the flows to rebuild for this type.
		flowIDs, err := liveFlowIDsForType(ctx, tx, t.ID, includeCustomFlows)
		if err != nil {
			return res, err
		}
		for _, fID := range flowIDs {
			fr, err := ReseedFlowToSpine(ctx, tx, fID, spine)
			if err != nil {
				return res, err
			}
			res.FlowsRebuilt++
			res.ArtefactsRebound += fr.ArtefactsRebound
			res.StatesDeleted += fr.StatesArchived
			res.StatesInserted += fr.StatesInserted
			res.TransitionsRebuilt += fr.TransitionsRebuilt
		}
	}

	return res, nil
}

// liveFlowIDsForType returns the live flow ids to rebuild for one type. When
// includeCustom is false only the default flow is returned.
func liveFlowIDsForType(ctx context.Context, tx pgx.Tx, typeID uuid.UUID, includeCustom bool) ([]uuid.UUID, error) {
	query := sqlSelectLiveFlowsHead
	if !includeCustom {
		query += sqlSelectLiveFlowsDefaultOnly
	}
	query += sqlSelectLiveFlowsTail

	rows, err := tx.Query(ctx, query, typeID)
	if err != nil {
		return nil, fmt.Errorf("devtools: list live flows for type %s: %w", typeID, err)
	}
	defer rows.Close()

	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("devtools: scan flow id: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// 5. Read-only preview
// ---------------------------------------------------------------------------

// PreviewReseed counts what ReseedScope WOULD do without mutating anything: the
// number of in-scope canonical types, the default/custom flow split, and the
// number of artefacts that would be repointed off old states. The handler calls
// this for the pre-flight confirm copy.
func PreviewReseed(ctx context.Context, tx pgx.Tx, s Scope, includeCustomFlows bool) (ReseedPreview, error) {
	prev := ReseedPreview{IncludeCustom: includeCustomFlows}

	types, err := ScopedCanonicalTypeIDs(ctx, tx, s)
	if err != nil {
		return prev, err
	}
	prev.Types = len(types)
	if len(types) == 0 {
		return prev, nil
	}

	typeIDs := make([]uuid.UUID, len(types))
	for i, t := range types {
		typeIDs[i] = t.ID
	}

	// Default vs custom flow split for the in-scope types.
	if err := tx.QueryRow(ctx, sqlPreviewFlowSplit, typeIDs).Scan(&prev.DefaultFlows, &prev.CustomFlows); err != nil {
		return prev, fmt.Errorf("devtools: preview flow split: %w", err)
	}
	if includeCustomFlows {
		prev.FlowsTotal = prev.DefaultFlows + prev.CustomFlows
	} else {
		prev.FlowsTotal = prev.DefaultFlows
	}

	// Artefacts that would be repointed: every live artefact sitting on a state
	// of an in-scope flow. ReseedFlowToSpine moves all of them onto the new
	// initial state, so every such artefact is a repoint. The flow filter is a
	// hard-coded constant fragment — never caller input — chosen by the flag.
	flowFrag := sqlFragFlowDefaultOnly
	if includeCustomFlows {
		flowFrag = sqlFragFlowAny
	}
	query := fmt.Sprintf(sqlPreviewArtefactRepoint, flowFrag)
	if err := tx.QueryRow(ctx, query, typeIDs).Scan(&prev.ArtefactsRepoint); err != nil {
		return prev, fmt.Errorf("devtools: preview artefact repoint count: %w", err)
	}

	return prev, nil
}
