---
name: vector-design
description: Use this skill to generate well-branded interfaces and assets for MMFFDev Vector — an enterprise SaaS PM platform that feels classy and modern, not corporate. Flat design (no shadows, no gradients, no chrome), warm neutral palette, Inter throughout, three branding tiers (Platform / Tenant / Product). Use for production code or throwaway prototypes/mocks.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

Key files:
- `README.md` — full brand, content, visual, iconography fundamentals + index
- `colors_and_type.css` — copy-paste CSS variables and semantic styles
- `preview/` — small visual reference cards for tokens and components
- `ui_kits/vector-app/` — pixel-spec React components for the SaaS app (sidebar, top bar, metric tiles, status pills, charts, tables)
- `assets/fonts/` — Inter (system) is the recommended workhorse; Zen Maru Gothic was supplied but is **not** the chosen face for Vector
- `research/` — original design brief

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. Pull components from `ui_kits/vector-app/` rather than rebuilding from scratch.

If working on production code, copy assets and treat `colors_and_type.css` as the contract. Tokens cascade in this order: foundation → personal theme → tenant brand → product brand. Never skip layers.

If the user invokes this skill without other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

**Hard rules** (don't break these without explicit user permission):
- No drop shadows. No gradients on UI chrome. No glow.
- No decorative colour. Status colour is reserved for status. Brand accent is one-per-region only.
- Inter only. Tabular-nums on every numeric column.
- Eyebrows (`text-xs`, `0.08em` letter-spacing, uppercase, `ink-subtle`) over h2/h3 in card chrome.
- Status pills are always icon + label, never colour alone.
- Brand colour never appears in charts.
