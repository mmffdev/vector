---
name: UI alignment verification
description: Always verify column/row alignment when adding UI elements to structured layouts (grids, tables, accordions)
type: feedback
originSessionId: 054f895e-0ce1-441e-a571-c177a1542f87
---
When adding columns, rows, or cells to any structured layout, always verify alignment with headers and sibling elements before implementing.

**Why:** User caught a column addition that didn't fully consider alignment with the existing header row. Misaligned grids are a recurring risk when columns are added without reading the full layout context first.

**How to apply:** Read both the header row and at least one data row before editing. Match column count, order, widths (all breakpoints), text alignment, borders, padding, and font-size. If alignment intent is unclear, ask before implementing.
