# Plan: Replace LayersPreviewTable with two Table calls

## Context

LayersPreviewTable.tsx is a 168-line bespoke component that bypasses the Table primitive and InlineEditField conventions already established in the codebase. The user confirmed the Strategy/Execution visual split can simply be two separate `<Table>` blocks, which removes the need for section-group rows as a Table feature. LayersTable.tsx (579 lines) and LayerHierarchyDiagram.tsx (47 lines) are completely unused dead code that also need deleting. `LayerDTO` type is currently exported from LayersTable but is needed in page.tsx and LayersPreviewTable — it must be inlined into page.tsx before deletion.

Goal: delete all three files; replace LayersPreviewTable usage in page.tsx with two direct `<Table>` calls; no Table primitive changes required.

## Critical files

- `app/(user)/portfolio-model/page.tsx` — host of BundleView; imports LayerDTO from LayersTable and LayersPreviewTable component
- `app/(user)/portfolio-model/LayersPreviewTable.tsx` — to delete
- `app/(user)/portfolio-model/LayersTable.tsx` — to delete (only LayerDTO type is used)
- `app/(user)/portfolio-model/LayerHierarchyDiagram.tsx` — to delete (fully dead)
- `app/components/Table.tsx` — no changes needed
- `app/components/InlineEditField.tsx` — no changes needed; already used directly in WorkItemsTree
- `app/components/SkeletonCompositions.tsx` — has a comment referencing LayersTable (line 49); update comment

## Approach

### Step 1 — Inline LayerDTO into page.tsx (already partially done)

`LayerDTO` was already moved to page.tsx as `export interface LayerDTO` in a prior partial edit. Verify it's there and correct:

```typescript
export interface LayerDTO {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
}
```

### Step 2 — Replace LayersPreviewTable in BundleView

In `BundleView`, replace the single `<LayersPreviewTable ... />` block with two `<Table>` calls inside the same Panel.

**Strategy table** — editable rows, reversed display order (highest sort_order = top row):

```tsx
<Table<LayerDTO>
  pageId="portfolio-model"
  slot="layers-strategy"
  ariaLabel="Strategy zone"
  rows={[...localLayers].reverse()}
  rowKey={(l) => l.id}
  columns={[
    {
      key: "sort_order",
      header: "Order",
      width: 80,
      kind: "numeric",
      render: (l) => localLayers.indexOf(l) === -1 ? "—" : localLayers.length - localLayers.indexOf(l),
    },
    {
      key: "tag",
      header: "Tag",
      width: 80,
      kind: "mono",
      editable: {
        type: "text",
        onSave: (l, v) => { onCommitLayer(l.id, "tag", v); },
        validate: (v) => (v.trim().length < 2 || v.trim().length > 4) ? "2–4 chars" : null,
      },
    },
    {
      key: "name",
      header: "Name",
      width: 200,
      editable: {
        type: "text",
        onSave: (l, v) => { onCommitLayer(l.id, "name", v); },
        validate: (v) => v.trim().length === 0 ? "Required" : null,
      },
    },
    {
      key: "description_md",
      header: "Description",
      editable: {
        type: "text",
        onSave: (l, v) => { onCommitLayer(l.id, "description_md", v); },
      },
    },
  ]}
/>
```

Note on Order column: `localLayers` is already sorted ascending by sort_order; reversing for display means index 0 in the reversed array = highest order. Use `render` to compute display order as `localLayers.length - sortedIndex`. The cleanest way: pre-compute a `displayLayers = [...localLayers].reverse()` before the JSX, then `render: (l) => displayLayers.indexOf(l) + 1 + fixedOffset`.

**Execution table** — read-only, fixed items (STRATEGY_FIXED_ITEMS), no `editable`:

```tsx
<Table<LayerDTO>
  pageId="portfolio-model"
  slot="layers-execution"
  ariaLabel="Execution zone"
  rows={[...STRATEGY_FIXED_ITEMS].sort((a, b) => b.sort_order - a.sort_order)}
  rowKey={(l) => l.id}
  columns={[
    {
      key: "sort_order",
      header: "Order",
      width: 80,
      kind: "numeric",
      render: (l) => l.sort_order === 0 ? "—" : String(l.sort_order),
    },
    { key: "tag", header: "Tag", width: 80, kind: "mono" },
    { key: "name", header: "Name", width: 200 },
    { key: "description_md", header: "Description", render: (l) => l.description_md ?? "—" },
  ]}
/>
```

Add an `<h4>` or `<p className="eyebrow">` label between the two tables: "Strategy Zone" / "Execution Zone". Check `css-guide.md` for the right class — likely `eyebrow` or a Panel sub-heading class.

The `onCommitLayer` in BundleView needs to also fire the API PATCH (currently it only does optimistic local state update). Check if the existing `onCommitLayer` prop in page.tsx was already wiring the API call — if not, add it in BundleView alongside the `setLocalLayers` optimistic update.

### Step 3 — Remove LayersPreviewTable import from page.tsx

Remove: `import LayersPreviewTable from "./LayersPreviewTable";`

### Step 4 — Delete the three files

```bash
rm "app/(user)/portfolio-model/LayersPreviewTable.tsx"
rm "app/(user)/portfolio-model/LayersTable.tsx"
rm "app/(user)/portfolio-model/LayerHierarchyDiagram.tsx"
```

### Step 5 — Fix SkeletonCompositions.tsx comment

Line 49: update the comment from "Mirrors LayersTable row" to something accurate, or remove it if the skeleton is itself dead.

## Things to verify before coding

1. Confirm `LayerDTO` export is correctly in page.tsx (the partial edit from last session)
2. Confirm `onCommitLayer` in BundleView wires an API PATCH — it currently only does `setLocalLayers`. If it doesn't, add `api("PATCH", /api/subscription/layers/${id}, { [field]: next })` call.
3. Check `defaultRowValue` in Table.tsx handles `description_md` being `null` correctly — it reads `row[column.key]` as string; null would render as empty string in the trigger (fine).

## Verification

- `npx tsc --noEmit` — no type errors
- Portfolio model page loads, adopted state shows Portfolio Hierarchy panel with two tables
- Strategy zone rows show click-to-edit on Tag/Name/Description; edits commit optimistically
- Execution zone rows (STR, TSK, DEF) are read-only
- No import errors referencing LayersTable, LayersPreviewTable, LayerHierarchyDiagram anywhere

## Not in scope

- Table primitive changes (no section headers, no per-row editability predicates needed)
- LayersTable component behaviour (was already unused; only the type was referenced)
- WorkItemsTree DnD work (happening in background, separate track)
