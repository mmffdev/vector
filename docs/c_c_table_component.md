# `<Table>` component contract

**Status:** active (PLA-0015) · **Path:** [`app/components/Table.tsx`](../app/components/Table.tsx) · **Harness:** `/dev/table-harness`

The single sanctioned table primitive in the user-facing app. Every `<table>` element under `app/**` MUST come from here, with the four documented tree exceptions as the only escape hatches. Catalog CSS lives in `tree_accordion-dense__*` ([`docs/css-guide.md` § Tables](css-guide.md)) — `<Table>` is the only consumer.

## Why one component

Eight near-identical hand-written `<table>` scaffolds existed before PLA-0015 — every call site re-solved the same problems (sticky head, `<colgroup>`, expander icon, pagination UI, empty rows). One component absorbs all of it; new tables become declarative; bugs are fixed in one place; lint can finally enforce the catalog rule because there's only one allowed table site (`Table.tsx` itself).

## v1 surface

Every feature is **opt-in**. Omit a prop → no UI for it.

```tsx
<Table
  pageId="workspace-settings"      // for addressables + draft scoping
  slot="users"                     // sub-namespace within the page
  ariaLabel="Users"                // REQUIRED

  columns={[
    { key: "expander",  width: 40,  kind: "expander" },
    { key: "last_name", header: "Last name",  width: 160,
      editable: { type: "text", onSave: (row, val) => patchUser(row.id, { last_name: val }) } },
    { key: "first_name", header: "First name", width: 160 },
    { key: "email", header: "Email", render: (r) => <EmailWithPills row={r} /> },
    { key: "department", header: "Department", width: 200 },
    { key: "status", header: "Status", width: 110, kind: "pill",
      pillVariant: (r) => r.is_active ? "success" : "neutral",
      pillLabel: (r) => r.is_active ? "Active" : "Inactive" },
  ]}

  rows={pageRows}
  rowKey={(r) => r.id}

  expandable={{ renderPanel: (row) => <UserEditPanel u={row} /> }}
  pagination={{ pageSize, page, onPageChange: setPage }}
  toolbar={{
    search:  { value: q, onChange: setQ, placeholder: "Search users…" },
    filters: [{ key: "role", label: "Role", value: role, options: roleOpts, onChange: setRole }],
    actions: <button className="btn btn--primary">+ New user</button>,
    meta:    `${total} user${total === 1 ? "" : "s"}`,
  }}
  empty="No users match the current filters."
  loading={!pageRows}

  rowClassName={(r) => isExternal(r) ? "users-table__row--external" : undefined}
  cellClassName={(r, c) => c.key === "status" ? "users-table__status-cell" : undefined}
/>
```

## Props reference

| Prop | Type | Purpose |
|---|---|---|
| `pageId` | `string` | Required. Used to scope draft keys and addressables. Stable across deploys (e.g. `"workspace-settings"`). |
| `slot` | `string` | Required. Sub-namespace within the page (e.g. `"users"`, `"permissions"`). Differentiates multiple tables on one page. |
| `ariaLabel` | `string` | Required. Accessibility — every table must have a label. |
| `columns` | `Column<R>[]` | Required. See cell-kind reference below. |
| `rows` | `R[] \| null` | Required. `null` means loading. |
| `rowKey` | `(r: R) => string` | Required. Stable per-row key. |
| `expandable` | `{ renderPanel: (r) => ReactNode; canExpand?: (r) => boolean }` | Optional. Adds expander column (always first) + colSpan panel row when open. |
| `pagination` | `{ pageSize: number \| "all"; page: number; onPageChange: (n) => void }` | Optional. Renders Prev/Next + page meta below the table. |
| `toolbar` | `Toolbar` | Optional. See toolbar reference. |
| `empty` | `string` | Optional. Message rendered as `<tr><td colSpan={N}>` when `rows.length === 0`. Default: `"No rows."` |
| `loading` | `boolean` | Optional. When `true`, renders a single loading row regardless of `rows`. |
| `rowClassName` | `(r: R) => string \| undefined` | Optional. Extra classes layered onto `tree_accordion-dense__row`. |
| `cellClassName` | `(r: R, c: Column<R>) => string \| undefined` | Optional. Extra classes layered onto `tree_accordion-dense__cell`. |
| `onRowClick` | `(r: R) => void` | Optional. Toggles expander when set; otherwise per-cell `onClick` is left to renderers. |

## Cell-kind reference

Every column declares **one** kind. Only `custom` allows arbitrary JSX; everything else lets the component render the catalog class for you.

| `kind` | Renders | Catalog class added |
|---|---|---|
| `"text"` (default) | `String(row[col.key])` | none extra |
| `"mono"` | `String(row[col.key])` | `tree_accordion-dense__cell--mono` |
| `"numeric"` | `String(row[col.key])` | `tree_accordion-dense__cell--numeric` |
| `"center"` | `String(row[col.key])` | `tree_accordion-dense__cell--center` |
| `"pill"` | `<span class="pill pill--{variant}">{label}</span>` | `tree_accordion-dense__cell--center` |
| `"expander"` | `.tree_accordion-dense__expander` button | the expander primitive (NOT `.btn--row-expander`) |
| `"custom"` | `col.render(row)` | none extra |

Pill columns require `pillVariant(row)` and `pillLabel(row)` props on the column.

## Inline edit

A column flips to edit mode by adding `editable`:

```ts
{
  key: "last_name", header: "Last name",
  editable: {
    type: "text",
    onSave: async (row, value) => patchUser(row.id, { last_name: value }),
    validate?: (value) => string | null,    // optional; return error string
  }
}
```

Behaviour: clicking the cell flips it to `<input>`, value seeded from `row[col.key]`; **Enter** saves; **Escape** cancels; the draft buffer is persisted via [`useDraft`](c_c_form_drafts.md) under `formKey = "table:${pageId}:${slot}"`, `scopeKey = "${rowKey}:${col.key}"`. Save returns a Promise — error string surfaces inline; resolution flips back to read-mode.

## Toolbar shape

Every toolbar slot is independently optional.

```ts
type Toolbar = {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string };
  filters?: Array<{
    key: string; label: string;
    value: string; options: Array<{ value: string; label: string }>;
    onChange: (v: string) => void;
  }>;
  actions?: ReactNode;   // typically a "+ New X" button
  meta?: ReactNode;      // typically "12 users" or "Loading…"
};
```

Filters render as `<select>` elements; the component does not own any filtering logic — it just renders the controls. **Callers filter `rows` before passing them in.** This keeps the component generic and predictable.

## Bespoke modifier hooks

Five existing call sites carry page-namespaced classes (`users-table__status-cell`, `users-table__row--open`, etc.). Two hooks let callers preserve them without forking:

- `rowClassName(row)` — string layered onto `.tree_accordion-dense__row`
- `cellClassName(row, col)` — string layered onto `.tree_accordion-dense__cell`

These are the **only** escape hatches. If a caller needs more (sortable headers, custom expander icon, column resize), it does NOT belong in `<Table>` — keep it bespoke and add it to the tree-exception ledger.

## Tree exceptions (do NOT migrate)

These four call sites stay bespoke. Listed in `dev/registries/raw-table-allow.txt` so `lint:no-raw-table` ignores them:

| File | Why bespoke |
|---|---|
| `app/(user)/work-items/Example2Tree.tsx` | Multi-level tree with `<TreeLines>` SVG geometry per row + lazy-load children |
| `app/(user)/work-items/page.tsx` (legacy tree) | `@dnd-kit` row reorder + custom `<SortTh>` headers + column-resize handles |
| `app/(user)/portfolio-model/LayersTable.tsx` | Zone-toggle accordion + native HTML5 drag-drop + validation error states |
| `app/(user)/work-items/page.tsx` (work-items tree v2) | Same family as Example2Tree |

A future `<TreeTable>` sibling component may absorb the first two; `<LayersTable>` likely stays bespoke indefinitely. Tracked separately, not in v1.

## Lint enforcement

`lint:no-raw-table` (under [`dev/scripts/`](../dev/scripts/)) fails CI on:

- Any `<table>` element in `app/**` not inside `app/components/Table.tsx` and not on the allow-list
- Any `tree_accordion-dense__*` class outside `Table.tsx` and the allow-list (catches future drift back to hand-written tables)

Allow-list ledger: [`dev/registries/raw-table-allow.txt`](../dev/registries/raw-table-allow.txt) — exactly the four tree files above. Adding a new line requires a justification comment and a code-review nod.

## Migration map (PLA-0015 story 00427)

The 9 flat call sites that adopt `<Table>` in v1:

| File | Slot | Notable features |
|---|---|---|
| `app/(user)/workspace-settings/page.tsx` § Users | `users` | expander + panel + inline-edit + pagination + search + dropdown filter + bespoke status-cell |
| `app/(user)/workspace-settings/page.tsx` § Workspaces | `workspaces` | inline-edit on name |
| `app/(user)/workspace-settings/page.tsx` § Archived | `workspaces-archived` | flat |
| `app/(user)/workspace-settings/page.tsx` § Permissions | `permissions` | pill matrix |
| `app/(user)/workspace-settings/page.tsx` § Grant rules | `grant-rules` | flat |
| `app/(user)/portfolio-model/page.tsx` § Artifacts | `artifacts` | flat |
| `app/(user)/portfolio-model/page.tsx` § Terminology | `terminology` | flat |
| `app/(user)/portfolio-model/LayersPreviewTable.tsx` | `layers-preview` | epic-row groups + inline-edit |
| `app/(user)/library-releases/page.tsx` | `releases` | pill cells |
| `app/(user)/risk/page.tsx` | `risks` | pill cells |
| `app/(user)/work-items/settings/page.tsx` | `custom-fields` | pill kind cells |
| `app/theme/page.tsx` § tokens | `theme-tokens` | large (~100 rows), flat |

The canary in story 00426 is **Permissions matrix** — simplest call site, no expander/edit/pagination, exercises the pill-cell path end-to-end before the harder sites.

## See also

- [`docs/css-guide.md`](css-guide.md) — `tree_accordion-dense__*` catalog (the underlying CSS primitives)
- [`docs/c_c_form_drafts.md`](c_c_form_drafts.md) — `useDraft` integration for inline-edit cells
- [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) — where `lint:no-raw-table` is registered
- [`dev/plans/PLA-0015.json`](../dev/plans/PLA-0015.json) — the plan record
