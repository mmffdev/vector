# Vector App — UI Kit

High-fidelity recreation of the Vector enterprise SaaS app, built against the design brief in `../../research/MMFFDev-Vector-design-system.md` and informed by the reference codebase at `MMFFDev - PM/`.

## What's in here

| Component | File |
|---|---|
| `Sidebar` | tenant block, sections, items, active state, user block |
| `TopBar` | breadcrumb, search, notifications, avatar |
| `MetricTile` | eyebrow + display metric + sparkline |
| `StatusPill` | success / warning / danger / info / neutral |
| `Button` | primary / secondary / ghost / danger + sizes |
| `DataTable` | sunken-header table with hover row tint |
| `BarChart` | monochrome ink + ink-muted comparison |

## Screens

`index.html` shows the **Dashboard** as the canonical view of the product, with sidebar, top bar, four metric tiles, sales-trend chart, revenue-breakdown chart, and a recent transactions table.

A second view, **Backlog**, is reachable by clicking the "Backlog" sidebar item (state-only, no routing).
