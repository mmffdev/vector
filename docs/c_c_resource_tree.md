# `<ResourceTree>` — generic hierarchical tree primitive

> Last verified: 2026-05-06 (PLA-0021 Wave 1)

The single sanctioned hierarchical-tree primitive for the app. Adopters compose a tree by passing five prop sets — Data, Scaffold, Features, CogMenu, Colour — and inherit the full feature stack (lines, expand, resize, pagination, search, sort, selection, filter chips, addressable substrate). `WorkItemsTree` is the first preset wrapper; future trees (PortfolioItemsTree, TopologyTree, etc.) follow the same shape.

**Source:** [`app/components/ResourceTree.tsx`](../app/components/ResourceTree.tsx). **Smoke:** [`app/components/__tests__/WorkItemsTree.test.tsx`](../app/components/__tests__/WorkItemsTree.test.tsx).

---

## When to use

- You need an unlimited-depth hierarchical view over a single resource type with DnD rank, inline edit, and substrate-addressable cells.
- The data is parent/child via `parent_id`; children are fetched on expand.

If your data is flat → use [`<Table>`](c_c_table_component.md). `<Table>` and `<ResourceTree>` are siblings, not layers — Table is the canonical flat primitive (PLA-0015), ResourceTree is the canonical tree primitive (PLA-0021). Do not nest one in the other.

---

## Address pattern

When mounted inside a `<Panel>` / `<ViewportSlot>` scope and given a `name` prop, the tree registers as:

```
samantha._viewport.<slot>._panel.<panel_name>._tree.<name>
```

Five sub-addresses register inside the tree's scope, one per prop set:

```
…_tree.<name>._propset.data
…_tree.<name>._propset.scaffold
…_tree.<name>._propset.features
…_tree.<name>._propset.cogmenu
…_tree.<name>._propset.colour
```

These are the canonical Samantha SDK targets for help, override hooks, and gadmin tooling. The `name` prop is **required** when the tree mounts inside a Panel scope; it is optional for unit tests that mount the bare component.

---

## The five prop sets

### Set 1 — Data (I/O)

| Prop | Type | Notes |
|---|---|---|
| `roots` | `T[]` | The current root window. |
| `total` | `number` | Total root count for pagination. |
| `getId` | `(row: T) => string` | Stable row id. |
| `getParentId` | `(row: T) => string \| null` | Parent reference; `null` for roots. |
| `getChildrenCount` | `(row: T) => number` | Drives the expander affordance. |
| `fetchChildren` | `(parentId: string) => Promise<T[]>` | Lazy child loader. |
| `patch` | `(id, patch) => Promise<T>` | Inline-edit writer. |

### Set 2 — Scaffold (columns)

| Prop | Type | Notes |
|---|---|---|
| `columns` | `ColumnDef<T>[]` | Declarative column list. |
| `rowHeight?` | `number` | Override the dense row height. |
| `indentStep?` | `number` | Pixels per nesting level. |

```ts
interface ColumnDef<T> {
  key: string;          // sort identity + column index
  label: string;        // header label
  width?: number | null; // null = flex column (absorbs remainder)
  minWidth?: number;
  align?: "left" | "mono";
  cellModifier?: string; // appended to th/td (e.g. --id, --summary)
  stopClick?: boolean;   // stop bubbling to row click
  render: (row: T, ctx: RenderCtx<T>) => ReactNode;
}
```

Exactly one column has `width: null` — it absorbs leftover horizontal space.

### Set 3 — Features (opt-in)

| Prop | Type | Notes |
|---|---|---|
| `pagination?` | `{ pageSize, options }` | Adds the pager strip. |
| `search?` | `{ placeholder, accessor }` | Adds the search input + client filter. |
| `sort?` | `{ key, dir, onChange }` | Header sort affordance. |
| `expandAllConcurrency?` | `number` | Throttle for collapse-all/expand-all ops. |

### Set 4 — CogMenu (type-only this card)

```ts
cogMenu?: (row: T) => MenuItem[];
interface MenuItem { key, label, onSelect, disabled? }
```

The cog renderer is wired in a later wave (WS6-B row context menu); the type is exported now so adopters can plan their menu without churn.

### Set 5 — Colour / tone (no-op default)

```ts
tone?: {
  typeBadge?: (row: T) => string | null;
  priorityIcon?: (row: T) => string | null;
  statusPill?: (row: T) => string | null;
};
```

Override hooks for tenants that need a custom tone map without forking the column renderers.

### Cross-cutting props

| Prop | Type | Notes |
|---|---|---|
| `selectedId?` | `string \| null` | Caller-owned selection. |
| `onSelect?` | `(row: T) => void` | Click handler. |
| `pageIndex?` | `number` | Caller owns pagination index for URL adoption. |
| `onPageIndexChange?` | `(next) => void` | |
| `onPageSizeChange?` | `(next) => void` | |
| `loading?` | `boolean` | Drives the placeholder. |
| `filterChips?` | `ReactNode` | Caller-owned chip slot above the table. |
| `ariaLabel` | `string` | Required — labels the underlying `<table>`. |
| `name?` | `string` | Substrate address name (required inside Panel scope). |

---

## Adoption recipe

A preset wrapper composes the five prop sets and forwards them to `<ResourceTree>`. Keep wrappers thin (≤ 100 lines) — all tree concerns live in the primitive, all per-resource concerns live in a sibling `*-tree-config.tsx` file (columns, I/O hook, panel header, filter chips). See [`app/components/WorkItemsTree.tsx`](../app/components/WorkItemsTree.tsx) and [`app/components/work-items-tree-config.tsx`](../app/components/work-items-tree-config.tsx) for the canonical example.

```tsx
import { ResourceTree } from "@/app/components/ResourceTree";
import { buildPortfolioColumns, usePortfolioWindow }
  from "@/app/components/portfolio-items-tree-config";

export default function PortfolioItemsTree({ selectedId, onSelect }: Props) {
  const { roots, total, fetchChildren, patchAndApply } = usePortfolioWindow();
  const columns = buildPortfolioColumns(patchAndApply);

  return (
    <ResourceTree
      roots={roots}
      total={total}
      getId={(r) => r.id}
      getParentId={(r) => r.parent_id}
      getChildrenCount={(r) => r.children_count}
      fetchChildren={fetchChildren}
      patch={async (id, body) => { patchAndApply(id, body); return { id, ...body } as never; }}
      columns={columns}
      pagination={{ pageSize: 25, options: [25, 50, 100] }}
      search={{ placeholder: "Search portfolio items…", accessor: (r) => r.title }}
      ariaLabel="Portfolio items dense grid"
      name="portfolio_items"      // → samantha…_tree.portfolio_items
      selectedId={selectedId}
      onSelect={onSelect}
    />
  );
}
```

---

## Adopters

| Wrapper | Address |
|---|---|
| `WorkItemsTree` | `samantha._viewport.app._panel.work_items_grid_tree_ll._tree.workitems` |

New adopters: register the wrapper in this table when its preset lands.

---

## Related

- [`docs/c_c_addressables.md`](c_c_addressables.md) — addressable substrate + `useRegisterAddressable`.
- [`docs/c_c_table_component.md`](c_c_table_component.md) — `<Table>` (flat sibling primitive, PLA-0015).
- [`docs/c_c_dnd.md`](c_c_dnd.md) — DnD convention for the upcoming WS1-B rank work.
- [`dev/research/R042.json`](../dev/research/R042.json) — full 28-feature roadmap and prop-set rationale.
- [`dev/plans/PLA-0021.json`](../dev/plans/PLA-0021.json) — plan source-of-truth.
