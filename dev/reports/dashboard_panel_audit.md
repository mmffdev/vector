# Dashboard panel audit — PLA-0005 / story 00250

_Generated: 2026-05-02 — `npm run audit:dashboard`_

## Summary

- Panel-shaped elements found: **5**
- Total rows: **6**

Each row below is a candidate for `<Panel name=…>` (or `<Table>`/
`<Navigation>`) when story 00251 flips `/dashboard` to strict mode.

## Inventory

| File | Line | Classification | Snippet | Proposed name |
|---|---|---|---|---|
| `app/(user)/dashboard/page.tsx` | — | chart-without-frame | 19 ChartWidget instances (not individually addressable; rolled into parent panel) | `chart_count_19` |
| `app/(user)/dashboard/page.tsx` | 32 | panel | Overview | `overview` |
| `app/(user)/dashboard/page.tsx` | 43 | panel | Portfolio dimensions | `portfolio_dimensions` |
| `app/(user)/dashboard/page.tsx` | 95 | panel | Objectives &amp; flow | `objectives_and_flow` |
| `app/(user)/dashboard/page.tsx` | 152 | panel | Advanced analysis | `advanced_analysis` |
| `app/(user)/dashboard/page.tsx` | 213 | panel | Recent activity | `recent_activity` |

## Notes

- `panel` rows are heading-led blocks that should each be wrapped
  in `<Panel name=…>` so the heading becomes the panel title and
  the following grid/table is the panel body.
- `chart-without-frame` is a roll-up count — individual
  `<ChartWidget>` instances stay inside their parent panel and
  are not separately addressable.
- `table` rows belong inside their nearest panel; the table
  itself becomes `<Table name=…>` for runtime address coverage.

