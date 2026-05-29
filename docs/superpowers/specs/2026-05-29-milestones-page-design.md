# Milestones Page — design

**Date:** 2026-05-29
**Status:** Draft, pending implementation plan
**Drives:** addition of `/milestones` user-facing page, gap-closure on the existing `timeboxes_milestones` substrate.

---

## Summary

Add a `/milestones` page to the Planning rail bucket that mirrors the Sprints page in shape and interaction. The DB table (`timeboxes_milestones`), FK on `artefacts`, and backend writer service (`backend/internal/timeboxmilestones`) already exist and are fully wired into the router. The work is purely **frontend + nav registration** — extending two existing components to accept a third `kind`, adding the page route, and seeding the nav entry.

Milestones are intentionally **shaped differently from sprints**: a milestone is a point-in-time delivery marker (single target date, no cadence/velocity/scope/creep). The existing `timeboxes_milestones` schema reflects that. This design preserves the simpler shape rather than verbatim-cloning every sprint field.

---

## Discovery — what already exists

| Component | Status | Notes |
|---|---|---|
| `timeboxes_milestones` table | ✅ Exists | Migrations 085 + 087; full §2.3/§2.4 column prefix convention |
| `artefacts.artefacts_id_timebox_milestone` FK | ✅ Exists | Added in 084, FK bound in 085, renamed to convention in 087 |
| `backend/internal/timeboxmilestones/` | ✅ Exists | Full CRUD service + handler (no tests) |
| Routes mounted | ✅ Both `/_site` and `/samantha/v2` | `main.go:1691`, `main.go:2310` |
| `TimeboxObjectTree` | ⛔ Sprint+Release only | KIND_CFG hardcoded to two kinds |
| `TimeboxInlineForm` | ⛔ Sprint+Release only | Same gap |
| `/milestones` page route | ⛔ Missing | No file at `app/(user)/milestones/page.tsx` |
| Nav `pages` row | ⛔ Missing | No row with `pages_key_enum='milestones'` |
| Tests for `timeboxmilestones` service | ⛔ Missing | Pre-existing gap, deferred to TD register |

---

## What this build IS

### Frontend slice 1 — `TimeboxObjectTree` gains `kind="milestone"`

File: `app/components/TimeboxObjectTree/index.tsx`

- Extend `Kind` union: `"sprint" | "release" | "milestone"`.
- Add KIND_CFG entry:
  ```ts
  milestone: {
    apiBase: "/timeboxes/milestones",
    rowPrefix: "timeboxes_milestones",
    namePrefix: "Milestone",
    listKey: "milestones",
  }
  ```
- **Column set** — when `kind === "milestone"`, render a different column array (no Start/End/Cadence/Scope/Velocity):
  - Name (`timeboxes_milestones_name`) — with the existing inherited-row treatment (italic + "↑ from parent" badge) preserved
  - Target Date (`timeboxes_milestones_date_target`) — mono, sortable
  - Status pill (`timeboxes_milestones_status`) — variants: planned (info), active (success), completed (neutral), missed (warning)
  - Created (`timeboxes_milestones_created_at`) — mono date
- **Search** — by `timeboxes_milestones_name` only (no suffix field exists on milestones).
- **Bulk-create wizard** — skipped for milestones. The `ActionBar` shows only a single "Create Milestone" button (mode `single`), no `mode: "bulk"` entry. The `ObjectTreeBulkCreateSheet` is not mounted when `kind === "milestone"`.
- **Single-create** — opens a minimal inline sheet with: Name (required), Target Date (required), Description (optional), Status (defaults to "planned"). Reuses the existing `TimeboxInlineForm` shell with the new kind. (Implementation note: the current sprints implementation routes "single create" through the bulk sheet with `defaultCount: 1, maxCount: 1` as a stopgap — for milestones we land a true single-row inline form directly. If that's too much scope for this slice, we use the same stopgap and add `TD-MILESTONES-SINGLE-CREATE` to pay down later. Decided during implementation plan.)
- **Inherited-row support** — preserve; the backend's ancestor-walk pattern is already implemented in `timeboxsprints` and `timeboxreleases`. **Open question**: verify `timeboxmilestones.service.go` performs the same ancestor walk; if not, that's a separate small slice (out of scope for this design — milestones currently are pinned to a specific node, so until propagation is wired the field renders blank and the inherited-row code path is dormant).

### Frontend slice 2 — `TimeboxInlineForm` gains `kind="milestone"`

File: `app/components/TimeboxInlineForm/index.tsx`

- Extend `Kind` union and KIND_CFG with the milestone entry (same shape as TimeboxObjectTree's).
- Replace `EditableState` shape for `kind === "milestone"`:
  ```ts
  { name, description, date_target, status }
  ```
  (Sprint/Release shape is `{ suffix, cadence_days, date_start, date_end, velocity }` — not applicable.)
- The form's diff/PATCH machinery already keys off the kind config — wire keys stay correct by construction (`timeboxes_milestones_name` etc).

### Frontend slice 3 — Page route

File: `app/(user)/milestones/page.tsx` (NEW)

Copy `app/(user)/sprints/page.tsx` verbatim, with these substitutions:

```tsx
"use client";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { StrictRoute } from "@/app/contexts/DomRegistryContext";
import { useSentinel } from "@/app/sentinel";
import TimeboxObjectTree from "@/app/components/TimeboxObjectTree";
import { usePageTitle } from "@/app/hooks/usePageTitle";

export default function MilestonesPage() {
  const { full } = usePageTitle();
  const { sentinel_user: user, sentinel_focus_node: activeNodeId } = useSentinel();
  const workspaceId = user?.tenant_id ?? "";

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="Track milestones and target dates for the workspace."
      />
      <PageDescription>
        Create and manage milestones — point-in-time delivery markers anchored
        to a topology node. Pin a node in the rail above before creating.
      </PageDescription>
      <StrictRoute>
        {workspaceId && activeNodeId && (
          <TimeboxObjectTree
            key={activeNodeId}
            kind="milestone"
            workspaceId={workspaceId}
            orgNodeId={activeNodeId}
          />
        )}
        {workspaceId && !activeNodeId && (
          <Panel
            name="panel_milestones_no_focus_node"
            title="Pick a topology node"
            description="Milestones belong to a team / squad / value-stream node — focus one in the rail above to list its milestones or create new ones."
          />
        )}
      </StrictRoute>
    </PageContent>
  );
}
```

**Required-topology-node gate** matches the Sprints page (Rick's answer to the scope question). Releases use the optional pattern; milestones use the stricter sprint-style pattern.

### Migration slice — Nav registration

File: `db/vector_artefacts/schema/158_milestones_page.sql` (NEW)
File: `db/vector_artefacts/schema/down/158_milestones_page_DOWN.sql` (NEW)

(Numbering: highest existing slot on disk is 157 — the Rally-fields workstream landed 150–157 uncommitted. Next free slot is **158**. If the Rally migrations are committed/applied between spec-writing and migration-writing, the writing-plans pass re-checks and bumps if needed.)

The migration runs in `vector_artefacts` (post-fold home of the nav cluster — see HARD RULE on DB routing). Schema shape, table names, and column names are the post-fold `pages_*`-prefixed forms — pre-fold seed migrations (129, 138) in `mmff_vector/` are reference-only because they target the old bare-column schema.

```sql
BEGIN;

-- 1. Register the page row.
INSERT INTO pages (
    pages_key_enum,
    pages_label,
    pages_href,
    pages_icon,
    pages_tag_enum,
    pages_kind,
    pages_pinnable,
    pages_default_pinned,
    pages_default_order
) VALUES (
    'milestones',
    'Milestones',
    '/milestones',
    'flag',
    'planning',
    'static',
    TRUE,
    TRUE,
    9
)
ON CONFLICT (pages_key_enum)
  WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL
  DO NOTHING;

-- 2. Grant to user, padmin, gadmin roles.
--    Role IDs are stable system seeds:
--      user:   00000000-0000-0000-0000-00000000ad10
--      padmin: 00000000-0000-0000-0000-00000000ad25
--      gadmin: 00000000-0000-0000-0000-00000000ad30
INSERT INTO users_roles_pages (
    users_roles_pages_id_page,
    users_roles_pages_id_role
)
SELECT
    p.pages_id,
    r.role_id
FROM pages p
CROSS JOIN (VALUES
    ('00000000-0000-0000-0000-00000000ad10'::uuid),
    ('00000000-0000-0000-0000-00000000ad25'::uuid),
    ('00000000-0000-0000-0000-00000000ad30'::uuid)
) AS r(role_id)
WHERE p.pages_key_enum         = 'milestones'
  AND p.pages_id_subscription  IS NULL
  AND p.pages_id_user_creator  IS NULL
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role)
  DO NOTHING;

-- 3. Backfill — pin Milestones into every existing nav profile for every
--    eligible user (mirrors migration 129/138's backfill block, post-split).
--    Note the post-141 split: pinned + bookmarks live in separate tables.
INSERT INTO users_nav_pinned (
    users_nav_pinned_id_user,
    users_nav_pinned_id_subscription,
    users_nav_pinned_id_profile,
    users_nav_pinned_item_key,
    users_nav_pinned_position
)
SELECT
    u.users_id,
    u.users_id_subscription,
    pr.users_nav_profiles_id,
    'milestones',
    COALESCE(
        (SELECT MAX(np.users_nav_pinned_position) + 1
           FROM users_nav_pinned np
          WHERE np.users_nav_pinned_id_user         = u.users_id
            AND np.users_nav_pinned_id_subscription = u.users_id_subscription
            AND np.users_nav_pinned_id_profile      = pr.users_nav_profiles_id),
        0
    )
FROM users u
JOIN users_nav_profiles pr
  ON pr.users_nav_profiles_id_user         = u.users_id
 AND pr.users_nav_profiles_id_subscription = u.users_id_subscription
WHERE NOT EXISTS (
    SELECT 1 FROM users_nav_pinned np
     WHERE np.users_nav_pinned_id_user         = u.users_id
       AND np.users_nav_pinned_id_subscription = u.users_id_subscription
       AND np.users_nav_pinned_id_profile      = pr.users_nav_profiles_id
       AND np.users_nav_pinned_item_key        = 'milestones'
);

COMMIT;
```

**Implementation-plan verification points** (before applying):
1. Confirm the exact post-fold `users_nav_pinned` column names (above is the expected shape from migration 141's split; verify against actual schema before running).
2. Confirm the role UUID seeds match what's live (a quick `SELECT users_roles_id, users_roles_role_enum FROM users_roles WHERE users_roles_role_enum IN ('user','padmin','gadmin')` will confirm).
3. Confirm `pages` ON CONFLICT arbiter syntax matches the actual partial-unique-index in 117 (the index is `pages_key_enum_system_unique` ON `(pages_key_enum) WHERE pages_id_subscription IS NULL AND pages_id_user_creator IS NULL`).

The DOWN migration:
- Deletes the `users_nav_pinned` rows where `users_nav_pinned_item_key = 'milestones'`.
- Deletes the `users_roles_pages` rows where the joined `pages_key_enum = 'milestones'`.
- Deletes the `pages` row where `pages_key_enum = 'milestones'` AND system-scope.

---

## What this build IS NOT

| Excluded | Why |
|---|---|
| New `timeboxes_milestones` table | Already exists with the correct shape (migrations 085 + 087). |
| New backend writer service | `timeboxmilestones` exists, full CRUD, mounted on the router. |
| Bulk-create wizard for milestones | Milestones have no cadence-cascade — there's no useful default sequence rule for "create N milestones at once". Single-create only. |
| `Notes` column | Rally's screenshot shows a Notes field; current `timeboxes_milestones` has Description but not Notes. Deferred to TD register (Rick chose "Skip Notes for now"). |
| Cadence / velocity / scope / creep / suffix fields | Conceptually wrong for a point-in-time marker. The table doesn't have these columns and that's intentional. |
| Sprint-style `no_overlap` GIST exclusion | Milestones have no date range to overlap on. The current table doesn't define one and shouldn't. |
| Backend tests for `timeboxmilestones` | Pre-existing gap (service was shipped without tests). Deferred to TD register; flagged as a buyer-readiness blocker, not a feature-gate. |
| Propagation / ancestor-walk for milestones | Out of scope. The required-topology-node gate means every milestone is pinned; until propagation is wired, the inherited-row code path in `TimeboxObjectTree` stays dormant for `kind="milestone"`. Will get its own design if Rick wants milestone heartbeats. |

---

## Tech-debt added by this build

Entries to add to `docs/c_tech_debt.md` during implementation:

- **TD-MILESTONES-NOTES** — Rally surface has a `Notes` long-form field this build skipped (DB column not added, form doesn't render one). **S2**. Trigger to pay: first user request for Notes, or before any external demo of the milestone detail flyout. Pay-down: one migration adding `timeboxes_milestones_notes TEXT`, plus form field.
- **TD-MILESTONES-BACKEND-TESTS** — `backend/internal/timeboxmilestones/` ships with zero test coverage (handler + service + sql). **S2**. Pre-existed this build but loudens once the page is live. Trigger: before any change to the service, or before this surface is shown to a buyer. Pay-down: mirror the test files in `timeboxsprints/` (`service_test.go`, `handler_test.go`).
- **TD-MILESTONES-SINGLE-CREATE** — IF the implementation plan chooses to reuse the sprint single-create stopgap (open the bulk sheet with `defaultCount: 1, maxCount: 1`), record that as debt. **S3**. Trigger: when adding any other kind that doesn't have a bulk-create path. Pay-down: extract a `<TimeboxInlineSingleCreate>` shell that all three kinds can use.

---

## Test plan (manual; no automation in this slice)

1. **Migration applies cleanly.** Run `<migration>` against vector_artefacts. Verify `schema_migrations` records 158 (or the bumped slot if Rally migrations advance the counter further by build time).
2. **Nav appears.** Sign in as `user@mmffdev.com`. Open the rail. Expect a "Milestones" entry in the Planning bucket, after Releases, with the flag icon.
3. **Page loads with no node focused.** Click Milestones in the rail with no topology node focused. Expect the "Pick a topology node" panel.
4. **Page loads with a node focused.** Focus a topology node. Expect the `TimeboxObjectTree` grid, "V2" badge, empty state "No milestones found."
5. **Single create.** Click "Create Milestone". Enter Name + Target Date. Submit. Expect the row to appear in the grid with status pill "planned".
6. **Edit.** Click the row name. Detail flyout opens via `TimeboxInlineForm`. Change the Target Date. Save. Expect optimistic merge in the grid.
7. **Status transition.** In the flyout, change status to "active", then "completed", then "missed". Each saves and the pill recolours.
8. **Archive.** Trigger archive via flyout. Row disappears from the grid.
9. **Cross-role visibility.** Sign in as `padmin@mmffdev.com` then `gadmin@mmffdev.com`. Both see the Milestones nav entry.
10. **Topology node binding survives reload.** Reload while on `/milestones` with a node focused; the same node stays focused, the same list reloads.

---

## Risks / open issues for the implementation plan to resolve

1. **Post-fold nav-table column names.** This spec encodes the expected `users_nav_pinned_*` shape from migration 141's split, but the implementation must `\d users_nav_pinned` against live before applying the migration. If column names differ, the migration adjusts before `BEGIN`.
2. **Role-grant ON CONFLICT arbiter.** The composite PK on `users_roles_pages (id_page, id_role)` is the expected arbiter; verify via `\d users_roles_pages`.
3. **`pages` ON CONFLICT arbiter syntax.** Need to verify that `ON CONFLICT (pages_key_enum) WHERE ...` matches the actual partial unique index name; if the index name is the only valid arbiter, switch to `ON CONFLICT ON CONSTRAINT pages_key_enum_system_unique`.
4. **Cascade triggers.** Migration 142 wires after-split nav-cascade triggers. Adding a new pinned row for an existing page-key should be inert (the trigger fires on `pages` writes, not `users_nav_pinned` writes); verify by reading 142 before applying.

These are migration-implementation concerns, not design concerns — they're recorded here so the writing-plans pass surfaces them as plan checkpoints rather than discovering them at apply time.

---

## Out-of-band notes for the user (Rick)

- Rally's image-attached field list includes ID + Creation Date as displayed columns. Both are present on the row but neither makes the grid in this design — IDs aren't user-readable surrogates here (no `MIL-NNNNN` minted), and Creation Date is rarely the sort users want first. If you want them on the grid, name it and I'll add them as columns (no schema work needed; the data is already on the wire).
- The sprint single-create UX is currently the bulk sheet with count=1 (intentional stopgap noted in `TimeboxObjectTree/index.tsx:340`). Calling that out so we make a conscious choice for milestones rather than inherit-by-accident.
