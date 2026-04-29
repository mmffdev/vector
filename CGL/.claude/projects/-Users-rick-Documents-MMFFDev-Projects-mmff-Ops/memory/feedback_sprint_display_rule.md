---
name: Sprint pickers must default to current sprint and show "— Current" suffix
description: Any UI that displays or lets users choose a sprint must default to current_sprint from project_config and mark the current sprint with "— Current" in the dropdown.
type: feedback
originSessionId: 8a7bc621-116a-450b-b2fe-592956aaea84
---
**Hard rule — applies to every page that shows sprints.**

Any sprint dropdown, filter, or stats display must:

1. **Default selection** — read `current_sprint` from `project_config` (via `getSprintState()`), not the alphabetically-last sprint ID. Queueing a future sprint must not hijack the default view; only `<startsprint>` flips the current.

2. **Suffix on the current option** — the currently-active sprint in the dropdown is marked with ` — Current` appended to its label. This is true even when the context is a destructive operation (e.g. sprint close) where the default is intentionally blank — the suffix still shows so the user can identify it.

**Why:** Creating a sprint record is not the same as activating it. Without this rule, any queued sprint immediately became the default view, hiding the actual in-progress work. Fix landed in DEF-28.

**How to apply:**
- For **filter dropdowns** (Planning, Sprint Summary): resolve `__latest__` → `sprintState.currentSprint`, fallback to alphabetical if API fails
- For **operation dropdowns** (Sprint Console): keep blank default, just add the suffix
- For **stats displays** (Project page "Current Sprint" box): look up the sprint by `sprintState.currentSprint` ID, fallback to alphabetical last
- When creating new pages that show sprints, apply this pattern from the start

**Implementation:** import `getSprintState` + `SprintState` from `api_functions`, add a `sprintState` useState, fetch alongside other page data in the refresh callback.
