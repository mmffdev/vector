# Handover — ArtefactInlineForm

**Branch:** `main`
**Date:** 2026-05-20
**Status:** ✅ Built, typechecks, builds, lints green. Not yet browser-smoke-tested.
**Plan:** [/Users/rick/.claude/plans/validated-fluttering-mist.md](/Users/rick/.claude/plans/validated-fluttering-mist.md)

---

## What this delivers

Click the coloured artefact-type badge (`EP` / `US` / `TA` / `DE`) on any row in the work-items or portfolio-items ObjectTree → an inline form slides down beneath the action bar showing that artefact's full detail. Fields auto-save on blur. Single **Finished** button closes the panel. Single-open semantics — clicking a different row's badge auto-closes the previous one. Mutually exclusive with the "Create New" flyout.

The form is a **reusable component** (`app/components/ArtefactInlineForm/`) driven by props — drops into any artefact-listing surface (work-items, portfolio-items, sprints, releases, future ones).

---

## Critical context

### Schema philosophy shift

The user asked for the right-column fields to be **first-class columns on `artefacts`**, not custom-field bindings. This made the PR significantly bigger than a UI-only piece. Five columns were promoted from field-library bindings to first-class:

- `colour` — per-artefact override (null = inherit from type)
- `is_blocked` (bool) + `blocked_reason` (text) — independent columns
- `timebox_milestone_id` (UUID, hard FK, ON DELETE SET NULL)

Already existed (no migration needed): `story_points`, `timebox_sprint_id` (a.k.a. `artefacts_id_timebox_sprint`), `timebox_release_id` (`artefacts_id_timebox_release`), `topology_node_id`, `priority_id`.

**Implication tracked as [TD-ARTEFACT-INLINE-FORM-FIELDLIB-LEFTOVERS](docs/c_tech_debt.md):** existing per-type field-library bindings for these keys (e.g. risk-type `blocked_reason` from migration 075) are now redundant but still in the DB. The form writes only the column; a follow-up migration should copy any non-null field-values rows into the columns then delete the bindings.

### `notes` is out of scope

The user explicitly said `notes` would be its own table coming later. The form does NOT render a notes field.

### Naming convention learned mid-flight

I initially named the milestone table `timebox_milestones` (singular prefix). Migration 054 had already enforced `timeboxes_*` (plural-then-singular) on sprints + releases per §2.3/§2.4. **Migration 087** is the corrective rename — table now `timeboxes_milestones`, FK column now `artefacts_id_timebox_milestone`. Anyone reading the code expecting the singular form will land on the wrong name; the rename is documented in 087's header.

---

## File-by-file changes

### Migrations (vector_artefacts)

| File | Purpose |
|------|---------|
| `db/vector_artefacts/schema/084_artefacts_inline_form_columns.sql` | Add `colour`, `is_blocked`, `blocked_reason`, `timebox_milestone_id` to `artefacts` (forward-ref column for the FK — bound in 085). 4 partial indexes. |
| `db/vector_artefacts/schema/085_timebox_milestones.sql` | New `timebox_milestones` table (initially singular — renamed by 087). Indexes + updated_at trigger. Adds FK constraint on `artefacts.timebox_milestone_id`. |
| `db/vector_artefacts/schema/086_seed_dev_milestones.sql` | Three deterministic UUIDs (`...801`/`802`/`803`) — Alpha launch, Beta launch, GA. Idempotent. |
| `db/vector_artefacts/schema/087_rename_milestones_to_convention.sql` | Renames `timebox_milestones` → `timeboxes_milestones` + all columns to `timeboxes_milestones_*` prefix, renames FK column `timebox_milestone_id` → `artefacts_id_timebox_milestone`. Mirrors migration 054. |

All four DOWN scripts in `db/vector_artefacts/schema/down/`.

**Status:** all four applied to dev (`localhost:5435/vector_artefacts`). Migration 083 (pre-existing, unrelated — `master_record_tenants_mentions_scope`) also got applied in the same run.

### Backend Go

**Modified — `backend/internal/artefactitems/`**

- `types.go` — Added 5 fields to `WorkItem` (`Colour`, `IsBlocked`, `BlockedReason`, `ReleaseID`, `MilestoneID`). Added 8 fields to `PatchWorkItemInput` (the 5 above + `OwnedByUserID`, `ParentArtefactID`, `TopologyNodeID`).
- `sql.go` — Extended `sqlWorkItemColumns` to project the 5 new columns. Used the real DB column names: `a.artefacts_id_timebox_release` (note: this is the existing release FK column post-RF1.4.2 rename), `a.artefacts_id_timebox_milestone`.
- `service.go` — Extended `scanWorkItemRow` with 5 new `&wi.*` reads. Extended `PatchWorkItem` body with 8 new field-translator blocks (each follows the three-state convention: nil = skip, "" = NULL, value = SET).
- `handler.go` — Extended `patchWorkItemReq` JSON shape with 8 new keys. Extended the dispatch call.

**New — `backend/internal/timeboxmilestones/`** (mirrors `timeboxreleases/` pattern)

- `types.go` — `Milestone`, `CreateMilestoneInput`, `UpdateMilestoneInput`, `ListFilters`, `validStatuses`.
- `sql.go` — Insert/select/list/update/archive constants using the `timeboxes_milestones_*` column names.
- `service.go` — `Create`, `Get`, `List`, `Update`, `Delete`, `scanMilestone`, `validateCreateInput`.
- `handler.go` — REST handlers (`List`, `Get`, `Create`, `Update`, `Delete`). Validates `workspace_id` query param.

**New — `backend/internal/lookups/`** — slim scope-bound lookups

- `types.go` — `UserInScope` (`id`, `display_name`, `avatar_url`). No PII beyond name + image URL.
- `sql.go` — `sqlListUsersInScope` — subscription-clamped, alphabetical order. Hard tenant clamp on `subscription_id = $1`.
- `service.go` — `ListUsersInScope`. Falls back to empty array if pool is nil.
- `handler.go` — `GET /_site/lookups/users-in-scope`. Pulls `SubscriptionID` from `auth.UserFromCtx`.

**Modified — `backend/cmd/server/main.go`**

- Added `timeboxmilestones` + `lookups` imports.
- Added `milestoneH` and `lookupsH` handler construction blocks (around lines 614, 624).
- Mounted milestones routes on `/_site/timeboxes/milestones` (line 1218) AND `/samantha/v2/timeboxes/milestones` (line 1723).
- Mounted lookups on `/_site/lookups/users-in-scope` (line 1234).

### siteAPI (`app/lib/apiSite/index.ts`)

Added after the `releases` namespace (around line 868):

- `Milestone` interface (matches the wire shape with `timeboxes_milestones_*` JSON keys).
- `milestones` namespace: `list`, `get`, `create`, `update`, `delete`.
- `UserInScope` interface.
- `lookups.usersInScope()` helper.

### ColourPicker promotion

**New — `app/components/ColourPicker.tsx`**

- Default + named export. Supports two modes via prop shape:
  - **Uncontrolled (default):** self-manages open state, renders popover inline. Used by `<flow-states/page.tsx>` and the new `<ArtefactInlineForm>`.
  - **Controlled + portal:** parent passes `open` + `onOpen` + `onClose`; popover renders via `ReactDOM.createPortal` positioned by `getBoundingClientRect`. Used by `<artefact-types/page.tsx>` where row-level open coordination matters.
- Reuses the existing `at-colour-picker` / `at-colour-popover` / `at-colour-cell` CSS classes — no globals.css change needed. Tracked as [TD-COLOUR-PICKER-CSS-RENAME](docs/c_tech_debt.md) for a future rename pass.
- Includes the 18-colour `PALETTE` (was previously duplicated in both pages).

**Modified — `app/(user)/workspace-admin/artefacts/artefact-types/page.tsx`**

- Deleted lines 33-145 (inline `ColourPicker` function + its surrounding `PALETTE` const).
- Added `import { ColourPicker } from "@/app/components/ColourPicker";`.
- Removed unused `ReactDOM` import.
- `ColourPickerCell` wrapper (line ~253) untouched — still passes through the controlled-mode props.

**Modified — `app/(user)/workspace-admin/flow-states/page.tsx`**

- Deleted lines 500-598 (inline `ColourPicker`).
- Deleted the local `PALETTE` constant (lines 61-67).
- Added the import to the existing imports block.

### ArtefactInlineForm (`app/components/ArtefactInlineForm/`)

6 new files:

- **`types.ts`** — `ArtefactInlineFormProps`, `ArtefactDetail` (mirrors the backend wire WorkItem + new columns), `ParentOption`, and `PARENT_PREFIX_MAP` constant (`TA → [DE, US]`, `US → [FE, EP]`, `DE → [EP, US]`).
- **`useArtefactInline.ts`** — data hook. Inputs: `{ artefactId, resourceUrl, onSaved }`. Picks `workItems` vs `portfolioItems` from `resourceUrl`. Returns `{ artefact, loading, error, patch }`. Uses a `reqIdRef` to avoid stale-update races when `artefactId` changes during an in-flight fetch.
- **`useParentCandidates.ts`** — resolves valid parent artefacts for a type prefix. Looks up type IDs via `artefactTypesApi.list()`, fans out parallel `workItems.list({item_type_id})` calls, flattens + sorts by `prefix` then `key_num`. Backend `?meg=` scope is applied automatically.
- **`BlockedToggle.tsx`** — green `MdCheckCircle` / red `MdBlock` icon-button. Reveals a reason textbox when blocked. Auto-focuses the textbox on the transition unblocked → blocked. Reason auto-saves on blur.
- **`ArtefactInlineForm.tsx`** — form body. Two columns: Left (Title, Description, Attachments stub, Created/Updated meta). Right (BlockedToggle, Topology, Colour, Owner, Flow state, Estimate, Parent, Sprint, Release, Milestone). Fetches the 6 dropdown sources in parallel on mount; each source is independently `.catch()`'d so one failure doesn't poison the others. Loading + error states.
- **`index.tsx`** — default export. The animation envelope `<section className="artefact-inline-form" data-open={...}>`. Inner body only mounts when `artefactId` is non-null (no fetch on a closed pane).

### CSS (`app/globals.css`)

Added a ~180-line block around line 13430 (just before the Pagination row banner) under the comment `/* ─── ArtefactInlineForm ─ */`. Mirrors the `.tree_accordion-dense__createflyout` animation envelope (`grid-template-rows: 0fr → 1fr`, `opacity`, `transform: translateY(-4px → 0)`, 220ms ease).

Key class names (all follow `root-block__Container_Child_leaf`):

- `.artefact-inline-form` (envelope) → `data-open="true"` toggles slide-down
- `.artefact-inline-form__Container` (padding host)
- `.artefact-inline-form__Container_Head` (sunken band with title)
- `.artefact-inline-form__Container_Cols` (two-column grid, collapses to one column under 700px)
- `.artefact-inline-form__Field` / `_Label` / `_Input` / `_Stub` / `_Meta`
- `.artefact-inline-form__Blocked` / `_Btn` / `_Btn_Label` / `_Reason_Field` / `_Reason` + `--blocked` modifier
- `.artefact-inline-form__Actions` (bottom Finished button row)

Also modified `.tree_accordion-dense__type-badge` (around line 13313): added `border:0; cursor:pointer; outline:none;` + a `:focus-visible` box-shadow ring. Necessary because the badge `<span>` is now a `<button>` — browser defaults would otherwise break the visual.

### ObjectTree integration

**Modified — `app/components/work-items-tree-config.tsx`**

- `SummaryCell` (around line 242) — added optional `onTypeBadgeClick?: (id: string) => void` prop. The badge `<span>` (line 263-271) is now a `<button>` with `onClick={(e) => { e.stopPropagation(); onTypeBadgeClick?.(row.id); }}` + `aria-label="Edit EP-12"`.
- `buildWorkItemsColumns` (line 439) — added optional 4th param `callbacks?: { onTypeBadgeClick?: ... }`. Threaded into the title column's render function.

**Modified — `app/components/ObjectTree/p_ObjectTree.tsx`**

- New imports: `ArtefactInlineForm` from `@/app/components/ArtefactInlineForm`.
- New state (after the `actionTypeId` state, ~line 141):
  - `openInlineFormId: string | null`
  - `openInlineForm(id)` callback — closes the create-flyout, toggles the inline form for that id.
  - `closeInlineForm()` callback.
  - Effect that force-closes the inline form when `actionTypeId` becomes truthy (mutual exclusion).
- `buildWorkItemsColumns` call (line 187) now passes `{ onTypeBadgeClick: openInlineForm }`.
- New `inlineFormNode` JSX rendered between `createFlyoutNode` and `<BulkActionBar>`. `resourceUrl` already in scope (line 163-164); `scope` comes from `config.scope ?? "work"`.

### Tech debt register (`docs/c_tech_debt.md`)

4 new entries appended just before the "Anti-patterns" section:

- `TD-ARTEFACT-INLINE-FORM-FIELDLIB-LEFTOVERS` (S3) — dual storage path between column and field-values for `colour`, `is_blocked`, `blocked_reason`, `story_points`.
- `TD-ATTACHMENTS-WIRING` (S3) — left-column drop-zone is a labelled stub; needs upload pipeline + storage backing.
- `TD-PARENT-CANDIDATES-DYNAMIC` (S3) — `PARENT_PREFIX_MAP` is hard-coded; promote to runtime resolution via `artefact_types.parent_type_id` chain.
- `TD-COLOUR-PICKER-CSS-RENAME` (S3) — `at-colour-*` classes survived the component promotion.

---

## Verification status

| Check | Result |
|-------|--------|
| `go build ./...` (backend) | ✅ Clean |
| `tsc --noEmit -p tsconfig.json` | ✅ Clean |
| `lint:no-raw-table` | ✅ OK — 11 matches, all exempt |
| `lint:page-description` | ✅ OK — 21 pages, 61 exempt |
| `lint:api-caller-discipline` | ✅ OK — 327 files, 2 exempt |
| Backend route probe — `GET /_site/timeboxes/milestones?workspace_id=...` | ✅ 401 (auth required — expected) |
| Backend route probe — `GET /_site/lookups/users-in-scope` | ✅ 401 (auth required — expected) |
| DB verification — 4 new columns on `artefacts`, 3 seed rows in `timeboxes_milestones` | ✅ Confirmed via `psql` |
| Browser smoke test on `/work-items` | ⚠️ **Not yet done** |
| Browser smoke test on `/portfolio-items` | ⚠️ **Not yet done** |

---

## What to test next (acceptance checks)

The plan file lists 18 acceptance criteria. The critical ones for first-look smoke testing:

1. **Badge becomes a button** — visit `http://localhost:3000/work-items`, click an `EP`/`US`/`TA` badge. Form should slide down beneath the action bar with smooth `grid-template-rows` transition.
2. **Pre-population** — opened form shows the row's actual title, description, parent, flow state, etc.
3. **Single-open** — click badge B while form A is open → A collapses, B opens.
4. **Mutex with create-flyout** — open form, click "Create New" → form collapses, create-flyout opens.
5. **Auto-save** — edit title, blur → Network tab shows `PATCH /_site/work-items/{id}` with `{ title }`. Reload → persisted.
6. **Parent dropdown logic** — open a Task → parent options are Defects + Stories. Open a Story → Features + Epics. Open a Defect → Epics + Stories.
7. **Milestone dropdown populated** — three seeded dev milestones appear (Alpha launch, Beta launch, GA).
8. **Owner picker** — should list users from the new `lookups.usersInScope()` endpoint (not from admin-gated user list).
9. **Blocked toggle** — green → red transition reveals reason textbox; blur on textbox PATCHes `blocked_reason`.
10. **Cross-surface** — navigate to `/portfolio-items`, click an EP badge → same form opens, network requests go to `/_site/portfolio-items/*`.
11. **Finished button** — collapses the form, no extra network call.
12. **ColourPicker promotion no regression** — open `/workspace-admin/artefacts/artefact-types` and `/workspace-admin/flow-states` — both pages still work, no visual change.

---

## Known gaps + risks

### Gaps the plan acknowledged

- **Attachments** — left-column drop-zone is a labelled stub. Tracked as `TD-ATTACHMENTS-WIRING`.
- **Flow-state dropdown not type-filtered** — for v1 the form fetches all flow states across the subscription (matches the existing `useWorkItemFlowStates` hook pattern). The user could see "wrong" flow states for cross-type artefacts. Cheap fix later: pass `artefact_type_id` to the query — but that requires exposing `artefact_type_id` on the WorkItem wire shape first (it's currently derived in SQL but not projected). The form's right column doesn't have an ID column to filter against today.
- **Parent prefix map hard-coded** — tracked as `TD-PARENT-CANDIDATES-DYNAMIC`. Tenant-added custom artefact types can't be parented via the form until this is dynamic.

### Risks I want to flag explicitly

1. **The badge `<span>` → `<button>` swap.** The existing `.tree_accordion-dense__type-badge` CSS rule sets `display: inline-flex` + colours. I added `border:0; cursor:pointer; outline:none;` + a `:focus-visible` box-shadow to the rule. Visual should be identical, but if the row's height baseline shifts by a pixel under certain themes, that's where to look first.
2. **`onSaved` mirrors into `patchAndApply`.** The form calls `onSaved(body)` which the host wires to `patchAndApply(openInlineFormId, body)` — but `patchAndApply` expects the `WorkItem` row shape. If you PATCH a field that's NOT on the existing `WorkItem` interface in [work-items-tree-config.tsx:74-100](app/components/work-items-tree-config.tsx#L74-L100), the optimistic update is a no-op (the row in the tree won't reflect the change until a hard refresh). The `WorkItem` interface currently has `title`, `flow_state_id`, `story_points`, `sprint_id`, `parent_id`, `owner_id`, `due_date`, `topology_node_id`, etc. — but NOT `colour`, `is_blocked`, `blocked_reason`, `release_id`, `milestone_id`. Adding those fields to `WorkItem` is a single-file diff if/when tree-row optimism is important.
3. **`workspaceId` from `useActiveWorkspace`.** The form depends on `useActiveWorkspace()` returning a non-null value to fetch dropdowns. If the user lands on `/work-items` with no active workspace selected, all dropdowns will be empty. Behaviour is graceful (empty options) but worth being aware of.
4. **Backend hot-reload pickup.** Air is running on the backend (PID 83673 was `/tmp/vector-backend`). The new routes work because air rebuilt on save. Anyone restarting manually needs `<server> -d` to apply the new `lookups` + `timeboxmilestones` packages.
5. **Existing field-library bindings for promoted columns.** Migration 075 seeded a `blocked_reason` field-library binding for risk-type artefacts. The form now writes to the COLUMN, not the binding. Old data that lives only in the field-values rows won't appear in the form. Tracked as `TD-ARTEFACT-INLINE-FORM-FIELDLIB-LEFTOVERS`.

---

## How to extend the form to a new surface

The form is driven by 5 props. To use it on a new page (e.g. `/sprints/{id}` showing artefacts in that sprint):

```tsx
import ArtefactInlineForm from "@/app/components/ArtefactInlineForm";

<ArtefactInlineForm
  artefactId={selectedArtefactId}      // null = collapsed
  resourceUrl="/work-items"             // or "/portfolio-items"
  scope="work"                          // or "strategy" — affects parent candidates
  onClose={() => setSelectedArtefactId(null)}
  onSaved={(body) => {
    // Optional — mirror PATCH into your local row state for optimistic UI
  }}
/>
```

The host needs to render the form ONCE per page (single-open is enforced by the host owning `selectedArtefactId`). The form's animation envelope handles its own visibility based on whether `artefactId` is null.

---

## Touchpoints in CLAUDE.md (HARD RULEs honoured)

- **siteAPI only** ✅ — every read/write goes through `apiSite*`. No raw fetch, no `/api/...`.
- **Server-side is the gate** ✅ — topology/sprints/releases/milestones/users-in-scope all clamp by subscription + topology server-side. Form is defence-in-depth.
- **Substrate prefix on new vector_artefacts** ✅ — migration 087 brought milestones into convention.
- **Never assume a DB** ✅ — milestones uses `vaPool`; lookups uses `pool`. Both pool choices documented in their service constructors and traceable through `main.go`.
- **HARD RULE — Backend env pinned to dev** ✅ — all work against `:5435` tunnel via `backend/.env.dev`.

---

## Commit guidance

When committing, group as:

1. **Migrations** — 084 + 085 + 086 + 087 (+ DOWN scripts) as one logical chunk.
2. **Backend services** — artefactitems updates + timeboxmilestones + lookups + main.go wiring as the second commit.
3. **Frontend** — siteAPI additions + ColourPicker promotion + ArtefactInlineForm + ObjectTree integration + globals.css + TD entries as the third commit (or split if it gets too big).

Each commit should be runnable in isolation (backend works without frontend; frontend gracefully handles 404 on missing endpoints).

Do not commit without explicit user instruction — per the standing rule the user hasn't said "commit this" yet.
