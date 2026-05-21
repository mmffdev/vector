"use client";

// Work-items reparent rules — Slice 4 of the ObjectTree refactor.
//
// Extracted from V2's ObjectTree so the generic shell doesn't know
// about `PARENT_PREFIX_MAP` or artefact `type_prefix`. The two
// predicates here form the work-items domain's contribution to the
// drag-and-drop legality model:
//
//   canReparent(mover, target) → bool
//     true when moving `mover` so that `target` is its new parent is
//     a legal move per the artefact type hierarchy. Strict
//     cross-boundary rule from PARENT_PREFIX_MAP.
//
//   getCandidateIds(mover, visibleRows) → string[]
//     The set of ids in the current visible tree that are valid drop
//     targets when dragging `mover`. Includes both parent-candidates
//     (legal parents by type) and sibling-candidates (rows whose
//     parent is a legal parent — for above/below drops). Drives the
//     dragstart visual highlight.
//
// Other domains (sprints, releases, milestones) supply their own
// rules — sprints today have no parent semantics, so they pass null
// for the entire `dnd` block in the V2 config, and the drag engine
// skips reparent legality checks.
//
// Slice 1.5 will move this kind of "rule module" into a plugin
// registry where the V2 shell dynamically loads the right rules
// based on dataType. For now, V2 imports this directly from a
// well-known path; the indirection is enough to break the
// PARENT_PREFIX_MAP coupling.

import { PARENT_PREFIX_MAP } from "@/app/components/ArtefactInlineForm/types";

// Minimal row shape the rules need. Any T with these fields satisfies it —
// work-items rows already do (WorkItem from work-items-tree-config).
export interface ReparentableRow {
  id: string;
  parent_id: string | null;
  type_prefix?: string;
}

/**
 * True when dropping `mover` onto `target` would be a legal reparent.
 * Three guards in order:
 *   1. Self → false (no row is its own parent)
 *   2. Same-parent → false (no-op move, also avoids a wasted PATCH)
 *   3. target.type_prefix must be in PARENT_PREFIX_MAP[mover.type_prefix]
 *      (the cross-boundary rule — Task can't host Epic, Epic can host
 *      Story but not Task directly, etc.)
 */
export function workItemsCanReparent(
  mover: ReparentableRow,
  target: ReparentableRow,
): boolean {
  if (mover.id === target.id) return false;
  if (mover.parent_id === target.id) return false;
  const allowed = PARENT_PREFIX_MAP[mover.type_prefix?.toUpperCase() ?? ""] ?? [];
  const targetPrefix = target.type_prefix?.toUpperCase() ?? "";
  return allowed.includes(targetPrefix);
}

/**
 * Candidate pre-pass — given the mover row and a flat list of currently
 * visible rows, returns every id that's a legal drop target. The
 * computation is two-pass, O(n) over the visible set:
 *
 *   Pass 1: parent candidates — rows whose TYPE prefix is in the
 *           mover's allowed-parent list (and aren't the mover's
 *           current parent, since that'd be a no-op).
 *   Pass 2: sibling candidates — rows whose parent_id is in the
 *           parent-candidate set. These cover the "drop above/below
 *           a sibling under a legal new parent" case; without them,
 *           an expanded Epic's existing Story rows wouldn't stripe
 *           and the user couldn't drop a Story alongside them.
 *
 * Returns the union (parents + siblings) so the drag engine can
 * highlight every legal target the moment a drag starts.
 */
export function workItemsGetCandidateIds(
  mover: ReparentableRow,
  visibleRows: ReadonlyArray<ReparentableRow>,
): string[] {
  const allowed = PARENT_PREFIX_MAP[mover.type_prefix?.toUpperCase() ?? ""] ?? [];
  if (allowed.length === 0) return [];
  const allowedSet = new Set(allowed);
  const parentCandidateIds = new Set<string>();

  // Pass 1 — parent candidates by type.
  for (const row of visibleRows) {
    if (row.id === mover.id) continue;
    if (mover.parent_id === row.id) continue;
    const prefix = row.type_prefix?.toUpperCase() ?? "";
    if (allowedSet.has(prefix)) parentCandidateIds.add(row.id);
  }

  // Pass 2 — sibling candidates: any row whose parent IS a parent candidate.
  const out: string[] = Array.from(parentCandidateIds);
  for (const row of visibleRows) {
    if (row.id === mover.id) continue;
    if (parentCandidateIds.has(row.id)) continue; // already added
    if (!row.parent_id) continue;
    if (parentCandidateIds.has(row.parent_id)) {
      out.push(row.id);
    }
  }
  return out;
}
