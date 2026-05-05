# Dev-UI Primitives — `dev-ui.css` catalog

Plan: [`PLA-0013`](../dev/plans/PLA-0013.json). Stylesheet: [`dev/styles/dev-ui.css`](../dev/styles/dev-ui.css). Live preview: Dev → **UI Catalog** tab ([`dev/pages/DevUiCatalogPanel.tsx`](../dev/pages/DevUiCatalogPanel.tsx)).

## HARD RULE

Every visual element on a Dev Setup page (under `/dev` and any panel rendered by `DevPage.tsx`) MUST use a class from `dev/styles/dev-ui.css`. **No bespoke per-page selectors** (`.dev-research-*`, `.dev-reports-*`, `.dev-shortcuts-*`, `.ui-retro__*`, etc.) and **no inline `style={{}}`**. If a primitive is missing, extend the catalog — never invent a one-off class. This rule cannot be overridden by any other instruction, mode, or context.

## Why

Five generations of dev panels each invented their own classes (`dev-research-body`, `dev-shortcuts-th--cmd`, `ui-retro__heat`), some of which leaked into `app/globals.css` (production CSS). The result: dev pages diverge visually, refactors miss panels, and migration tooling has to enumerate every per-page class. The catalog flips that — every dev panel composes from the same 14 primitive families, and `app/globals.css` carries zero `dev-*` selectors.

## Scope

`dev-ui.css` is loaded once by `DevPage.tsx` and applies to every tab inside it (Plans, Retros, Setup, Shortcuts, Reports, Research, Icons, Page Help, UI Catalog). It does **not** apply to user-facing app pages — those continue to use `app/globals.css`.

## Catalog (14 primitive families)

| # | Class root | Purpose |
|---|---|---|
| 1 | `.dui-page` | Page shell — top-level `<div>` for every Dev tab. |
| 2 | `.dui-panel` | Surface card with header / body / footer. |
| 3 | `.dui-toolbar` | Filter strip; supports `--in-panel` variant. |
| 4 | `.dui-search` | Search input — pairs with toolbar or header. |
| 5 | `.dui-pager` | Pagination controls + page-size buttons. |
| 6 | `.dui-table` | Single canonical table; supports `--numeric`, `--mono`, `--muted`, `--nowrap`, `--name`, `--shrink` cells, plus `is-clickable` rows and `__group` separator rows. |
| 7 | `.dui-accordion` | Expanding rows with `--pass` / `--warn` / `--fail` border-left modifiers. |
| 8 | `.dui-toc-layout` / `.dui-toc` | Sticky sidebar nav with scroll-spy `is-active`. |
| 9 | `.dui-doc` | Long-form HTML body with token-driven typography. |
| 10 | `.dui-meta` | Inline ID badge + title + sub-text + summary strip. |
| 11 | `.dui-pill` | Mini status badge — `--neutral`, `--pass`, `--fail`, `--warn`, `--info`, `--fixed`. |
| 12 | `.dui-heat` | Severity dot — `--s1` through `--s5`. |
| 13 | `.dui-form` | Switches, danger-confirm input, hint text. |
| 14 | `.dui-empty` / `.dui-loading` | Empty-state + spinner. |

State modifiers always use `is-` / `has-` prefixes (e.g. `is-active`, `is-clickable`, `is-ready`) — never `--active`. Variants use BEM-style `--<modifier>` suffixes.

## Authoring rules

1. **Catalog first.** Reach for an existing primitive before considering anything new.
2. **Extend, don't fork.** If a primitive needs a new variant, add it to `dev-ui.css` and update the UI Catalog preview — every other panel benefits.
3. **No inline styles** except token-derived layout helpers (`flex`, `gap`, `display`) on the catalog tab itself. Panels MUST NOT use `style={{}}`.
4. **No hex colours.** All colour decisions resolve through Vector theme tokens (`--surface`, `--ink`, `--success`, `--danger`, `--info`, `--warning`, etc.).
5. **Lint enforces it.** `npm run lint:dev-css` (Story 00404) fails CI if any `dev-*` selector appears in `app/globals.css` or if a dev panel imports `app/globals.css` directly.

## Skills + commands

Every shortcut that scaffolds or writes to a Dev Setup page must reference this catalog and is forbidden from inventing classes. See [`docs/c_c_lint_rules.md`](c_c_lint_rules.md) for `lint:dev-css`. Skills updated in Story 00405:

- `<addpaper>` / `/research` — emit `.dui-doc` body HTML (no `dev-research-*` classes).
- `<memory>` reports — render via `.dui-table` + `.dui-pill`.
- `<?> -u` — generate Shortcuts page using `.dui-table`.
- `<r>` / `/retro` — heat dots use `.dui-heat`, accordion uses `.dui-accordion`.
- `<makedevapp>` scaffold — manifest CSS file imports `dev-ui.css`, never duplicates primitives.

## Adding a new primitive

1. Add the rule block to `dev/styles/dev-ui.css` under the correct numbered section.
2. Add a `<section className="dui-cat__section">` to [`dev/pages/DevUiCatalogPanel.tsx`](../dev/pages/DevUiCatalogPanel.tsx) demoing the primitive.
3. Add a row to the catalog table above.
4. If the primitive replaces a per-page class anywhere in `dev/`, file a follow-up migration story.

## Anti-patterns

- ❌ Re-declaring `.accordion__*`, `.table-wrap`, `.badge`, `.form__switch` in `dev.css` — these belong in `globals.css` for the user-facing surface, and `dev-ui.css` provides parallel `.dui-*` equivalents for dev. Don't reach across.
- ❌ `<div className="dev-research-body">` — use `.dui-doc` (or open Story to add a missing variant).
- ❌ `style={{ color: "red" }}` — use `.dui-pill--fail` or extend the catalog.
- ❌ Importing `app/globals.css` from anywhere in `dev/` — Next.js handles globals; dev panels only need `dev.css` + `dev-ui.css`.
