---
name: feedback-system-vs-display-layers
description: "System identifiers (UUIDs, slots, URL paths) are project-controlled and stable; display strings (catalogue names, sidebar labels) are tenant-controlled and free to change. The two never cross — display strings are never used as identifiers, system identifiers are never user-facing."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fd420f3b-59b4-438d-97d2-bff948699036
---

**Hard separation between the system layer and the display layer.** The system uses stable, project-controlled handles for everything internal (UUIDs, slot enums, URL path segments, sidecar references). The display layer uses tenant-controlled free strings for everything user-facing (catalogue names, sidebar labels, page titles). **The two are never the same value, and the system never falls back to display strings when an identifier is needed.**

**Why:** Locked 2026-05-16 during the chip-architecture conversation. Rick named two specific reasons URLs must stay project-locked:

1. **Bookmarking would silently break.** If `/risk` flipped to `/issue` when Gadmin renamed the Risk type, every bookmark to `/risk` becomes a 404 (or, worse, semantically wrong). Users have no way to know their bookmark went stale. Multi-workspace makes it worse — a user in Workspace A (calls it "Risk") and Workspace B (calls it "Issue") can't have a single bookmark that works in both.
2. **URLs are infrastructure, not language.** The path `/risk` is the system's name for "the page bound to the Risk slot". It's not user copy any more than the table name `artefacts` is. Conflating identifier with display is the same category mistake as conflating SQL column names with spreadsheet headers.

The broader principle: **the layer that owns an identifier is the only layer that names it; the layer that owns display is the only layer that relabels it. You don't reuse one as the other.**

**How to apply:**

| Concern | Identifier type | Owner | User-visible? |
|---|---|---|---|
| Database PK / FK | UUID | System | No |
| Slot enum on artefact_types | Stable string (`wrk_risk`) | Project | No |
| Sidecar references | Slot string | Project | No |
| URL path | Path slug (`/risk`) | Project | Only when typed/bookmarked |
| Catalogue display name | Free string ("Issue") | Gadmin | Yes — everywhere in UI |
| Sidebar nav label | Display name | Gadmin | Yes |

- **System-layer values are project-locked and append-only.** A slot value, a URL path, an enum value — once defined, never renamed, never removed. Add new ones; never mutate existing.
- **Display-layer values are tenant-free.** Rename "Risk" → "Issue" → "Hazard" freely; the system is invariant.
- **Never use a display string as an identifier.** No `WHERE name = 'Risk'` (today's bug). No `?type=epic` in URLs (slug looks stable but the column it matches is renameable). Always UUID-on-wire, slot-in-config, path-segment-in-route.
- **Never expose a system identifier in UI.** No UUIDs in error messages, no slot enums in tooltips, no URL paths as page titles. The user sees the display string. The system sees the handle.
- **Sidebar/nav reads display from catalogue at render time.** The label "Issue" comes from `artefacts_types_name` for the current workspace; the route `/risk` is the system path for the slot the page is bound to.

This is the same shape as several existing rules:
- [[project_workspace_scope_invisible]] — workspace UUID is system-side; user sees label only.
- [[feedback_url_is_path_only]] — URL carries path only; no query state of any kind.
- [[feedback_no_hardcoded_order_from_db_data]] — display order comes from DB sort_order, not TSX literals.

They're all instances of this one principle: **system layers and display layers are separate. They never swap responsibilities.**

**Related:**
- [[project_workspace_scope_invisible]] — workspace as a system clamp.
- [[feedback_url_is_path_only]] — URL as path-only system surface.
- [[feedback_no_hardcoded_order_from_db_data]] — display data from DB, not code literals.
- [[user_stakeholder_foundation_mode]] — design rule: stable system primitives + soft display surfaces is what the foundation looks like.
