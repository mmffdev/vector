# Code Standards

**Loaded on demand — read this file before writing or editing code.**

## CSS Naming Convention

**Pattern**: `ui-{function}__{element}--{modifier}`

**Prefixes by scope**:
- `ui-` — shared interactive UI elements (ui-filterbar, ui-statbox, ui-page-title)
- `prefix-` — text colour prefixes (prefix-pink, prefix-dev, prefix-blue)
- `doc-` / `dmp-` — document page styling
- Feature block names have NO prefix — they ARE the block (accordion, heartbeat, portgrid, wizard, log-viewer, volume-browser, asset-register)

**Rules**:
- Block names describe FUNCTION not LOCATION (ui-filterbar not page-toolbar, ui-statbox not summary-bar)
- Elements use double-underscore: `ui-filterbar__search`
- Modifiers use double-dash: `ui-statbox__value--success`
- State classes use `is-` / `has-` prefix: `is-active`, `has-error`
- Global classes live in `design-system.css` — never duplicate in feature/page CSS
- Feature CSS only contains classes scoped to that feature block
- Page CSS only contains overrides (e.g. max-width tweaks)

**Before naming a new class, check**:
1. Does a global class already exist for this? → Use it
2. Is this feature-specific? → Use the feature block name
3. Is this reusable across pages? → Use `ui-{function}__` prefix in design-system.css

## Build Verification

Before reporting a task complete:
- **Frontend**: Run **both** checks: `cd web && npx tsc --noEmit && npx vite build`
  - `npx vite build` uses esbuild which strips types without checking — wrong prop types, missing required fields, and type mismatches pass silently but crash at runtime
  - `npx tsc --noEmit` catches type errors that Vite misses
- **Backend**: Run `cd backend && npx tsc`
- Do not rely on TypeScript alone — Vite catches unresolved imports and runtime build errors that `tsc` misses

## Database Queries — Bomb-Proof Schema Validation

**Rule:** Never query a column that might not exist. Always validate against the **live database first**, not documentation.

**Workflow before writing any SQL query:**

1. **Inspect the actual schema** (live source of truth):
   ```bash
   bash .claude/utils/schema-query.sh inspect sprints
   # Shows all columns in the sprints table RIGHT NOW
   ```

2. **Only reference columns shown in the output** — if a column doesn't appear, it doesn't exist.

3. **For dynamic/uncertain queries, use the safe query helper:**
   ```bash
   bash .claude/utils/schema-query.sh safe sprints id name start_date status end_date
   # Returns: ⚠ Columns not found in sprints: status
   # Queries only: id, name, start_date, end_date (silently skips 'status')
   # Lists available columns if all requested columns are missing
   ```

4. **Check existence before conditional logic:**
   ```bash
   if bash .claude/utils/schema-query.sh exists sprints status; then
     # Column exists — safe to query
   else
     # Column doesn't exist — use fallback (e.g. end_date IS NULL)
   fi
   ```

**Why this matters:** Documentation (memory files, code comments, research papers) can lag behind schema changes. The database itself is always correct. Never trust old notes about what columns exist.

**Remember:** If you see an error like `Error: in prepare, no such column: X`, it means:
- The column doesn't exist in the current schema
- Always run `schema-query.sh inspect TABLE` to see what's actually there
- Then update your query to use only columns that exist

**Tools:**
- `.claude/utils/schema-query.sh` — always available for schema checks
- `memory/database_schema_reference.md` — reference, but verify with schema-query.sh first

## Dead Code Detection
After removing a feature, function, or component, grep the codebase for orphaned imports and unused exports that referenced it. Remove any dead references found in the same commit as the removal — don't leave orphans behind.

## Dependency Audit Rule
When adding or upgrading npm packages (`npm install`, `npm update`), run `npm audit` afterwards. If vulnerabilities are found, report them before proceeding. Do not silently install packages with known critical/high vulnerabilities.

## Import Ordering Convention
When creating or editing `.ts`/`.tsx` files, follow this import order — separate each group with a blank line:
1. **Node/stdlib** — `import path from 'path'`
2. **External packages** — `import React from 'react'`
3. **Internal/absolute** — `import { FeatureTable } from '../features/tables/feature_table_index'`
4. **Relative** — `import { logic } from './feature_my-thing_logic'`
5. **CSS (always last)** — `import './feature_my-thing.css'`

Only enforce when already touching imports in a file — do not reorder existing files unprompted.

## Feature Model
All frontend features follow this file structure:

```
web/src/features/<feature-name>/
  feature_<area>-<name>_index.ts      # barrel export
  feature_<area>-<name>.tsx            # main component
  feature_<area>-<name>_logic.ts       # business logic (optional)
  feature_<area>-<name>.css            # scoped styles
```

When the user writes **`<FE>`** followed by a description, scaffold a new feature:
1. Prompt for **area** (e.g. `network`, `docker`, `build`) and **name** (e.g. `ping`, `grid`, `wizard`) if not clear from context
2. Create the directory and files following the pattern above
3. Feature CSS uses bare block naming (no `ui-` prefix) — the feature name IS the block

Example: `<FE> network ping tool` → `web/src/features/network-ping/feature_network-ping_index.ts` etc.

## Table Standard
When building any table, use `FeatureTable` from `features/tables/feature_table_index` and its `feature_table.css`. Define columns via the `Column<T>[]` interface. For filter bars and toggle buttons adjacent to tables, use global `ui-filterbar` classes (`ui-filterbar__options`, `btn btn-ghost btn-sm ui-filterbar__pagesize`). Never create bespoke table or filter button styles in feature CSS.

## Grid / Accordion Standard
When building expandable row grids or accordion layouts, use `DockerGrid` from `features/docker-grid/` as the reference pattern. Parent rows with expand/collapse, child detail panels, stat boxes, search/filter controls, inline actions. Follow the same CSS block naming and `ui-filterbar` / `ui-statbox` integration.

## Sprint Badge Standard
Always render sprint IDs using the global badge system — never as plain text or bespoke styles:
```tsx
import { sprintBadgeStyle } from '../utils/sprint-colors';
<span className="ui-badge ui-badge--sprint" style={sprintBadgeStyle(sprintId)}>{sprintId}</span>
```
`sprintLabel()` helper (`"sprint009"` → `"S009"`) is available for space-constrained contexts.

## CSS/ID Change Reporting

Every time a CSS class, ID, or data-asset-id is added, renamed, or removed, output a change report table at the end of the response:

| # | Old Name | New Name | What It Is | Scope | Stylesheet |
|---|----------|----------|------------|-------|------------|

- **Scope**: `Global` = used across multiple pages/features. `Local` = single page/feature only.
- **Stylesheet**: The CSS file where the class is defined (not where it's consumed).
- End with **Total changes: X**
- This table is mandatory after any commit that touches class names, IDs, or data-asset-id attributes.
- NOT required for commits that only change content, logic, or non-CSS code.

## UI Alignment — Columns, Rows, and Headers
When adding or modifying UI elements that sit within a structured layout (tables, grids, accordion rows, list headers), **always verify alignment with adjacent elements**:
- New columns must have a matching header **and** a matching data cell in every row — never one without the other.
- Column widths in the CSS grid template must be updated in **all breakpoints** (desktop + responsive).
- Text alignment (left/right/center) in data cells must match the corresponding header.
- Border, padding, and font-size must be consistent with sibling columns.
- If a header row exists above data rows, read both the header and at least one data row before editing to confirm the column order and count match.
- **If alignment intent is unclear, ask before implementing.**

## debugtable — Grid/Table Debug Borders
When the user writes **debugtable** or **debugtable on**, add `border: 1px solid red; /* DEBUG */` to every cell and the outer container of the grid/table currently being worked on:
1. Identify the CSS file for the grid/table currently being discussed or last edited.
2. Add the debug border to the outer container rule and all cell selectors (`> span`, `> td`, `> th`, or equivalent direct-child cell rules).
3. Tag each added line with `/* DEBUG */` so they are easy to find.

When the user writes **debugtable off**, remove all lines containing `/* DEBUG */` from the target CSS file.

**Rules:**
- Never commit debug borders — always strip before any commit.
- If the target grid/table is ambiguous, ask which one.
