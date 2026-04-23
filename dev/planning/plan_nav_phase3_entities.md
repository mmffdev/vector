# Plan — Nav Phase 3: Entity-Key Catalogue

> Created: 2026-04-23
> Status: **shipped** (commit `6f3e555`, 2026-04-23). Terminology changed during implementation: "pin" → "bookmark" throughout.
> Related: `plan_nav_registry_split.md` (Phases 1–4 + Phase 8 verification shipped)
> Schema baseline: migration `009_page_registry.sql` already includes `pages.kind = 'entity'`
> Last verified: 2026-04-23

---

## Goal

Let users pin specific entities (portfolios, products) into their personal sidebar alongside static pages, using the existing `pages` registry and `user_nav_prefs` plumbing. No new mechanism — entity rows are just `pages` rows with `kind = 'entity'`.

Out of scope for this slice: pinning individual work items (`/item/<uuid>`), pinning a list filter, custom user-authored pages.

---

## Locked decisions (proposed — confirm before starting)

### What is pinnable

Round 1: **portfolios** and **products** only. Both are first-class entities under the workspace; both have a stable URL (`/portfolio/<uuid>`, `/product/<uuid>`); both have a name, an owner, an `archived_at` column. Work items are deliberately excluded — too many of them, lifecycle is too short, and the existing `Favourites` page already covers ad-hoc bookmarking.

### How a user pins

Star button on the entity's detail-page header. Filled star = pinned for me; outline = not pinned. Clicking toggles. No bulk pin UI. No drag-from-list.

The star also appears on portfolio/product list rows as a hover affordance, so users can pin without opening the entity.

### Where pinned entities sit in the sidebar

New tag group: **`bookmarks`** with `display_name = "Bookmarks"`, `default_order = 0` (above `Personal`), `is_admin_menu = FALSE`. *(Plan called this `pinned_entities` / "Pinned"; shipped as `bookmarks` / "Bookmarks".)*

Rationale: keeping bookmarked entities separate from `Planning` means the static `Portfolio` page index and a user's bookmarked portfolios don't collide visually. Order within the group is the user's drag order, same as static pinned items.

### Display label and icon

- **Label:** entity's current `name` column. If renamed, the sidebar shows the new name on next catalogue refresh (no migration needed — `pages.label` for entity rows is recomputed at query time, see "Backend serving" below).
- **Icon:** fixed by entity kind — `briefcase` for portfolio, `box` for product. No per-entity icon picker in this slice.

### Lifecycle

- **Archived entity (`archived_at IS NOT NULL`):** hide from sidebar silently. Pref row stays in `user_nav_prefs` so unarchiving restores the pin without the user having to re-star.
- **Deleted entity:** the `pages` row is removed by FK cascade (`pages.created_by` is NULL for entity rows but they have a backing `entity_id` FK — see schema below). `user_nav_prefs.item_key` is TEXT with no FK, so an orphan pref row is harmless; the catalogue endpoint just won't return a matching catalogue entry, and the sidebar drops it.
- **User loses access** (e.g. removed as stakeholder, role demoted below entity's role gate): same as archived — silently hidden. Pref row stays in case access is restored.

### Role gate

Entity rows inherit role visibility from the entity's existing access rules, not from `page_roles`:
- **portfolio:** owner + entity_stakeholders + padmin/gadmin in same tenant
- **product:** same rule
- A user can only pin an entity they currently have access to. The catalogue endpoint filters out entity rows the caller can't see.

`page_roles` rows for entity pages are not used (we'd have to manage them per-pin, and tenant-level role gating is already handled by the entity access rules).

---

## Schema additions

Single new migration: `010_nav_entity_bookmarks.sql`. No existing tables modified. *(Plan called this `010_nav_entity_pins.sql`; name changed to "bookmarks" during implementation.)*

```sql
BEGIN;

-- New tag group for entity bookmarks. Sits above Personal.
-- Shipped as tag_enum='bookmarks', display_name='Bookmarks' (plan said 'pinned_entities'/'Pinned').
INSERT INTO page_tags (tag_enum, display_name, default_order, is_admin_menu) VALUES
    ('bookmarks', 'Bookmarks', -1, FALSE);

-- Bump existing tag default_orders so pinned_entities = 0 mathematically
-- without a negative number leaking into the API. Choosing -1 then
-- normalizing here keeps the seed migration intact for fresh installs.
UPDATE page_tags SET default_order = default_order + 1
  WHERE tag_enum != 'bookmarks';
UPDATE page_tags SET default_order = 0
  WHERE tag_enum = 'bookmarks';

-- Track the entity backing each entity-kind page. Lets the catalogue
-- query JOIN to portfolio/product to get the live name and check archive.
-- Polymorphic FK (entity_kind + entity_id), same shape as entity_stakeholders.
CREATE TABLE page_entity_refs (
    page_id      UUID PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
    entity_kind  TEXT NOT NULL CHECK (entity_kind IN ('portfolio', 'product')),
    entity_id    UUID NOT NULL,
    UNIQUE (entity_kind, entity_id)
);

CREATE INDEX idx_page_entity_refs_lookup ON page_entity_refs(entity_kind, entity_id);

COMMIT;
```

**Why a separate table and not a column on `pages`?** Static pages have no entity backing; adding nullable `entity_kind` / `entity_id` to `pages` muddies the existing rows. A side table keeps the static catalogue clean and the entity refs together.

### Pinned key_enum format

`entity:portfolio:<uuid>` and `entity:product:<uuid>`. The `entity:` prefix collides with nothing in the static catalogue and makes audit log lines self-documenting.

---

## Backend changes

### New service: `nav.Bookmarks`

Single source of truth for entity bookmarking. *(Plan called this `nav.EntityPins`; shipped as `nav.Bookmarks`.)* Three methods:

```go
type Bookmarks interface {
    // Pin creates the pages row + page_entity_refs row + user_nav_prefs row
    // in a single transaction. Idempotent — re-pinning is a no-op.
    Pin(ctx, userID uuid.UUID, kind string, entityID uuid.UUID) error

    // Unpin removes the user_nav_prefs row. Leaves pages + page_entity_refs
    // intact so other users keep their bookmarks for the same entity.
    Unpin(ctx, userID uuid.UUID, kind string, entityID uuid.UUID) error

    // IsPinned returns whether this user has bookmarked the entity.
    IsPinned(ctx, userID uuid.UUID, kind string, entityID uuid.UUID) (bool, error)
}
```

Pin flow:
1. Check caller has access to the entity (re-uses existing portfolio/product service access checks).
2. Get-or-create the `pages` row for this entity (`key_enum = "entity:<kind>:<id>"`, `kind = "entity"`, `tag_enum = "bookmarks"`, `pinnable = TRUE`, `default_pinned = FALSE`, `tenant_id = entity.tenant_id`).
3. Get-or-create the `page_entity_refs` row.
4. Insert `user_nav_prefs` row at the end of the user's `pinned_entities` group (compute next position).
5. All four ops in one tx; rollback on any failure.

### `/api/nav/catalogue` extended

Existing endpoint already returns the static catalogue. Add a JOIN-based query for entity rows the caller can see:

```sql
SELECT p.id, p.key_enum, per.entity_kind, per.entity_id,
       COALESCE(po.name, pr.name) AS label,
       CASE per.entity_kind
         WHEN 'portfolio' THEN '/portfolio/' || per.entity_id
         WHEN 'product'   THEN '/product/'   || per.entity_id
       END AS href,
       CASE per.entity_kind
         WHEN 'portfolio' THEN 'briefcase'
         WHEN 'product'   THEN 'box'
       END AS icon,
       p.tag_enum
FROM pages p
JOIN page_entity_refs per ON per.page_id = p.id
LEFT JOIN portfolio po ON per.entity_kind = 'portfolio' AND po.id = per.entity_id AND po.archived_at IS NULL
LEFT JOIN product   pr ON per.entity_kind = 'product'   AND pr.id = per.entity_id AND pr.archived_at IS NULL
WHERE p.kind = 'entity'
  AND p.tenant_id = $1                              -- tenant scope
  AND (po.id IS NOT NULL OR pr.id IS NOT NULL)      -- not archived/deleted
  AND id IN (
    -- access check: caller is owner, stakeholder, or padmin/gadmin
    -- (delegated to existing helper, simplified here)
    SELECT page_id_visible_to_user($2)
  );
```

Two catalogue branches now: static (unchanged) and entity (new). Frontend gets a single merged list with `kind` discriminator.

Cache: existing 60s registry cache stays for static rows; entity rows skip the cache (per-user, per-tenant, would explode the key space). Acceptable — the JOIN is indexed and entity counts per user are small.

### REST endpoints

*(Plan used `/api/nav/pin`; shipped as `/api/nav/bookmark`.)*

```
POST   /api/nav/bookmark       { kind: "portfolio" | "product", entity_id: uuid }   → 204
DELETE /api/nav/bookmark       { kind: "portfolio" | "product", entity_id: uuid }   → 204
GET    /api/nav/bookmark/check?kind=...&entity_id=...                                → { pinned: bool }
```

The `/check` endpoint is what the entity detail page hits to render the `PinButton`'s filled/outline state on first load.

### Audit

- `nav.entity_pinned`   metadata `{ kind, entity_id }`
- `nav.entity_unpinned` metadata `{ kind, entity_id }`

Same audit logger as user.created etc.

---

## Frontend changes

### New context method

`NavPrefsContext` gains (shipped with bookmark terminology):
```typescript
isBookmarked(kind: "portfolio" | "product", entityID: string): boolean
bookmark(kind: "portfolio" | "product", entityID: string): Promise<void>
unbookmark(kind: "portfolio" | "product", entityID: string): Promise<void>
```

`isBookmarked` is synchronous against the in-memory `prefs` array (matching `key_enum = "entity:<kind>:<id>"`). Bookmark/unbookmark POST then refetch.

### `<PinButton>` component

*(Plan called this `<PinStar>`; shipped as `<PinButton>` in `app/components/PinButton.tsx`.)*

Reusable, used on:
- `/portfolio/<id>` page header (right-aligned, next to title)
- `/product/<id>` page header
- portfolio list rows on hover
- product list rows on hover

```tsx
<PinButton kind="portfolio" id={p.id} />
```

Internal: reads `isBookmarked`, calls `bookmark`/`unbookmark` on click, optimistic update with rollback on error.

### Sidebar rendering

No change to the rendering loop — `pinned_entities` is just another tag group. The catalogue already returns the right shape; the sidebar already groups by `tagEnum`. Group header reads "Pinned" automatically from `page_tags.display_name`.

The only sidebar-side adjustment: when the group is empty (user hasn't bookmarked anything), hide the group header. Static groups always show their header even when empty (per Phase 2 design); the Bookmarks group is the exception because an empty "Bookmarks" looks like dead UI.

### Empty-pins onboarding hint

First-time users with zero pinned entities: small `?` icon next to the sidebar Pinned header (when it would be visible — i.e. when `is_first_login` flag exists, which it doesn't yet). Skip for v1; ship without onboarding.

---

## Edge cases worth thinking about

| Case | Behaviour |
|---|---|
| User pins a portfolio, then loses stakeholder access | Sidebar hides it next refetch. Pref row stays. If access restored, pin reappears. |
| User pins a portfolio that gets archived | Same as above — hidden, pref row preserved. |
| User pins a portfolio in tenant A, gets moved to tenant B | Pref row stays but catalogue won't return it (tenant-scoped). On move-back, reappears. |
| Two users pin the same portfolio | Single shared `pages` row + `page_entity_refs` row. Each has their own `user_nav_prefs` row. Unpin only removes the prefs row. |
| Last user unpins a portfolio | The `pages` and `page_entity_refs` rows linger. Acceptable garbage; can be GC'd later by a "pages with zero referencing prefs" cron if it grows. |
| Portfolio renamed | Next catalogue fetch (sidebar load or refetch on save) shows new name. |
| Portfolio deleted | FK cascade removes `page_entity_refs` row → catalogue JOIN excludes it → sidebar drops it. Pref row goes orphan but harmless. |
| Pin cap | Cap raised from 20 → 50 (`nav.MaxPinned = 50`) to accommodate entity bookmarks alongside static pinned items. Worth flagging in the button's disabled state when at cap. |
| Contiguity rule | Entity bookmarks are all in the `bookmarks` group, so they're naturally contiguous. No special handling. |

---

## Migration & data risk

- New table only. No existing tables changed except the `page_tags.default_order` shift (+1 to all existing rows so `pinned_entities` can be 0). Tested in dry-run before COMMIT.
- The shift means a fresh install on `009` then `010` produces the same final state as a fresh install with both, which is the invariant we need.
- No backfill of `user_nav_prefs` — entity pins start empty for everyone.

---

## Implementation order

1. **Migration `010_nav_entity_bookmarks.sql`** — drafted above. Apply, verify on dev DB.
2. **Backend service `nav.Bookmarks`** — Pin/Unpin/IsPinned + access checks. Unit tests for tenant isolation, archive filtering, idempotency, 50-cap.
3. **Catalogue query extension** — second SELECT branch + merge. Test that static catalogue still returns identical results when caller has zero entity pins.
4. **REST handlers** — `POST /api/nav/bookmark`, `DELETE /api/nav/bookmark`, `GET /api/nav/bookmark/check`. Wire to audit. 403 on access violation, not 400.
5. **Frontend context** — `isBookmarked` / `bookmark` / `unbookmark` on `NavPrefsContext`. Refetch wiring.
6. **`<PinButton>` component** — visual + click handler + optimistic update.
7. **Wire button into portfolio + product detail pages** — header placement, list-row hover.
8. **Sidebar tweak** — hide empty `bookmarks` group header.
9. **End-to-end manual test** — pin/unpin/archive/rename/delete/access-loss flows across roles.
10. **Commit + push.**

---

## Checkpoints

Confirm with user before:
- Starting step 1 (migration touches `page_tags` ordering — wants eyes on)
- Starting step 6 (star icon visual + placement is a UX choice)
- Final push

---

## Open questions

1. Is "Pinned" the right group name, or do you prefer "My Pins" / "Bookmarks" / something else?
2. Star icon is currently used by the `Favourites` static page. Risk of confusion — a user might think starring an entity adds it to Favourites, not pins it. Alternative: pin/thumbtack icon (📌-style). I'd suggest **pin icon** for the action and keep the star reserved for Favourites.
3. Should there be a "Manage pinned entities" view (list all my pins, drag-reorder, bulk unpin) under `/preferences/navigation`? My recommendation: **no for v1** — the sidebar drag already handles reorder, and the unpin button on each entity covers removal. Add a manage view only if users complain.
4. Cap on entity pins specifically — currently they share the 20-item cap with static pinned. Do you want a separate cap (e.g. max 10 entities) so users can't pin 20 portfolios and lose all static nav? My recommendation: keep one cap, surface a clear warning when they hit it.

---

## Out for later (not in this slice)

- Pinning individual work items (`/item/<uuid>`)
- Pinning saved filters / list views
- Per-entity icon picker
- Onboarding hint for first-time users
- Garbage collection of orphan `pages` rows
- Manage-bookmarks view in `/preferences/navigation`

> Note: custom user-authored pages (`pages.kind = 'user_custom'`) shipped in PR #4 alongside this plan (migration `016_user_custom_pages.sql`, service `backend/internal/custompages/`, route `/p/[id]`).
