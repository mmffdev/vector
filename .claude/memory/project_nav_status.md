---
name: Nav system status (Vector PM)
description: Current state of Rally-style personalised nav — phases shipped, security audit outcome, what's next
type: project
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
Rally-style personalised navigation for Vector PM. Stack: static catalogue in `backend/internal/nav/catalogue.go`, Postgres `user_nav_prefs` table, Go service/handler at `backend/internal/nav/`, React context at `app/context/NavPrefsContext.tsx`, sidebar in `app/components/AppSidebar_2.tsx`.

**Shipped:**
- Phase 1–3: catalogue, prefs CRUD, pin/unpin modal.
- Phase 4: drag-to-reorder in modal AND sidebar, inline Accept/Undo banner on sidebar drag (using `--line-1` / `--surface` / `--ink-2` palette tokens, not hot pink), 20-item client cap, @dnd-kit based.
- Security hardening (commit ec474b9, pushed to origin/main 2026-04-22): role gate on PUT /api/nav/prefs for every item_key, role gate on GET /api/nav/start-page with silent fallback on demotion, server-side `MaxPinned=20` cap, 120 req/min/IP httprate on /api/nav, generic "invalid request" error body (no echo of offending key). Tests added in `service_test.go`: `TestReplacePrefs_RejectsItemForbiddenForRole`, `TestReplacePrefs_RejectsTooManyPinned`, `TestGetStartPageHref_FallsBackWhenRoleLosesAccess`. All green.

**Why:** Phase 3 from plan was entity-key catalogue extension (dynamic item_keys for per-project/per-entity nav); deferred — core role-gated catalogue is the validated baseline. Security audit was ad-hoc user request after Phase 4 landed, not a planned phase.

**How to apply:** Next natural step is Phase 3 (entity-key catalogue) OR a different user-chosen direction. Don't re-do the audit fixes. Don't re-do Phase 4. Before starting Phase 3, re-read `backend/internal/nav/catalogue.go` and the `user_nav_prefs` migration — catalogue validation currently assumes static keys and will need a DB-backed branch for entity keys.
