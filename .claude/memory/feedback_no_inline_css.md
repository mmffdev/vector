---
name: No inline CSS in Vector PM
description: Never use inline style objects or style attributes in JSX — all styling via globals.css classes
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
No inline CSS in the Vector PM frontend. Every component must use CSS classes defined in `app/globals.css` (or a scoped stylesheet). No `style={{...}}` attributes, no JS-object style maps.

**Why:** The existing pages (login, change-password, Topbar, Sidebar, and the admin page I just built 2026-04-21) all use inline style objects, which the user flagged as wrong. Inline styles duplicate rules, fight the light/dark theme system, and can't be overridden without !important.

**How to apply:**
1. When building new components, add class names and put the rules in `globals.css` using `var(--ink-1)`, `var(--line-1)`, etc.
2. The initial cleanup pass completed 2026-04-21 — admin page, login, reset request, reset confirm, change-password, Topbar, Sidebar, (user)/layout, and the dev page were all migrated. `grep -R "style={{" app/` should return nothing; if it does, migrate on sight.
3. Skip `style={{...}}` even for "just one line" — no exceptions.
