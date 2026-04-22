# Plan — Nav Registry + Admin Page Split

> Created: 2026-04-23
> Status: approved brief, not yet started
> Related: memory `project_nav_status.md` (Phases 1–4 + security shipped at ec474b9)

---

## Backlog (feature-level checklist)

Tick off as features ship. Granular steps live in "Implementation order" below.

- [x] DB-backed page registry (`pages`, `page_tags`, `page_roles`) with seed migration
- [ ] Role ceiling enforcement on account management (service-layer, 403 on violation)
- [ ] Backend catalogue served from registry (`/api/nav/catalogue` returns `tags` + `tagEnum`)
- [ ] Grouping contiguity rule in `validatePinned` (+ `ErrBadGrouping`)
- [ ] Frontend catalogue switched to runtime fetch (delete `navCatalog.ts`)
- [ ] Sidebar grouped rendering with always-on headings
- [ ] Group-level drag (reorder whole groups; items stay within their group)
- [ ] Workspace Settings page (gadmin-only; inherits user management)
- [ ] Portfolio Settings page (padmin + gadmin; scaffold only)
- [ ] Account Settings page (all users; scaffold only)
- [ ] `/admin` route redirected to `/workspace-settings`
- [ ] Avatar dropdown menu (auto-populated from `is_admin_menu` tags)
- [ ] `/preferences/navigation` full-page replacement for the modal
- [ ] Custom user pages — stub section only
- [ ] End-to-end manual test across user / padmin / gadmin
- [ ] Commit + push

---

## Context

Phases 1–4 of personalised navigation shipped. Security hardening in. Before Phase 3 (entity-key catalogue) we need actual entities to pin, which means building the Portfolio Settings UI — and that's the cue to restructure the admin area and introduce a proper page registry.

Today the nav catalogue is a hand-synced pair: `backend/internal/nav/catalog.go` and `app/lib/navCatalog.ts`. The single `/admin` route is labelled "Settings" and serves user management (padmin+gadmin) plus a stub permissions tab. Everything below replaces that shape.

---

## Locked decisions (from brief)

### Three admin-adjacent pages replacing `/admin`

| Page | Route | Roles | Tag |
|---|---|---|---|
| Workspace Settings | `/workspace-settings` | gadmin | `admin_settings` |
| Portfolio Settings | `/portfolio-settings` | padmin + gadmin | `admin_settings` |
| Account Settings   | `/account-settings`   | all users | `personal_settings` |

User management (the current `/admin` payload) moves into **Workspace Settings**, visible to both gadmin and padmin — but editing rights follow the **role ceiling rule** (see below). Padmin needs user-list visibility so they can assign team members; they cannot create or modify accounts above their own level. `/admin` route is cut; seed migration rewrites existing `user_nav_prefs` rows with `item_key = "admin"` to `item_key = "workspace-settings"` for both gadmins and padmins.

### Role ceiling on account management (hard rule)

Baked into memory (`feedback_role_ceiling.md`). Enforced at the service layer, not just route layer, for defence-in-depth:

- **gadmin** may create/update gadmin, padmin, user accounts
- **padmin** may create/update padmin, user accounts (never gadmin)
- **user** has no account-management rights

Any violation → backend returns **403** (authorisation failure, not 400 validation). Covers create, update (both the target's current role and the requested new role), password reset, deactivate, delete. Backend has no ceiling check today — **must land before** Workspace Settings opens user-list access to padmins.

**Frontend handling of 403:** don't render a bare 403 page. The frontend intercepts auth failures and redirects the user back to `/dashboard` with a friendly banner/toast explaining what happened and who to contact (padmin for portfolio, gadmin for tenant/account). This needs a **global alerts/messages system** we don't have yet — tracked as a separate feature request (see `dev/planning/feature_global_alerts.md`). Until that system lands, interim handling is a minimal inline error message on the relevant page; the full redirect-and-banner flow lights up when the alerts system ships.

### Avatar dropdown

Top-right header avatar becomes a click-target. Opens a dropdown listing all pages whose tag has `is_admin_menu = true`, filtered by the caller's role. No drag, no pink dots, no reorder. Uses existing sidebar item styling. Group order fixed, then page order within group by `default_order`.

Result by role:
- **user:** Account Settings
- **padmin:** Portfolio Settings, Account Settings
- **gadmin:** Workspace Settings, Portfolio Settings, Account Settings

### Registry moves to DB

`backend/internal/nav/catalog.go` static slice retires. `app/lib/navCatalog.ts` retires entirely. `/api/nav/catalogue` reads from DB and returns the role-filtered catalogue. Frontend fetches on load (already does via `NavPrefsContext`), caches in memory, refetches on role change.

### Tag groups

Enum-keyed with display-name lookup. Starter enums:

| Enum | Display | `is_admin_menu` | Default order |
|---|---|---|---|
| `personal`          | Personal          | false | 0 |
| `planning`          | Planning          | false | 1 |
| `strategic`         | Strategic         | false | 2 |
| `admin_settings`    | Admin Settings    | true  | 3 |
| `personal_settings` | Personal Settings | true  | 4 |

Default page→tag mapping:

| Page | Tag |
|---|---|
| Dashboard | `personal` |
| My Vista | `personal` |
| Backlog | `planning` |
| Planning | `planning` |
| Portfolio | `planning` |
| Risk | `strategic` |
| Workspace Settings | `admin_settings` |
| Portfolio Settings | `admin_settings` |
| Account Settings | `personal_settings` |
| Dev Setup | *(untouched — stays non-pinnable, no tag required)* |

### Sidebar rendering

Flat list today becomes grouped-with-headings. Every group header shows regardless of member count (we'll test if it's too busy downstream — that was the user's call). Within a group: user-sortable via drag. Between groups: user-sortable at the group level (entire group block drags). Items cannot cross group boundaries.

### Preferences page (replaces modal)

`/preferences/navigation`. Full page, all users. Shows every pinnable page the caller's role can see, grouped by tag. User drags:
- pages within their group to reorder
- whole groups to reorder relative to each other
- pages between pinned/unpinned state (toggle)
- start page selector

Single **Save** button commits everything atomically via a single PUT.

### Custom user pages — STUB ONLY

Schema accommodates (`pages.kind = 'user_custom'`, `pages.created_by = user_id`, visible only to creator). UI at `/preferences/navigation` shows a placeholder section labelled "Your custom pages (coming soon)". No create/edit flow. Full feature waits on the not-yet-built app catalogue (charts, reports, widgets).

---

## Schema

### New tables

```sql
-- Tag groups. Enum-keyed for mechanics, display_name for UI.
CREATE TABLE page_tags (
    tag_enum        TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    default_order   INT  NOT NULL,
    is_admin_menu   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Master page registry. Replaces the hand-mirrored catalogue.
CREATE TABLE pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_enum        TEXT NOT NULL,                 -- stable code-facing id, e.g. "dashboard"
    label           TEXT NOT NULL,                 -- display name
    href            TEXT NOT NULL,
    icon            TEXT NOT NULL,
    tag_enum        TEXT NOT NULL REFERENCES page_tags(tag_enum),
    kind            TEXT NOT NULL,                 -- 'static' | 'entity' | 'user_custom'
    pinnable        BOOLEAN NOT NULL DEFAULT TRUE,
    default_pinned  BOOLEAN NOT NULL DEFAULT FALSE,
    default_order   INT NOT NULL DEFAULT 0,        -- within its tag
    created_by      UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = system page
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- key_enum is unique per (tenant, creator) scope. System pages (both NULL) must be globally unique.
    CONSTRAINT pages_unique_system_key UNIQUE (key_enum, tenant_id, created_by)
);

CREATE INDEX idx_pages_tag ON pages(tag_enum);
CREATE INDEX idx_pages_tenant ON pages(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_pages_creator ON pages(created_by) WHERE created_by IS NOT NULL;

-- Role gate, many-to-one.
CREATE TABLE page_roles (
    page_id     UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    PRIMARY KEY (page_id, role)
);

CREATE TRIGGER trg_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
```

### Changes to `user_nav_prefs`

Existing columns stay. Two options for group order:

**Option A (chosen):** derive group order from the positions. Positions are already contiguous 0..N-1 across the whole user's pinned list. Pages within a group must be contiguous in position (enforced by validator). Group order = the order of each group's first-appearing page. Zero schema change.

**Option B:** add `group_position` column. More explicit but redundant state to keep consistent.

Going with A. The validator already enforces contiguity; extending it to also enforce "all items of tag X are contiguous" is cheap and avoids a second sort key.

`item_key` stays TEXT (no FK) — same reasoning as before: static keys, entity keys, and future user-custom keys all share the column.

### Seed migration contents

Two-part migration (`009_page_registry.sql`):

1. Create tables.
2. Insert `page_tags` rows for the five enums.
3. Insert `pages` rows for all current static items + the three new pages. Populate `page_roles` accordingly.
4. Rewrite `user_nav_prefs.item_key` from `"admin"` → `"workspace-settings"` for gadmins.
5. Delete `user_nav_prefs` rows where `item_key = "admin"` AND the user is a padmin.
6. Seed default_pinned defaults (matches the current defaults — Dashboard, My Vista, Portfolio, Favourites, Backlog, Planning, Risk, plus role-gated Workspace/Portfolio Settings).

---

## Backend

### `internal/nav/catalog.go`

Retires the static `Catalog` slice. `Find`, `IsPinnable`, `CatalogFor`, `roleAllowed` remain as helpers that operate on a struct loaded from DB.

Replacement: a read-only loader.

```go
type Registry struct {
    entries      []CatalogEntry
    byKey        map[string]CatalogEntry
    tags         []TagGroup
}

func LoadRegistry(ctx context.Context, pool *pgxpool.Pool) (*Registry, error) {
    // SELECT pages + page_roles + page_tags once. Cache on a ~60s TTL.
    // On cache miss, re-query.
}

func (r *Registry) Find(key string) (CatalogEntry, bool) { ... }
func (r *Registry) CatalogFor(role models.Role) []CatalogEntry { ... }
func (r *Registry) Tags() []TagGroup { ... }
```

The service methods (`GetPrefs`, `ReplacePrefs`, `GetStartPageHref`) already take the pool — extend `Service` with a `*Registry` field, initialised at startup, refreshed on TTL or on admin-triggered change (later).

### `validatePinned`

Extended to:
- Still reject unknown keys, non-pinnable keys, role-forbidden keys, duplicates, bad positions.
- **New:** reject non-contiguous tag groupings. Every run of items sharing a tag must be a contiguous block.

Test: `TestReplacePrefs_RejectsNonContiguousGroups` seeds pinned list `[dashboard(personal), portfolio(planning), my-vista(personal)]` → expects `ErrBadGrouping`.

### API surface changes

- `GET /api/nav/catalogue` — response gains a `tags` array alongside `catalogue`:
  ```json
  {
    "catalogue": [ { ...existing fields..., "tagEnum": "personal" } ],
    "tags": [ { "enum": "personal", "label": "Personal", "defaultOrder": 0, "isAdminMenu": false } ]
  }
  ```
- `PUT /api/nav/prefs` — request shape unchanged (still `pinned[]` with `item_key` + `position`). Contiguity constraint enforced server-side. Start page still optional.
- New: **nothing needed** for avatar dropdown — frontend filters the catalogue by `isAdminMenu`.

### New error

`ErrBadGrouping = errors.New("pinned items must be grouped contiguously by tag")`. Handler maps it to the same generic `"invalid request"` 400 as the others.

---

## Frontend

### `app/lib/navCatalog.ts` — delete

Replaced by a runtime-loaded catalogue. `NavPrefsContext` already fetches `/api/nav/catalogue` on load; extend its shape to include `tags` and `tagEnum` on each entry.

### `app/components/AppSidebar_2.tsx` — regrouped rendering

Current flat render becomes:

```
<AppSidebar>
  [for each tag in pinnedGroupOrder:]
    <SidebarGroupHeading>{tag.label}</SidebarGroupHeading>
    <SortableContext (items in this group only)>
      [for each pinned item in this group:]
        <SortableSidebarItem ... />
    </SortableContext>
</AppSidebar>
```

Group-level drag: the heading is the drag handle for the whole group block. Two `DndContext` layers — outer for groups, inner per group for items. (Or a single context with a typed id distinguishing `group:<enum>` vs `item:<key>` — simpler; go with that.)

Accept/Undo banner from Phase 4 stays.

### `app/components/UserAvatarMenu.tsx` — new

Clickable avatar → dropdown anchored to top-right. Renders pages where `tagEnum` is in an `isAdminMenu` tag, role-filtered, grouped by tag with headings, ordered by `default_order`. No drag affordances. Closes on outside click / Escape. Uses existing sidebar item CSS with a `.avatar-menu` modifier for positioning.

### `app/(user)/preferences/navigation/page.tsx` — new

Full page replacing the existing modal. All pinnable pages listed, grouped by tag. Same dnd-kit patterns as sidebar. Start-page radio. "Save" commits via PUT. "Reset to defaults" uses existing DELETE endpoint.

Stub section at the bottom:

```tsx
<section className="nav-prefs__custom">
  <h3>Your custom pages</h3>
  <p>Coming soon — build your own pages from charts, reports, and widgets.</p>
</section>
```

### `app/components/AppHeader.tsx` — wire avatar

Currently the avatar likely is a static circle. Make it a button that toggles `UserAvatarMenu`. Keep initials rendering as-is.

### The three new pages

- `app/(user)/workspace-settings/page.tsx` — receives current `/admin` user-management UI. Gadmin-only gate inside the page (same pattern as today's `/admin`).
- `app/(user)/portfolio-settings/page.tsx` — **scaffold**, real Portfolio Manager content follows in the next effort; for this pass it's a PageShell with a "Coming soon" placeholder. Padmin+gadmin gate.
- `app/(user)/account-settings/page.tsx` — scaffold: change password + display name (deferred to next effort but leave the shell). All users.

### `/admin` redirect

`app/(user)/admin/page.tsx` becomes a server-side redirect to `/workspace-settings`. Keeps bookmarks alive.

---

## Files

### Create

- `db/schema/009_page_registry.sql`
- `backend/internal/nav/registry.go` — `Registry` struct, loader, TTL cache
- `backend/internal/nav/registry_test.go` — loader + tag filter + role filter tests
- `app/components/UserAvatarMenu.tsx`
- `app/(user)/preferences/navigation/page.tsx`
- `app/(user)/workspace-settings/page.tsx`
- `app/(user)/portfolio-settings/page.tsx`
- `app/(user)/account-settings/page.tsx`

### Modify

- `backend/internal/nav/catalog.go` — drop static slice, keep helpers operating on loaded `Registry`
- `backend/internal/nav/service.go` — add `*Registry` field, pass registry into validation; add `ErrBadGrouping`; extend `validatePinned`
- `backend/internal/nav/handler.go` — map `ErrBadGrouping` to 400; return `tags` in catalogue response
- `backend/cmd/server/main.go` — load registry at startup, inject into service
- `backend/internal/nav/service_test.go` — update test constructors for registry; add grouping tests
- `app/context/NavPrefsContext.tsx` — fetch + expose `tags`; add `tagEnum` to prefs entries
- `app/components/AppSidebar_2.tsx` — grouped rendering, two-level drag
- `app/components/AppHeader.tsx` — avatar button, mount `UserAvatarMenu`
- `app/globals.css` — `.avatar-menu`, `.sidebar-group-heading`, grouping layout

### Delete

- `app/lib/navCatalog.ts` (retired; all consumers switch to `NavPrefsContext`)
- `app/(user)/admin/page.tsx` (replaced by redirect) — or keep and make it the redirect; lower-risk
- *(keep)* `backend/internal/nav/catalog.go` — repurposed, not deleted

---

## Implementation order (one pass, sequenced commits)

Each numbered item is one shippable commit. Stop between any two if something blocks.

1. **Schema** — write `009_page_registry.sql`, apply locally, verify seed rows and the prefs rewrite step using the dev admin account.
2. **Backend registry** — add `Registry`, `LoadRegistry`, TTL cache, swap `catalog.go` internals to load from DB. Update `service.go` to hold `*Registry`, extend `validatePinned` with grouping contiguity check. Add `ErrBadGrouping`. Update handler + catalogue response shape. Run existing tests, fix, commit.
3. **Frontend catalogue wiring** — delete `navCatalog.ts`, extend `NavPrefsContext` to read `tags` + `tagEnum`. Keep existing sidebar rendering working (no grouping yet — just sorted flat list), verify no regression.
4. **Sidebar grouping** — grouped rendering with headings, two-level drag, Accept/Undo banner unchanged. Visual pass for spacing, headings, dark/light theme.
5. **New pages scaffold** — workspace-settings, portfolio-settings, account-settings pages + role gates + page titles. Move user-management UI from `/admin` into `/workspace-settings`. Convert `/admin` to redirect.
6. **Avatar menu** — `UserAvatarMenu` + wire up in `AppHeader`. Visual pass.
7. **Preferences page** — `/preferences/navigation` full-page replacement; deprecate/delete the old modal; add custom-pages stub section.
8. **End-to-end manual test** — as user, padmin, gadmin: pin/unpin/reorder pages across groups, confirm contiguity rejection in UI, confirm avatar menu role-filtering, confirm `/admin` redirect.
9. **Commit + push** — single summary commit message referencing this plan.

---

## Verification

1. Gadmin login → sidebar shows grouped items with headings Personal / Planning / Strategic / Admin Settings; avatar menu shows Workspace + Portfolio + Account Settings.
2. Padmin login → sidebar as above minus Workspace Settings; avatar shows Portfolio + Account Settings.
3. User login → sidebar shows Personal + Planning + Strategic groups only; avatar menu shows Account Settings only.
4. `/admin` navigates → `/workspace-settings` (gadmin) or 404 (user) / redirect (padmin falls through to whatever is appropriate — confirm during impl).
5. Preferences page: pin Workspace Settings, drag it into the middle of Planning group → Save → backend rejects with 400 `"invalid request"` → UI surfaces generic error and keeps draft.
6. Drag entire Planning group above Personal → Save → sidebar reloads with new group order.
7. 20-item cap still enforced (regression check from Phase 4 security).
8. Role gate still enforced on start-page (regression check from security audit).
9. Delete `user_nav_prefs` rows (reset to defaults) → defaults honour new tag order.
10. Create a new user in Workspace Settings → log in as them → sidebar shows the correct role-filtered catalogue with groups.

---

## Open for later (not in this pass)

- Custom user pages — real create/edit flow + app catalogue (charts, reports).
- Phase 3 entity-key catalogue — `pages.kind = 'entity'` rows dynamically loaded per project/portfolio.
- Tenant-scoped pages (`pages.tenant_id NOT NULL`) — enables a gadmin to add a global page that only shows for their tenant's users. Schema is ready, UI is not.
- Admin UI to manage `page_tags` (rename display, reorder, toggle `is_admin_menu`).

---

## Known risks

- **Two-level drag UX.** Group-level drag on top of item-level drag inside dnd-kit can get fiddly. Mitigation: type ids `group:<enum>` vs `item:<key>`, handle in a single `onDragEnd` that dispatches by prefix. Prototype in step 4; if it's miserable, fall back to explicit up/down arrow buttons on group headers.
- **Registry cache invalidation.** TTL of 60s means a just-seeded page takes up to a minute to appear. Acceptable for now — the only writers are migrations and (later) admin UI; add cache-bust on admin writes when that lands.
- **Existing pinned prefs across the `admin → workspace-settings` rename.** Handled by migration step 4/5 above. Verify after migration runs on the live backup.
- **Padmins losing user-management access.** By design — user management is now gadmin-only. Confirm this is intended before shipping. (The brief implies yes: "Workspace Settings — gAdmin", and users are the main thing at `/admin` today.)

---

## Checkpoints

Stop and confirm with user before:
- Starting step 4 (sidebar grouping) — UX-heavy, want eyes on draft behaviour
- Starting step 7 (preferences page) — same reason, biggest UX surface
- Final push — review commit message and scope
