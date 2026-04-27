# Vector Design System — Handoff for Claude Code

You (Claude Code) have been pointed at this folder. Read this file first, then start work.

---

## What this folder is

The **Vector design system** for MMFFDev — an enterprise SaaS portfolio/programme management platform. It contains the rules, tokens, components, and reference UIs you must follow when building or editing any Vector interface.

**Aesthetic:** flat, warm-neutral, monochrome with restrained status colour, generous whitespace. **No drop shadows. No gradients. No decorative colour.** Hierarchy comes from typography, tone shifts, and spacing — never depth.

---

## Read these files, in this order

1. **`SKILL.md`** — the skill front-matter (also tells you what to do if invoked standalone).
2. **`README.md`** — full system: branding hierarchy, content fundamentals, visual foundations, iconography, file index. **This is the source of truth.**
3. **`colors_and_type.css`** — every CSS variable: foundation tokens, type scale, spacing, radii, semantic styles. Drop-in.
4. **`ui_kits/vector-app/`** — reference React components built against this system:
   - `styles.css` — component styles (sidebar, top bar, cards, tables, buttons, pills, accordion)
   - `Sidebar.jsx`, `TopBar.jsx`, `Components.jsx`, `Dashboard.jsx`, `Backlog.jsx`, `PortfolioModel.jsx`, `Accordion.jsx`
   - `index.html`, `portfolio-model.html`, `accordion.html` — interactive demos
5. **`preview/*.html`** — visual reference cards for tokens & components (use these to verify intended look).

---

## Hard rules — do not break these

- **No shadows.** No `box-shadow` on UI chrome, ever. Separation = canvas-vs-surface tone + 1px border.
- **No gradients on chrome.** Decorative illustrations are fine, app surfaces are not.
- **Inter only.** Single sans family. Variation comes from weight + size, not from juggling fonts.
- **Tabular nums on every numeric column.** `font-variant-numeric: tabular-nums`.
- **Eyebrow micro-labels** for section headings — `11px`, `letter-spacing: 0.08em`, `text-transform: uppercase`, `color: var(--ink-subtle)`.
- **Status pills are always icon + label** — never colour alone.
- **Brand colour never in charts.** Charts are monochrome (ink for primary, ink-muted for comparison).
- **Rule of one accent.** Only one of {Platform, Tenant, Product} expresses colour in any given region.
- **One primary button per region.**

---

## What to do now

The user wants you to **build / edit their live Vector codebase using this design system**. Specifically:

### Step 1 — Adopt the tokens

Copy `colors_and_type.css` into the target codebase (e.g. `src/styles/tokens.css`) and import it at the root. **All colour, type, spacing, and radius values must come from these CSS variables.** Do not invent hex codes or pixel values.

### Step 2 — Adopt the components

Treat the JSX files in `ui_kits/vector-app/` as the canonical implementations. Port them into the target codebase's component idiom (Next.js / React / whatever they use), but keep:
- Same DOM structure
- Same class names (`.btn`, `.card`, `.tbl`, `.pill`, `.eyebrow`, `.acc-row`, etc.)
- Same visual rules (heights, radii, colours, padding from `styles.css`)

### Step 3 — Confirm before bulk-editing

Before refactoring any existing page, **summarise the changes you'll make and ask the user to confirm**. Don't silently rewrite their UI.

### Step 4 — When building new pages

Reference `ui_kits/vector-app/portfolio-model.html` as the canonical "admin page" template (header bar + sidebar + page content with eyebrow-labelled sections + tables + footer actions). Match that structure unless the user says otherwise.

For any new tabular content with expandable rows, use the **AccordionTable** component (`Accordion.jsx`) — don't invent a new pattern.

---

## Open questions you should raise

The brief left these unresolved. Ask the user before assuming:

1. **Platform brand accent** — currently defaults to ink. Do they want a Vector signature colour for platform-only surfaces (login, system emails)?
2. **Tenant + Product brand examples** — got real logos/hex pairs to wire into `--brand-tenant` / `--brand-product`?
3. **Iconography source** — Lucide via CDN, self-hosted SVG sprite, or the inline icons currently in the JSX components?
4. **Density variant** — compact mode v1 or v2?
5. **Font hosting** — Inter from Google Fonts (current) or self-hosted woff2?

---

## How to call back

When you're done with a piece of work or need direction, ping the user with:
- A short summary of what you changed
- A list of any **caveats** (substitutions, assumptions, places you deviated from the system)
- A **clear ask** for what to do next

Do not silently complete large multi-file edits without confirmation.
