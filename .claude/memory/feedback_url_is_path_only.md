---
name: feedback-url-is-path-only
description: "URL carries the page identity ONLY — no query string, no filter/sort/scope params, no UUIDs. Every other piece of state lives backend-side or in-memory."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fd420f3b-59b4-438d-97d2-bff948699036
---

**Nothing goes in the URL other than the page path itself.** No `?type=epic`, no `?status=open`, no `?sort=title&dir=asc`, no `?workspaceID=…`, no `?vid=…`. State that needs to persist across reloads lives **on the backend** (per-user preferences, last-used filters); state that doesn't lives in **React component state**.

**Why:** Locked 2026-05-16 by Rick. Generalises [[project_workspace_scope_invisible]] from "no workspace UUIDs" to "no URL state of any kind". URLs are a public surface — anything in them is shareable, bookmarkable, URL-fiddleable, and indexable. The product principle is the same as workspace scope: the user reaches state through the UI, not by typing into the address bar. Filter chips, sort buttons, scope pickers must drive backend writes (or local React state), never `router.replace` with new params.

**How to apply:**

- **Filters / sort / view state** → React state (`useState`) when ephemeral, or a per-user backend setting (`/_site/me/preferences` style) when it should persist across reloads. Never `useSearchParams` for any of these.
- **Deep-link to records** → the path is enough (`/work-items/abc-123` not `/work-items?id=abc-123`). The page reads its identity from the route segment, looks up the record server-side, and renders.
- **Wizard / view picker** → no `?vid=` query. Either route segments (`/p/foo/edit` not `/p/foo?vid=edit`) or component state owned by the page.
- **Existing URL-state code is debt.** Strip it the next time the surface is touched and file a TD entry. The pre-NavigationPie work-items filter chips already wrote `?type=` etc — that was the established convention until 2026-05-16; the new rule supersedes it.
- **The chip `useSearchParams` pattern is dead.** Migrate every chip and sort control to `useState` (or a per-user backend pref) on the next pass.

**Related:**
- [[project_workspace_scope_invisible]] — the original "no workspace UUIDs" rule this generalises.
- [[feedback_no_browser_alerts]] — same family: in-page UI / backend mechanism over surfaced state.
