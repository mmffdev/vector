# ObjectTreeV2 Inline Flyouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move both ObjectTreeV2 flyouts (create + row-detail/edit) INSIDE the `<ResourceTree>` table as `<tr>` rows so they push the grid + pagination down rather than rendering as siblings outside it. Tighten CSS so title bars are flush (no top radius, no gaps above/below).

**Architecture:** ResourceTree gains a new `renderCreateRow` prop that injects a `<tr.row-create>` as the first tbody row. The existing `renderRowDetail` slot is reused for the WorkItem detail flyout (currently rendered as a sibling after `<Panel>`). OTV2 routes both create and detail through these slots based on adapter presence. CSS removes top radius from title bars and flushes the `<tr>` cells top/bottom.

**Tech Stack:** Next.js 14 (App Router), TypeScript, React 18, plain CSS in `app/globals.css`. Component cluster: `app/components/ObjectTreeV2/p_ObjectTree.tsx`, `app/components/ResourceTree.tsx`, `app/components/ArtefactInlineForm/ArtefactInlineForm.tsx`.

**Spec:** [docs/superpowers/specs/2026-05-29-objecttree-inline-flyouts-design.md](../specs/2026-05-29-objecttree-inline-flyouts-design.md)

**Branch:** main (no worktree — this is a focused UI change touching three files).

---

## File Structure

**Modify:**
- `app/components/ResourceTree.tsx` — add `renderCreateRow` prop + render `<tr.row-create>` before paged rows; existing `renderRowDetail` mechanism stays as-is.
- `app/components/ObjectTreeV2/p_ObjectTree.tsx` — generalise `renderAdapterRowDetail` to also serve the WorkItem route; wire `renderCreateRow` to the existing `createFlyoutNode` / `adapterCreateFlyoutNode`; remove the two `{inlineFormNode}` sibling renders and the two `{...createFlyoutNode}` renders inside `inner`.
- `app/globals.css` — drop top radius on title bars; add flush-top rule for `.tree_accordion-dense__cell--row-detail`; add new `.tree_accordion-dense__row-create` + `.tree_accordion-dense__cell--row-create` rules mirroring the row-detail block.

**No new files. No deletions. No moved files.**

---

## Pre-flight verification (5 min)

Before touching code, confirm two structural assumptions from the spec:

- [ ] **Step 0.1: Confirm pagination is outside the table**

Run: `grep -n "</table>\|<Pagination" "app/components/ResourceTree.tsx" | head -5`
Expected: `</table>` appears before `<Pagination` in the JSX. (Verified during spec-writing — re-check before edits.)

- [ ] **Step 0.2: Confirm ArtefactInlineForm title bar class**

Run: `grep -n "artefact-inline-form__Container_Head" "app/components/ArtefactInlineForm/ArtefactInlineForm.tsx"`
Expected: Class appears on a `<header>` element with `--duplicate` / `--deleting` modifier classes nearby.

If either assumption fails, STOP and re-read the spec before continuing.

---

## Task 1: Add `renderCreateRow` prop to ResourceTree

**Files:**
- Modify: `app/components/ResourceTree.tsx` (add prop to type, destructure, inject `<tr>` before `renderRows`)

- [ ] **Step 1.1: Add the prop to the type definition**

Locate the existing `renderRowDetail` prop (currently around `app/components/ResourceTree.tsx:288`). Insert the new prop immediately after it.

Replace:
```ts
  renderRowDetail?: (row: T) => React.ReactNode | null;

  // Disable the inner scroll container — table grows to natural height
```

With:
```ts
  renderRowDetail?: (row: T) => React.ReactNode | null;

  // OTV2 create-row slot — when defined and returning non-null, an extra
  // table row is injected as the FIRST tbody row (above the first data
  // row, below <thead>) with a single colSpan cell containing the
  // returned React node. Used to host an inline "create new" flyout
  // that pushes the rest of the grid + pagination down rather than
  // rendering as a sibling outside the table. Return null when the
  // create flyout is closed. Opt-in: omit to keep legacy behaviour
  // (no extra row injected).
  renderCreateRow?: () => React.ReactNode | null;

  // Disable the inner scroll container — table grows to natural height
```

- [ ] **Step 1.2: Destructure the prop in the component**

Locate the destructured prop block (currently around line 882 where `renderRowDetail` is destructured). Add `renderCreateRow` right after.

Replace:
```ts
  renderRowDetail,
  disableInnerScroll,
```

With:
```ts
  renderRowDetail,
  renderCreateRow,
  disableInnerScroll,
```

- [ ] **Step 1.3: Inject the create row at the top of `<tbody>`**

Locate the `<tbody>` render (currently `app/components/ResourceTree.tsx:1931`).

Replace:
```tsx
          <tbody>{renderRows(pagedRoots, 0)}</tbody>
```

With:
```tsx
          <tbody>
            {(() => {
              // OTV2 create-row slot — single colSpan <tr> at the top of
              // tbody (above the first data row, below <thead>). Hosts
              // the create flyout inline so it pushes the rest of the
              // grid down. e.stopPropagation on the cell prevents the
              // outside-click handlers from treating clicks inside the
              // flyout as table clicks.
              const createNode = renderCreateRow?.();
              if (!createNode) return null;
              return (
                <tr className="tree_accordion-dense__row-create">
                  <td
                    className="tree_accordion-dense__cell tree_accordion-dense__cell--row-create"
                    colSpan={columns.length + leadOffset}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {createNode}
                  </td>
                </tr>
              );
            })()}
            {renderRows(pagedRoots, 0)}
          </tbody>
```

- [ ] **Step 1.4: Verify the build still passes**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: No new errors. (If ResourceTree has existing errors, none of them should mention `renderCreateRow` or the lines you edited.)

- [ ] **Step 1.5: Commit**

```bash
git add app/components/ResourceTree.tsx
git commit -m "$(cat <<'EOF'
feat(resourcetree): add renderCreateRow slot for inline create flyouts

Single colSpan <tr> at the top of <tbody>, mirrors the existing
renderRowDetail mechanism. Lets OTV2 host the create flyout inside
the table so opening it pushes the grid + pagination down rather
than rendering as a sibling outside the table.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Generalise `renderAdapterRowDetail` to serve both routes

OTV2 currently routes the adapter's row flyout through `renderRowDetail` ([p_ObjectTree.tsx:2104-2117](../../app/components/ObjectTreeV2/p_ObjectTree.tsx#L2104-L2117)). The WorkItem route doesn't use it — instead it renders `inlineFormNode` as a sibling after `<Panel>` (lines 2273, 2280). This task collapses both routes into the same callback.

**Files:**
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx`

- [ ] **Step 2.1: Rename and generalise the callback**

Locate `renderAdapterRowDetail` (currently `p_ObjectTree.tsx:2104-2117`).

Replace:
```tsx
  // Inline row-detail render function — ResourceTree calls this per row
  // and injects the returned node into an extra <tr> directly under that
  // row. Returns null for rows that aren't the active flyout row, so the
  // flyout only expands under the clicked row (not all rows).
  const renderAdapterRowDetail = useCallback(
    (row: WorkItem): React.ReactNode | null => {
      if (!adapter?.renderRowFlyout) return null;
      if (flyoutRowId !== (row as { id: string }).id) return null;
      return adapter.renderRowFlyout(row as unknown as T, {
        onClose: () => setFlyoutRowId(null),
        onSaved: () => {
          setFlyoutRowId(null);
          setAdapterRefreshTick((n) => n + 1);
        },
      });
    },
    [adapter, flyoutRowId],
  );
```

With:
```tsx
  // Inline row-detail render function — ResourceTree calls this per row
  // and injects the returned node into an extra <tr> directly under that
  // row. Returns null for rows that aren't the active flyout row, so the
  // flyout only expands under the clicked row (not all rows). Serves
  // both routes:
  //   - Adapter mounts (CustomFields etc): forward to
  //     adapter.renderRowFlyout. The host owns the flyoutRowId state.
  //   - WorkItem mounts (default): return the WorkItem inlineFormNode
  //     IFF openInlineFormId === row.id. The inline form is the
  //     ObjectTreeDetailFlyout-wrapped ArtefactInlineForm built below.
  const renderRowDetail = useCallback(
    (row: WorkItem): React.ReactNode | null => {
      const rowId = (row as { id: string }).id;
      if (adapter?.renderRowFlyout) {
        if (flyoutRowId !== rowId) return null;
        return adapter.renderRowFlyout(row as unknown as T, {
          onClose: () => setFlyoutRowId(null),
          onSaved: () => {
            setFlyoutRowId(null);
            setAdapterRefreshTick((n) => n + 1);
          },
        });
      }
      // WorkItem route — only emit the flyout for the matching row.
      if (openInlineFormId !== rowId) return null;
      return inlineFormNode;
    },
    [adapter, flyoutRowId, openInlineFormId, inlineFormNode],
  );
```

(`inlineFormNode` is the `<ObjectTreeDetailFlyout .../>` declared above at line 2055 — it's already in scope.)

- [ ] **Step 2.2: Wire the unified callback into ResourceTree**

Locate the existing wiring (currently `p_ObjectTree.tsx:2204-2210`).

Replace:
```tsx
        {...(adapter?.renderRowFlyout && {
          renderRowDetail: renderAdapterRowDetail,
          // Drop the inner scroll container so opening the inline flyout
          // pushes the whole panel down instead of spawning a second
          // scrollbar competing with the page scroll.
          disableInnerScroll: true,
        })}
```

With:
```tsx
        renderRowDetail={renderRowDetail}
        // Drop the inner scroll container so opening the inline flyout
        // (adapter row flyout OR WorkItem edit flyout) pushes the whole
        // panel down instead of spawning a second scrollbar competing
        // with the page scroll. Applies to both routes — the row-detail
        // mechanism is unified.
        disableInnerScroll
```

- [ ] **Step 2.3: Verify typecheck**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: No new errors. The `renderRowDetail` callback signature returns `React.ReactNode | null` which matches the prop on `<ResourceTree<WorkItem>>`.

- [ ] **Step 2.4: Commit (no behaviour change yet — sibling `{inlineFormNode}` is still rendered too, double-render until Task 4)**

DO NOT commit yet. The next task removes the sibling render. Continue.

---

## Task 3: Wire the create flyout to `renderCreateRow`

**Files:**
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx`

- [ ] **Step 3.1: Add the `renderCreateRow` callback near the other flyout callbacks**

Locate the `adapterCreateFlyoutNode` block (currently `p_ObjectTree.tsx:2091-2099`). Immediately after the existing `renderRowDetail` callback you defined in Task 2, add:

```tsx
  // Create-row render function — ResourceTree calls this and injects the
  // returned node as the first <tr> of <tbody> (above the first data
  // row, below <thead>). One of two routes is active per mount:
  //   - Adapter mounts: adapter.renderCreateFlyout owns the JSX.
  //   - WorkItem mounts (default): the local createFlyoutNode JSX block
  //     (built above) provides the create form.
  // Returns null when the create flyout is closed.
  const renderCreateRow = useCallback((): React.ReactNode | null => {
    if (adapter?.renderCreateFlyout) {
      if (!createFlyoutOpen) return null;
      return adapter.renderCreateFlyout({
        onClose: () => setCreateFlyoutOpen(false),
        onCreated: () => {
          setCreateFlyoutOpen(false);
          setAdapterRefreshTick((n) => n + 1);
        },
      });
    }
    // WorkItem route — createFlyoutNode handles its own
    // data-open attribute and animation. Always rendered, but only
    // hosted in the table while createFlyoutOpen is true so the row
    // doesn't take up height when closed.
    if (!createFlyoutOpen) return null;
    return createFlyoutNode;
  }, [adapter, createFlyoutOpen, createFlyoutNode]);
```

- [ ] **Step 3.2: Pass `renderCreateRow` to `<ResourceTree>`**

Locate the props passed to `<ResourceTree<WorkItem>>` in the `inner` block. Add `renderCreateRow={renderCreateRow}` right after the `renderRowDetail` line you wrote in Task 2.

Replace:
```tsx
        renderRowDetail={renderRowDetail}
        // Drop the inner scroll container so opening the inline flyout
```

With:
```tsx
        renderRowDetail={renderRowDetail}
        renderCreateRow={renderCreateRow}
        // Drop the inner scroll container so opening the inline flyout
```

- [ ] **Step 3.3: Verify typecheck**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: No new errors.

DO NOT commit. The double-render (sibling-rendered create flyout + table-row create flyout) is removed in Task 4.

---

## Task 4: Remove sibling renders of create + detail flyouts

The flyouts are now reachable inside the table. Remove the legacy sibling renders so they don't double up.

**Files:**
- Modify: `app/components/ObjectTreeV2/p_ObjectTree.tsx`

- [ ] **Step 4.1: Remove the create flyouts from `inner`**

Locate the `inner` JSX (currently `p_ObjectTree.tsx:2127-2132`).

Replace:
```tsx
  const inner = (
    <>
      {headerNode}
      {actionBarNode}
      {adapterCreateFlyoutNode}
      {createFlyoutNode}
      {/* TODO(00456): wire bulk action handlers in WS3-D */}
```

With:
```tsx
  const inner = (
    <>
      {headerNode}
      {actionBarNode}
      {/* Create flyouts (adapter + WorkItem) and the row-detail flyout
          are hosted INSIDE <ResourceTree> via renderCreateRow /
          renderRowDetail. Rendering them here would double them up. */}
      {/* TODO(00456): wire bulk action handlers in WS3-D */}
```

- [ ] **Step 4.2: Remove `{inlineFormNode}` from both return paths**

Locate the two return paths (currently `p_ObjectTree.tsx:2267-2282`).

Replace:
```tsx
  if (title && addressableName) {
    return (
      <>
        <Panel name={addressableName} title={title}>
          <div {...dropZoneProps}>{inner}</div>
        </Panel>
        {inlineFormNode}
      </>
    );
  }
  return (
    <>
      <div {...dropZoneProps}>{inner}</div>
      {inlineFormNode}
    </>
  );
```

With:
```tsx
  if (title && addressableName) {
    return (
      <Panel name={addressableName} title={title}>
        <div {...dropZoneProps}>{inner}</div>
      </Panel>
    );
  }
  return <div {...dropZoneProps}>{inner}</div>;
```

- [ ] **Step 4.3: Verify typecheck**

Run: `npm run typecheck 2>&1 | tail -20`
Expected: No new errors. `inlineFormNode` is still referenced inside the `renderRowDetail` callback (Task 2), so it's not unused.

- [ ] **Step 4.4: Commit Tasks 2–4 together as a single behavioural change**

```bash
git add app/components/ObjectTreeV2/p_ObjectTree.tsx
git commit -m "$(cat <<'EOF'
feat(otv2): host create + row-detail flyouts inside ResourceTree

Both flyouts now render as <tr> rows inside <tbody> via the
renderCreateRow / renderRowDetail slots (the latter is generalised
to serve the WorkItem route too — previously only the adapter
route used it; the WorkItem inlineFormNode was a sibling after
<Panel>).

Opening either flyout pushes the rest of the grid + pagination
down. No inner scrollbar (disableInnerScroll is now unconditional).
No double-render: the sibling {inlineFormNode} and the in-inner
{...createFlyoutNode} renders are removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: CSS — flush row-detail, add row-create rules, kill title-bar radius

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 5.1: Extend the row-detail flush rule + add the row-create twin**

Locate the existing row-detail block (currently `app/globals.css:14364-14374`).

Replace:
```css
/* Inline adapter row-detail — the <tr> ResourceTree injects directly
   under the active flyout row. Cell is bare so the adapter's flyout
   shell takes the full slot AND sits flush against the next row (no
   bottom border, no inner padding). */
.tree_accordion-dense__row-detail {
  background: var(--surface);
}
.tree_accordion-dense__cell--row-detail {
  padding: 0 !important;
  border-bottom: 0 !important;
}
```

With:
```css
/* Inline row-detail and row-create — the <tr>s ResourceTree injects
   for OTV2's inline flyouts. The cell is bare so the flyout shell
   takes the full slot AND sits flush both above (against the row /
   <thead> above) and below (against the next row / pagination). No
   borders, no inner padding. */
.tree_accordion-dense__row-detail,
.tree_accordion-dense__row-create {
  background: var(--surface);
}
.tree_accordion-dense__cell--row-detail,
.tree_accordion-dense__cell--row-create {
  padding: 0 !important;
  border-top: 0 !important;
  border-bottom: 0 !important;
}
```

- [ ] **Step 5.2: Drop top radius on the createflyout title head**

Locate `.tree_accordion-dense__createflyout-head` (currently `app/globals.css:13541-13549`).

Replace:
```css
.tree_accordion-dense__createflyout-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--surface-sunken);
  margin: -14px -16px -12px;
  padding: 10px 16px;
}
```

With:
```css
.tree_accordion-dense__createflyout-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--surface-sunken);
  margin: -14px -16px -12px;
  padding: 10px 16px;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
```

- [ ] **Step 5.3: Drop top radius on the ArtefactInlineForm title head**

Find the existing class block in `app/globals.css`:

Run: `grep -n "artefact-inline-form__Container_Head\b" app/globals.css | head -5`
Expected: one or more rules. Read those rules to confirm current radius. If the block doesn't already exist or doesn't set radius, ADD this rule immediately after the existing `.artefact-inline-form__Container_Head` declarations (or at the same location as Step 5.2 if no prior rule exists):

```css
/* Inline flyout title bars never get rounded corners on the top —
   they sit flush under the row above (or <thead>, for create) once
   hosted inside ResourceTree via renderRowDetail / renderCreateRow. */
.artefact-inline-form__Container_Head,
.artefact-inline-form__Container_Head--duplicate,
.artefact-inline-form__Container_Head--deleting {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}
```

If `.artefact-inline-form__Container_Head` already sets a non-zero `border-radius` (full or top), override it here. If the existing rule uses shorthand like `border-radius: 8px 8px 0 0`, the override above wins for the top corners only.

- [ ] **Step 5.4: Visual smoke test in dev browser**

Run: `<npm>` (or `npm run dev` if not using the wrapper). Open `http://localhost:5101/work-items` and:

1. Click **+ Add** → create flyout appears as the FIRST row of the table, flush under `<thead>`, no top radius.
2. Click a work-item row → edit flyout appears DIRECTLY under that row, flush, no top radius. Click another row → previous flyout closes, new one opens under the clicked row.
3. Open the edit flyout for a row, click **Duplicate** → flyout turns amber (still flush). Click **Delete** → red striped state (still flush).
4. Open the edit flyout for the LAST row on the page → no gap between the flyout's bottom edge and the pagination box.
5. Open `http://localhost:5101/custom-fields/[some-type-id]` → adapter row-detail still works (this is the regression check); create flyout also appears as first row.
6. Scroll the page: the panel grows naturally; there is no second scrollbar inside the panel.

If any of the six checks fail, STOP and read the spec's "Risks & open questions" section. Likely culprits: sticky `<thead>` interaction (#1), pagination location assumption (#2), outside-click handler (#3), or a colour-state surface mismatch (#5).

- [ ] **Step 5.5: Commit the CSS changes**

```bash
git add app/globals.css
git commit -m "$(cat <<'EOF'
style(otv2): flush inline flyouts against neighbouring rows

Extend row-detail rule with border-top: 0; add the row-create twin.
Drop top border-radius on both flyout title bars (.createflyout-head
and .artefact-inline-form__Container_Head) so they sit flush under
the row above (or <thead> for create).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final regression sweep across all five WorkItem mounts

**Files:** none (manual verification)

- [ ] **Step 6.1: Walk through each mount in the browser**

For each route below, open the page and verify:
1. Row-detail flyout opens directly under the clicked row.
2. Create flyout opens as first table row.
3. No second scrollbar.
4. No visual gap above/below the flyout title bar.

Routes:
- `/work-items?meg=<workspaceId>&type=<typeId>` (the URL from the original task)
- `/risks`
- `/value-sprint`
- `/value-sprint-review`
- `/portfolio-items`
- `/custom-fields/[id]` (adapter route regression)

- [ ] **Step 6.2: Check the console for warnings**

Open browser devtools console on each route. Look for:
- React key warnings (would indicate the new `<tr>` lost a `key` prop).
- HTML nesting warnings (e.g. `<div>` inside `<table>` outside of a `<td>`).

Expected: no new warnings introduced by this change.

- [ ] **Step 6.3: Run the full typecheck + lint**

Run: `npm run typecheck`
Expected: passes (or: same baseline errors as before this branch — record any prior baseline before starting).

Run: `npm run lint`
Expected: passes (or: same baseline). The custom lint rules of relevance: none specific to ResourceTree props.

If both pass, the change is shippable.

---

## Self-review checklist

**Spec coverage** — every requirement in [the spec](../specs/2026-05-29-objecttree-inline-flyouts-design.md) maps to a task above:

| Spec section | Implementing task |
|---|---|
| Change 1 — WorkItem detail flyout inline | Task 2 (unified callback) + Task 4 (remove sibling) |
| Change 2 — Create flyout inline as first row | Task 1 (ResourceTree prop) + Task 3 (OTV2 wiring) + Task 4 (remove inner render) |
| Change 3a — Kill top radius on title bars | Task 5.2, 5.3 |
| Change 3b — Flush above/below | Task 5.1 |
| Change 3c — Animation preservation | Implicit (no transition rules changed) |
| Affected mounts regression | Task 6 |
| Risks 1–5 — verify | Pre-flight + Task 5.4 smoke test |

**Placeholder scan:** no TBD / "implement later" / "similar to Task N" / unspecified error handling. Each step has either the exact code OR an exact command + expected output.

**Type consistency:** `renderRowDetail` callback signature is `(row: WorkItem) => React.ReactNode | null` (matches existing). New `renderCreateRow` is `() => React.ReactNode | null` (no args — create is row-agnostic). State accessors used: `flyoutRowId`, `openInlineFormId`, `createFlyoutOpen`, `setCreateFlyoutOpen`, `setAdapterRefreshTick` — all confirmed defined above the new callbacks in `p_ObjectTree.tsx`.

**Commit cadence:** four commits (Task 1, Task 4 batching 2+3+4, Task 5, Task 6 is no-op verification). This matches the project's "commit all workstreams" rule — Tasks 2/3/4 belong together as a single behavioural change to OTV2.
