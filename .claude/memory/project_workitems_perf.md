---
name: Work-items interaction performance — 2s block on sort
description: 2-second main thread block on work-items sort interaction; root cause and fix path recorded.
type: project
originSessionId: dafbaa04-6546-45d4-81a9-59ae1b1e5ea5
---
Observed 2026-05-06: Chrome DevTools performance recording of a sort/column-click interaction on `/work-items` showed 2,020ms main thread block. Page shows 11,065 total items; 1,035 in filtered result; 25 rendered (paginated).

**Why:** Sort is likely still happening client-side despite the backend accepting `sort`+`dir` params (added in commit `d2b194d`). On interaction, JS re-sorts/re-groups all 1,035 items, rebuilds tree node map, recomputes flow-state pills for every node — then React reconciles the full tree.

**How to apply:** Before touching the work-items sort feature, verify whether the sort header click fires a query-param update (server-driven refetch) or mutates local state. Fix path in priority order:
1. Make sort server-driven — click → `router.replace()` with `?sort=&dir=` → fresh fetch, discard old result.
2. Stop materialising tree state for non-rendered rows.
3. `react-virtual` if client-side sort must be kept.
