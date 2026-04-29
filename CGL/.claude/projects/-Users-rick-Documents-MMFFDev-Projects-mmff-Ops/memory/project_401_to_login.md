---
name: 401 page is a placeholder for the future login redirect
description: Current bare 401 in AppRouter (web/src/App.tsx) is the hook point for the login page when auth lands
type: project
originSessionId: 2ae83362-dabc-4472-8a8f-7b89c9458d58
---
The bare 401 rendered by `Unauthorized` in `web/src/App.tsx` (triggered by `AppRouter` when the URL doesn't resolve via the deeplink reverse map) is explicitly a placeholder. When the auth/login layer is wired, that exact surface becomes the login redirect — unresolved/forged URLs push the user through login rather than onto the app chrome.

**Why:** The opaque `/projects/{anchor}/{token}` URL scheme is a privacy boundary. A URL that doesn't decode shouldn't reveal any app surface (no header, sidebar, or footer) — currently that's a dead 401, eventually it's the login gate.

**How to apply:** When implementing login, replace `Unauthorized` with a redirect to the login page (or render the login form directly there). Don't add nav/chrome back around it — the stripped-chrome behaviour is the point. The `AppRouter` gate logic stays; only the `Unauthorized` leaf changes.
