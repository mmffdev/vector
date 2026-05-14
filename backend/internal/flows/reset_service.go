package flows

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ErrNoSnapshot is returned when an artefact type has no flow_defaults row —
// the seed never captured one (or the type was created post-seed).
var ErrNoSnapshot = errors.New("flows: no factory default snapshot for this artefact type")

// ErrNoSurvivor is returned when a Reset would leave an artefact stranded —
// the snapshot has no pill the artefact can rebind to. In practice this
// only happens if the snapshot is empty, which is a seed bug; we surface
// it so the UI can show a clear error rather than silently wiping the flow.
var ErrNoSurvivor = errors.New("flows: snapshot has no pill to rebind artefacts to")

// snapshotPill is one row from flow_state_defaults.
type snapshotPill struct {
	ID         string
	Name       string
	Kind       string
	SortOrder  int
	IsInitial  bool
	IsPullable bool
	Colour     *string
}

// snapshotEdge is one row from flow_transition_defaults, paired with names.
type snapshotEdge struct {
	FromID, ToID, FromName, ToName string
}

// livePill is one row from the live flow_states table, plus the surviving flag.
type livePill struct {
	ID          string
	Name        string
	Kind        string
	SortOrder   int
	IsInitial   bool
	IsPullable  bool
	Colour      *string
	MatchedSnap *snapshotPill // non-nil when (name, kind) matches a snapshot pill
}

// PreviewReset diffs the live default flow against the snapshot for one
// artefact type and returns what Apply would do — never mutates anything.
func (s *Service) PreviewReset(ctx context.Context, subscriptionID string, in ResetPreviewInput) (*ResetPreview, error) {
	tdata, err := s.loadResetData(ctx, subscriptionID, in.ArtefactTypeID)
	if err != nil {
		return nil, err
	}

	preview := &ResetPreview{
		ArtefactTypeID:   tdata.typeID,
		ArtefactTypeName: tdata.typeName,
		FlowID:           tdata.flowID,
		FlowName:         tdata.flowName,
		Pills:            []ResetPillDelta{},
		Transitions:      []ResetTransitionDelta{},
		ArtefactImpacts:  []ResetArtefactImpact{},
	}

	// Build pill deltas.
	livesByMatch := map[string]*livePill{}
	for i := range tdata.live {
		lp := &tdata.live[i]
		livesByMatch[matchKey(lp.Name, lp.Kind)] = lp
	}
	snapsByMatch := map[string]*snapshotPill{}
	for i := range tdata.snap {
		sp := &tdata.snap[i]
		snapsByMatch[matchKey(sp.Name, sp.Kind)] = sp
	}

	// Compute walk-back successor candidates: each live pill with the
	// "Survives" flag set when its (name, kind) is found in the snapshot.
	rebindUniverse := make([]pillRow, 0, len(tdata.live))
	for _, lp := range tdata.live {
		_, survives := snapsByMatch[matchKey(lp.Name, lp.Kind)]
		rebindUniverse = append(rebindUniverse, pillRow{
			ID: lp.ID, Name: lp.Name, SortOrder: lp.SortOrder, Survives: survives,
		})
	}

	// Pills present in live but not in snapshot — to remove (with successor).
	for _, lp := range tdata.live {
		if _, ok := snapsByMatch[matchKey(lp.Name, lp.Kind)]; ok {
			continue
		}
		succID, succName := pickSuccessor(
			pillRow{ID: lp.ID, Name: lp.Name, SortOrder: lp.SortOrder},
			rebindUniverse,
		)
		preview.Pills = append(preview.Pills, ResetPillDelta{
			Action:             "remove",
			LiveStateID:        lp.ID,
			Name:               lp.Name,
			Kind:               lp.Kind,
			SortOrder:          lp.SortOrder,
			IsInitial:          lp.IsInitial,
			IsPullable:         lp.IsPullable,
			SuccessorStateID:   succID,
			SuccessorStateName: succName,
		})
	}

	// Pills in snapshot — either keep, update (sort/initial/pullable diff), or add.
	for _, sp := range tdata.snap {
		lp, ok := livesByMatch[matchKey(sp.Name, sp.Kind)]
		if !ok {
			preview.Pills = append(preview.Pills, ResetPillDelta{
				Action: "add",
				Name: sp.Name, Kind: sp.Kind, SortOrder: sp.SortOrder,
				IsInitial: sp.IsInitial, IsPullable: sp.IsPullable,
			})
			continue
		}
		differs := lp.SortOrder != sp.SortOrder ||
			lp.IsInitial != sp.IsInitial ||
			lp.IsPullable != sp.IsPullable
		action := "keep"
		if differs {
			action = "update"
		}
		preview.Pills = append(preview.Pills, ResetPillDelta{
			Action: action,
			LiveStateID: lp.ID,
			Name: sp.Name, Kind: sp.Kind, SortOrder: sp.SortOrder,
			IsInitial: sp.IsInitial, IsPullable: sp.IsPullable,
		})
	}

	// Transition deltas — match by (from_match_key, to_match_key) since
	// IDs differ between live and snapshot once any edits have happened.
	liveEdgeKeys := map[string]bool{}
	for _, e := range tdata.liveEdges {
		liveEdgeKeys[edgeKey(e.FromName, e.FromID, tdata.live)+"|"+edgeKey(e.ToName, e.ToID, tdata.live)] = true
	}
	snapEdgeKeys := map[string]bool{}
	for _, e := range tdata.snapEdges {
		snapEdgeKeys[edgeKey(e.FromName, e.FromID, snapToLive(tdata.snap))+"|"+edgeKey(e.ToName, e.ToID, snapToLive(tdata.snap))] = true
	}
	// Add: in snapshot, not in live.
	for _, e := range tdata.snapEdges {
		k := edgeKey(e.FromName, e.FromID, snapToLive(tdata.snap)) + "|" + edgeKey(e.ToName, e.ToID, snapToLive(tdata.snap))
		if liveEdgeKeys[k] {
			continue
		}
		preview.Transitions = append(preview.Transitions, ResetTransitionDelta{
			Action: "add",
			FromStateID: e.FromID, ToStateID: e.ToID,
			FromName: e.FromName, ToName: e.ToName,
		})
	}
	// Remove: in live, not in snapshot.
	for _, e := range tdata.liveEdges {
		k := edgeKey(e.FromName, e.FromID, tdata.live) + "|" + edgeKey(e.ToName, e.ToID, tdata.live)
		if snapEdgeKeys[k] {
			continue
		}
		preview.Transitions = append(preview.Transitions, ResetTransitionDelta{
			Action: "remove",
			FromStateID: e.FromID, ToStateID: e.ToID,
			FromName: e.FromName, ToName: e.ToName,
		})
	}

	// Artefact rebind impacts: count live artefacts on each "remove" pill.
	for _, d := range preview.Pills {
		if d.Action != "remove" {
			continue
		}
		if d.SuccessorStateID == "" {
			return nil, ErrNoSurvivor
		}
		var count int
		err := s.vaPool.QueryRow(ctx, sqlCountArtefactsOnFlowState, d.LiveStateID).Scan(&count)
		if err != nil {
			return nil, fmt.Errorf("flows: count artefacts on %s: %w", d.LiveStateID, err)
		}
		if count > 0 {
			preview.ArtefactImpacts = append(preview.ArtefactImpacts, ResetArtefactImpact{
				RemovedStateID:    d.LiveStateID,
				RemovedStateName:  d.Name,
				SuccessorStateID:  d.SuccessorStateID,
				SuccessorStateName: d.SuccessorStateName,
				ArtefactCount:     count,
			})
		}
	}

	preview.AlreadyAtDefault = !hasChanges(preview)
	return preview, nil
}

// ApplyReset rewrites the live default flow to match the snapshot in one
// transaction: rebind impacted artefacts, archive removed pills, update
// kept pills' attributes, insert new pills, and rewrite transitions.
func (s *Service) ApplyReset(ctx context.Context, subscriptionID string, in ResetPreviewInput) (*ResetApplyResult, error) {
	preview, err := s.PreviewReset(ctx, subscriptionID, in)
	if err != nil {
		return nil, err
	}
	if preview.AlreadyAtDefault {
		return &ResetApplyResult{ArtefactTypeID: preview.ArtefactTypeID, FlowID: preview.FlowID}, nil
	}

	tx, err := s.vaPool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("flows: begin reset tx: %w", err)
	}
	defer tx.Rollback(ctx)

	result := &ResetApplyResult{
		ArtefactTypeID: preview.ArtefactTypeID,
		FlowID:         preview.FlowID,
	}

	// 1. Walk-back rebind first — artefacts move to successor BEFORE the
	//    state row gets archived (avoids momentary FK violations even
	//    though we soft-archive rather than hard delete).
	for _, imp := range preview.ArtefactImpacts {
		tag, err := tx.Exec(ctx, sqlRebindArtefactsToSuccessor,
			imp.SuccessorStateID, imp.RemovedStateID,
		)
		if err != nil {
			return nil, fmt.Errorf("flows: rebind artefacts: %w", err)
		}
		result.ArtefactsRebound += int(tag.RowsAffected())
	}

	// 2. For each pill delta — apply.
	//    Insert order: process "add" rows AFTER "update" so newly added
	//    initial pills don't collide with the partial unique index.
	var addRows []ResetPillDelta
	for _, d := range preview.Pills {
		switch d.Action {
		case "remove":
			_, err := tx.Exec(ctx, sqlArchiveFlowStateByID, d.LiveStateID)
			if err != nil {
				return nil, fmt.Errorf("flows: archive state %s: %w", d.LiveStateID, err)
			}
			result.PillsRemoved++
		case "update":
			_, err := tx.Exec(ctx, sqlUpdateFlowStateOrderAndFlags,
				d.SortOrder, d.IsInitial, d.IsPullable, d.LiveStateID,
			)
			if err != nil {
				return nil, fmt.Errorf("flows: update state %s: %w", d.LiveStateID, err)
			}
			result.PillsUpdated++
		case "add":
			addRows = append(addRows, d)
		}
	}
	for _, d := range addRows {
		_, err := tx.Exec(ctx, sqlInsertFlowStateForReset,
			preview.FlowID, d.Name, d.Kind, d.SortOrder, d.IsInitial, d.IsPullable,
		)
		if err != nil {
			return nil, fmt.Errorf("flows: insert state %s: %w", d.Name, err)
		}
		result.PillsAdded++
	}

	// 3. Reload live pill name->id map post-mutation (new IDs for added pills).
	liveByName, err := loadLiveNameIDMap(ctx, tx, preview.FlowID)
	if err != nil {
		return nil, err
	}

	// 4. Rewrite transitions.
	for _, t := range preview.Transitions {
		switch t.Action {
		case "remove":
			_, err := tx.Exec(ctx, sqlDeleteFlowTransitionByFlowFromTo,
				preview.FlowID, t.FromStateID, t.ToStateID,
			)
			if err != nil {
				return nil, fmt.Errorf("flows: drop transition: %w", err)
			}
			result.TransitionsRemoved++
		case "add":
			fromID, fromOK := liveByName[t.FromName]
			toID, toOK := liveByName[t.ToName]
			if !fromOK || !toOK {
				return nil, fmt.Errorf("flows: cannot map snapshot transition %s→%s to live state ids", t.FromName, t.ToName)
			}
			_, err := tx.Exec(ctx, sqlInsertFlowTransitionIdempotent,
				preview.FlowID, fromID, toID,
			)
			if err != nil {
				return nil, fmt.Errorf("flows: add transition: %w", err)
			}
			result.TransitionsAdded++
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("flows: commit reset: %w", err)
	}
	return result, nil
}

// matchKey is the (name, kind) pair used to pair live pills with snapshot pills.
func matchKey(name, kind string) string { return name + "\x00" + kind }

// edgeKey resolves a state id to its name within `pills` and returns the name —
// fall back to the raw id when not found (defensive).
func edgeKey(name, id string, pills []livePill) string {
	if name != "" {
		return name
	}
	for _, p := range pills {
		if p.ID == id {
			return p.Name
		}
	}
	return id
}

// snapToLive shims a []snapshotPill into []livePill for shared helpers.
func snapToLive(snap []snapshotPill) []livePill {
	out := make([]livePill, len(snap))
	for i, s := range snap {
		out[i] = livePill{ID: s.ID, Name: s.Name, Kind: s.Kind, SortOrder: s.SortOrder}
	}
	return out
}

func hasChanges(p *ResetPreview) bool {
	for _, d := range p.Pills {
		if d.Action != "keep" {
			return true
		}
	}
	return len(p.Transitions) > 0
}

// loadLiveNameIDMap reads name->id for live pills on the given flow within tx.
func loadLiveNameIDMap(ctx context.Context, tx pgx.Tx, flowID string) (map[string]string, error) {
	rows, err := tx.Query(ctx, sqlListFlowStateNameIDs, flowID)
	if err != nil {
		return nil, fmt.Errorf("flows: reload state ids: %w", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		out[name] = id
	}
	return out, rows.Err()
}
