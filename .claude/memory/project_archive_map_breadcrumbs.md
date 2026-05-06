---
name: Archive map flyout — live breadcrumb rows
description: Why ArchiveMapFlyout shows muted "live" rows between the anchor and archived twigs (PLA-0006 fix, 2026-05-04)
type: project
originSessionId: 2af977f2-07e2-4db6-9734-a27922315e85
---
The `/topology` archive-map flyout (`app/components/ArchiveMapFlyout.tsx`) renders TWO row kinds: `archived` (with Restore button) and `live` (muted/italic, "live" tag, no button).

**Why:** The `/api/topology/nodes/{id}/archived-descendants` endpoint walks live descendants of the anchor first, then enters every archived branch hanging off any of them. So an archived twig (e.g. B) can have a `parent_id` pointing to a LIVE intermediate (e.g. A) that is NOT in the returned list. A naive walk from anchor → would find no children whose `parent_id == anchor` and render an empty flyout, even though the warning triangle (rollup count) correctly says ≥1. Bug surfaced 2026-05-04 when archiving B under live A under anchor Bank 1.

**How to apply:**
- `buildRows` in `ArchiveMapFlyout.tsx` stitches live intermediates by walking each archived row's `parent_id` chain up through the parent-supplied `liveAncestors` map until it hits the anchor. Live intermediates render as muted breadcrumb rows.
- The parent (`app/(overlay)/topology/page.tsx`) builds `liveAncestorsMap: Map<id, {name, parentId}>` from its `tree` state and passes it as a prop. If you add a new caller of `<ArchiveMapFlyout>`, you MUST pass this map or the flyout breaks the same way.
- `useEffect` clears `list` to `null` on `nodeId` change to prevent the stale-render flash when the user clicks a different triangle while the flyout is already open.
- The Restore button's `parent_is_archived && depth > 0` guard depends on rendered tree depth matching reality — that's another reason this fix synthesises live rows instead of flattening everything to depth 0.
