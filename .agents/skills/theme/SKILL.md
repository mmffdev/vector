---
name: theme
description: Generate a Vector theme pack from an attached image (or hex list). Extracts palette, applies role-mapping rules, writes CSS, registers it in the theme picker.
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# /theme — Image → Theme Pack

Loaded only when `<theme>` or `/theme` is invoked. Do not preload.

## Invocation

```
<theme>                           # user attaches an image in chat
<theme> "Brand Name"              # name the theme (otherwise inferred)
<theme> -hex #FF346E,#000,#C9CACF # skip the image, use literal hexes
<theme> -dark                     # force dark polarity (override Stage 2)
<theme> -s 30                     # spawn agents to produce 30 themes from all images in context
<theme> -h                        # print usage and exit
```

When `-h` is the only flag, print the help block (below) and stop. Generate nothing.

---

## What this skill does

1. **Extracts** 6–10 dominant colors from the attached image (visually).
2. **Bins** them via the algorithm in [`docs/c_theme_rules.md`](../../../docs/c_theme_rules.md).
3. **Maps** them to design tokens deterministically — same input → same output.
4. **Writes** `public/themes/<slug>.css` mirroring the shape of `vector-mono.css`.
5. **Registers** the theme in 4 hardcoded places so the picker shows it instantly.

The spec doc at `docs/c_theme_rules.md` is the source of truth for the algorithm. Re-read it on every invocation — do not improvise.

---

## Input modes

### Mode A — image attached in chat (default)

The user pastes a brand sheet, mockup, palette card, or screenshot. Use multimodal vision to identify the dominant colors.

**Sampling rules:**
- Aim for **6–10 colors** total. Below 4 the algorithm has nothing to work with; above 12 the role mapping starts crowding.
- Include every color that covers >5% of the image area.
- Always include the **darkest** and **lightest** color, even if low-area, so neutrals span the full L-range.
- Estimate hex to the nearest 8-bit RGB value. If two colors are within 5 RGB units of each other, treat them as one.
- Note approximate area coverage for each — needed for Stage 2 polarity pick.

### Mode B — `-hex` literal list

User supplies a comma-separated list. Skip image inspection. Validate each value is a 3- or 6-digit hex. Treat the first listed color as the dominant neutral for polarity purposes if no neutral is dominant by area.

### Mode C — image is a photo (>15 distinct colors)

If the image is photographic rather than a designed palette, run k-means quantization via Python (Pillow + numpy) to reduce to 8 colors before applying rules. The skill prefers Mode A's visual extraction when possible — only fall back to Python when the image is genuinely complex.

### Mode D — `-s N` spawn mode

The user drops one or more images and passes `-s N`. The main agent acts as **coordinator**:

1. **Count images** — identify all palette images attached in the current message.
2. **Plan the batch** — compute `ceil(N / image_count)` variations per image. Round up so total produced ≥ N; trim the last batch if needed. Plan slugs before spawning — name them: one literal extraction, then colour-theory derivations (complementary hue 180° rotation, analogous 30° shift + 20% chroma boost).
3. **Spawn sub-agents in parallel** — one `Agent` per source image. Each agent receives:
   - The hex palette (visually extracted from the image by the coordinator)
   - Planned slugs and role-binding table per theme
   - Instructions to write CSS to `public/themes/` and report back with slugs + 4 swatches each
   - **Explicit instruction NOT to register** — registration is the coordinator's job
4. **Await all agents** — collect slug + swatch data from every completed agent.
5. **Register sequentially** — once all CSS files are on disk, update the 4 registration files one after another to avoid race conditions.
6. **Report** — list all themes produced with display names and swatches.

**Colour-theory derivation rules:**
- **Complementary:** rotate accent hue H by 180°, keep original neutrals, derive new slug with `-complement` or a descriptive name.
- **Analogous:** rotate accent hue H by +30°, boost chroma by 20% (clamp 100), keep neutrals.
- Sub-agents are each fully autonomous CSS writers — do not use them for registration.

**Important:** The `-s N` target is a minimum, not a cap. If rounding produces N+1 or N+2, that is fine.

---

## Steps

### 1. Identify input

If an image is attached: list the colors you see, with hex estimates and rough area weight. Show the list back to the user as a one-line confirmation:

> Pulled this palette from your image: `#FF346E` (15% — vivid pink), `#000000` (35% — black), `#C9CACF` (40% — light gray), `#ACAFBA` (10% — mid gray). Building **Vector Mono**. Proceeding.

In auto mode, do not wait for confirmation — proceed unless the user objects. In normal mode, wait one beat for correction before continuing.

### 2. Apply the algorithm

Walk Stages 1–5 of [`docs/c_theme_rules.md`](../../../docs/c_theme_rules.md) in order. Produce an in-memory mapping table:

```
--canvas         → #C9CACF
--surface-sunken → #ACAFBA
--ink            → #000000
--accent         → #FF346E
... (every token bound)
```

Do not skip any token from the spec. If a token has no source color (e.g. only one accent in the palette), apply the collapse rules from Stage 4.

### 2.5. Verify contrast (hard gate)

Before writing CSS, run **Stage 4.5 — Contrast verification** from the spec on every pair listed there. Use the WCAG luminance formula. For each pair, compute the ratio and confirm it meets the minimum (4.5:1 body, 3:1 muted/UI, 1.5:1 borders).

Quick reference table to fill in for the user (one row per verified pair):

| Pair | bg | fg | Ratio | Min | Pass? |
|---|---|---|---|---|---|
| `--ink` on `--canvas` | … | … | … | 4.5 | ✓/✗ |
| `--ink` on `--surface-sunken` | … | … | … | 4.5 | ✓/✗ |
| `--ink-contrast` on `--ink` | … | … | … | 4.5 | ✓/✗ |
| `--accent-ink` on `--accent` | … | … | … | 4.5 | ✓/✗ |
| zone-toggle text (`--accent-ink`) on zone-toggle bg (`--accent`) | … | … | … | 4.5 | ✓/✗ |
| `--ink-subtle` (blended) on `--surface-sunken` | … | … | … | 3.0 | ✓/✗ |
| group-sep text on group-sep band | … | … | … | 4.5 | ✓/✗ |

**W/W/B/B rule (hard):** the zone-toggle/accordion band uses the same accent fill as the active sidebar item, so the text on it MUST be `--accent-ink` (computed from accent luminance per Stage 4) — never `--ink` (which tracks canvas polarity and can collide with a same-polarity accent, producing white-on-white or black-on-black).

If any pair fails, apply the auto-correction order from Stage 4.5:
1. Foreground swap (try `--ink-contrast`).
2. Background swap (try `--canvas` instead of `--surface-sunken`).
3. Mid-neutral synthesis (alpha-blend `--ink` over `--canvas` at 8–15% to derive a softer sunken).
4. Component-level override.
5. Refuse — abort with the failing pair listed.

**Both light and dark slots must pass.** If the theme has both polarities, check both.

### 3. Generate the CSS

Write `public/themes/<slug>.css` mirroring the structure of `public/themes/vector-mono.css`:

```css
/* ============================================================
   <Theme Name> — auto-generated by <theme> on YYYY-MM-DD
   Input palette: #..., #..., ...
   Polarity: light|dark
   ============================================================ */

:root {
  /* Foundation */
  --canvas: ...;
  --surface: ...;
  --surface-sunken: ...;
  --ink: ...;
  --ink-muted: rgba(...);
  ...

  /* Status — collapsed onto accent + ink */
  --success: ...;
  ...

  /* Brand slots */
  --brand-tenant: ...;
  ...
}

:root[data-theme="light"], :root {
  --accent: ...;
  --accent-soft: rgba(...);
  ...
}

/* ---------- Tables ---------- */
.table tbody tr, ...

/* ---------- Buttons ---------- */
.btn, .btn--primary { ... }
.btn:hover:not(:disabled), ... { ... }

/* ---------- Sidebar nav ---------- */
.sidebar-item:hover, .sidebar-item.active { ... }

/* ---------- Sidebar borders ---------- */
.app-sidebar-container { border-right: none; }
.sidebar-brand { border-bottom: none; }

/* ---------- Zone-toggle bands ----------
   Main expand/collapse row inherits the active-nav accent treatment so
   the user sees one visual language for "interactive row". Bind text to
   --accent-ink (NOT --ink) to honour the W/W/B/B rule — never let white
   land on a near-white accent or black on a near-black accent. */
button.layers-editor__zone-toggle {
  background: var(--accent);
  color: var(--accent-ink);
  padding: 0 20px;
}
button.layers-editor__zone-toggle .eyebrow { color: var(--accent-ink); }
button.layers-editor__zone-toggle .accordion__chevron { border-color: var(--accent-ink); }
.layers-editor__row--group-sep td.layers-editor__group-sep-cell { ... }

/* ---------- Dark slot ---------- */
:root[data-theme="dark"] { ... }
```

Slug rules:
- Lowercase, hyphenated.
- Must match `[a-z][a-z0-9-]*`.
- If the user named the theme "Vector Mono" the slug is `vector-mono`.
- If unnamed, propose one based on the dominant accent: e.g. `pink-mono`, `cobalt-warm`, `forest-cream`. Confirm with the user before writing.

### 4. Register the theme

Four files hardcode the theme list. Update all four. Order matters — the first three are pure data, the fourth is a runtime boot script.

#### 4a. `app/hooks/useThemePack.ts`

Update three lines:

```ts
export type ThemePack = "default" | "vector-mono" | "<slug>";

const PACK_HREF: Record<Exclude<ThemePack, "default">, string> = {
  "vector-mono": "/themes/vector-mono.css",
  "<slug>": "/themes/<slug>.css",
};

const VALID_PACKS: ThemePack[] = ["default", "vector-mono", "<slug>"];
```

#### 4b. `app/(user)/theme/page.tsx`

Add an entry to the `buttons` array inside `ThemesTab` (search for `id: "vector-mono"` to find the location). The 4 swatches should be: most-vivid accent, darkest neutral, canvas, surface-sunken.

```ts
{
  id: "<slug>",
  label: "<Display Name>",
  description: "<one-sentence description — what makes this palette distinct>",
  swatches: ["<accent>", "<ink>", "<canvas>", "<surface-sunken>"],
},
```

#### 4c. `app/components/UserAvatarMenu.tsx`

Add an entry to the `PALETTES` array (search for `id: "vector-mono"`). Same 4 swatches as 4b:

```ts
{ id: "<slug>", label: "<Display Name>", swatches: ["<accent>", "<ink>", "<canvas>", "<surface-sunken>"] },
```

#### 4d. `app/layout.tsx` — boot script

The current implementation hardcodes the case for `vector-mono`. Refactor it to be data-driven so future themes auto-load **without further edits**:

```js
(function(){
  try {
    var p = localStorage.getItem('vector-theme-pack');
    var valid = ['vector-mono', '<slug>' /* extend per theme */];
    if (p && valid.indexOf(p) !== -1) {
      var l = document.createElement('link');
      l.id = 'vector-theme-pack';
      l.rel = 'stylesheet';
      l.href = '/themes/' + p + '.css';
      document.head.appendChild(l);
    }
  } catch(e) {}
})();
```

Add the new slug to the `valid` array on each run. (If the array exceeds ~6 themes, propose collapsing this script to read the valid list from a generated JSON file — but defer until then.)

### 5. Verify

After writing all 5 files:

```bash
# Quick sanity checks
test -f public/themes/<slug>.css && echo "CSS written"
grep -q "<slug>" app/hooks/useThemePack.ts && echo "Hook updated"
grep -q "<slug>" app/\(user\)/theme/page.tsx && echo "Picker updated"
grep -q "<slug>" app/components/UserAvatarMenu.tsx && echo "Avatar menu updated"
grep -q "<slug>" app/layout.tsx && echo "Boot script updated"
```

Then verify the no-halo invariant — the generated CSS must contain none of these in actual declarations (strip /* … */ comment blocks before grepping so the doc header doesn't false-match):

```bash
awk 'BEGIN{c=0} /\/\*/{c=1} c==0{print} /\*\//{c=0}' public/themes/<slug>.css | \
  grep -qE '(box-shadow|text-shadow|drop-shadow|^[[:space:]]*outline[[:space:]]*:)' \
  && echo "✗ HALOS FOUND" || echo "✓ No halos"
```

Run all six. Report the result table to the user.

### 6. Tell the user how to apply

> Theme **<Display Name>** generated. Open the user avatar menu → palette icon → pick **<Display Name>**, or visit Theme Settings to switch. The CSS is at [`public/themes/<slug>.css`](public/themes/<slug>.css). Edit it directly and refresh — no rebuild needed (it's a static asset).

---

## `-h` Help output

Print this verbatim when `-h` is the only flag:

```
<theme> — Image → Vector Theme Pack

Usage:
  <theme>                          Attach an image; build a theme from its palette.
  <theme> "Display Name"           Same, with explicit theme name.
  <theme> -hex #aaa,#bbb,#ccc      Skip the image; use literal hexes.
  <theme> -dark                    Force dark polarity (Stage 2 override).
  <theme> -s 30                    Spawn agents to produce 30 themes from all images in context.
  <theme> -h                       Show this help and exit.

Spec: docs/c_theme_rules.md (algorithm + role-binding rules).

Output:
  - public/themes/<slug>.css            (generated theme)
  - app/hooks/useThemePack.ts           (registered)
  - app/(user)/theme/page.tsx           (added to picker)
  - app/components/UserAvatarMenu.tsx   (added to avatar menu)
  - app/layout.tsx                      (boot script updated)

-s N mode: coordinator spawns one sub-agent per image (all in parallel). Each
agent writes CSS files only; coordinator registers all outputs sequentially
when every agent is done. Sub-agents MUST NOT register. N is a minimum target.

The skill is deterministic: same palette → same theme. If you don't like the
result, the algorithm is wrong, not the skill — propose a rule change in
docs/c_theme_rules.md and re-run.
```

---

## Error handling

| Condition | Response |
|---|---|
| No image attached and no `-hex` flag | Print `<theme> -h` and ask for an image. |
| `-s N` with no images in context | Print `<theme> -s requires at least one image attached. Drop your palette images and re-run.` |
| `-s N` where N ≤ 0 or non-integer | Print usage and ask for a positive integer. |
| Image has fewer than 3 distinct colors | Refuse — say "I need at least 3 colors to build a theme; this image looks too monochromatic." |
| Image is a photo with >15 distinct colors | Switch to Mode C (Python k-means). If Pillow isn't available, fall back to visual extraction with a note. |
| Slug already exists at `public/themes/<slug>.css` | Ask: "Theme `<slug>` already exists. Overwrite, or pick a new name?" |
| User passes both an image and `-hex` | `-hex` wins. State that the image was ignored. |

---

## Why this skill exists

The previous workflow ("here are some hex codes, build a theme") was non-deterministic — same palette could land in different roles depending on which conversation it happened in. That made theme work feel arbitrary.

This skill makes theming a **transformation**: input → algorithm → output. The algorithm lives in `docs/c_theme_rules.md` so future-you (or another agent) follows the same rules. If the rules are wrong, fix the spec, not the output.
