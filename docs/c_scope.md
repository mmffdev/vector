# Scope — features underway

Live snapshot of what is actively being built. Update when a feature moves state.

**Status values:** `underway` | `paused` | `complete`

---

## Underway

| Feature | Area | Migration | Stories | Status | Notes |
|---|---|---|---|---|---|
| Work Items — execution page (tree grid, filter, detail panel, sprints, custom fields) | ITM / API / SQL | 062–066 | 00175–00189 | underway | Backend package in progress; frontend filter + tree grid next |
| Icon catalogue + per-subscription item-type icons | ITM / SQL | 067 | TBD | underway | `vector_icons` + `subscription_item_type_icons` tables created; padmin picker UI + API TBD; seed: epic=MdOutlineCreateNewFolder, story=MdOutlineFolder, task=MdChecklist, defect=MdOutlineBugReport (all md pack) |
| Scope page (sidebar entry + blank template) | UI / SQL | 070 | TBD | underway | Built-in static page under Planning tag; visible to all roles; route `/scope`; folder icon; body is an empty PageShell — upload + work-item linking deferred |

---

## Paused

_(none)_

---

## Recently completed

| Feature | Area | Stories | Completed |
|---|---|---|---|
| Portfolio templates (replace portfolio_models + layers) | POR / SQL | 00156–00174 | 2026-04-30 |
| Vector Design System rebrand | UI | 00108–00123 | 2026-04-27 |
| Library release channel (Phase 3) | LIB | — | 2026-04-25 |
