---
name: API reference docs must stay in sync with backend handlers
description: After any work that adds, removes, or changes backend routes/handlers, update api-reference/ docs and redeploy
type: feedback
originSessionId: 984ee177-319a-47f4-84ab-55fd5b444b31
---
After any task that touches backend route registration or handler files, update the API reference docs and redeploy before marking work complete.

**Why:** The api-reference site at localhost:8083 is the team's single source of truth for the REST API. A stale docs site is worse than no docs site.

**How to apply:**
- If you modify or create any file matching `backend/internal/*/handler.go`, `backend/cmd/server/main.go`, or any `router.go` / `routes.go` → update the relevant page in `api-reference/docs/rest-api/`
- If you add a new endpoint group → create the new `_category_.json` + `index.mdx` under `api-reference/docs/rest-api/<group>/`
- After doc changes, run `cd api-reference && bash deploy.sh` to push to host
- The Stop hook in `.claude/settings.json` will remind you at session end if handler files changed
