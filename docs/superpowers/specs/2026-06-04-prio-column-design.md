# Prio Column — Sequential Ranking on the Execution Grid

**Date:** 2026-06-04
**Status:** Design — pending plan
**Scope:** `/scope` execution grid ([Grid__Tree](../../../app/components/Grid/Grid__Tree.tsx) + [GridExecution](../../../app/(user)/scope/GridExecution.tsx))
**Pattern reference:** Rally / Broadcom Rally `DragAndDropRank` (validated 2026-06-04 via [deep-research workflow](https://techdocs.broadcom.com/us/en/ca-enterprise-software/valueops/rally/rally-help/planning/building-your-backlog/prioritizing-work/drag-and-drop-ranking.html) + user-confirmed via two parent/child screenshots).

---

## Problem

The execution grid renders top-level artefacts (Epics, Stories not nested under an Epic, Defects, Risks — but never Tasks) as a tree. Users currently have no at-a-glance ordinal — "where in the queue is this thing?". They want a `Prio` column rendering `1..n` in display order so they can:

- Reference items by ordinal in conversation ("Prio 5 needs a second pair").
- See immediately how deep the queue is.
- Confirm drag-reorder, delete, and insert operations resulted in the order they intended.

The ordinal must behave correctly when the user switches between a focused topology-node view (sees only that node's items) and a parent-rollup view (sees the amalgamated set across child nodes). Rally is the canonical reference for this UX and was used to validate the model.

## Non-goals

- A persisted `prio` column in the database. Position is already global; Prio is a derived projection.
- Changes to `/rank/move` semantics or the existing DnD wiring.
- Prio numbering for Tasks (excluded by design; Rally also excludes Tasks from cross-project ranking).
- Prio for nested artefacts (e.g. Stories under an Epic, Defects under a Story). Nested rows render an empty Prio cell.
- A new mutation surface. All four user rules (add, delete, reorder, duplicate) flow through existing endpoints.

## Model

### Substrate (already exists)

The `artefacts.artefacts_position` column is a sparse INT (insert gap = 100) per artefact, maintained by [`backend/internal/ranking`](../../../backend/internal/ranking) via the `/rank/move` endpoint. It is **global within the workspace** — one position per artefact, not partitioned. This is structurally equivalent to Rally's `DragAndDropRank` token (lexorank-style, one per artifact, workspace-wide).

### Prio (new — derived)

A SQL window function projects `artefacts_position` to a dense `1..n` *over whatever the read query's result set contains*. Because the handler already applies workspace + topology-node clamps (sentinel + `?meg=`), the window naturally densifies per visible scope:

- Focus on child node "B2B Insurance" → cohort = items pinned to that node → Prio = 1..n among those.
- Focus on parent node containing B2B Insurance + others → cohort = amalgamated set → Prio = 1..(n+m+...), continuous, no duplicates.

The relative order is preserved across both views because position is global. The displayed number floats with scope — this matches Rally exactly. User-supplied Rally screenshots (2026-06-04 chat) confirmed: a parent-rollup view showed 1..13 continuous, and a child-node view of the same data showed the visible subset densified to 1..9 with relative order intact (e.g. US16 was rank 6 in the parent view, rank 5 in the child; US8 was 10 → 6; US13 11 → 7; etc.).

### Filter (cohort definition)

A row receives a Prio iff **all three** are true:

1. `artefacts_id_parent IS NULL` — top-level (not nested under any artefact).
2. `artefacts_types_slot != 'wrk_task'` — not a Task.
3. Row passes the read query's scope filter (workspace + topology clamp + any user filters).

Rows that fail any of these get `NULL` Prio. The grid renders `NULL` as an empty cell.

## Backend

### SQL change

In [`backend/internal/artefactitems/sql.go`](../../../backend/internal/artefactitems/sql.go), augment the top-level and children read queries with:

```sql
CASE
  WHEN a.artefacts_id_parent IS NULL
   AND t.artefacts_types_slot != 'wrk_task'
  THEN ROW_NUMBER() OVER (
    PARTITION BY (
      a.artefacts_id_parent IS NULL
      AND t.artefacts_types_slot != 'wrk_task'
    )
    ORDER BY a.artefacts_position ASC, a.artefacts_number ASC
  )
  ELSE NULL
END AS artefacts_prio
```

Notes:
- Partition expression is a boolean — effectively "qualifying rows form one partition, non-qualifying form another (whose ROW_NUMBER values we discard via the CASE)". This avoids dense-rank gaps from non-qualifying rows.
- Ordering by `(position ASC, number ASC)` matches the existing default sort and gives a deterministic tiebreaker.
- The window runs *over the filtered result set* — clamps (workspace, topology, user filters) apply in `WHERE` before the window evaluates, so densification is per-view automatically.

### DTO

[`backend/internal/artefactitems/types.go`](../../../backend/internal/artefactitems/types.go) — add to the artefact item response struct:

```go
Prio *int `json:"prio,omitempty"`
```

Nullable. Encoded as `null` when the row is nested, a Task, or otherwise non-qualifying. Encoded as the dense rank integer otherwise.

### No new mutations

- **Add:** existing create flow assigns `position = MAX(position) + 100` (already implemented). New row appears at end of cohort with `Prio = max(prio) + 1` on next read.
- **Delete:** row drops out of result set. Surviving rows' `ROW_NUMBER` shifts down naturally on next read. No write needed.
- **Reorder (DnD):** existing `/rank/move` updates `artefacts_position` based on visible neighbors. ROW_NUMBER re-projects. No write to Prio (it doesn't exist as a column).
- **Duplicate:** existing duplicate flow assigns next position. *Open question — see Open Questions §1.*

### Test surface

- Unit/integration: window projection returns dense `1..n` for qualifying rows in a multi-row, multi-type, multi-parent dataset.
- Tasks and nested artefacts return `NULL`.
- After `/rank/move`, the next read reflects the new dense ordering.
- After delete, the gap closes on next read.
- After reparent INTO an Epic, the moved row's Prio becomes `NULL`; cohort renumbers.
- After reparent OUT of an Epic, the row re-enters the cohort with a new Prio.
- Two different scope clamps over the same dataset produce different but order-preserving Prio values (the validated Rally model).

## Frontend

### Column insertion

In [`app/(user)/scope/scopeColumns.tsx`](../../../app/(user)/scope/scopeColumns.tsx), `makeScopeColumns()` returns the column array. Insert a new column at **index 0**:

```ts
{
  id: 'prio',
  label: 'Prio',
  defaultWidth: 56,           // 3-4 digits + padding (matches Rally's column width feel)
  sortable: true,             // server-side; maps to ORDER BY artefacts_position ASC
  resizable: false,           // fixed-width is correct for a 1-4 digit ordinal
  renderCell: (row) => (
    <span className="grid-tree__prio">{row.prio ?? ''}</span>
  ),
}
```

### Tree caret + indent

Because it sits at index 0, the Prio column inherits the primary-column responsibilities from [Grid__Tree_Row](../../../app/components/Grid/Grid__Tree_Row.tsx):
- Expand/collapse caret rendered before the cell content.
- [Grid__Tree_Lines](../../../app/components/Grid/Grid__Tree_Lines.tsx) SVG indent before the cell content.

This is acceptable — Rally's UI carries the expand caret (`>` glyph) on the rank-column row when the row has children (confirmed in the user-supplied screenshots: US2 at rank 5 and US8 at rank 10 in the parent view both render a caret on their rank cell).

### Default sort

Default sort stays unchanged (`artefacts_position ASC, artefacts_number ASC`). The Prio column header shows the ascending sort indicator by default — Prio ascending is mechanically identical to position ascending.

### Styling

New CSS class in [`app/components/Grid/Grid__Tree_Row.tsx`](../../../app/components/Grid/Grid__Tree_Row.tsx) co-located stylesheet or [`app/globals.css`](../../../app/globals.css):

```css
.grid-tree__prio {
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-weight: 500;
  color: var(--text-secondary);
}
```

Tabular numerals so vertical alignment is clean across 1, 10, 100, 1000.

## Edge cases

| Scenario | Behaviour |
|---|---|
| Top-level Epic | Has Prio. |
| Top-level Story (not under any Epic) | Has Prio. |
| Top-level Defect | Has Prio. |
| Top-level Risk | Has Prio. |
| Story nested under Epic | `Prio = NULL`. Empty cell. |
| Defect nested under Story | `Prio = NULL`. Empty cell. |
| Task (any position) | `Prio = NULL`. Empty cell. |
| Reparent OUT of Epic (back to top-level) | Re-enters cohort; Prio = derived from dropped position. |
| Reparent INTO Epic (was top-level) | Prio becomes `NULL` on next read. |
| Duplicate from top-level | Position = existing-flow default. See Open Questions §1. |
| Filter applied (e.g. owner = me) | Prio re-densifies among visible rows. Matches Rally. |
| Workspace switch | New cohort; new Prio. |
| Topology focus change | New cohort; new Prio (smaller scope → smaller numbers; broader scope → larger numbers). |

## Open Questions

### §1 — Duplicate placement

User spec says: "we duplicate an artefact, it gets a number of copied from `c=current+1`" — i.e. the duplicate slots immediately after the source. The existing duplicate flow most likely appends at end of cohort (position = MAX + 100). Behaviour to confirm and a possible follow-up story to insert the duplicate at `(source_position + next_sibling_position) / 2` instead of MAX+100.

**Recommendation:** ship this design with duplicate-at-end (existing behaviour), then file a follow-up story to refine duplicate-placement once the column is live and the visual difference is observable. This keeps the Prio column shippable independently.

### §2 — Performance at scale

`ROW_NUMBER() OVER (ORDER BY artefacts_position)` over a workspace with ~10k top-level artefacts is sub-millisecond on a btree-indexed sort. Confirm an index exists on `(artefacts_id_subscription, artefacts_id_workspace, artefacts_id_parent, artefacts_position)` or equivalent; add one if not.

### §3 — Sort indicator semantics

When the user clicks "Prio" header to invert sort (descending), should the displayed numbers stay `1..n` from the top (matching screen position) or invert to `n..1`? Rally renders the rank number always-ascending in the column even when the table sort is inverted by another column. Recommended: same here — Prio is *what the number is*, not *what direction we're sorted*.

## Risks

- **Caret-on-number cell** may visually crowd a 4-digit Prio + caret + indent. Mitigation: 56px column gives ~24px for caret/indent and ~32px for the number, sufficient for 4 digits with tabular nums. If it crowds at 4+ digits in practice, lift Prio to a "lead control" alongside stripe/select/drag (no caret, no sort header). Defer this judgement to visual review.
- **Sort-by-Prio click** triggering a server fetch with `sort=artefacts_position` may conflict with other column sorts. The grid's existing sort state machine handles single-column sort cleanly — no special handling needed.
- **Performance** of `ROW_NUMBER` on very large tenant datasets (100k+ top-level artefacts in scope at once). Unlikely to hit in practice — the topology clamp typically narrows scope dramatically. If it becomes a hotspot, materialise Prio nightly into a sidecar (out of scope for this design).

## Acceptance

Per the user's five rules in the original message:

1. **New artefact gets next number** — covered by existing create + window projection. ✓
2. **Remove artefact, higher numbers decrement** — window re-derives on next read. ✓
3. **Reorder by drag, lands at target position +1 of item above** — covered by existing `/rank/move` + window. ✓
4. **Reorder, all higher-numbered get +1** — window re-derives on next read. ✓
5. **Duplicate gets `source+1`, all higher get +1** — Open Question §1 (existing flow may append; follow-up if needed).

Visual proof: the new column should reproduce the Rally behaviour seen in the reference screenshots — single view shows continuous `1..n`, switching from parent to child view densifies the visible subset, relative order preserved.

---

## Implementation outline

1. Backend SQL window projection + nullable `Prio` DTO field + integration tests covering the seven edge cases above.
2. Frontend `Prio` column at index 0 in `scopeColumns.tsx` + CSS class + visual review against the two Rally reference screenshots.
3. Verify Open Question §1 — read the duplicate handler, file follow-up story if `source+1` placement is wanted.
4. Confirm Open Question §2 — index on `(workspace, parent, position)` exists or add migration.
5. Manual verification: parent-node focus vs child-node focus shows correctly densified rank with relative order preserved.

Detailed plan to follow via `superpowers:writing-plans`.
