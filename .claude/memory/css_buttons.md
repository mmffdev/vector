---
name: CSS — canonical .btn rule
description: Every <button> in Vector MUST carry .btn + variant; bespoke selectors may only override positioning/colour, never restate baseline declarations.
type: feedback
originSessionId: 2af977f2-07e2-4db6-9734-a27922315e85
---
Every `<button>` in the Vector codebase MUST carry `.btn` plus exactly one variant. The canonical button system lives in [app/globals.css](../../app/globals.css) ~lines 1141–1255 and is documented in [docs/css-guide.md](../../docs/css-guide.md) (Buttons section — read it before writing or editing any button).

**The variants:**
- `.btn` — default (ink fill)
- `.btn .btn--primary` — primary CTA (accent fill)
- `.btn .btn--secondary` — accent outline
- `.btn .btn--ghost` — transparent / muted (use for toolbar buttons)
- `.btn .btn--icon` — square 36×36 icon-only (add `.btn--ghost` for transparent)
- `.btn .btn--danger` — destructive
- `.btn .btn--row-expander` — tree expander
- `.btn .btn--sm` — 32px height (combine with any of the above)
- `.btn .btn--lg` — 48px height
- `.btn--block` — full-width

**HARD RULE — bespoke selectors may NEVER restate baseline declarations.** A bespoke selector (e.g. `.chart-widget__close`, `.topo-flyout__close`) is allowed to override ONLY:
- `position`, `top`, `right`, `bottom`, `left`, `z-index`
- `margin`
- An icon's accent or hover colour, only when it genuinely differs from the variant default

It must NOT redeclare `display`, `align-items`, `width`, `height`, `padding`, `border`, `background`, `color`, `border-radius`, `font-*`, `cursor`, `transition`. If those are needed, the variant already provides them.

**Why:** changing the site-wide button shape (e.g. radius, height, hover behaviour) must be a single edit to `.btn` + variants. Every duplicated declaration is a place a future theme change has to be re-applied — exactly the problem the user flagged on 2026-05-04 when reviewing the topology toolbar.

**How to apply:**
- When writing a new button: pick the closest `.btn` variant; never invent a new bespoke button class for shape/size.
- When editing an existing button without `.btn`: this is a defect — add `.btn .btn--<variant>` to the className AND strip duplicated declarations from the bespoke selector. Often the bespoke selector ends up empty and can be deleted entirely.
- Round/circular buttons are NOT exempt: per user policy (2026-05-04), every button is square. The only exception is decorative pill shapes that are not buttons (e.g. `.toggle-btn__blob`, `.profile-bar__pill`, colour swatches like `.topo-flyout__swatch`).
- Naked `<button>` with no class is a defect — full stop.
