# Plan — User Management Consolidation (B20.4)

**Created:** 2026-05-19
**Mode:** solo-dev (PLA counter frozen at PLA-0055; this doc replaces a numbered PLA file)
**Scope-tracker ref:** `B20.4` in [`Vector_Scope.md`](../../Vector_Scope.md)
**Origin chat:** 2026-05-19 session — Insurance-node POC + topology grant rendering bug → uncovered missing User Management surface.

---

## Why this plan exists

The current `/user-management` route is a flat list with an inline edit panel and a sibling `/permissions` page-access matrix. The topology-grants surface is a separate per-user URL (`/user-management/{userId}/topology-permissions`) reached via a button buried in the edit panel.

This is wrong shape for the procurement audience. Defence/finance buyers expect a single User Admin surface where every per-user action lives in one place, with bulk operations, structured data (cost centres, phone numbers), and demonstrable server-side authorisation on every filter and column.

This plan consolidates the existing pieces and adds the missing ones into a coherent User Admin section under `/user-management`, modelled on the artefacts tab-bar pattern at `/workspace-admin/artefacts/*`.

---

## HARD RULES (apply to every story)

1. **SERVER IS THE GATE** ([CLAUDE.md](../../.claude/CLAUDE.md) hard rule). Every column, every bulk action, every filter — server-side gate first, written and tested before the client renders anything. The wire payload must never contain data the caller isn't cleared to see. Frontend filtering is redundancy, not security.
2. **HUMAN ACCOUNTS ARE OFF LIMITS.** Bulk operations MUST filter `gadmin@`, `padmin@`, `user@` out of any mutation set. Confirm dialog tells the operator `"N of M will be updated (K protected accounts skipped)"`.
3. **Backend env is `dev`.** No staging/prod toggles touched.
4. **No assumed databases.** `users` and `users_roles` live in `mmff_vector` (pool). `topology_nodes` and `users_roles_topology_nodes` live in `vector_artefacts` (vaPool). Cost centres land in `mmff_vector` (subscription-scoped reference data).
5. **All authorisation re-checked server-side per request** — JWT identity + permission lookup + (where relevant) topology clamp predicate. No reliance on the previous turn's auth result.

---

## End-state IA

```
/user-management/                       ← redirects → /users
├── layout.tsx                          ← tab bar [Users] [Permissions]
├── page.tsx                            ← redirect("/user-management/users")
├── users/
│   └── page.tsx                        ← consolidated user list + inline edit-row panel
└── permissions/
    └── page.tsx                        ← existing role × page matrix (unchanged)
```

Deleted: `/user-management/[userId]/topology-permissions/` — its content folds into the inline edit-row panel on `/users`.

---

## Column spec (final) — `/users` table

In-row columns (always visible):

| # | Column | Source | Notes |
|---|---|---|---|
| 0 | ☐ Select | client state | Header = select-all-filtered (not-cross-page) |
| 1 | Avatar | `users.profile_image_url` (NULL → initials) | Small circle; Rally parity |
| 2 | User name | `users.email` | Login email; sole identity column |
| 3 | First name | `users.first_name` | |
| 4 | Last name | `users.last_name` | |
| 5 | Display name | `users.display_name` (new) | "Shown to others" name |
| 6 | Profile name | `users_nav_profiles.users_nav_profiles_label` via `users.active_nav_profile_id` | Active nav profile (e.g. "MMFFDev") |
| 7 | Department | `users.department` | |
| 8 | Subscription Permission | `users_roles.users_roles_label` via `users.role_id` | RBAC role label (Rally-aligned label) |
| 9 | Office Location | `users.office_location_id` (stub UUID column in B20.4.2; FK and dropdown source in deferred B20.4.7) | Renders blank/None until B20.4.7 ships |
| 10 | Password reset flag | `users.password_reset_required` (new boolean) | Renders state only; set-flag UI deferred |
| 11 | Disabled | `users.is_active` (read-only checkbox) | Toggle lives in edit-row panel only |
| 12 | Edit | inline expander | |

Edit-panel-only fields (not in row, accessible via row expansion):

### Account Information
- Middle name — `users.middle_name` (new)
- Phone (work) — `users.phone_work` (E.164, new)
- Phone (mobile) — `users.phone_mobile` (E.164, new)
- Disabled toggle — `users.is_active` (staged toggle; hard rule: locked for human accounts)

### Display Preferences
- Display name — `users.display_name` (also shown in row)
- (Profile image upload — deferred to B20.4.9)

### Settings
- Default workspace — `users.workspace_id` (already exists)
- Default scope node — `users.active_scope_node_id` (already exists)
- Timezone — `users.timezone` (mirrors tenant_timezone enum)
- Date format — `users.date_format` (mirrors tenant_date_format enum)
- Date+time format — `users.datetime_format` (mirrors tenant_datetime_format enum)
- Email notifications enabled — `users.email_notifications_enabled` (new boolean)
- Password expires (display only) — computed from `password_changed_at` + tenant policy
- (Session timeout per-user override — separate story under B16 Security & Auth)

### Administrative Fields
- Network ID — surface existing `users.ldap_dn` as "Network ID" label
- Cost centre — FK `users.cost_centre_id` → new `cost_centres` table (B20.4.3)
- Office location — FK `users.office_location_id` → new `office_locations` table (B20.4.7)

---

## Bulk-action bar

Renders above the table when ≥1 row selected. Actions, each with confirm:

| Action | Server endpoint | Audit |
|---|---|---|
| Assign topology… | Existing per-user `POST /topology/nodes/{nodeId}/roles` looped; new bulk endpoint `POST /_site/admin/users/bulk/topology-grant` once N > 20 | One `topology.grant_created` audit row per user |
| Set role… | `PATCH /_site/admin/users/{id}` looped; bulk endpoint later | One `users.role_changed` per user |
| Send password reset | `POST /_site/admin/users/{id}/reset-link` looped | One `auth.reset_link_issued` per user |
| Disable | `PATCH /_site/admin/users/{id}` looped | One `users.disabled` per user |
| Cancel | client only | none |

**Partial-success surface.** If 4 of 5 succeed and 1 fails, the 4 stay applied. Toast: `"4 of 5 updated — failed: alice@… (insufficient permission)"`. No transactional all-or-nothing across users.

---

## Story breakdown — 10 stories under B20.4

> **Open scoping question** (decide before starting story 7+): split into **B20.4 core** (stories 1–6) and **B20.5 procurement-grade refinements** (stories 7–10) to keep section size manageable. Default = stay as B20.4 for now; revisit when starting B20.4.7.

> **Onboarding-topology intent** — still open. If onboarding means "new user arrives with topology grants pre-attached during the invite flow," that's a new story under B20.4 (or B20.5) wiring the CreateUser modal to accept an initial topology-grant payload. Confirm scope before adding.

Solo-dev mode: each story = title + 1–3 line acceptance criteria, written into `Vector_Scope.md` under `B20.4`. Implementation order is the order listed — each one ships before the next starts.

### B20.4.1 — Tab-bar restructure (`/users` + `/permissions` siblings)
**AC:**
- `/user-management` redirects to `/user-management/users` (server `redirect()`).
- `/user-management/layout.tsx` renders horizontal tab bar `[Users] [Permissions]` cloned from `app/(user)/workspace-admin/artefacts/layout.tsx`.
- Existing list-with-inline-edit page moves to `/users/page.tsx` — no behaviour change yet.
- Page-catalogue migration: `pages.href` for `key_enum='user-management'` updates from `/user-management` → `/user-management/users` so the nav rail lands on the right page.

### B20.4.2 — Extended user fields migration (names, phones, display, settings, flags) + deferred stubs
**AC:**
- Migration adds real fields: `middle_name text`, `display_name text`, `phone_work text`, `phone_mobile text`, `timezone text`, `date_format text`, `datetime_format text`, `email_notifications_enabled boolean DEFAULT true`, `password_reset_required boolean DEFAULT false`.
- Migration adds **stub fields for deferred entities** so the schema is stable and forward-compatible: `cost_centre_id uuid NULL` (no FK yet — added in B20.4.3), `office_location_id uuid NULL` (no FK yet — added in B20.4.7), `profile_image_url text NULL` (asset pipeline deferred — added in B20.4.9). Each stub column has a `-- TD-STUB-<area>` comment in the migration so the deferred FK/management work stays visible.
- E.164 validation lives in `backend/internal/users/service.go` (regex `^\+[1-9]\d{1,14}$`), enforced on PATCH for both phone fields.
- Tenant settings enums for timezone / date_format / datetime_format reused — no duplicate enum lists.
- `/_site/admin/users/{id}` PATCH accepts new fields, rejects malformed phone with `400 phone.invalid_e164`. Stub fields accept NULL or string IDs but are not FK-enforced yet (caller responsibility until the referenced tables exist).
- Server-side: GET `/_site/admin/users` includes new fields in response only for callers with `users.admin.view` permission. Test pins the contract per role.
- Network ID is surfaced from existing `users.ldap_dn` field — no new column.

**Stub-field discipline (cross-cutting):** when a deferred story later adds the FK target table, the follow-up migration only needs to (a) backfill any existing string values into proper UUIDs and (b) add the `FOREIGN KEY (col) REFERENCES target(id)` constraint. No column rename, no shape change — the stub column already has the correct name and type. This keeps schema migrations forward-only and lets the UI bind to the final column name immediately.

### B20.4.3 — Cost centres entity (table + FK promotion + management UI)
**AC:**
- Migration creates `cost_centres (id, subscription_id, parent_id, code, name, is_active, archived_at, created_at, updated_at)` with `(subscription_id, code) UNIQUE WHERE archived_at IS NULL` partial index.
- Same migration **promotes the existing stub** `users.cost_centre_id` (added in B20.4.2) to a real FK: `ALTER TABLE users ADD CONSTRAINT users_cost_centre_id_fkey FOREIGN KEY (cost_centre_id) REFERENCES cost_centres(id) ON DELETE RESTRICT`. Any existing non-NULL values backfilled or nulled with a one-shot data migration before the FK is added.
- Backend `internal/costcentres` service: CRUD + tenant-scoped list + parent-id hierarchy enforcement.
- `/_site/admin/cost-centres` REST surface (gadmin + padmin only — `cost_centres.manage` permission code).
- New `/workspace-admin/cost-centres` page lists and CRUDs cost centres (gated by `cost_centres.manage`).
- User edit panel exposes a cost-centre dropdown (typeahead) populated from the same endpoint.

### B20.4.4 — Bulk multi-select + bulk-action bar (no new bulk endpoints — loop existing per-user)
**AC:**
- Leading checkbox column on `/users` table; header is tri-state (none / some / all-of-filtered).
- Bulk-action bar above the table appears when ≥1 selected: count, [Assign topology] [Set role] [Send reset] [Disable] [Cancel].
- Each action loops existing per-user endpoints in parallel (bounded concurrency 5).
- Toast surfaces partial-success counts; failed rows listed by email.
- Server-side: every per-user call re-checks `topology.grants.manage_others` / `users.admin.edit` independently — bulk is N independent gated calls, not one elevated call.
- Bulk action set automatically filters protected human accounts (`gadmin@mmffdev.com`, `padmin@mmffdev.com`, `user@mmffdev.com`) out of the mutation set and surfaces the skip count in the confirm dialog.

### B20.4.5 — Fold topology grants into the inline edit-row panel
**AC:**
- The existing `<UserNodeAssignment>` component renders inside the expanded edit-row on `/users`, replacing the "Manage topology permissions" link.
- The `[userId]/topology-permissions/page.tsx` route deletes; redirect `/user-management/[userId]/topology-permissions` → `/user-management/users` for any stale links.
- Per-grant role choice exposed (viewer/editor/admin) — the current code hard-codes `admin` (see [`page.tsx:115`](../../app/(user)/user-management/[userId]/topology-permissions/page.tsx#L115)).
- Server endpoint unchanged: `POST /topology/nodes/{id}/roles` accepts role in body, validated against the existing CHECK constraint.

### B20.4.6 — Password-reset-flag column rendering
**AC:**
- `/users` table renders a flag icon in the `Password reset` column when `users.password_reset_required = true`.
- Flag is read-only in this story; set/clear UI deferred to a future story.
- Server returns the flag only when the caller has `users.admin.view` permission.
- Test pins that for an unprivileged caller, the field is omitted from the response body entirely (not just hidden in the UI).

### B20.4.7 — Office locations structured entity `[P4 — deferred]`
**Deferred from initial B20.4 ship.** Added to plan to reserve the design; not in the first batch of work. The user edit panel's "Location" / "Office Location" field renders as free text or `None` until this story ships, at which point it becomes a dropdown driven by this list.

**Scope of management — vector-admin, not gadmin.** Vector admins (platform-level operators, `grp_global`) define the canonical office-locations list which then feeds the per-user dropdown across all tenants. This is a **subscription-scoped reference list maintained by vector admin**, not a tenant-managed list. Rationale: defence/finance buyers want consistent location values across the whole platform so audit reports group correctly; letting each tenant define its own list creates the same drift problem we're avoiding for cost centres.

**AC:**
- Migration creates `office_locations (id, parent_id, code, name, address, is_active, archived_at, created_at, updated_at)` — **no `subscription_id`** (platform-global). `(code) UNIQUE WHERE archived_at IS NULL` partial index.
- Same migration **promotes the existing stub** `users.office_location_id` (added in B20.4.2) to a real FK: `ALTER TABLE users ADD CONSTRAINT users_office_location_id_fkey FOREIGN KEY (office_location_id) REFERENCES office_locations(id) ON DELETE RESTRICT`. Existing non-NULL values backfilled or nulled before the FK is added.
- Backend `internal/officelocations` service: CRUD + parent-id hierarchy + active-only list endpoint.
- `/_site/vector-admin/office-locations` REST surface gated by new `office_locations.manage` permission code — assigned to `grp_global` only (vector admin), not tenant gadmins.
- New `/vector-admin/office-locations` page lists and CRUDs office locations (gated by `office_locations.manage`, vector-admin-only nav entry).
- User edit panel office-location dropdown switches from blank to populated from `/_site/office-locations` (read-only endpoint available to any authenticated user for the typeahead; write endpoint stays vector-admin-only).
- Server-side: write endpoints reject any caller that is not `grp_global`; read endpoint returns active-only records and never includes archived ones in the public list.

### B20.4.8 — Inline edit-row panel sections (IA)
**AC:**
- Edit-row panel renders four sections with section headers: **Account Information** / **Display Preferences** / **Settings** / **Administrative Fields**.
- Field-to-section mapping per the column-spec block above.
- Each section visually distinct (panel header + body), no inline `style={{}}`, uses catalog CSS classes.
- Server-side: PATCH `/_site/admin/users/{id}` accepts any subset of fields; missing fields are not mutated. Field-by-field permission gate applied (e.g. cost-centre changes require `cost_centres.assign`).

### B20.4.9 — Profile image upload `[P4 — deferred]`
**AC:**
- Column already exists as a stub (`users.profile_image_url text NULL`) added in B20.4.2. This story implements the upload pipeline that populates it.
- Upload endpoint `POST /_site/users/{id}/profile-image` accepting multipart/form-data, max 2 MB, image/png + image/jpeg only, MIME-sniff verified server-side (not just content-type header).
- Image stored under tenant-scoped path; signed URL minted on read.
- Delete endpoint `DELETE /_site/users/{id}/profile-image` clears the field and removes the asset.
- Avatar column on `/users` list renders the image when present; initials fallback when not.
- Server-side: image bytes scanned by `clamd` (or equivalent) if procurement requires; otherwise basic MIME-sniff only — flag for buyer-profile review before shipping.
- Audit row `users.profile_image_changed` on every upload/delete.

### B20.4.10 — Disabled column read-only checkbox (Rally pattern)
**AC:**
- `/users` table renders the Disabled state as a read-only checkbox column (no inline toggle action on the list page).
- The actual disable toggle action lives only in the edit-row panel, where it's staged with the existing confirm-changes UX.
- Server-side check unchanged: PATCH `is_active = false` still requires `users.admin.edit` and is rejected for protected human accounts.
- Reduces accidental-disable risk by separating display from mutation.

---

## Cross-cutting non-functional requirements

### Authorisation contract tests (per story, server-side)

For every endpoint touched, the test surface must include at least:

1. **Allowed role + correct data**: gadmin GETs `/admin/users` → 200 + full extended-field set.
2. **Disallowed role + filtered data**: padmin GETs `/admin/users` → 200 but extended PII fields (phone, cost centre) absent from payload.
3. **Forbidden role + 403**: user role GETs `/admin/users` → 403.
4. **Cross-tenant isolation**: gadmin from subscription A GETs `/admin/users?subscription=B` → 403 or empty result (whichever matches the existing tenancy model — never a leak).

### Audit trail

Every per-user mutation emits one `audit_events` row keyed on `user_id` (target) + `actor_id` (caller) + `action` (e.g. `users.role_changed`). Bulk actions emit N individual rows, not one batch row — procurement queries audit logs per-user.

### Migration discipline

- One forward + reverse migration per phase: `down.sql` exists, dry-run script ([`dev/scripts/dry_run_migration.sh`](../../dev/scripts/dry_run_migration.sh)) green.
- `cost_centres` migration: forward = CREATE TABLE + add FK column; reverse = DROP FK + DROP TABLE. No data backfill (table starts empty).
- Extended-fields migration: forward = ADD COLUMN with default; reverse = DROP COLUMN. Schema-compatible — old code keeps working.

### Hot paths flagged for awareness (do not regress)

- `/users` list page replaces `/user-management` — every nav-pref row referencing the old href needs the catalogue migration applied first.
- `users_nav_profiles` joined into the admin user list — verify perf with EXPLAIN; consider a covering index on `(active_nav_profile_id, subscription_id)` if N > 10k users.
- Topology grant POST loops in bulk: bounded concurrency 5 to keep audit-log write rate under control.

---

## Definition of done (whole plan)

- All six stories shipped to `dev`.
- `/user-management` is the tab-bar landing; `/users` and `/permissions` siblings work.
- The page-catalogue migration applied; nav rail lands on `/users`.
- Inline row panel includes profile, role, extended fields, cost centre, topology grants, password reset, disable.
- Bulk-action bar works with partial-success reporting.
- Old `[userId]/topology-permissions` route removed.
- Authorisation contract tests pass for gadmin / padmin / user / external on every endpoint touched.
- One `audit_events` row per per-user mutation in test runs.
- TD entries opened for any deferred work surfaced during implementation.

---

## Out of scope (parked, not in this plan)

- **Restricted-node mechanism** (`topology_nodes.is_restricted` + clamp filter) — separately stories under B6.x once this plan ships. The `<topology>` admin needs its own page changes; not in the User Admin surface.
- **Set-the-password-reset-flag UI** — column renders the state; the action that sets it (e.g. "Force password change next login") is a future story under B16.x (auth).
- **Padmin pathway for topology grant management** — currently gadmin-only via `topology.grants.manage_others`. Workspace-scoped delegation is a separate auth-model design.
- **Bulk endpoint optimisation** — when bulk operations hit performance ceiling (loops exceed N=20 users or audit-log write burst exceeds 100/s), introduce real bulk endpoints. Deferred until measured.
