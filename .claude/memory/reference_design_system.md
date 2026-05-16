---
name: Vector Design System location and font decision
description: Where the design system lives, what font/color it specifies, and how it differs from the current app
type: reference
originSessionId: 984ee177-319a-47f4-84ab-55fd5b444b31
---
**Design system:** `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/MMFFDev - Vector Assets/Vector Design System/`

Accessible as skill: `/vector-design` (SKILL.md is the entry point)

Key files:
- `colors_and_type.css` — all design tokens (colors, type, spacing, radii)
- `README.md` — brand fundamentals, branding tiers, content voice
- `preview/` — standalone HTML reference cards per concept
- `ui_kits/vector-app/` — high-fidelity JSX components (Sidebar, Dashboard, Backlog, etc.)

## Font decision

**Satoshi** for body + display (local font, loaded in `app/layout.tsx`), **JetBrains Mono** for code.
Bound to `--font-sans` / `--font-mono` on `<html>` by Next.js. `--font-display` and `--font-numeric` chain off `--font-sans` in `app/styles/primitives.css` so any future swap propagates.

Earlier specs mentioned Inter (design-system draft) and Zen Maru Gothic (prior art) — both superseded.

## Color decision

Design system: warm neutral palette — `--canvas: #F4F2EE`, `--ink: #1A1A1A`, no decorative color, no brand orange. Status color reserved for status only.
Current app: orange accent system.

The design system is the intended future state. The codebase is prior art. When building new UI, follow the design system.

## Hard rules from SKILL.md
- No drop shadows. No gradients on UI chrome. No glow.
- No decorative colour. Status colour is reserved for status. Brand accent is one-per-region only.
- Satoshi only (var `--font-sans`). Tabular-nums on every numeric column.
- Eyebrows (`text-xs`, `0.08em` letter-spacing, uppercase, `ink-subtle`) over h2/h3 in card chrome.
- Status pills are always icon + label, never colour alone.
- Brand colour never appears in charts.
