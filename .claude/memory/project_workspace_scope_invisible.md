---
name: project-workspace-scope-invisible
description: Workspace scope is a backend-only mechanism — never visible in URLs, never user-pickable, never named in UI. Users only feel its boundary through what they can see/edit and how things are labelled.
metadata:
  type: project
---

**Workspace scope as a mechanism is hidden from the user entirely. Only UI labelling and permissions reveal where they are.**

**Why:** Locked in 2026-05-16 (Rick) during TD-WS-001 design call. The user explicitly rejected URL-segment workspace IDs ("safest, no url seeking, must be backend driven"). The product principle is: a user is *in* a workspace because of who they logged in as + their topology/role assignment, not because they navigated to one. Exposing workspace UUIDs in URLs or as picker affordances leaks an implementation detail and creates a class of permissioning bugs (URL-fiddling to reach another workspace's data). The boundary should feel like "the things I can see" rather than "a folder I'm browsing".

**How to apply:**

- **No `{workspaceID}` URL params, ever.** Routes that scope to a workspace must resolve it server-side from `u.SubscriptionID` (+ topology/role for multi-workspace tenants later). The canonical pattern is `GET /_site/workspace-settings` — no path/query workspace param. Same for any future per-workspace surface.
- **No workspace pickers in UI.** No dropdowns to "switch workspaces". If a user has access to multiple workspaces, the surface for moving between them is the topology/scope mechanism the user already touches (PLA-0042 chrome scope picker uses topology nodes, not raw workspace IDs).
- **No workspace UUIDs in client code.** `app/lib/*Api.ts` clients call workspace-scoped endpoints without an ID arg. If a typed client needs one, it's a smell — push the resolution back into the handler.
- **Permission filters + label text are the only legitimate workspace signals to the user.** Page titles say "Workspace settings" (label), not "Workspace 9f3a-… settings" (UUID leak). The PageAccessDenied screen replaces a workspace-scoped page they can't see; the URL stays clean.
- **Handlers resolve via `ActiveWorkspaceResolver` (or equivalent).** Given `u.SubscriptionID`, return the workspace ID the caller is permitted to act on. Today (single-workspace-per-subscription) that's a one-row FDW lookup. Multi-workspace later extends via `users_roles_workspaces` / topology assignment — still no URL change.

**Related:**
- [[feedback_no_browser_alerts]] — same family: backend/UI delivers boundaries, not raw mechanism.
- [[project_blocking_release_gate]] — page-gating pattern; combines with this rule (a gated page never reveals what's behind it).
- TD-WS-001 in `docs/c_tech_debt.md` — the pay-down rewires `workspacemasterrecord.Handler.Get/Patch` to use this principle.
