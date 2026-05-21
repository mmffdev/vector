# CSS Conventions

**Buttons:** every `<button>` carries `.btn` + variant. Variants in [app/globals.css](app/globals.css) ~1141–1255: `--primary`, `--secondary`, `--ghost`, `--icon` (36×36, combine with `--ghost`), `--danger`, `--row-expander`, `--sm`, `--lg`, `--block`. Bespoke selectors NEVER restate baseline. Naked `<button>` = defect.

**Tables:** every table uses `.tree_accordion-dense__*` (scroll/table/head/th/row/cell/`--numeric`/`--center`/`--mono`/`--epic`/`--child`/`--selected`). Old `.table*` family DEPRECATED (overflow:hidden clipped sticky heads). Column widths via `<col style={{width:N}}/>` inside `<colgroup>` — only sanctioned inline style.

**No inline `style={{}}`.** Exception: `style={{"--my-var": value}}` for genuinely dynamic CSS-var assignment. Custom interactive elements compose from tokens — active uses `--accent` / `--accent-ink`, never `--brand` (`--brand` is for identity marks only).

**CSS/HTML naming:** `root-block__Container_Child_leaf`. `__` once at root, `_` deeper, `-` modifier only. No BEM `--`, no generics (`wrapper`/`box`). Propose chain ONLY when introducing NEW root-block or renaming; routine adds silent.
