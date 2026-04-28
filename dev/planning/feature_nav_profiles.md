# Feature: Navigation Profiles

**Status:** Design approved 2026-04-27. Implementation cards: 00118 (SQL), 00119 (Profiles API), 00120 (Prefs API extension), 00121 (Context), 00122 (Bar UI), 00123 (Editor reactivity).

**Related docs:** `plan_nav_registry_split.md` (Phases 1–4 + 8 shipped), `plan_nav_phase3_entities.md` (entity bookmarks shipped). This is **Phase 5**.

---

## Goal

Each user gets multiple named navigation layouts ("profiles") they can swap between. Default is seeded; user creates more as needed. Each profile is a complete, independent layout: its own pinned items, its own group placements, its own start page.

**Hard rule — shared pool:** custom pages **and** custom groups belong to the user, not to any one profile. They cannot be "claimed" by a profile and become unavailable to others. Every profile's Available pool exposes the full set of the user's pages and groups; the profile only decides which ones it displays and where.

---

## Current state (one paragraph)

The schema was forward-designed for this. `user_nav_prefs.profile_id UUID` exists at `db/schema/008_user_nav_prefs.sql:27` and every index includes it, but production rows are always NULL. `user_nav_groups` and `user_custom_pages` have no `profile_id`. The 5 buttons at `app/(user)/preferences/navigation/page.tsx:1494` are pure UI scaffolding with no backend wiring. `NavPrefsContext` (`app/contexts/NavPrefsContext.tsx`) assumes a single profile per user. App-layer (`user_id`, `subscription_id`) tenancy enforcement throughout — no RLS.

---

## Data model

### What's per-profile vs. shared

| Resource | Scope | Why |
|---|---|---|
| Pinned items (`user_nav_prefs`) | Per profile | The whole point — different layouts per profile |
| Custom groups (`user_nav_groups`) | **Shared** per user | Hard rule above. The group definition (id, label) lives at user level and is never "claimed." |
| Group placement (which profile shows which group, in what position) | Per profile (NEW table `user_nav_profile_groups`) | Lets each profile pick which shared groups appear in its sidebar without claiming the group itself |
| Custom pages (`user_custom_pages`) | **Shared** per user | Same shared-pool rule as groups |
| Bookmarks (entity pins) | Per profile | Lives in `user_nav_prefs` already, so this is automatic |
| Active profile selection | **Server-side** on `users.active_nav_profile_id` — follows the user across devices (hot-desking) |

### New table

```sql
-- db/schema/017_user_nav_profiles.sql
CREATE TABLE user_nav_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL,
  label           TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 32),
  position        INTEGER NOT NULL,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  start_page_key  TEXT,                       -- per-profile start page; NULL = role default
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uniq_default_profile_per_user
  ON user_nav_profiles (user_id, subscription_id) WHERE is_default = TRUE;

CREATE UNIQUE INDEX uniq_profile_position
  ON user_nav_profiles (user_id, subscription_id, position);

CREATE UNIQUE INDEX uniq_profile_label
  ON user_nav_profiles (user_id, subscription_id, LOWER(label));
```

**Caps:** max 10 profiles per user.
**Default rules:** `label = 'Default'`, `is_default = TRUE`, `position = 0`. Cannot rename, delete, or reorder. Always exists.

### Per-profile group placement (NEW)

Groups stay shared (per the hard rule above). To express "which groups does this profile display, and in what position," we add a small junction table:

```sql
-- db/schema/018_user_nav_profile_groups.sql
CREATE TABLE user_nav_profile_groups (
  profile_id  UUID NOT NULL REFERENCES user_nav_profiles(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES user_nav_groups(id)  ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  PRIMARY KEY (profile_id, group_id)
);

CREATE UNIQUE INDEX uniq_profile_group_position
  ON user_nav_profile_groups (profile_id, position);
```

**Invariant:** if any pin in profile P references group G via `user_nav_prefs.group_id`, there must be a matching `user_nav_profile_groups` row. Frontend creates the placement when first dragging a pin into a group; backend rejects writes that violate the invariant. Removing the placement (drag the group back to Available) is allowed only if no pins in this profile reference the group.

### Existing-table changes

```sql
-- user_nav_prefs: enforce profile_id (currently nullable, always NULL)
ALTER TABLE user_nav_prefs ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE user_nav_prefs ADD CONSTRAINT fk_user_nav_prefs_profile
  FOREIGN KEY (profile_id) REFERENCES user_nav_profiles(id) ON DELETE CASCADE;

-- user_nav_groups: NO CHANGE. Stays user-level (shared).
-- Existing index uniq_user_nav_groups_user_label (user_id, LOWER(label)) is unchanged.

-- users: server-side active selection
ALTER TABLE users ADD COLUMN active_nav_profile_id UUID
  REFERENCES user_nav_profiles(id) ON DELETE SET NULL;
```

### Migration of existing data (card 00118)

```
1. CREATE user_nav_profiles.
2. CREATE user_nav_profile_groups.
3. INSERT one Default per (user_id, subscription_id) found in user_nav_prefs UNION user_nav_groups.
   - label='Default', is_default=TRUE, position=0, start_page_key = NULL.
4. UPDATE user_nav_prefs SET profile_id = <default.id> WHERE profile_id IS NULL.
5. ALTER user_nav_prefs.profile_id SET NOT NULL + add FK.
6. INSERT INTO user_nav_profile_groups (profile_id, group_id, position)
   SELECT <user's Default>, g.id, g.position FROM user_nav_groups g
   — pre-seed every existing group as placed in that user's Default profile.
7. UPDATE users SET active_nav_profile_id = <user's Default> for every user with a Default row.
8. (No backfill needed for users with no nav data — lazy-seed on first prefs read.)
```

`user_nav_groups` itself is unchanged by this migration.

---

## Role-aware Default seeding

> User confirmed: "gadmin, padmin, user etc. get their own default nav schema, we already have pages they can and cant see so that work well"

When a Default profile is **first created** for a user (either via the migration or lazy-seed for a brand-new user), it inherits the role-appropriate starting layout:

- **Pinned items:** drawn from `catalogue.entry.defaultPinned === true` AND `entry.roles` includes the user's role. Already filtered by the existing `/api/nav/catalogue` handler (`backend/internal/nav/handler.go:31`).
- **Start page:** picked by role — gadmin → first gadmin landing in catalogue, padmin → first padmin landing, user → `/dashboard`. (Implemented as a small role→key map server-side in the seeder; user can change it later by clicking the star on any pin.)
- **Position order:** uses each catalogue entry's `defaultOrder`.

Non-default profiles created by the user start **empty** — user pins what they want.

---

## Active profile — server-side, sticky across devices

> User confirmed: "yes as people hot desk and work from home"

- Stored on `users.active_nav_profile_id`. Loaded as part of the auth bootstrap.
- On cold start with NULL: backend resolves to the user's Default profile.
- Switching profiles (via Save Profile in the editor — see UX below) writes the new value.
- ON DELETE SET NULL: if a user deletes their currently-active non-Default profile, the column nulls out and the next read falls back to Default.

No localStorage involvement. Same profile follows the user from laptop to office desk to phone.

---

## API surface

### New endpoints — Profiles CRUD (card 00119)

```
GET    /api/nav/profiles                        → Profile[] sorted by position
POST   /api/nav/profiles      body: { label }   → Profile (validates cap=10, label uniqueness, length 1–32)
PATCH  /api/nav/profiles/:id  body: { label? }  → Profile (rejects if is_default)
DELETE /api/nav/profiles/:id                    → 204 (rejects if is_default; cascades prefs + groups)
PATCH  /api/nav/profiles/order body: [{id,position}] → Profile[]
                                                  (Default always position=0; reorder uses two-phase write
                                                   to avoid unique-index collisions)
PUT    /api/nav/profiles/:id/activate           → 204 (sets users.active_nav_profile_id)
```

### Extended endpoints (card 00120)

All accept `?profile=<uuid>`; omitting falls back to caller's active profile.

```
GET    /api/nav/prefs?profile=<uuid>            → PrefRow[] + groups for that profile
PUT    /api/nav/prefs?profile=<uuid>            → atomic replace within that profile
DELETE /api/nav/prefs?profile=<uuid>            → reset that profile only (keeps the profile row)
GET    /api/nav/start-page?profile=<uuid>       → resolved href for that profile
GET    /api/nav/catalogue                       → unchanged (catalogue is profile-agnostic)
POST   /api/nav/bookmark   body adds: profile_id → pin to specific profile
DELETE /api/nav/bookmark   body adds: profile_id
GET    /api/nav/bookmark/check?profile=<uuid>   → check within profile
```

**Tenancy (hard requirement):** no RLS in the DB, so every profile-scoped query must filter `WHERE profile_id = $X AND user_id = $Y AND subscription_id = $Z`. To eliminate drift, **card 00119 must ship a `requireOwnedProfile(ctx, userID, subID, profileID) error` helper** in `backend/internal/nav/` that returns a sentinel `ErrProfileNotFound` if the profile doesn't belong to the caller. Every endpoint that takes a `profile_id` (path, query, or body) calls this helper first. Code review checklist item: any new handler touching `user_nav_prefs`, `user_nav_profile_groups`, or `user_nav_profiles` must be preceded by a `requireOwnedProfile` call.

---

## UX — edit-mode lockdown on /preferences/navigation

> User confirmed: "when you select a preset, all the other buttons grey out and become unfunctional, with a new button appearing for Save Profile and another Cancel"

### Quick-bar states

**Idle (no edits in flight):**
- All profile buttons enabled and clickable.
- Active profile shown in the white-bg / black-border / black-text style (already shipped).
- Inactive profiles in `btn--primary` (dark fill).
- Trailing `+ Add` button visible if under cap of 10.
- Default has no rename/delete affordance; non-default profiles get a `⋯` menu (Rename / Delete).
- No Save / Cancel buttons.

**Edit mode (entered by clicking any profile button):**
- That profile's data is loaded into the editor (replacing previous draft).
- All **other** profile buttons greyed out and non-functional.
- The clicked profile button stays interactive but locked-in (no further click effect).
- `+ Add` button greyed out.
- Two new buttons appear at the right end of the bar: **Save Profile** (primary) and **Cancel** (ghost).
- Editor area (drag/drop, pin, rename group, etc.) is fully active.

**On Save Profile:**
- PUT `/api/nav/prefs?profile=<id>` with the draft.
- PUT `/api/nav/profiles/:id/activate` to mark this as the user's active profile.
- Bar returns to idle state with this profile now highlighted as active.
- Sidebar elsewhere in the app re-renders against the new active profile (free, since `NavPrefsContext` is shared).

**On Cancel:**
- Discard draft, revert editor to whatever was loaded before edit-mode started (i.e., the user's previously-active profile).
- Active profile in the DB is unchanged (we never wrote it).
- Bar returns to idle state.

**Edge case — page load:** the page loads idle, with the user's current active profile rendered in the editor read-only-feel (technically draft state, but no Save/Cancel visible because nothing was clicked). Same shape as clicking the already-active profile would produce, but no lockdown until the user explicitly clicks.

### Add / Rename / Delete

- **Add:** clicking `+` opens a small inline input (or modal) for the label. Server creates the profile, frontend switches into edit mode for it (so user immediately starts pinning).
- **Rename:** `⋯` menu → Rename → inline editable label on the button. Save commits via PATCH; Escape cancels. Only available on non-default profiles, only when bar is idle.
- **Delete:** `⋯` menu → Delete → confirm dialog. The dialog shows a **full-width red-bordered warning banner** (uses the existing `--danger` / `--danger-bg` tokens) with copy along the lines of:

  > **Deleting this profile removes its pinned layout only.** Your custom pages and groups are not deleted — they go back to the Available pool and remain available to every other profile.

  Confirm → DELETE the profile. Cascades wipe `user_nav_prefs` rows and `user_nav_profile_groups` placements for that profile via FK. `user_custom_pages` and `user_nav_groups` are untouched. If the deleted profile was active, server nulls `users.active_nav_profile_id`, frontend falls back to Default on next read.

---

## Frontend changes

### `NavPrefsContext` (card 00121)

Add to state:
- `profiles: Profile[]`
- `activeProfileId: string` (from `users.active_nav_profile_id`, falls back to Default)
- `editingProfileId: string | null` (in-memory; non-null = edit mode)
- `dirty: boolean` (does draft differ from last-loaded?)

Add to API:
- `setEditingProfile(id)` — loads `/api/nav/prefs?profile=<id>` into draft, sets `editingProfileId`
- `saveEditing()` — PUT prefs + PUT activate, then refetch and clear `editingProfileId`
- `cancelEditing()` — clears draft + `editingProfileId`, falls back to active profile data
- `createProfile(label)`, `renameProfile(id, label)`, `deleteProfile(id)`, `reorderProfiles(ids[])`

When `editingProfileId === null`, the sidebar everywhere else in the app reads the active profile's prefs. When non-null, it could either (a) keep showing the active profile (recommended — predictable) or (b) preview the editing draft (showy but confusing). Recommend (a).

### Profile-bar component (card 00122)

Replace lines 1494–1500 of `app/(user)/preferences/navigation/page.tsx`. Component owns:
- Render profiles + Add button + (in edit mode) Save / Cancel
- Disabled states driven by `editingProfileId !== null`
- `⋯` menu for non-default profiles

CSS: extend the existing `.nav-prefs__quick-btn--active` rule already in `globals.css`. Add `.nav-prefs__quick-btn--locked` (greyed, no pointer) and rules for the inline Save/Cancel pair.

### Editor reactivity (card 00123)

- `setEditingProfile` triggers a clean reload of `bucketOrder`, `itemsByBucket`, `childrenByParent`, `customGroups`, `iconOverrides`, `startPageKey` — all derived from the newly fetched profile.
- Live sidebar updates on Save are automatic via shared context.
- Test matrix: switch from a profile with custom groups to one without; switch from many pins to none; delete the active profile and confirm fallback to Default.

---

## Caps

- 10 profiles per user (matches `user_nav_groups` cap).
- Profile label: 1–32 chars, trimmed, case-insensitive unique per user.
- Existing per-profile caps stay: 50 pinned, 10 custom groups, 8 children per parent, 64-char group label.

---

## Risks / things to watch

- **Reorder unique-index collision:** `PATCH /api/nav/profiles/order` must do a two-phase write (set all to negative offsets first, then to final values) or use a deferrable unique constraint. Standard pattern in this codebase already? Worth checking how `user_nav_prefs` position updates handle it.
- **Cascade delete of profile** wipes pins and custom groups but **not** `user_custom_pages` — pages survive and remain reachable in the catalogue/Available pool of remaining profiles. Document this in the delete confirmation copy.
- **Active-profile race:** if user has the editor open in two tabs and saves different profiles, last-write-wins on `users.active_nav_profile_id`. Acceptable.
- **`user_nav_groups` label uniqueness scope** changes from per-user to per-profile — migration must drop and recreate the index, and any seed/test fixtures that relied on the old scope need updating.
- **Backfill cost:** for tenants with many users who already have prefs, the backfill is a single INSERT-from-SELECT plus an UPDATE. Should be sub-second per tenant; confirm with `EXPLAIN` if the user table is large.
- **`requireOwnedProfile` helper** — every endpoint that accepts a `profile` param must verify the profile belongs to the calling `(user_id, subscription_id)` before any write. Easy to forget on the third or fourth endpoint. Add the helper in card 00119, reuse from 00120.

---

## Story breakdown — 14 stories for tracing

The original six cards (00118–00123) are too coarse for traceable progress. Replace them with the following decomposition. Dependencies are noted; everything within a layer can be done in parallel unless a dependency is called out.

### Schema (3 stories) — runs first; everything else depends on it

- [x] **S1 — SQL: create `user_nav_profiles` + `user_nav_profile_groups`.** Both new tables, indexes (one Default per user, position uniqueness, label uniqueness), check constraints (label 1–32, position ≥ 0), caps trigger or app-layer cap of 10 profiles.
- [x] **S2 — SQL: alter existing tables for profiles.** `user_nav_prefs.profile_id` SET NOT NULL + FK ON DELETE CASCADE. `users.active_nav_profile_id` UUID NULL + FK ON DELETE SET NULL. `user_nav_groups` is **not** altered.
- [x] **S3 — SQL: data migration script.** Insert one Default per user found in `user_nav_prefs ∪ user_nav_groups`; UPDATE prefs to set profile_id; INSERT `user_nav_profile_groups` rows from existing `user_nav_groups`; UPDATE `users.active_nav_profile_id`. Idempotent + dry-run mode via existing `cmd/migrate -dry-run` flag.

### Backend (6 stories) — S1–S3 must be merged first

- [x] **B1 — API: `requireOwnedProfile` helper.** `nav.RequireOwnedProfile(ctx, userID, subID, profileID) error` returns sentinel `ErrProfileNotFound`. Unit tests: owned-OK, wrong-user, wrong-tenant, missing. **Foundational — every other API story depends on this.**
- [x] **B2 — API: profiles CRUD.** `GET /api/nav/profiles`, `POST` (cap of 10, label 1–32, case-insensitive uniqueness), `PATCH /:id` (rejects `is_default`), `DELETE /:id` (rejects `is_default`, cascades).
- [x] **B3 — API: order + activate.** `PATCH /api/nav/profiles/order` with two-phase write to dodge unique-index collision. `PUT /api/nav/profiles/:id/activate` sets `users.active_nav_profile_id`.
- [ ] **B4 — API: extend prefs/start-page/bookmark with profile scope.** `?profile=` query param on `GET/PUT/DELETE /api/nav/prefs` and `GET /api/nav/start-page`. `profile_id` body field on `POST/DELETE /api/nav/bookmark` + `?profile=` on `/check`. Default behaviour when omitted: caller's active profile.
- [ ] **B5 — API: lazy-seed + role-aware Default.** First `GET /api/nav/prefs` for a user with no Default → server creates one, populates pins from catalogue's `defaultPinned ∧ roles ⊇ user.role`, picks role-appropriate `start_page_key`.
- [ ] **B6 — API: group-placement invariant on prefs PUT.** Reject any pin that references a `group_id` lacking a `user_nav_profile_groups` row for the target profile. On group placement removal, refuse if any pin still references it. Cleanup logic for orphans.

### Frontend context (2 stories) — depends on B-layer

- [ ] **C1 — Context: profiles + activeProfileId + mutators.** `profiles[]`, `activeProfileId` (read from auth bootstrap or `/api/nav/profiles`), `createProfile / renameProfile / deleteProfile / reorderProfiles`. No edit-mode logic yet — acts as read-only profile listing.
- [ ] **C2 — Context: edit-mode + dirty tracking.** `editingProfileId`, `setEditingProfile(id)`, `saveEditing()` (PUT prefs + PUT activate), `cancelEditing()` (revert to active), `dirty` boolean.

### Frontend bar UI (3 stories) — C-layer must exist

- [ ] **U1 — Bar: render + active highlight + edit-mode lockdown.** Replace `page.tsx:1494–1500`. Renders profiles in position order; active gets the white-bg/black-border style (already shipped); edit-mode disables non-active buttons + shows Save/Cancel. CSS: `.nav-prefs__quick-btn--locked` + Save/Cancel inline-pair styling.
- [ ] **U2 — Bar: + Add button + creation flow.** Trailing `+` opens inline label input; on submit calls `createProfile(label)`, then auto-enters edit mode for the new profile. Greys out when at cap. Default's button never gets Add affordance.
- [ ] **U3 — Bar: ⋯ menu (Rename + Delete with warning).** Non-default profiles get a `⋯` menu. Rename → inline editable label + PATCH on Enter. Delete → modal with full-width red-bordered warning banner using `--danger` / `--danger-bg`, copy: *"Deleting this profile removes its pinned layout only. Your custom pages and groups are not deleted — they go back to the Available pool and remain available to every other profile."* Confirm → DELETE; if active, falls back to Default on next read.

### Editor reactivity (2 stories)

- [ ] **E1 — Editor: clean draft rehydrate on profile switch + live sidebar.** `setEditingProfile` fully reloads `bucketOrder`, `itemsByBucket`, `childrenByParent`, `customGroups` (from `user_nav_profile_groups` + shared `user_nav_groups`), `iconOverrides`, `startPageKey`. On Save, sidebar elsewhere in app re-renders against new active profile (verify shared context wiring).
- [ ] **E2 — Editor: fallback-to-Default + e2e test matrix.** When active profile is deleted (own action or another tab), next read sees `active_nav_profile_id = NULL` and silently falls back to Default. E2E test matrix: switch with-groups → without-groups; switch many-pins → empty; delete the active profile; rename then switch; reorder profiles then refresh.

### Dependency graph

```
S1 ─┐
S2 ─┼─→ S3 ─→ B1 ─┬─→ B2 ─┬─→ C1 ─→ U1 ─→ U2 ─→ U3 ─┐
                  ├─→ B3 ─┘                          │
                  ├─→ B4 ─→ C2 ─────────────────────┤
                  ├─→ B5                             │
                  └─→ B6 ─────────────────────────────┴─→ E1 ─→ E2
```

Total: **14 stories** (was 6). Each lands in roughly the F2–F5 estimate range. Better burn-down visibility, smaller blast radius per merge, easier to slot work between sessions.
