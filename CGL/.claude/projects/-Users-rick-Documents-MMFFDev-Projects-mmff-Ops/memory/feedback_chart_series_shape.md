---
name: Chart data points need { ts, value } shape
description: The Chart feature's LineRenderer reads pt.value, so series.data must be ChartDataPoint[], not number[]. Casts with `as any` hide this bug.
type: feedback
originSessionId: f9e1df41-a67e-453d-9a5b-b23b674c9d40
---
When using the `Chart` component from `web/src/features/charts/`, each series's `data` field must be `ChartDataPoint[]` (i.e. `{ ts: number; value: number }[]`) — not a raw `number[]`. The line/bar renderers read `pt.value`, so number arrays silently render nothing.

**Why:** User flagged an empty "Latency Trend" chart on Admin → Local Setup. Root cause was `data: latencyHistory.map(h => h.tunnelMs)` passing `number[]` with an `as any` cast that hid the type mismatch.

**How to apply:** When wiring a new `<Chart>` call site, map each point to `{ ts, value }`. If you see `as any` on a Chart `data` prop, treat it as a red flag and check the point shape. Prefer typed data over casts.
