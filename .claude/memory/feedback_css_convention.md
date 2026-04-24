---
name: Vector PM CSS naming convention
description: BEM-lite convention for all Vector PM frontend styling — classes in globals.css, no inline styles
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
All Vector PM CSS follows **BEM-lite** with category prefixes. Full reference lives in the project at `docs/css-guide.md` — read it before adding styles.

**Core rules (TL;DR):**
- `.block`, `.block__element`, `.block--modifier` — standard BEM
- Prefixes: `u-` utility, `is-`/`has-` state, `js-` JS-only hook
- All values via CSS variables (`var(--ink-1)`, `var(--line-1)`)
- No inline `style={{...}}`, no Tailwind, no CSS-in-JS
- One component class + modifiers per element: `<button className="btn btn--primary btn--sm">`

**Why:** User asked for a consistent convention before the codebase grew more pages (admin page + login + change-password + Topbar were all inline-style one-offs). BEM-lite was chosen because it's zero-tooling, retrofits cleanly onto the existing `.sidebar`/`.topbar` class names, and works with the existing CSS-variable token system.

**How to apply:**
1. Before writing any new styling, read `docs/css-guide.md` in the project.
2. New components get a block class defined in `app/globals.css`, not inline styles.
3. If you find yourself reaching for `style={{...}}`, stop — add or reuse a class instead.
4. The utility prefix `u-` is sparingly for single-purpose helpers; prefer proper component classes.
