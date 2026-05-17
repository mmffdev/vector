# Accessibility — WCAG 2.2 Level AA

Single source of truth for web accessibility in Vector. Load before any UI work that touches interaction surfaces (buttons, modals, forms, tables, navigation) or before a pre-launch a11y pass.

Scope: web only — Vector ships as a Next.js app. Native (iOS/Android) is out of scope; revisit when SIGMA / mobile surface lands.

## POUR — the four pillars

Every WCAG 2.2 criterion rolls up to one of:

- **Perceivable** — users can sense the content (contrast, alt text, reflow).
- **Operable** — users can interact (keyboard, target size, focus).
- **Understandable** — content + behaviour are predictable (errors, consistent nav).
- **Robust** — assistive tech can parse it (Name/Role/Value, valid semantics).

The accessibility tree is what screen readers actually "read" — not your DOM. Use native semantic elements (`<button>`, `<a>`, `<nav>`, `<dialog>`) before reaching for ARIA. Every `<div>` with `onClick` is a defect.

## Perceivable

### Contrast ratios (SC 1.4.3, 1.4.11)

| Surface | Minimum ratio |
|---|---|
| Body text (≤18px or ≤14px bold) on background | **4.5:1** |
| Large text (>18px or >14px bold) on background | **3:1** |
| Interactive control boundaries, focus rings, state indicators | **3:1** against adjacent colours |

Vector tokens that must observe this: `--ink-1` through `--ink-4` against `--bg` / `--surface` / `--surface-alt`. Verify each theme pack with a contrast checker before merging it.

**HARD RULE:** Never encode meaning by colour alone. A red border without an icon or text marker fails SC 1.4.1.

### Text alternatives (SC 1.1.1)

- Decorative SVGs inside buttons: `<svg aria-hidden="true">` + button has its own label.
- Icon-only buttons (`.btn .btn--icon`): MUST carry `aria-label="…"`.
- Images that convey information: `alt="…"` with the actual content, not "Image of…".
- Charts: provide a text summary or data table alongside.

### Reflow (SC 1.4.10)

Layout must remain functional up to 400% zoom without horizontal scrolling on a 1280px viewport. Vector's `900px` mobile breakpoint handles this naturally; new components inherit it through `.app-content-container`.

## Operable

### Target size — SC 2.5.8

**HARD RULE:** Every interactive element MUST have a hit area of **≥ 24×24 CSS pixels**. Vector's `.btn` size ladder already passes — `.btn--micro` (20×20) is the only exception and is allowed only in dense table-row contexts where adjacent rows give vertical headroom (effective spacing satisfies the exception in SC 2.5.8).

For icon buttons smaller than 40×40 visible, **expand the hit area via a `::before` pseudo-element** rather than adding outer padding that disrupts layout:

```css
.btn--micro::before {
  content: "";
  position: absolute;
  inset: -8px;
}
```

### Keyboard operability (SC 2.1.1, 2.1.2)

- Every interactive surface MUST be reachable via Tab in a logical order.
- Every interactive surface MUST have a visible focus indicator (see SC 2.4.11).
- **No keyboard traps.** Modals, popovers, and flyouts MUST release focus on Esc or explicit close.
- Drag-only interactions (e.g. `@dnd-kit` reordering in [docs/c_c_dnd.md](c_c_dnd.md)) MUST have a keyboard alternative — typically up/down arrows on the focused row (SC 2.5.7).

### Focus appearance — SC 2.4.11

The focus ring MUST be:

- At least **2px thick** in solid colour, OR an equivalent contrast change.
- At least **3:1 contrast** against both the focused element and the adjacent background.
- Not removed without replacement. `outline: none` without a substitute focus style is a defect.

Vector standard: `:focus-visible` uses `--accent` for the ring; never use `--brand`.

### Modal focus trap — SC 2.1.2

**HARD RULE:** When `.modal.is-open`, focus MUST be contained inside the modal and Esc MUST close it. On close, focus MUST restore to the trigger element. Apply to every modal, flyout, and popover — `<ArchiveMapFlyout>`, dropdown menus, command palette, etc.

Pattern:

1. On open, store `document.activeElement` as the return target.
2. Focus the first focusable element in the modal (usually the close button or primary action).
3. Trap Tab cycle inside the modal.
4. On close (button click, Esc, backdrop click), focus the stored return target.

## Understandable

### Error identification + suggestion — SC 3.3.1, 3.3.3

- Form validation MUST surface a text message linked to the field via `aria-describedby`.
- Where possible, suggest a correction ("Email must include `@`") rather than just flagging the failure.
- Use `.form__error` (existing catalog class) — never a coloured border alone.

### Consistent navigation — SC 3.2.3

`.sidebar-item`, `.anav`, and `.topbar` MUST present items in the same order across pages. New navigation surfaces inherit via the four CSS custom properties defined in [docs/css-guide.md](css-guide.md) — don't reorder.

### Redundant entry — SC 3.3.7

Don't re-ask for data the user already provided in the same flow. Pre-fill where possible (email confirmation, address copy, etc).

## Robust

### Name, Role, Value (SC 4.1.2)

Every interactive element MUST expose:

- **Name** — what it is (label text, `aria-label`, `<label for=>`).
- **Role** — what it does (native element OR `role="…"`).
- **Value / State** — current state (`aria-expanded`, `aria-selected`, `aria-pressed`, `aria-checked`).

Bad: `<div onClick={…} class="btn">Save</div>` — no role, no keyboard handling.
Good: `<button class="btn btn--primary" onClick={…}>Save</button>` — semantic, keyboard-accessible by default.

### Status messages — SC 4.1.3

Toasts, inline status, and async result banners MUST use `aria-live`:

- `aria-live="polite"` — announces when the user is idle (default for most status).
- `aria-live="assertive"` — interrupts immediately (errors, blocking states only).

Vector primitive: toasts should carry `role="status"` (implicit polite) or `role="alert"` (implicit assertive).

## Anti-patterns

| Anti-pattern | Why it fails | Fix |
|---|---|---|
| `<div onClick>` button | No keyboard, no role | `<button class="btn …">` |
| Colour-only error state | Fails 1.4.1 for colour-blind users | Add icon + text |
| Modal that doesn't trap focus | Fails 2.1.2 | Trap + restore on close |
| `outline: none` without replacement | Fails 2.4.11 | Keep ring or replace |
| `alt="Image of a chart"` | Screen reader already announces "image" | `alt="<actual content>"` or `aria-hidden` if decorative |
| Drag-only reorder | Fails 2.5.7 | Provide arrow-key alternative |
| Icon-only button with no `aria-label` | No accessible name | Add `aria-label` |
| `<h2>` outside `<Panel>` | Heading hierarchy + missing semantic context (Vector-specific) | Use `<Panel name="…" title="…">` per [docs/c_c_lint_rules.md](c_c_lint_rules.md) |

## Pre-launch checklist

Run this before any page or feature ships:

- [ ] Every interactive element ≥ 24×24 CSS px (or uses pseudo-element hit area expansion).
- [ ] Focus indicator visible and ≥ 3:1 contrast on every interactive element.
- [ ] Every modal/flyout traps focus while open and restores on close.
- [ ] Every dropdown / menu / popover restores focus to its trigger on close.
- [ ] Every form provides text error messages linked via `aria-describedby`.
- [ ] Every icon-only button has `aria-label`.
- [ ] Content reflows at 400% zoom without horizontal scroll.
- [ ] No information conveyed by colour alone.
- [ ] Tab order is logical and matches visual order.
- [ ] Async status surfaces use `aria-live` or implicit `role="status"` / `role="alert"`.

## References

- [WCAG 2.2 Guidelines](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [docs/css-guide.md](css-guide.md) — catalog classes that already meet a11y defaults
- [docs/c_c_dev_ui_primitives.md](c_c_dev_ui_primitives.md) — `.dui-*` rules for `/dev` pages
