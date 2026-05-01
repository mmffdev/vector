---
name: CSS enforcement — all elements must use globals.css; no inline styles; buttons need .btn
description: Every element on every page must be styled via globals.css classes and CSS variables — no inline styles, no exceptions unless dynamic value exposed as a CSS custom property
type: feedback
originSessionId: 43139e10-f5f1-4a48-bb00-5f2c887dc814
---

**Rule:** Every element placed on a page MUST be styled via `app/globals.css` classes and CSS variables. `style={{...}}` is prohibited. Every `<button>` MUST carry `.btn` + exactly one variant modifier.

**Why:** Two separate incidents on 2026-04-29:
1. Workdays picker day tiles and segmented control in Workspace Settings used `--brand` instead of `--accent`/`--accent-ink`, producing white-on-white invisible text.
2. Broader enforcement request: user explicitly stated "every element we drop onto a page uses the CSS; no custom styles unless requested."

**How to apply:**

1. **Inline styles** — Before writing `style={{...}}`, stop. Add the rule to `globals.css` under the appropriate component block. The only permitted exception: a genuinely dynamic value that can't be a CSS variable — in that case use `style={{ "--my-var": value }}` and reference `var(--my-var)` in the stylesheet.

2. **Buttons** — Every `<button>` in the app carries `.btn` as a base class plus exactly one variant:
   - `.btn` — default action
   - `.btn btn--primary` — primary CTA (one per region)
   - `.btn btn--secondary` — cancel / secondary
   - `.btn btn--ghost` — quiet / icon-only
   - `.btn btn--danger` — destructive
   - Add `.btn--sm` or `.btn--lg` for size variants
   A naked `<button>` with no class is a defect.

3. **Custom interactive elements** (toggle tiles, day pickers, segmented controls) that are NOT `.btn` buttons MUST compose from these tokens — never invent new token names or use `--brand` for interactive states:
   - Active: `background: var(--accent)`, `color: var(--accent-ink)`, `border-color: var(--accent)`
   - Inactive: `background: var(--surface)`, `color: var(--ink)`, `border: 1px solid var(--border-strong)`
   - Hover (inactive): `background: var(--surface-sunken)`, `color: var(--ink)`
   - Geometry: `border-radius: 0`, `height: 40px` (matches `.btn`)
   - `--brand` is for identity marks only — never for interactive state colors.

4. **Use the catalog first** — check `docs/css-guide.md` component catalog before writing any new class. If an existing block + modifier covers the case, use it.
