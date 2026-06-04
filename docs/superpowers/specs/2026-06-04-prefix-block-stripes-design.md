# PrefixBlockStripes — design

**Date:** 2026-06-04
**Status:** Approved, implementing

## Goal

Extract the decorative striped square (currently inlined as `.grid__Tree_Title_Badge`
in `Grid__Tree`) into a reusable `PrefixBlockStripes` component, swap it into the
grid's existing usage, and add it as a prefix to the main site title in the shell
header so it renders on every `(user)` page.

## Component — `app/components/PrefixBlockStripes.tsx`

- Pure presentational, decorative → `aria-hidden="true"`, no semantic content.
- Optional `size?: number` (default `32`) so each call site requests its own size
  without forking CSS. Passed through as a `--prefix-block-size` CSS var.
- Optional `className?: string` for call-site layout hooks.
- Renders `<span className="prefix-block-stripes" aria-hidden />`.

## CSS — `.prefix-block-stripes`

Moves the exact pattern out of `.grid__Tree_Title_Badge`:

```css
.prefix-block-stripes {
  flex-shrink: 0;
  width: var(--prefix-block-size, 32px);
  height: var(--prefix-block-size, 32px);
  background: repeating-linear-gradient(
    -45deg,
    var(--ink) 0,
    var(--ink) 5px,
    var(--canvas) 5px,
    var(--canvas) 10px
  );
}
```

## Grid__Tree swap

`app/components/Grid/Grid__Tree.tsx` — replace the `grid__Tree_Title_Badge` span
(the `badge` branch) with `<PrefixBlockStripes />`. Retire the now-dead
`.grid__Tree_Title_Badge` rule in `globals.css`.

## Shell header

`app/redesign/components/RedesignTopBar.tsx` + `app/redesign/shell.css`:

- Block sits flush-left at the header's existing 30px padding; title text to its
  right (common left edge = the block's left edge — chosen alignment).
- Wrap: `<div class="main_title__lead"><PrefixBlockStripes/><h1 .../></div>` inside
  the existing flex row so `main_title__actions` stays right-aligned.
- Always present (every page via `(user)/layout.tsx → RedesignShell → RedesignTopBar`).
- Block size tuned visually to the `--text-xl` title cap-height.

## Out of scope

- No behaviour, no props beyond size/className. Decorative only.
