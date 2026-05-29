# Milestones Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/milestones` page to the Planning rail bucket, replicating the Sprints page surface against the existing `timeboxes_milestones` table + backend service. Two existing components (`TimeboxObjectTree`, `TimeboxInlineForm`) gain a third `kind="milestone"` branch; one new page route; one new DB migration that registers the page + grants + pins it.

**Architecture:** Frontend-only + nav-seed; no new tables, no new Go services. Extends the two timebox composer components by adding a third entry to their KIND_CFG maps and a kind-aware column/field set for milestones. The new page mirrors `app/(user)/sprints/page.tsx` with the same required-topology-node gate. The migration runs in `vector_artefacts` (post-fold home of the `pages` + `users_nav_pinned` cluster) and uses code-based role lookup (`users_roles_code IN ('user','padmin','gadmin')`) rather than the deprecated hardcoded role UUIDs from pre-fold seed migrations.

**Tech Stack:** Next.js 14 App Router (frontend, `app/(user)/...`), React + TS components in `app/components/`, Go chi backend (already wired, no changes needed), PostgreSQL migrations via the `<migration>` skill against the `vector_artefacts` DB.

---

## Spec reference

This plan implements: [`docs/superpowers/specs/2026-05-29-milestones-page-design.md`](../specs/2026-05-29-milestones-page-design.md)

Open issues that the spec flagged for verification-at-plan-time, resolved here in the plan:

1. **Post-fold `users_nav_pinned` column shape** — confirmed from migration 141. Columns used in the seed: `users_nav_pinned_id_user`, `users_nav_pinned_id_subscription`, `users_nav_pinned_id_profile`, `users_nav_pinned_item_key`, `users_nav_pinned_position`. The `users_nav_pinned_id` PK defaults to `gen_random_uuid()` — not specified in INSERT.
2. **`pages` ON CONFLICT arbiter** — confirmed from migration 117. The system-scope unique index is `pages_key_enum_system_unique` (partial: `WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL`). Use `ON CONFLICT ON CONSTRAINT` form since `ON CONFLICT (cols) WHERE (...)` matches the partial-index predicate, but the constraint-name form is the most portable.
3. **Role grant lookup** — DO NOT use hardcoded UUIDs (`00000000-0000-0000-0000-00000000ad10` etc) — those were the pre-fold mmff_vector seeds. Post-fold `users_roles` table is keyed by `users_roles_code` text + `users_roles_is_system = TRUE`. The seed joins on code.
4. **Cascade triggers (migration 142)** — fire on `pages` write events to propagate role-grant changes to pinned/bookmark rows. They DO NOT interfere with adding a new page row + manually backfilling its pins; they only act on `users_roles_pages` mutations after the fact. Safe.
5. **Single-create UX** — Sprint page routes "Create Sprint" through the bulk sheet with `defaultCount: 1, maxCount: 1` (intentional stopgap at `TimeboxObjectTree/index.tsx:340-353`). For milestones we adopt the SAME stopgap to avoid expanding scope. TD entry `TD-MILESTONES-SINGLE-CREATE` records this. The bulk sheet is built generically and accepts the milestone column shape (name + date + optional description) without changes to the sheet itself.

---

## File Structure

**New files (3):**
- `app/(user)/milestones/page.tsx` — Next.js App Router page, mirror of `app/(user)/sprints/page.tsx`. Single responsibility: mount `<TimeboxObjectTree kind="milestone">` inside the user-route shell with the required-topology-node gate.
- `db/vector_artefacts/schema/158_milestones_page.sql` — registers the `milestones` system page, grants user/padmin/gadmin via code lookup, backfills `users_nav_pinned` rows for existing profiles.
- `db/vector_artefacts/schema/down/158_milestones_page_DOWN.sql` — symmetric rollback.

**Modified files (2):**
- `app/components/TimeboxObjectTree/index.tsx` — extend `Kind` union + `KIND_CFG`, add milestone-specific column array, add milestone-specific bulk-config builder, swap inherited-row rendering to be kind-agnostic where needed (it already is — only the column key changes).
- `app/components/TimeboxInlineForm/index.tsx` — extend `Kind` union + `KIND_CFG`, add milestone-specific `EditableState` shape + extract/diff/render branches.

**No backend changes.** `backend/internal/timeboxmilestones/` is already complete + mounted on the router at both `/_site/timeboxes/milestones` and `/samantha/v2/timeboxes/milestones`.

**No new tests in this plan.** Pre-existing TD: `timeboxmilestones` has zero test coverage. This plan does NOT add tests for the new frontend code either — `TimeboxObjectTree` + `TimeboxInlineForm` have no unit-test scaffolding today, and adding one for milestones-only would be a one-off. The spec's TD register has `TD-MILESTONES-BACKEND-TESTS` covering the backend gap; a sibling `TD-TIMEBOX-FRONTEND-TESTS` is added to cover the frontend gap symmetrically. Manual test plan from the spec is the verification surface for this build.

---

## Task ordering rationale

The migration goes FIRST because:
- It's the most error-prone surface (post-fold schema names, role-lookup translation, partial-index arbiter).
- Running it gives us a live `/milestones` nav entry that 404s — which is a useful integration smoke before the frontend lands.
- Frontend slices are cheap to revert; an applied migration is harder.

Frontend slices land in dependency order: `TimeboxInlineForm` first (the form is loaded by the grid's flyout), then `TimeboxObjectTree`, then the page route that mounts both.

---

## Task 1: Migration — register `/milestones` page + grants + pins

**Files:**
- Create: `db/vector_artefacts/schema/158_milestones_page.sql`
- Create: `db/vector_artefacts/schema/down/158_milestones_page_DOWN.sql`

**Pre-check (run before writing the migration):**

- [ ] **Step 1: Confirm 158 is still the next free slot**

Run: `ls db/vector_artefacts/schema/ | grep -E '^[0-9]+_' | sed 's/_.*//' | sort -n | tail -3`

Expected: highest number is 157. If higher (Rally workstream advanced), bump THIS plan's migration number accordingly (159, 160, …) — the file content does not change, only the filename + the `schema_migrations` row.

- [ ] **Step 2: Confirm the role codes are seeded and `is_system = TRUE`**

Run the dev-DB query via the pg-mcp wrapper or the backend API (per HARD RULE: don't ask the user, query directly):
```bash
PGPASSWORD="$(grep DB_PASSWORD backend/.env.dev | cut -d= -f2)" \
  psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
  -c "SELECT users_roles_id, users_roles_code, users_roles_is_system FROM users_roles WHERE users_roles_code IN ('user','padmin','gadmin') AND users_roles_is_system = TRUE ORDER BY users_roles_code;"
```

Expected: three rows, one per code, each with `users_roles_is_system = t`. If a row is missing, STOP — the migration depends on these. Surface the gap.

- [ ] **Step 3: Confirm the `pages_key_enum_system_unique` partial-index exists**

```bash
PGPASSWORD="$(grep DB_PASSWORD backend/.env.dev | cut -d= -f2)" \
  psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
  -c "\d+ pages" | grep -A 1 "pages_key_enum_system_unique"
```

Expected: line showing `UNIQUE, btree (pages_key_enum) WHERE pages_id_user_creator IS NULL AND pages_id_subscription IS NULL`.

- [ ] **Step 4: Write the migration**

Create `db/vector_artefacts/schema/158_milestones_page.sql` with this content:

```sql
-- ============================================================
-- 158_milestones_page.sql
--
-- Register /milestones as a system page in the Planning rail bucket,
-- grant user/padmin/gadmin roles, and pin it into every existing
-- nav profile so the rail picks it up without a logout/login.
--
-- Mirrors the sprints (129) + releases (138) seed pattern, translated
-- to the post-fold schema:
--   - pages (post-fold column prefixes pages_*)
--   - users_roles_pages with code-based role lookup (no hardcoded UUIDs)
--   - users_nav_pinned (post-141 split from users_nav_prefs)
--
-- WHY:
--   The /milestones page (implementation plan 2026-05-29-milestones-page.md,
--   spec 2026-05-29-milestones-page-design.md) closes the frontend gap over
--   the existing timeboxes_milestones table + backend service. Without
--   this page row + grants + pins, the route exists in Next.js but is
--   invisible in the rail.
--
-- IDEMPOTENCY:
--   - pages: ON CONFLICT ON CONSTRAINT pages_key_enum_system_unique DO NOTHING.
--   - users_roles_pages: ON CONFLICT (composite PK) DO NOTHING.
--   - users_nav_pinned: WHERE NOT EXISTS guard on (user, sub, profile, item_key).
--
-- ROLLBACK:
--   db/vector_artefacts/schema/down/158_milestones_page_DOWN.sql
-- ============================================================

BEGIN;

-- ── 1. Register the page row. ───────────────────────────────────
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
ON CONFLICT ON CONSTRAINT pages_key_enum_system_unique DO NOTHING;

-- ── 2. Grant to user / padmin / gadmin via code lookup. ─────────
INSERT INTO users_roles_pages (
    users_roles_pages_id_page,
    users_roles_pages_id_role
)
SELECT
    p.pages_id,
    r.users_roles_id
FROM pages p
CROSS JOIN users_roles r
WHERE p.pages_key_enum         = 'milestones'
  AND p.pages_id_subscription  IS NULL
  AND p.pages_id_user_creator  IS NULL
  AND r.users_roles_code       IN ('user','padmin','gadmin')
  AND r.users_roles_is_system  = TRUE
ON CONFLICT (users_roles_pages_id_page, users_roles_pages_id_role) DO NOTHING;

-- ── 3. Backfill into existing nav profiles. ─────────────────────
--    Position = current max + 1 for the profile, or 0 if none.
INSERT INTO users_nav_pinned (
    users_nav_pinned_id_user,
    users_nav_pinned_id_subscription,
    users_nav_pinned_id_profile,
    users_nav_pinned_item_key,
    users_nav_pinned_position
)
SELECT
    pr.users_nav_profiles_id_user,
    pr.users_nav_profiles_id_subscription,
    pr.users_nav_profiles_id,
    'milestones',
    COALESCE(
        (SELECT MAX(np.users_nav_pinned_position) + 1
           FROM users_nav_pinned np
          WHERE np.users_nav_pinned_id_user         = pr.users_nav_profiles_id_user
            AND np.users_nav_pinned_id_subscription = pr.users_nav_profiles_id_subscription
            AND np.users_nav_pinned_id_profile      = pr.users_nav_profiles_id),
        0
    )
FROM users_nav_profiles pr
WHERE NOT EXISTS (
    SELECT 1
      FROM users_nav_pinned np
     WHERE np.users_nav_pinned_id_user         = pr.users_nav_profiles_id_user
       AND np.users_nav_pinned_id_subscription = pr.users_nav_profiles_id_subscription
       AND np.users_nav_pinned_id_profile      = pr.users_nav_profiles_id
       AND np.users_nav_pinned_item_key        = 'milestones'
);

COMMIT;
```

- [ ] **Step 5: Write the DOWN migration**

Create `db/vector_artefacts/schema/down/158_milestones_page_DOWN.sql`:

```sql
-- ============================================================
-- 158_milestones_page_DOWN.sql
--
-- Reverse of 158_milestones_page.sql. Deletes inner-most first so
-- the page row drops cleanly at the end.
-- ============================================================

BEGIN;

-- ── 1. Remove pinned rows for this page key. ────────────────────
DELETE FROM users_nav_pinned
 WHERE users_nav_pinned_item_key = 'milestones';

-- ── 2. Remove role grants for the system 'milestones' page. ─────
DELETE FROM users_roles_pages
 WHERE users_roles_pages_id_page IN (
    SELECT pages_id FROM pages
     WHERE pages_key_enum        = 'milestones'
       AND pages_id_subscription IS NULL
       AND pages_id_user_creator IS NULL
 );

-- ── 3. Remove the page row. ─────────────────────────────────────
DELETE FROM pages
 WHERE pages_key_enum        = 'milestones'
   AND pages_id_subscription IS NULL
   AND pages_id_user_creator IS NULL;

COMMIT;
```

- [ ] **Step 6: Apply the migration via the `<migration>` skill**

Invoke `<migration>` and confirm:
- Target DB: `vector_artefacts` (per the HARD RULE — never assume, but this is the post-fold home of `pages` / `users_nav_pinned`).
- Forward migration applies cleanly in one BEGIN/COMMIT.
- A row exists in `public.schema_migrations` for `158`.

- [ ] **Step 7: Verify post-apply state**

Run three follow-up queries to confirm shape:

```bash
PGPASSWORD="$(grep DB_PASSWORD backend/.env.dev | cut -d= -f2)" \
  psql -h localhost -p 5435 -U mmff_dev -d vector_artefacts \
  -c "SELECT pages_key_enum, pages_label, pages_href, pages_icon, pages_tag_enum, pages_default_order FROM pages WHERE pages_key_enum = 'milestones';"

PGPASSWORD="..." psql ... -c "
  SELECT r.users_roles_code, COUNT(*) AS grants
    FROM users_roles_pages urp
    JOIN users_roles r  ON r.users_roles_id  = urp.users_roles_pages_id_role
    JOIN pages       p  ON p.pages_id        = urp.users_roles_pages_id_page
   WHERE p.pages_key_enum = 'milestones'
   GROUP BY r.users_roles_code
   ORDER BY r.users_roles_code;"

PGPASSWORD="..." psql ... -c "
  SELECT COUNT(*) AS pinned_rows
    FROM users_nav_pinned
   WHERE users_nav_pinned_item_key = 'milestones';"
```

Expected:
- First query: 1 row, label=Milestones, href=/milestones, icon=flag, tag=planning, default_order=9.
- Second query: 3 rows (gadmin, padmin, user), `grants=1` each.
- Third query: matches the count of `users_nav_profiles` rows in dev (one pin per profile).

- [ ] **Step 8: Smoke-test in the browser**

Visit `http://localhost:5101/`. Sign in as `user@mmffdev.com`. Open the nav rail. Expect a "Milestones" entry in the Planning bucket with the flag icon. Clicking it 404s (Next.js page doesn't exist yet) — that's the expected pre-frontend state.

- [ ] **Step 9: Commit**

```bash
git add db/vector_artefacts/schema/158_milestones_page.sql db/vector_artefacts/schema/down/158_milestones_page_DOWN.sql
git commit -m "$(cat <<'EOF'
feat(nav): register /milestones system page + grants + pins (mig 158)

Registers the milestones page in the Planning rail bucket (order 9,
flag icon), grants to user/padmin/gadmin via users_roles_code lookup
(post-fold pattern — no hardcoded role UUIDs), and backfills the pin
into every existing nav profile.

The Next.js route does not exist yet — entry will 404 until the
frontend slices land in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit: run `git diff --cached --stat` and verify ONLY the two migration files are staged (per the HARD RULE on inspecting the index).

---

## Task 2: Extend `TimeboxInlineForm` with `kind="milestone"`

**Files:**
- Modify: `app/components/TimeboxInlineForm/index.tsx`

The flyout-body component must support milestone before the grid (Task 3) starts mounting it.

- [ ] **Step 1: Read the current file end-to-end to confirm the diff surface**

Read `app/components/TimeboxInlineForm/index.tsx` in full. Key spots:
- `Kind` type definition (around line 25)
- `KIND_CFG` map (around lines 33–44)
- `EditableState` interface (around line 77)
- `extractEditable` (around line 85)
- `diffEditable` (later in file — its name suggests it computes the PATCH body)
- The JSX block that renders the form fields (further down)

You're going to introduce a milestone-specific shape that runs in parallel to the sprint/release shape rather than trying to merge them — the fields are too different (no suffix, no cadence, no date range — just a single target date + description + status).

- [ ] **Step 2: Extend the `Kind` union + `KIND_CFG` map**

Edit the relevant span. Replace:

```ts
type Kind = "sprint" | "release";

interface KindCfg {
  apiBase: string;
  rowPrefix: string;
  namePrefix: string;
}

const KIND_CFG: Record<Kind, KindCfg> = {
  sprint: {
    apiBase: "/timeboxes/sprints",
    rowPrefix: "timeboxes_sprints",
    namePrefix: "Sprint",
  },
  release: {
    apiBase: "/timeboxes/releases",
    rowPrefix: "timeboxes_releases",
    namePrefix: "Release",
  },
};
```

with:

```ts
type Kind = "sprint" | "release" | "milestone";

interface KindCfg {
  apiBase: string;
  rowPrefix: string;
  namePrefix: string;
}

const KIND_CFG: Record<Kind, KindCfg> = {
  sprint: {
    apiBase: "/timeboxes/sprints",
    rowPrefix: "timeboxes_sprints",
    namePrefix: "Sprint",
  },
  release: {
    apiBase: "/timeboxes/releases",
    rowPrefix: "timeboxes_releases",
    namePrefix: "Release",
  },
  milestone: {
    apiBase: "/timeboxes/milestones",
    rowPrefix: "timeboxes_milestones",
    namePrefix: "Milestone",
  },
};
```

- [ ] **Step 3: Introduce a milestone-specific editable shape + helpers**

After the existing `EditableState` interface and `extractEditable` / `diffEditable` helpers (which serve the sprint/release shape), add this parallel block. Place it directly after the existing helpers so the file reads as "sprint/release shape, then milestone shape":

```ts
// ── Milestone-specific editable shape ──────────────────────────
// Milestones are point-in-time markers: no suffix, no cadence, no
// date range, no velocity. Just name + description + single target
// date + status.
interface MilestoneEditableState {
  name: string;
  description: string;
  date_target: string;
  status: string;
}

function extractMilestoneEditable(row: TimeboxRow): MilestoneEditableState {
  const get = (col: string): string => {
    const v = row[`timeboxes_milestones_${col}`];
    return v === null || v === undefined ? "" : String(v);
  };
  return {
    name: get("name"),
    description: get("description"),
    date_target: get("date_target"),
    status: get("status") || "planned",
  };
}

function diffMilestoneEditable(
  current: MilestoneEditableState,
  initial: MilestoneEditableState,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (current.name !== initial.name) {
    patch.timeboxes_milestones_name = current.name;
  }
  if (current.description !== initial.description) {
    patch.timeboxes_milestones_description = current.description || null;
  }
  if (current.date_target !== initial.date_target) {
    patch.timeboxes_milestones_date_target = current.date_target;
  }
  if (current.status !== initial.status) {
    patch.timeboxes_milestones_status = current.status;
  }
  return patch;
}
```

(NOTE: this code assumes `TimeboxRow` is already declared in the file — verify in step 1. If the symbol name differs, use the actual name.)

- [ ] **Step 4: Branch the body component on kind**

Locate the main component function (the one accepting `TimeboxInlineFormProps`). At the top of its body, before the existing state init, add a kind branch. The cleanest pattern: extract the existing sprint/release rendering into an inner `SprintReleaseBody` component, and add a `MilestoneBody` component. The outer component dispatches by kind.

If extracting is too invasive for one diff, the alternative (acceptable) is an `if (kind === "milestone") return <MilestoneBody ... />` early-return at the top of the existing component, leaving the existing sprint/release code intact below.

Add the `MilestoneBody` component. Place it after the existing component definition (or before the default export — match the file's existing layout convention):

```tsx
function MilestoneBody({
  rowId,
  workspaceId,
  orgNodeId,
  onClose,
  onSaved,
}: TimeboxInlineFormProps) {
  const cfg = KIND_CFG.milestone;
  const [row, setRow] = useState<TimeboxRow | null>(null);
  const [edit, setEdit] = useState<MilestoneEditableState | null>(null);
  const [initial, setInitial] = useState<MilestoneEditableState | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the row when rowId changes
  useEffect(() => {
    if (!rowId) {
      setRow(null);
      setEdit(null);
      setInitial(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ workspace_id: workspaceId });
        if (orgNodeId) params.set("org_node_id", orgNodeId);
        const data = await apiSite<TimeboxRow>(
          `${cfg.apiBase}/${rowId}?${params.toString()}`,
        );
        if (cancelled) return;
        setRow(data);
        const editable = extractMilestoneEditable(data);
        setEdit(editable);
        setInitial(editable);
      } catch (e) {
        if (!cancelled) {
          notify.apiError(e as ApiError, "Failed to load milestone");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rowId, workspaceId, orgNodeId, cfg.apiBase]);

  const handleSave = useCallback(async () => {
    if (!rowId || !edit || !initial) return;
    const patch = diffMilestoneEditable(edit, initial);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId });
      const updated = await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}?${params.toString()}`,
        {
          method: "PATCH",
          body: JSON.stringify(patch),
        },
      );
      notify.success("Milestone saved");
      onSaved?.(updated);
      onClose();
    } catch (e) {
      notify.apiError(e as ApiError, "Failed to save milestone");
    } finally {
      setSaving(false);
    }
  }, [rowId, edit, initial, workspaceId, cfg.apiBase, onSaved, onClose]);

  if (!rowId || !row || !edit) return null;

  return (
    <form
      className="timebox-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSave();
      }}
    >
      <label className="form-row">
        <span className="form-row__label">Name</span>
        <input
          className="form-row__input"
          type="text"
          value={edit.name}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          required
        />
      </label>
      <label className="form-row">
        <span className="form-row__label">Description</span>
        <textarea
          className="form-row__input"
          value={edit.description}
          onChange={(e) => setEdit({ ...edit, description: e.target.value })}
          rows={3}
        />
      </label>
      <label className="form-row">
        <span className="form-row__label">Target Date</span>
        <input
          className="form-row__input"
          type="date"
          value={edit.date_target}
          onChange={(e) => setEdit({ ...edit, date_target: e.target.value })}
          required
        />
      </label>
      <label className="form-row">
        <span className="form-row__label">Status</span>
        <select
          className="form-row__input"
          value={edit.status}
          onChange={(e) => setEdit({ ...edit, status: e.target.value })}
        >
          <option value="planned">Planned</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="missed">Missed</option>
        </select>
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={onClose}
          disabled={saving}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
```

(NOTE: the exact CSS class names — `timebox-inline-form`, `form-row`, `btn`, etc — should match what the existing sprint/release body uses. Cross-check against the existing component's JSX in step 1; if it uses different class names, substitute them so the rendering matches visually.)

- [ ] **Step 5: Wire the dispatch at the top of the main component**

At the top of the existing main component body (the one accepting `TimeboxInlineFormProps`), add:

```tsx
if (props.kind === "milestone") {
  return <MilestoneBody {...props} />;
}
```

This early-return preserves the existing sprint/release path untouched and the JSX below runs only for those two kinds.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "TimeboxInlineForm|milestone" | head -20`

Expected: no errors mentioning `TimeboxInlineForm` or `milestone`. If the dispatch above complains because `kind` isn't narrowed by the early return, add a non-null assertion or refactor the existing main body to also check `kind !== "milestone"`.

- [ ] **Step 7: Visual smoke (deferred to Task 4)**

Don't attempt to manually test in browser yet — the page route doesn't exist. The grid (Task 3) is what loads this form. Verify at the end of Task 4.

- [ ] **Step 8: Commit**

```bash
git add app/components/TimeboxInlineForm/index.tsx
git commit -m "$(cat <<'EOF'
feat(TimeboxInlineForm): add kind="milestone" support

Adds the third kind branch alongside sprint/release. Milestone editable
shape is intentionally smaller: name + description + single target
date + status (no suffix, no cadence, no date range, no velocity).

The sprint/release JSX path is preserved verbatim via an early-return
dispatch at the top of the main body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit: `git diff --cached --stat` — only the InlineForm file staged.

---

## Task 3: Extend `TimeboxObjectTree` with `kind="milestone"`

**Files:**
- Modify: `app/components/TimeboxObjectTree/index.tsx`

- [ ] **Step 1: Re-read the file's KIND_CFG, column array, and bulk-config builder**

Read `app/components/TimeboxObjectTree/index.tsx` if it's not still fresh in mind. Anchor points:
- `Kind` type (around line 43)
- `KIND_CFG` map (lines 52–65)
- `buildBulkConfig` (lines 69–124)
- `columns: Column<TimeboxRow>[]` array (lines 230–313 — defined inside the inner component)
- `addressable` registration in the wrapper (lines 460–472)

- [ ] **Step 2: Extend the `Kind` union + `KIND_CFG` map**

Replace:

```ts
type Kind = "sprint" | "release";
```

with:

```ts
type Kind = "sprint" | "release" | "milestone";
```

In the `KIND_CFG` block, add the third entry. Update the `listKey` type union too:

```ts
interface KindCfg {
  apiBase: string;
  rowPrefix: string;
  namePrefix: string;
  listKey: "sprints" | "releases" | "milestones";
}

const KIND_CFG: Record<Kind, KindCfg> = {
  sprint: {
    apiBase: "/timeboxes/sprints",
    rowPrefix: "timeboxes_sprints",
    namePrefix: "Sprint",
    listKey: "sprints",
  },
  release: {
    apiBase: "/timeboxes/releases",
    rowPrefix: "timeboxes_releases",
    namePrefix: "Release",
    listKey: "releases",
  },
  milestone: {
    apiBase: "/timeboxes/milestones",
    rowPrefix: "timeboxes_milestones",
    namePrefix: "Milestone",
    listKey: "milestones",
  },
};
```

- [ ] **Step 3: Update `statusVariant` for the milestone-only `missed` status**

Locate the existing `statusVariant` function (around line 144). Replace with:

```ts
function statusVariant(status: string): PillVariant {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "neutral";
    case "missed":
      return "warning";
    default:
      return "info";
  }
}
```

(`warning` must exist on the `PillVariant` union — check `app/components/Table.tsx`'s type. If it doesn't, use `danger` or whichever amber/red variant exists; pick the closest match. If neither exists, fall back to `info` and add a TD entry `TD-PILL-MISSED-VARIANT`.)

- [ ] **Step 4: Build a milestone-specific column array inside the inner component**

Inside `TimeboxObjectTreeInner`, the current `columns: Column<TimeboxRow>[]` array is defined unconditionally. Replace its construction with a kind-aware branch. Locate the block starting `// Columns` (around line 229) and replace through the end of the columns array (around line 313) with:

```tsx
// Columns — milestone vs sprint/release have different shapes.
const columns: Column<TimeboxRow>[] = useMemo(() => {
  if (kind === "milestone") {
    return [
      {
        key: `${p}_name`,
        header: "Name",
        kind: "custom",
        render: (r) => {
          const name = String(r[`${p}_name`] ?? "");
          const origin = String(r.origin ?? "local");
          const isInherited = origin === "inherited";
          const fromNodeName = (r.from_node_name as string | null) ?? null;
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                data-objecttree-flyout-trigger="1"
                className="link-button"
                style={{
                  background: "none",
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  color: isInherited
                    ? "var(--ink-muted)"
                    : "var(--brand-action)",
                  fontStyle: isInherited ? "italic" : "normal",
                  textDecoration: "underline",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const id = String(r[`${p}_id`] ?? "");
                  setOpenRowId((cur) => (cur === id ? null : id));
                }}
              >
                {name}
              </button>
              {isInherited && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--ink-subtle)",
                    fontStyle: "italic",
                  }}
                  title={`Inherited from ${fromNodeName ?? "a parent node"}`}
                >
                  ↑ from {fromNodeName ?? "parent"}
                </span>
              )}
            </div>
          );
        },
      },
      { key: `${p}_date_target`, header: "Target Date", kind: "mono" },
      {
        key: `${p}_status`,
        header: "Status",
        kind: "pill",
        pillVariant: (r) => statusVariant(String(r[`${p}_status`] ?? "")),
        pillLabel: (r) => String(r[`${p}_status`] ?? ""),
      },
      { key: `${p}_created_at`, header: "Created", kind: "mono" },
    ];
  }
  // sprint/release shape — original column set
  return [
    {
      key: `${p}_name`,
      header: "Name",
      kind: "custom",
      render: (r) => {
        const suffix = r[`${p}_suffix`] as string | null;
        const name = String(r[`${p}_name`] ?? "");
        const origin = String(r.origin ?? "local");
        const isInherited = origin === "inherited";
        const fromNodeName = (r.from_node_name as string | null) ?? null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              type="button"
              data-objecttree-flyout-trigger="1"
              className="link-button"
              style={{
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
                color: isInherited
                  ? "var(--ink-muted)"
                  : "var(--brand-action)",
                fontStyle: isInherited ? "italic" : "normal",
                textDecoration: "underline",
              }}
              onClick={(e) => {
                e.stopPropagation();
                const id = String(r[`${p}_id`] ?? "");
                setOpenRowId((cur) => (cur === id ? null : id));
              }}
            >
              {name}
              {suffix && (
                <span style={{ color: "var(--ink-subtle)" }}> ({suffix})</span>
              )}
            </button>
            {isInherited && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--ink-subtle)",
                  fontStyle: "italic",
                }}
                title={`Inherited from ${fromNodeName ?? "a parent node"}`}
              >
                ↑ from {fromNodeName ?? "parent"}
              </span>
            )}
          </div>
        );
      },
    },
    { key: `${p}_date_start`, header: "Start", kind: "mono" },
    { key: `${p}_date_end`, header: "End", kind: "mono" },
    { key: `${p}_cadence_days`, header: "Cadence (days)", kind: "numeric" },
    {
      key: `${p}_status`,
      header: "Status",
      kind: "pill",
      pillVariant: (r) => statusVariant(String(r[`${p}_status`] ?? "")),
      pillLabel: (r) => String(r[`${p}_status`] ?? ""),
    },
    {
      key: `${p}_scope`,
      header: "Scope",
      kind: "numeric",
      render: (r) => String(r[`${p}_scope`] ?? "—"),
    },
    {
      key: `${p}_velocity`,
      header: "Velocity",
      kind: "numeric",
      render: (r) => String(r[`${p}_velocity`] ?? "—"),
    },
  ];
}, [kind, p]);
```

The wrap in `useMemo` is intentional — columns containing closures over `setOpenRowId` shouldn't recreate on every render.

- [ ] **Step 5: Build a milestone-specific bulk-config**

The existing `buildBulkConfig` function (lines 69–124) hardcodes sprint/release shape (suffix, date_start, cadence_days, date_end, velocity). For milestones we want a minimal sheet: Name (auto from pattern), Description (optional), Target Date.

Modify `buildBulkConfig` to branch on kind. Replace the existing function with:

```ts
function buildBulkConfig(kind: Kind): BulkCreateConfig {
  const cfg = KIND_CFG[kind];
  const p = cfg.rowPrefix;

  if (kind === "milestone") {
    return {
      label: `Create ${cfg.namePrefix}s`,
      endpoint: `${cfg.apiBase}/bulk-create`,
      listKey: cfg.listKey,
      namePattern: `${cfg.namePrefix} {n}`,
      namePrefixField: `${p}_name`,
      defaultCount: 1,
      maxCount: 1,  // single-create stopgap; bulk-create endpoint may not exist
      rules: {},
      columns: [
        {
          key: "date_target",
          wireKey: `${p}_date_target`,
          label: "Target Date",
          type: "date",
        },
        {
          key: "description",
          wireKey: `${p}_description`,
          label: "Description (optional)",
          type: "text",
          optional: true,
        },
      ],
    };
  }

  // sprint/release shape — original
  return {
    label: `Create ${cfg.namePrefix}s`,
    endpoint: `${cfg.apiBase}/bulk-create`,
    listKey: cfg.listKey,
    namePattern: `${cfg.namePrefix} {n}`,
    namePrefixField: `${p}_name`,
    defaultCount: 1,
    maxCount: 52,
    rules: {
      cascadeStartFromPrevEnd: true,
      deriveEndFromCadence: true,
    },
    columns: [
      {
        key: "suffix",
        wireKey: `${p}_suffix`,
        label: "Suffix (optional)",
        type: "text",
        optional: true,
        placeholder: "e.g. Red Cherry",
      },
      {
        key: "date_start",
        wireKey: `${p}_date_start`,
        label: "Start",
        type: "date",
        lockAfterFirst: true,
      },
      {
        key: "cadence_days",
        wireKey: `${p}_cadence_days`,
        label: "Cadence (days)",
        type: "number",
        default: 14,
      },
      {
        key: "date_end",
        wireKey: `${p}_date_end`,
        label: "End (derived)",
        type: "derived",
        derivedFrom: ["date_start", "cadence_days"],
      },
      {
        key: "velocity",
        wireKey: `${p}_velocity`,
        label: "Velocity",
        type: "number",
        optional: true,
        width: 80,
      },
    ],
  };
}
```

- [ ] **Step 6: Update the bulk-submit handler for the milestone case**

The existing `handleBulkSubmit` (around line 317) POSTs to `${cfg.apiBase}/bulk-create`. The milestone backend handler exposes `Create` (single POST) at `${cfg.apiBase}` — NOT a bulk-create endpoint. For the single-create stopgap (maxCount=1), the function must use the single-POST endpoint for milestones.

Replace the existing `handleBulkSubmit` with:

```tsx
const handleBulkSubmit = useCallback(
  async (payloadRows: Array<Record<string, unknown>>) => {
    try {
      if (kind === "milestone") {
        // No bulk endpoint on the milestone backend — POST each row to
        // the single-create endpoint. With maxCount=1 (see buildBulkConfig)
        // this is always a single row in practice.
        for (const row of payloadRows) {
          await apiSite(
            `${cfg.apiBase}?workspace_id=${workspaceId}`,
            {
              method: "POST",
              body: JSON.stringify(row),
            },
          );
        }
      } else {
        await apiSite(
          `${cfg.apiBase}/bulk-create?workspace_id=${workspaceId}`,
          {
            method: "POST",
            body: JSON.stringify({ [bulkConfig.listKey]: payloadRows }),
          },
        );
      }
      notify.success(
        `Created ${payloadRows.length} ${cfg.namePrefix}${
          payloadRows.length === 1 ? "" : "s"
        }`,
      );
      setBulkOpen(false);
      void reload();
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to bulk-create ${kind}s`);
    }
  },
  [cfg.apiBase, cfg.namePrefix, workspaceId, kind, bulkConfig.listKey, reload],
);
```

- [ ] **Step 7: Update the list-response parse for the milestone case**

The existing `reload` (around line 183) calls `apiSite<{ items: TimeboxRow[]; total: number }>` and reads `data.items`. The milestone backend's List handler returns `{milestones: [...], count: N}` — different envelope keys.

Replace the existing `reload` with:

```tsx
const reload = useCallback(async () => {
  if (!workspaceId) return;
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (orgNodeId) params.set("org_node_id", orgNodeId);
  try {
    const data = await apiSite<Record<string, unknown>>(
      `${cfg.apiBase}?${params.toString()}`,
    );
    // sprint/release: { items, total }
    // milestone:      { milestones, count }
    const items = (data[cfg.listKey] ?? data.items ?? []) as TimeboxRow[];
    setRows(items);
  } catch (e) {
    notify.apiError(e as ApiError, `Failed to load ${kind}s`);
    setRows([]);
  }
}, [cfg.apiBase, cfg.listKey, kind, workspaceId, orgNodeId]);
```

- [ ] **Step 8: Update the search filter for the milestone case**

The existing `filteredRows` (around line 208) searches name + suffix. Milestones have no suffix. Replace:

```tsx
const filteredRows = useMemo(() => {
  if (!rows) return null;
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => {
    const name = String(r[`${p}_name`] ?? "").toLowerCase();
    const suffix = String(r[`${p}_suffix`] ?? "").toLowerCase();
    return name.includes(needle) || suffix.includes(needle);
  });
}, [rows, search, p]);
```

with:

```tsx
const filteredRows = useMemo(() => {
  if (!rows) return null;
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) => {
    const name = String(r[`${p}_name`] ?? "").toLowerCase();
    if (name.includes(needle)) return true;
    if (kind === "milestone") return false;
    const suffix = String(r[`${p}_suffix`] ?? "").toLowerCase();
    return suffix.includes(needle);
  });
}, [rows, search, p, kind]);
```

- [ ] **Step 9: Update the `lastEndDate` for the milestone case**

`lastEndDate` (around line 221) reads `${p}_date_end` to seed the bulk-create wizard's "start from previous end". Milestones don't have `_date_end`, and the wizard never cascades for milestones (we disable that via `rules: {}`). The variable will be the empty string for milestones — that's fine because `startAnchor` is unused when no cascade-rules apply. **No code change needed**, but verify the existing code doesn't throw on the missing key. Existing code uses `String(... ?? "")` which is safe.

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "TimeboxObjectTree|milestone" | head -20`

Expected: no errors mentioning either symbol. If the `Column<TimeboxRow>[]` array's `kind: "mono"` / `kind: "pill"` discriminators don't match the actual `Column` type union, fix per the Table component's type signatures.

- [ ] **Step 11: Commit**

```bash
git add app/components/TimeboxObjectTree/index.tsx
git commit -m "$(cat <<'EOF'
feat(TimeboxObjectTree): add kind="milestone" support

Adds the third kind branch alongside sprint/release. Milestone column
set is Name / Target Date / Status / Created (no Start/End/Cadence/
Scope/Velocity). Bulk-create wizard locks to count=1 because the
milestone backend exposes only a single-POST Create endpoint, not a
bulk-create one — recorded as TD-MILESTONES-SINGLE-CREATE.

The List response envelope ({milestones,count} vs {items,total}) is
parsed via cfg.listKey to keep the existing sprint/release path
unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit: `git diff --cached --stat` — only the TimeboxObjectTree file staged.

---

## Task 4: Create the `/milestones` page route

**Files:**
- Create: `app/(user)/milestones/page.tsx`

- [ ] **Step 1: Confirm the parent directory does not already exist**

Run: `ls -d "app/(user)/milestones" 2>/dev/null && echo EXISTS || echo MISSING`

Expected: `MISSING`. If `EXISTS`, inspect — there shouldn't be a milestones dir yet. If there's a stale one, surface to user before touching.

- [ ] **Step 2: Create the page file**

Write `app/(user)/milestones/page.tsx`:

```tsx
"use client";

// /milestones — point-in-time delivery markers.
//
// Mirrors app/(user)/sprints/page.tsx with the required-topology-node
// gate. The TimeboxObjectTree component handles kind="milestone"
// branching internally (column set, bulk-config, list envelope).

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
        Create and manage milestones — point-in-time delivery markers
        anchored to a topology node. Pin a node in the rail above before
        creating.
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

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep milestones | head -20`

Expected: no errors. If `tenant_id` doesn't exist on `sentinel_user`, check `app/sentinel/` for the actual property name (might be `workspace_id` or `subscription_id`) — match the property used in the Sprints page.

- [ ] **Step 4: Manual smoke — visit the page**

Backend on `:5100`, frontend on `:5101`. With `<server> -d` (already pinned dev — verify via the marker at the top of CLAUDE.md). Sign in as `user@mmffdev.com` / `password`.

Steps:
1. Open `http://localhost:5101/milestones`.
2. With NO topology node focused: expect the "Pick a topology node" panel.
3. Focus a node via the rail (any team-level node).
4. Expect the V2-badged grid, header "Milestones", empty state "No milestones found."
5. Click "Create Milestone". Sheet opens with maxCount=1. Enter a target date + optional description. Submit.
6. Expect the row to appear with status pill "planned".
7. Click the row's name button. Detail flyout opens via `TimeboxInlineForm`'s milestone body.
8. Change status to "active" → save. Pill recolours to success-green.
9. Reload the page. State persists.

If any of those fail, debug at the source (read the network call in DevTools, then read the matching handler in `backend/internal/timeboxmilestones/handler.go`) — DO NOT ask the user before exhausting direct diagnosis per the HARD RULE.

- [ ] **Step 5: Cross-role verification**

Sign out, sign in as `padmin@mmffdev.com` / `password`. Expect "Milestones" in the Planning rail bucket. Sign out, sign in as `gadmin@mmffdev.com` / `password`. Same expectation.

- [ ] **Step 6: Commit**

```bash
git add "app/(user)/milestones/page.tsx"
git commit -m "$(cat <<'EOF'
feat(milestones): add /milestones page route

Mirrors the sprints page surface — required-topology-node gate plus
TimeboxObjectTree with kind="milestone". Reachable from the Planning
rail bucket (entry seeded by migration 158, components extended in
the prior two commits).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit: `git diff --cached --stat` — only the new page file staged.

---

## Task 5: Tech-debt entries + memory refresh

**Files:**
- Modify: `docs/c_tech_debt.md`
- Modify: `context/MEMORY.md` (only if a relevant active thread changed — likely not)

- [ ] **Step 1: Read the current tech-debt register**

Read `docs/c_tech_debt.md`. Note the format conventions used by existing entries (TD-* prefix, severity tag S1/S2/S3, trigger condition, pay-down plan).

- [ ] **Step 2: Append the three TD entries from the spec**

Add (or update if already present) these three entries in the appropriate section of `docs/c_tech_debt.md`:

```markdown
### TD-MILESTONES-NOTES — Rally `Notes` field missing on milestones (S2)

Rally's milestone detail surface has a long-form `Notes` field. The
2026-05-29 milestones page build skipped it (Rick chose "Skip Notes for
now"); the DB column `timeboxes_milestones_notes` does not exist and
the inline form does not render a Notes input. Description (a separate
short-form field) is present.

**Trigger to pay down:** first user request for Notes, or before any
external demo that walks through the milestone detail flyout.

**Pay-down plan:** one migration adding `timeboxes_milestones_notes TEXT`,
backend types/service/handler updates, and a form field in
`TimeboxInlineForm`'s `MilestoneBody`.

### TD-MILESTONES-BACKEND-TESTS — `timeboxmilestones` service has zero test coverage (S2)

`backend/internal/timeboxmilestones/` shipped without `service_test.go`
or `handler_test.go`. Pre-existed the milestones page build but is now
on the user-visible critical path.

**Trigger to pay down:** before any change to the service, or before
this surface is shown to a buyer.

**Pay-down plan:** mirror the test files in `backend/internal/timeboxsprints/`
(`service_test.go` + `handler_test.go`), adapted to the milestone wire shape
and the simpler point-in-time semantics.

### TD-MILESTONES-SINGLE-CREATE — single-create reuses bulk-sheet stopgap (S3)

The "Create Milestone" button opens `ObjectTreeBulkCreateSheet` with
`defaultCount: 1, maxCount: 1` instead of a dedicated single-row inline
form. This matches the same stopgap the sprints page uses
(`TimeboxObjectTree/index.tsx:340-353`). The UX works but the bulk-sheet
shell carries unused affordances (the count-stepper is disabled but
present).

**Trigger to pay down:** when adding any other kind that doesn't have
a bulk-create path, or whenever the single-create UX becomes a
usability complaint.

**Pay-down plan:** extract `<TimeboxInlineSingleCreate>` from the bulk
sheet and route all three kinds through it for the single-create case;
bulk sheet stays for sprint/release multi-create only.
```

- [ ] **Step 3: Optionally refresh `context/MEMORY.md`**

If the current "## Active Threads" section in `context/MEMORY.md` references milestones or had a "TODO: build milestones page" line, update it to reflect "shipped". If no such reference exists, skip — this is a normal feature build, not a system-shaping change worth a durable memory entry.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/c_tech_debt.md
# If MEMORY.md changed in step 3, also: git add context/MEMORY.md
git commit -m "$(cat <<'EOF'
docs(td): register milestones-page tech debt (notes, tests, single-create)

Three entries opened by the milestones page build:
  - TD-MILESTONES-NOTES (S2): Rally Notes field deferred
  - TD-MILESTONES-BACKEND-TESTS (S2): service has zero coverage
  - TD-MILESTONES-SINGLE-CREATE (S3): single-create reuses bulk sheet

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Pre-commit: `git diff --cached --stat` — only the TD file (and MEMORY.md if it actually changed).

---

## Final smoke + handover

- [ ] **Step 1: Run the linters that touch this surface**

```bash
npm run lint 2>&1 | grep -E "milestones|TimeboxObjectTree|TimeboxInlineForm" | head -20
```

Expected: no lint failures. If any of the project's `lint:*` checks (h2-panel-only, page-description, addressables, column-prefix) fires, fix at source — DO NOT skip with eslint-disable per the HARD RULE on hacks.

- [ ] **Step 2: Full manual run-through of the spec's 10-step test plan**

Run the test plan from `docs/superpowers/specs/2026-05-29-milestones-page-design.md` § "Test plan". Every step should pass.

- [ ] **Step 3: Confirm no unexpected files are dirty**

```bash
git status --short
```

Expected: clean working tree (or only files unrelated to this build that were already dirty at session start).

- [ ] **Step 4: Write a short handover note**

If a handover doc is pinned via `<read>`, refresh it via `<write>` per the project's session-end discipline. Otherwise skip — this build is small enough that the commit messages + spec + plan + TD entries are the full record.

---

## Plan self-review

Checked against `docs/superpowers/specs/2026-05-29-milestones-page-design.md`:

**Spec coverage:**
- Frontend slice 1 (TimeboxObjectTree kind=milestone) → Task 3 ✓
- Frontend slice 2 (TimeboxInlineForm kind=milestone) → Task 2 ✓
- Frontend slice 3 (/milestones page route) → Task 4 ✓
- Migration slice (158) → Task 1 ✓
- TD entries → Task 5 ✓
- Manual test plan → Final smoke step 2 ✓
- Plan-time verification points (post-fold column names, ON CONFLICT arbiter, role lookup, cascade triggers, single-create UX) → resolved in plan preamble and applied throughout ✓

**Placeholder scan:** none. Every step contains the actual SQL, TSX, or shell command.

**Type/symbol consistency:**
- `Kind` union extended to `"sprint" | "release" | "milestone"` consistently in both Task 2 and Task 3.
- `KIND_CFG` entry shape uses the same field set in both files (`apiBase`, `rowPrefix`, `namePrefix`, plus `listKey` only on the TimeboxObjectTree variant where it's also typed on `KindCfg`).
- `MilestoneBody` consistently named between Task 2 step 4 and step 5.
- `buildBulkConfig` returns the same `BulkCreateConfig` type both branches; milestone branch correctly omits the suffix/cadence/date_start/date_end/velocity columns.
- Wire keys consistently `timeboxes_milestones_*` matching backend `types.go`.
- `users_nav_pinned` column names consistent with migration 141.
- `pages_key_enum_system_unique` constraint name consistent with migration 117.

No issues found; plan is internally consistent.
