---
name: Detail row overflow fix pattern
description: FeatureTable expandable detail rows must use ResizeObserver on wrapper div (not table) to constrain content width
type: feedback
originSessionId: 884d3afe-84ae-4bdd-9194-a2c15afea02f
---
FeatureTable detail rows (colSpan cells) cannot be constrained by CSS alone in `table-layout: auto`. The fix is:

1. `ResizeObserver` on the `.feature-table` wrapper div (NOT the `<table>` element — the table expands with content, the wrapper is viewport-constrained)
2. Measured width passed as `maxWidth` inline style on `.feature-table__detail-sizer` div
3. Sizer div has `overflow: hidden` to clip content
4. Inner div has `overflow-x: auto` for scrollable content within bounds

**Why:** `table-layout: auto` + `colSpan` means the td width IS the content width. CSS `max-width: 0; min-width: 100%` trick doesn't work reliably. `table-layout: fixed` breaks column sizing. Only a JS-measured pixel constraint on a block-level wrapper works.

**How to apply:** If detail row content ever overflows again, check that `wrapperRef` is on the `.feature-table` div, not the `<table>`.
