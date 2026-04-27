# Vector Design System — MMFFDev

> Vector is the platform. The design system is its grammar.

This is the design system for **MMFFDev Vector**, an enterprise SaaS platform for portfolio, programme, and product management — a Jira/Rally-class tool that intentionally feels classy and modern, not corporate. Flat surfaces, warm neutrals, restrained colour, generous whitespace.

The system spans **three branding tiers** and a **personal preference layer** so it can dress itself up as the platform, as a tenant, as a specific product, and as a single user — without any of those identities tripping over each other.

---

## At a glance

| | |
|---|---|
| **Product** | Vector — enterprise agile / portfolio management |
| **Owner** | MMFFDev |
| **Stack** (reference) | Next.js 15 + React 18, custom CSS (no Tailwind, no UI lib), Go backend |
| **Aesthetic** | Flat. Warm neutral. Monochrome with restrained status colour. Calm. |
| **Anti-aesthetic** | Drop shadows, gradients, decorative colour, multiple accents in one region |
| **Reference vibe** | Spark Pixel dashboard (`assets/Spark-Pixal.jpg`) |

---

## Branding hierarchy

Four layers. Only one expresses colour in any region at a time. This is **the rule of one accent**.

| Tier | Owner | Where it lives | Colour |
|---|---|---|---|
| **Platform** | MMFFDev Vector | Login screen, footer wordmark, system emails | Quiet — defaults to ink |
| **Tenant** | The customer org | Sidebar header, login background | Tenant brand colour (themeable, gated by WCAG AA) |
| **Product** | A product line in a tenant | Active tab, primary CTA, breadcrumb root | Product accent (scoped to that product only) |
| **Personal** | The end user | Light / Dark / Custom | Inverts foundation only — never overrides brand |

---

## Sources & provenance

| Resource | Path / link | Notes |
|---|---|---|
| Design brief | `research/MMFFDev-Vector-design-system.md` | Authoritative spec — all tokens are derived from this |
| Reference dashboard | `assets/Spark-Pixal.jpg` | "Reference vibe" — clean, warm, monochrome with restrained status colour |
| Reference codebase | `MMFFDev - PM/` (mounted, read-only) | Next.js 15 app at `app/`, key components in `app/components/`, current global CSS in `app/globals.css` |
| Uploaded fonts | `fonts/ZenMaruGothic-*.ttf` | Kept available for accent / legacy use; **not** the system default |

> The reference codebase currently uses Zen Maru Gothic + Archivo Black + JetBrains Mono and a hot-pink / lime-green accent system. **The design system here intentionally departs from that** — the brief calls for Inter throughout and warm neutrals with no decorative colour. The codebase is the prior art; the brief is the future state. All tokens here follow the brief.

---

## File index

| File / folder | What's in it |
|---|---|
| `README.md` | You are here. Context, foundations, content, iconography, manifest. |
| `SKILL.md` | Agent-skill front-matter for use as a Claude Code skill. |
| `colors_and_type.css` | All foundation tokens — colours, type, spacing, radii, semantic classes. |
| `fonts/` | Zen Maru Gothic (legacy/accent). Inter is loaded from Google Fonts. |
| `assets/` | Logos, the Spark Pixel reference image. |
| `preview/` | Standalone HTML cards (one per concept) that render in the Design System tab. |
| `ui_kits/vector-app/` | High-fidelity recreations of the Vector app — sidebar, dashboard, backlog, login. |
| `research/` | Original brief + reference imagery. |

---

## Content fundamentals

How copy is written across Vector. Tone is the *interface's* tone — quiet, exact, helpful — never marketing-cheery and never enterprise-cold.

### Voice

**Calm, deliberate, plainspoken.** We write like a senior PM giving you a status update — no exclamation marks, no "Awesome!", no emoji. We assume you came here to do work, not be entertained.

### Person

- We say **"you"** to the user. Never "we", never "your team" unless the team is the actual subject.
- We say **"Vector"** when we mean the platform; never "the platform" or "the system".
- We do **not** use first-person plural in product copy. (`README.md` and design docs may — that's authorial voice.)

### Casing

| Surface | Casing | Examples |
|---|---|---|
| Page titles | Sentence case | "Welcome back, Salung", "Portfolio overview" |
| Card titles | Sentence case | "Sales trend", "Recent transactions" |
| **Eyebrow / micro-labels** | **ALL CAPS, letter-spacing 0.08em** | "TOTAL REVENUE", "RECENT TRANSACTIONS", "ID", "CUSTOMER" |
| Buttons | Sentence case | "Export CSV", "Add transaction", "Save changes" |
| Status pills | Sentence case | "Success", "Pending", "Refunded" |
| Tabs | Sentence case | "Daily", "Monthly", "Yearly" |
| Nav items | Sentence case | "Dashboard", "Customer list", "Roles & permissions" |

The all-caps eyebrow is the system's signature device — use it on table column headers, dashboard tile labels, and section dividers in long pages. Nowhere else.

### Length & rhythm

- **Page subtitles** are one short clause — "Your workspace overview", "Pin portfolios and products to your sidebar bookmarks." Period at the end if it's a full sentence; no period if it's a fragment.
- **Empty states** are two lines: a short heading (3–6 words) and a single explanatory sentence. No CTAs unless we know what the user should do next.
- **Error messages** name the thing and the action. "Invalid email or password." "Account locked. Try again later." Never "Oops!" or "Something went wrong.".
- **Helper text** under inputs is a single sentence in `--ink-muted`.

### Numbers, dates, and currency

- Always **tabular-nums** in tables and metrics so columns align.
- Currency: `$20,320` (symbol, comma thousands, no trailing `.00` unless needed).
- Date ranges: `Jan 1 – Aug 30` (en-dash, sentence-cased month abbrevs).
- Deltas: `+0.94 last year` — sign always shown, comparator after.
- Counts: `4,305 New Users` — sentence case, plural where natural.

### What we don't do

- ❌ Emoji in product UI. (Doc files like this README are exempt.)
- ❌ "!" in product copy.
- ❌ "Awesome", "Great", "Oops", "Whoops".
- ❌ Marketing capitals ("Premium Feature").
- ❌ Hype words: "powerful", "seamless", "next-gen", "revolutionary".
- ❌ Apologetic empty states ("We couldn't find anything!").

### Worked examples

> **Welcome back, Salung**  
> Your workspace overview

> **TOTAL REVENUE**  
> $20,320  +0.94 last year

> **No portfolios yet**  
> Portfolios and products will appear here once they exist.

> **Account locked. Try again later.**

---

## Visual foundations

### Surfaces & separation

Vector has **three** background tones, in order from outermost to innermost:

1. **Canvas** `#F4F2EE` — the warm off-white app background. The biggest surface in any view.
2. **Surface** `#FFFFFF` — cards, panels, modals, the sidebar.
3. **Surface sunken** `#EDEAE4` — table headers, active nav items, hover-row tint, subtle inset wells.

Separation between regions comes from the canvas/surface tone shift plus a 1px border. **Never** from a shadow, never from a gradient. If something feels insufficiently distinct, the answer is more whitespace, a stronger border (`--border-strong`), or a sunken tone — not depth.

### Type

- **Inter** throughout. One family, one personality. Hierarchy is weight + size + colour.
- **JetBrains Mono** only for code, IDs, technical configs.
- Numerics are always `font-variant-numeric: tabular-nums` so columns align without `text-align: right` hacks.
- Bold (`700`) is reserved for display metrics and emphatic states. Default emphasis is **semibold (600)**.
- Eyebrow micro-labels are the system signature — see Content fundamentals.

### Spacing

4px base scale. Named tokens (`--space-1` through `--space-16`) — never raw px. Card padding is `--space-6` (24px). Table rows are 48px. Inputs are 40px. **Generous** is the default — when in doubt, add space, don't remove.

### Borders & radii

- Hairline borders at `--border` (`#E5E1DA`). Stronger separation at `--border-strong` (`#D4CFC5`) for inputs.
- Cards use `--radius-lg` (12px), buttons/inputs `--radius-md` (8px), pills `--radius-full`.
- **No shadows. Ever.** Not even subtle ones. Not on cards, not on dropdowns, not on tooltips. The system was designed without them — adding one breaks the language.

### Backgrounds & imagery

- The canvas is a warm flat fill — no patterns, no textures, no noise, no subtle gradients.
- Imagery (avatars, illustrations) sits inside surfaces and is rendered without shadow or border.
- Illustrations, when they appear, are flat geometric or editorial line art. (Style is open question #5 in the brief — TBD.)
- **No full-bleed photography in chrome**. Marketing surfaces may use it; product chrome does not.

### Animation

- **Calm.** 150ms easing on hover and focus state changes. 250ms on layout transitions (sidebar collapse).
- Easing is `ease` for tone changes, `ease-out` for entries, `ease-in` for exits.
- **No bounces, no springs, no parallax.** Nothing that draws attention to itself.
- Always respect `prefers-reduced-motion: reduce`.

### Hover & press states

- **Hover on a row or item:** background tints to `--surface-sunken`. Text colour stays.
- **Hover on a button (primary):** colour shifts slightly toward black; no scale, no glow.
- **Hover on a link:** opacity 0.8 or text colour darkens. Never underline-on-hover unless underlined when at-rest.
- **Press:** no scale-down, no shrink. The state is communicated by the tone shift staying.
- **Focus:** 2px outline in `--ink`, 2px offset. Tenant-brand if the tenant has set one and contrast permits. Never removed.

### Transparency & blur

- Used sparingly. Modal backdrops are `rgba(0,0,0,0.4)` flat — no blur.
- We **don't** use frosted-glass / backdrop-filter in product chrome.
- Disabled state is `opacity: 0.5`; everything else is fully opaque.

### Imagery vibe

When imagery is used (avatars, dashboard illustrations, marketing): warm, neutral-leaning, low-saturation. Never cool blue, never high-saturation, never grain or film texture. The reference is `assets/Spark-Pixal.jpg` — flat, monochrome, clean.

### Cards

White surface (`--surface`) on warm canvas (`--canvas`). 1px `--border` hairline. `--radius-lg` (12px). `--space-6` padding. **No shadow.** Header pattern: eyebrow micro-label, optional inline action / overflow menu, then content.

### Layout rules

- App shell is a fixed left sidebar (240px expanded, 64px collapsed) and a fluid main canvas.
- Main content max-width is 1440px with a minimum of `--space-6` side gutter.
- Card grids are 12-column with a `--space-6` gutter.
- Mobile: sidebar collapses; cards stack at full canvas width.

### Charts

Monochrome. `--ink` for the primary series, `--ink-muted` for comparison. Gridlines are `--border` at 50% opacity, dashed. Axis labels are `--text-xs` `--ink-subtle`. **Brand colour is never used in charts** — this keeps charts comparable across tenants and prevents accessibility surprises when a tenant brand is low-contrast.

---

## Iconography

### Library

**Lucide** — single source, 1.5px stroke at 16/20px, 2px stroke at 24px+. Icons inherit `currentColor`, never coloured for decoration. Status icons get coloured only when paired with a status pill.

We link Lucide via CDN in preview cards (`https://unpkg.com/lucide-static`) and recommend the React package in production:

```bash
npm install lucide-react
```

### Sizes

| Context | Size |
|---|---|
| Inline with body text | 14px |
| Default in dense UI (table actions, ghost buttons) | 16px |
| Primary nav (sidebar) | 20px |
| Standalone (page headers, empty states) | 24px |

### Rules

- One library only. **Do not mix** Lucide with Heroicons, Material, Phosphor, etc.
- Stroke width is the brand voice — don't override per-icon.
- Never use icons as decoration. If an icon doesn't add information, remove it.
- Emoji in product UI: ❌ no. (Markdown docs may.)
- Unicode chars as icons (✓, →, etc.): only for keyboard glyphs and inline math/text symbols. Never as a stand-in for an icon.

### Codebase status

The reference codebase ships a small custom `NavIcon.tsx` component with bespoke SVGs for sidebar items. Going forward, those should be migrated to Lucide equivalents (`pencil` → Lucide `Pencil`, etc.). No proprietary icon font, no SVG sprite.

---

## Slides

No slide template was provided with this brief. If/when one is supplied, slide assets will live in `slides/`.

---

## UI kits

| Kit | Path | Status |
|---|---|---|
| **Vector App** | `ui_kits/vector-app/` | Sidebar, dashboard, backlog table, status pills, login — based on the reference codebase's pages and the brief's component spec |

Each kit's `index.html` is a click-thru hi-fi recreation. Components are factored into small JSX files; the kit's `README.md` lists what's in it.

---

## Open questions (from the brief)

These are unresolved in the brief and worth bringing to the user:

1. **Platform brand colour** — currently ink. Should MMFFDev Vector own a signature accent (used only on platform surfaces — login, system emails)?
2. **Display font** — Inter throughout is the safe choice. A subtly distinctive face for page titles only could give Vector more personality.
3. **Density variants** — compact mode for power users — v1 or v2?
4. **Tenant brand on charts** — currently disallowed. Revisit with strict contrast gate?
5. **Illustration style** — flat geometric? Editorial line art? Worth defining before product teams pick their own.
