# Theme Rules — Deterministic Palette → Role Mapping

Specification used by `<theme>` (see [`.claude/skills/theme/SKILL.md`](../.claude/skills/theme/SKILL.md)). Given any input palette (image, hex list, brand sheet) this algorithm produces the same role bindings every time. Slot names ("table header", "primary button") are never assigned by hand — they fall out of the rules below.

This file is the **spec**. The skill is the **implementation**.

---

## Stage 1 — Measure & bucket

For every input color, compute three scalars from its RGB:

| Scalar | Formula | Range |
|---|---|---|
| `L` (lightness) | `(max(r,g,b) + min(r,g,b)) / 2` (HSL L) | 0–100 |
| `C` (chroma) | HSL saturation × min(L, 100−L) / 50 — the perceptual vividness | 0–100 |
| `H` (hue) | HSL hue angle | 0–360 |

Bucket by chroma:

| Bucket | Rule | Role |
|---|---|---|
| **Neutral** | `C < 10` | Surfaces, ink, borders |
| **Muted** | `10 ≤ C < 30` | Optional surface tints, secondary borders |
| **Accent** | `C ≥ 30` | Interactive states (hover, CTA, highlight, status) |

Within each bucket, **sort by `L` ascending**. The sorted index is the rank used in Stage 3.

---

## Stage 2 — Pick polarity (once)

Look at the **most-frequent neutral** in the input (the one covering the largest area, or the median neutral if frequencies are unknown):

| Dominant neutral L | Polarity |
|---|---|
| L > 60 | **Light** |
| L < 40 | **Dark** |
| 40–60 | Default to **Light**; user can override with `-dark` flag |

This decision freezes Stage 3's ordering. Never re-evaluate per component.

---

## Stage 3 — Bind neutrals to surface tokens

The neutral bucket is sorted by `L`. Bind by rank:

### Light polarity

| Token | Source | Why |
|---|---|---|
| `--canvas` | Lightest neutral | Page background, largest visible area |
| `--surface` | = `--canvas` (or 2nd-lightest if distinct) | Cards / panels |
| `--surface-sunken` | Mid neutral (one rank below canvas) | Table headers, accordion-expanded headers, inputs |
| `--ink` | Darkest neutral | Body text, table-body cells (max contrast anchor) |
| `--ink-muted` | `--ink` at 65% alpha | Secondary text |
| `--ink-subtle` | `--ink` at 45% alpha | Captions, placeholders |
| `--ink-faint` | `--ink` at 28% alpha | Decorative dividers |
| `--ink-contrast` | White if `--ink` is dark, else black | Text on ink-filled surfaces |
| `--border` | = `--ink` | Strong borders |
| `--border-strong` | = `--ink` | Emphasis borders |

### Dark polarity

Invert: `--canvas` = darkest neutral, `--ink` = lightest neutral. Alpha values for muted/subtle/faint stay the same; switch base from `0,0,0` to `255,255,255`.

---

## Stage 4 — Bind accents to interactive tokens

The accent bucket is sorted by `C` descending (most vivid first):

| Rank | Token(s) | Use |
|---|---|---|
| 1 (most vivid) | `--accent`, `--accent-pink`, `--hot-pink`, `--brand-tenant`, `--brand-product`, `--warning`, `--danger`, `--nav-item-hover-bg`, `--nav-item-active-bg` | All interactive highlights |
| 1 (alpha shifts) | `--accent-soft` = rank-1 at 12% alpha; `--accent-border` = rank-1 at 40% alpha | Subtle washes |
| 2 (if present) | Secondary CTA, focus ring, info-bg tint | Optional |
| 3+ | Decorative accents only — **never** bind to a status or interactive role unless the user names them explicitly |

`--accent-ink` / `--accent-contrast` / `--brand-*-contrast` rule:
- If the accent's `L < 55` → contrast = white
- Else → contrast = black

Status collapse (when palette has only one accent):
- `--success` and `--info` → `--ink` (use neutrals to signal "OK")
- `--warning` and `--danger` → `--accent` (use the vivid color to signal "attention")
- All `*-bg` variants → `--canvas` or `--surface-sunken`

---

## Stage 4.5 — Contrast verification (hard gate)

After Stages 3 and 4 have produced a binding table, every (background, foreground) pair must pass a WCAG-style luminance contrast check. **No theme ships with dark text on a dark surface, or light text on a light surface — ever.**

### Relative luminance (sRGB)

For any color `(r, g, b)` with channels in 0–255:

```
function srgbToLinear(c) {
  c = c / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

L_rel = 0.2126 * srgbToLinear(r)
      + 0.7152 * srgbToLinear(g)
      + 0.0722 * srgbToLinear(b)
```

### Contrast ratio

```
ratio = (max(L1, L2) + 0.05) / (min(L1, L2) + 0.05)
```

Range: 1.0 (identical) to 21.0 (black on white).

### Required minimums

| Pair role | Minimum ratio | Why |
|---|---|---|
| Body text on its surface (`--ink` on `--canvas`, `--surface`, `--surface-sunken`) | **4.5:1** | WCAG AA normal text |
| Cell text on table body (`--ink-contrast` on `--ink`) | **4.5:1** | Default cell rendering |
| Accent text on accent-filled surface (`--accent-ink` on `--accent`) | **4.5:1** | Buttons, hover rows |
| Placeholder / muted text (`--ink-muted`, `--ink-subtle` over their surface) | **3:1** | Lowered bar — non-essential text |
| Borders against their surface | **1.5:1** | Just needs to be visible |

### Pairs that MUST be verified per theme

For both polarity slots (light and dark), check:

1. `--ink` vs `--canvas`
2. `--ink` vs `--surface`
3. `--ink` vs `--surface-sunken`
4. `--ink-contrast` vs `--ink` (table body cells)
5. `--accent-ink` vs `--accent` (buttons, hover rows)
6. `--ink-muted` (after alpha-blending over canvas) vs `--canvas`
7. `--ink-subtle` (after alpha-blending over `--surface-sunken`) vs `--surface-sunken` — placeholder on input
8. Any explicit override surface (e.g. zone-toggle band, group-sep band) vs the text color rendered inside it

For alpha-blended foregrounds (`rgba(R,G,B,A)`) over an opaque background `(BR,BG,BB)`, compute the perceived RGB:

```
out_c = A * fg_c + (1 - A) * bg_c   for each channel
```

Then run that opaque RGB through the contrast formula.

### Auto-correction rule

If a pair fails its minimum, the algorithm **must not silently emit it**. Apply this fallback in order:

1. **Foreground swap** — if the failing fg is an `--ink`-derived token, swap to `--ink-contrast` (or vice versa) and re-test.
2. **Background swap** — if the failing bg is `--surface-sunken`, retry with `--canvas` or `--surface`.
3. **Mid-neutral synthesis** — if neither end-neutral fits, derive a new shade by alpha-blending `--ink` over `--canvas` at 8–15% (light polarity) or `--canvas` over `--ink` at the same alpha (dark polarity). Re-test.
4. **Component-level override** — if all else fails, write an explicit override in the component selector forcing the correct fg.
5. **Last resort: refuse** — if no combination of the input palette can satisfy the minimum, abort and warn the user. Do not ship a theme with known unreadable pairs.

### Common failure modes (catch these by name)

| Symptom | Cause | Fix |
|---|---|---|
| Form input placeholder invisible | `--surface-sunken` is too dark for a light-mode `--ink-subtle` | Lighten `--surface-sunken` to a tint of `--canvas` (Step 3 synthesis), not a separate dark color |
| Table header text invisible | `--surface-sunken` and `--ink` are both dark | Force header text to opposite-end neutral via component override |
| Pill/badge text invisible | Status `*-bg` token landed on a dark mid-neutral | Bind `*-bg` to `--canvas` or `--surface-sunken` with verified contrast against `--ink` or `--accent` text |
| Slate group-sep band has unreadable text | Mid-tone band inherits ambient `--ink` regardless of mode | Hardcode `color: var(--ink-contrast)` on the group-sep cell selector |
| Hover row text disappears on amber | `--ink` (cream/black) over `--accent` falls below 4.5:1 | Component override binds row-hover text to `--accent-ink` always |

The skill must run this stage after Stage 4 and before writing CSS. If any binding fails its minimum and cannot be auto-corrected, the skill aborts with a one-line report listing the offending pair and the measured ratio.

---

## Stage 5 — Component invariants

These hold regardless of input palette. They are the rules that map tokens to actual selectors.

### Tables

| Selector | Bind |
|---|---|
| `.table tbody tr`, `tbody td`, `.table__cell` | bg = `--ink`, color = `--ink-contrast` |
| `.table__head .table__cell`, `thead th`, `.table__head` | bg = `--surface-sunken`, color = `--ink` |
| `.table tbody tr:hover td` | bg = `--accent`, color = `--accent-ink` |

Body cells anchor to `--ink` (max contrast), headers sit at `--surface-sunken` (mid neutral). Hover always escalates to the most-vivid accent.

### Buttons

| Selector | Bind |
|---|---|
| `.btn`, `.btn--primary` | bg + border = `--accent`, color = `--accent-ink` |
| `.btn:hover:not(:disabled)`, `.btn--primary:hover:not(:disabled)` | bg + border = `--ink`, color = `--ink-contrast` |
| `.btn:disabled` | bg = `--surface-sunken`, color = `--ink-subtle` |

Rest = vivid; hover = ink. Always. Never invert that polarity.

### Sidebar nav

| Selector | Bind |
|---|---|
| `.sidebar-item:hover`, `.sidebar-item.active` | bg = `--accent`, color = `--accent-ink` |
| `.app-sidebar-container` | `border-right: none` |
| `.sidebar-brand` | `border-bottom: none` |

### Accordion / zone-toggle bands

The expand-toggle bands ("main rows" that open/close groups — e.g. `.layers-editor__zone-toggle`, any future accordion header) inherit the **same accent treatment used by the active sidebar nav item**, so the user sees a single visual language for "this row is interactive / important".

| Selector | Bind |
|---|---|
| Rest band (closed) | bg = `--accent`, color = `--accent-ink`, chevron border = `--accent-ink` |
| Expanded band header | bg = `--accent`, color = `--accent-ink` (same as rest — the chevron rotation alone signals state) |
| Hover row | bg = `--accent` darkened ~10% (alpha-blend `--ink` over `--accent` at 10%), color = `--accent-ink` |
| Group separator strip | bg = mid neutral that's *not* `--ink` (e.g. muted bucket if present, otherwise `--surface-sunken` darkened 15%) |

**W/W/B/B rule (hard):** when binding text on top of an accent-filled band, never emit white-on-white or black-on-black. The `--accent-ink` token is computed from the accent's luminance (Stage 4 rule: `L < 55` → white, else black) precisely to prevent this — bind to it directly, never reuse `--ink` (which tracks the canvas polarity, not the accent's). Verify the pair under Stage 4.5 #8.

### Status surfaces

| Selector | Bind |
|---|---|
| Success token | color = `--ink`; bg = `--canvas` or `--surface-sunken` |
| Warning / danger | color = `--accent`; bg = `--surface-sunken` or `--canvas` |
| Info | color = `--ink`; bg = `--surface-sunken` |

### No-halo invariant (hard rule)

Generated theme CSS **must not introduce halo effects** anywhere. The following properties are forbidden in any selector emitted by the skill:

- `box-shadow` (any non-`none` value, including inset)
- `outline` (any non-`none` value beyond browser-default focus rings, which the theme should not touch)
- `filter: drop-shadow(...)`, `filter: blur(...)`
- `text-shadow`
- `-webkit-box-shadow` and other vendor-prefixed shadow properties

If a component visibly needs separation (e.g., a card on a similar-toned canvas), use a **border** with `--border` or `--border-strong`, or shift the surface to `--surface-sunken`. Never reach for a glow.

This rule overrides any aesthetic instinct. Themes are about color contrast and surface hierarchy, not depth effects.

---

## Stage 6 — Output shape

The skill writes one CSS file at `public/themes/<slug>.css` matching the structure of `vector-mono.css`:

1. Header comment listing the input palette and the role assignments.
2. `:root { ... }` — Foundation, Status, Brand slots.
3. `:root[data-theme="light"], :root { ... }` — light bridge tokens (`--accent`, `--paper`, etc.).
4. Component overrides — tables, buttons, sidebar, accordion bands.
5. `:root[data-theme="dark"] { ... }` — inverted palette.

Then the skill registers the theme in 4 places (see SKILL.md).

---

## Quick reference — the universal pattern

> **Neutrals carry hierarchy via `L`-rank. Accents carry interaction via `C`-rank.**

- Largest area → lightest neutral (light) or darkest neutral (dark).
- Strongest contrast anchor → opposite-end neutral (`--ink`).
- Anything that responds to a click or hover → most-vivid accent.
- Hover state on a button or row → `--ink` (button) or `--accent` (row). Never random.

If a palette only has neutrals → the theme is monochrome; "accent" falls back to the highest-`L`-distance neutral. Warn the user: most components will read flat without a vivid color.
