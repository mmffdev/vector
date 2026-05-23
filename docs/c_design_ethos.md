# Design Ethos — Award-Winning UI/UX

**Standing principle for every visual / interaction surface in Vector.**

This site exists to **wow** users. The bar is **Awwwards Site of the Day**, **CSS Design Awards Website of the Day**, **FWA of the Day**, **Webby**. Not "clean enterprise SaaS" — that's the floor we already cleared. Every screen Rick sees should feel like it belongs in a design publication.

## Non-negotiables

1. **Ultra-modern, experimental UI/UX.** Default to the contemporary edge — kinetic typography, bento layouts, glass + grain, scroll-bound motion, generative accents, asymmetric grids, micro-interactions. If a pattern feels "safe Material 2020" — push further.
2. **Data is the hero, the chrome serves it.** Every panel, table, chart, and tree on this site presents or manipulates data. Make the data legible AND beautiful — never one at the expense of the other. Chrome (borders, gutters, labels) recedes; data sings.
3. **Colour schemes that win awards.** Palettes are deliberate, harmonious, and emotive. No default Tailwind greys, no stock Bootstrap blues. Theme packs (see [`docs/c_theme_rules.md`](c_theme_rules.md)) are art-directed — every role-mapping decision is intentional.
4. **Design quality is a gate, not a polish step.** Don't ship a feature that's "functional but ugly" and promise to revisit. Visual quality is part of Definition of Done. If the design hasn't reached the bar, the story isn't accepted.
5. **Top-tier craft on every detail.** Spacing rhythm, typographic hierarchy, easing curves, hover states, empty states, loading states, transitions between routes. The 90% nobody notices is what separates award winners from competent work.

## What this means in practice

- **When designing a new page** — start from "what would Awwwards SOTD look like for this?" not "what does the standard CRUD layout require?"
- **When picking a component pattern** — prefer the experimental over the generic IF it serves the data better. Bento over plain card grid. Animated reveal over instant pop. Force-directed graph over flat list when relationships matter.
- **When choosing colour** — reach for the active theme pack's full role spectrum, not just `--text` on `--bg`. Use accent, decorative, and surface variants intentionally.
- **When pushing motion** — every transition has a curve and a duration that was *chosen*, not defaulted. Snappy where it should be snappy (button feedback ≤120ms), expressive where it should be expressive (route reveal, modal entry).
- **When ambiguous** — ask "is this the version that wins an award, or the version that just works?" Pick the former unless time-boxed otherwise.

## Hard floor (still applies)

The experimental bar **never** compromises:

- **Accessibility** — WCAG 2.2 AA is the floor, not the ceiling. See [`docs/c_accessibility.md`](c_accessibility.md). Motion respects `prefers-reduced-motion`. Contrast holds across every theme pack.
- **Security posture** — no client-only gates dressed up as UX. See [`docs/c_security.md`](c_security.md) + Server-is-the-Gate hard rule.
- **Performance** — kinetic doesn't mean janky. 60fps for interactions on the dev rig, no >100KB hero images, lazy-load anything below the fold.
- **Naming + CSS conventions** — experimental visuals still live inside the `root-block__Container_Child_leaf` discipline and use catalog classes (no inline `style={{}}`). See [`.claude/memory/css_naming_convention.md`](../.claude/memory/css_naming_convention.md) + [`docs/css-guide.md`](css-guide.md).

## Reference benches

When Claude is asked for design direction, the calibration anchors are:

- **Awwwards SOTD** (last 12 months) — site-of-the-day archive.
- **Linear, Vercel, Stripe, Arc, Raycast, Things 3** — for product-data UX that still wins awards.
- **Refactoring UI, Practical Typography** — for the craft layer beneath the experimentation.
- **CSS Design Awards, FWA, Site Inspire** — for layout / motion / palette inspiration.

The question is never "is this acceptable?" — it's **"would this be screenshotted and shared?"**
