---
name: Sidebar toolbar icon alignment
description: Calibrated left margin for sidebar toggle/pencil icons — 22px confirmed by user
type: feedback
originSessionId: 0f779eb1-91e3-46e0-8199-d8a54719ec8f
---
The sidebar toolbar contains two icons: the sidebar toggle and the pencil (edit) icon. Their left margin was calibrated iteratively:

- 18px — tried, not accepted
- 20px — tried, not accepted
- 22px — user confirmed "perfect"

**Settled value: `margin-left: 22px` (or equivalent `left: 22px` / `padding-left: 22px` depending on implementation).**

Any future sidebar layout work — including responsive adjustments, theme changes, or icon size changes — must preserve this 22px left alignment. Do not alter it without explicit user confirmation of a new value.
