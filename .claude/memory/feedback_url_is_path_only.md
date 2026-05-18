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

**The address bar vs the wire (the thing Claude keeps tripping over — 2026-05-18):**

This rule is about the **user-visible URL in the address bar**. Nothing else. It does NOT mean the wire request between the browser and the Go backend has to be query-free.

- **Address bar = path only.** `/portfolio-items` stays `/portfolio-items`. No `?` ever. No router.replace with params. No useSearchParams. This is the user contract.
- **Wire request CAN carry query params.** When `apiSite("/portfolio-items?limit=25&offset=0&scope=<uuid>")` fires, the browser sends `GET /_site/portfolio-items?limit=25&offset=0&scope=<uuid>` to Go. That's invisible to the user and that's fine. It's how Go handlers receive parameters via `r.URL.Query().Get("scope")`. Nothing about PLA-0053 forbids this.
- **The wrong inference:** "the URL is path-only" → "the backend can't read query params" → "we have to invent a new way for the frontend to tell the backend the scope". That's wrong. Go reads query params off the wire URL, which is not the address bar URL. They are two different surfaces.
- **When in doubt:** check what the *user* sees in the address bar. If the answer is "just the path", the rule is satisfied. What JS sends to Go is implementation, not user surface.

If Rick says "we binned `?…` from the URL", he means the address bar surface that the user sees and can bookmark / share / fiddle. He does NOT mean the wire surface where Go handlers parse query params. Don't second-guess this — go straight to reading `r.URL.Query().Get(...)` on the Go side; the address bar is unaffected.

**Related:**
- [[project_workspace_scope_invisible]] — the original "no workspace UUIDs" rule this generalises.
- [[feedback_no_browser_alerts]] — same family: in-page UI / backend mechanism over surfaced state.
- [app/lib/api.ts](../../../../../Documents/MMFFDev%20-%20Projects/MMFFDev%20-%20Vector/app/lib/api.ts) — header comment above `withForwardedScope` (lines 62-79) restates this for the next reader of the fetch helper.
