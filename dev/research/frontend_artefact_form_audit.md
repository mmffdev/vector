# Frontend artefact-form audit

**Date:** 2026-05-29
**Scope:** Discovery audit for the core-field demotion project (see `handovers/a_customFields_coreDemotion.md`). Read-only. No edits. No git. No DB writes.

What the frontend surfaces TODAY for an artefact row, and what each demotion candidate would need.

---

## ArtefactInlineForm fields rendered today

The slide-out inline edit panel (`ArtefactInlineForm`) is mounted at the bottom of the OTV2 grid when a row is clicked. Body lives in `app/components/ArtefactInlineForm/ArtefactInlineForm.tsx`.

| # | Field (in UI order) | DB column / PATCH key | Control type | File:line |
|---|---|---|---|---|
| 1 | Title | `artefacts.artefacts_title` → PATCH `title` | `<input type="text">` (local draft, commit on blur) | `ArtefactInlineForm.tsx:282-293` |
| 2 | Description (rich text) | `artefacts.artefacts_description_doc` (JSONB) → PATCH `description_doc`. Legacy `artefacts_description` (TEXT) used as fallback seed only | `<RichTextField>` (TipTap) | `ArtefactInlineForm.tsx:303-321` |
| 3 | Attachments | (stub — not wired; TD-ATTACHMENTS-WIRING) | static `<div>` placeholder | `ArtefactInlineForm.tsx:324-329` |
| 4 | Created / Last updated | `created_at`, `updated_at` | read-only text spans | `ArtefactInlineForm.tsx:331-334` |
| 5 | Hierarchy snapshot | `parent_id` + self ref | `<ArtefactNodeDiagram>` (read+navigate) | `ArtefactInlineForm.tsx:339-351` |
| 6 | Blocked (toggle + reason) | `artefacts.artefacts_is_blocked` + `artefacts_blocked_reason` → PATCH `is_blocked` / `blocked_reason` | `<BlockedToggle>` — icon button + reveal-on-blocked `<textarea>` | `ArtefactInlineForm.tsx:356-361`, body `BlockedToggle.tsx:42-73` |
| 7 | Topology node | `topology_node_id` | native `<select>` (inline) | `ArtefactInlineForm.tsx:363-381` |
| 8 | Colour | `artefacts.artefacts_colour` → PATCH `colour` | `<ColourPicker>` | `ArtefactInlineForm.tsx:383-389` |
| 9 | Owner | `owned_by_user_id` | native `<select>` (inline) | `ArtefactInlineForm.tsx:391-407` |
| 10 | Flow state | `flow_state_id` (locked when derived from children) | native `<select>` (inline) | `ArtefactInlineForm.tsx:409-444` |
| 11 | Plan estimate (points) | `artefacts.artefacts_story_points` → PATCH `story_points` | `<input type="number">` (local draft, commit on blur) | `ArtefactInlineForm.tsx:446-462` |
| 12 | Parent | `parent_id` → PATCH `parent_artefact_id` | native `<select>` w/ optgroups | `ArtefactInlineForm.tsx:464-487` |
| 13 | Sprint | `sprint_id` | native `<select>` (inline) | `ArtefactInlineForm.tsx:489-501` |
| 14 | Release | `release_id` | native `<select>` (inline) | `ArtefactInlineForm.tsx:503-515` |
| 15 | Milestone | `milestone_id` | native `<select>` (inline) | `ArtefactInlineForm.tsx:517-531` |
| 16 | Custom Fields (per-type) | `artefacts_fields_values` via `/{resource}/{id}/field-values` | `<EditCustomFields>` — dynamic dispatch on `field_type`: textbox / richtext (textarea) / integer / decimal / date / boolean (select Yes/No) / select / radio (select) / multiselect / url / user | `ArtefactInlineForm.tsx:539-543`, body `EditCustomFields.tsx:131-318` |

**Notes on existing primitives the form uses (relevant for additions):**

- `<BlockedToggle>` — `app/components/ArtefactInlineForm/BlockedToggle.tsx` — pattern: green/red icon button + reveal-on-true textarea. Bespoke per-feature; **not a generic boolean primitive**.
- `<RichTextField>` — `app/components/RichTextField/` — TipTap editor returning a ProseMirror JSON doc.
- `<InlineSelect>` — `app/components/InlineSelect.tsx` — used in the GRID (`work-items-tree-config.tsx`), NOT in the inline form. Inline form uses native `<select>` throughout.
- `<InlineEditField>` — `app/components/InlineEditField.tsx` — click-to-edit text/number; used in the GRID (title cell, points cell), NOT in the inline form (the form uses native `<input>` w/ local draft + blur commit).
- `EditCustomFields` switch already covers `boolean` (as a select), `select`, `textbox`, `integer`, `decimal`, `richtext` (as a plain `<textarea>`, **not** a full TipTap editor — see Surprises below).

---

## ObjectTreeV2 columns toggleable today

The grid's column catalogue is **server-driven** — `useColumnCatalogue.ts` fetches `GET <resourceUrl>/columns` which returns `backend/internal/artefactitems/columns.go::ArtefactItemColumns` (a `[]ColumnSpec` allow-list). The picker UI is `app/components/ObjectTreeV2/plugins/ColumnPicker.tsx`. Custom-field columns are **intentionally not merged** (see `useColumnCatalogue.ts:14-23` — gated by TD-OBJECTTREE-PICKER-CUSTOM-FIELDS).

Actual rendered columns are produced by `buildWorkItemsColumns()` in `app/components/work-items-tree-config.tsx`. The picker can advertise more columns than the renderer covers — extra ones come through as the field on the wire but have no custom render (default cell formatting).

### A. Catalogue entries the picker advertises (from `backend/internal/artefactitems/columns.go:69-124`)

| Wire-key | Label | Group | Default visible | Addable |
|---|---|---|---|---|
| `id` | ID | Identity | yes (always-on) | no |
| `key_num` | # | Identity | yes | yes |
| `type_prefix` | Type Prefix | Identity | no | yes |
| `item_type` | Type | Identity | yes | yes |
| `artefact_type_id` | Artefact Type ID | Identity | no | yes |
| `title` | Title | Content | yes | no |
| `description` | Description | Content | no | yes |
| `description_doc` | Description (Doc) | Content | no | yes |
| `status` | Status | Workflow | yes | yes |
| `flow_state_id` | Flow State ID | Workflow | no | yes |
| `flow_state_name` | Flow State | Workflow | yes | yes |
| `flow_state_code` | Flow State Code | Workflow | no | yes |
| `priority_id` | Priority ID | Priority & Estimation | no | yes |
| `priority` | Priority | Priority & Estimation | yes | yes |
| `story_points` | Story Points | Priority & Estimation | yes | yes |
| `rollup_points` | Rollup Points | Priority & Estimation | no | yes |
| `sprint_id` | Sprint ID | Planning | no | yes |
| `sprint` | Sprint | Planning | yes | yes |
| `release_id` | Release | Planning | yes | yes |
| `milestone_id` | Milestone | Planning | no | yes |
| `due_date` | Due Date | Planning | no | yes |
| `parent_id` | Parent | Hierarchy | yes | yes |
| `root_feature_id` | Root Feature | Hierarchy | no | yes |
| `children_count` | Children | Hierarchy | no | yes |
| `owner_id` | Owner ID | People | no | yes |
| `owner` | Owner | People | yes | yes |
| `created_by` | Created By | People | no | yes |
| `topology_node_id` | Topology Node | Topology | no | yes |
| `colour` | Colour | Visual | no | yes |
| `is_blocked` | Blocked | Visual | yes | yes |
| `blocked_reason` | Blocked Reason | Visual | no | yes |
| `subscription_id` | Subscription | Audit | no | yes |
| `created_at` | Created | Audit | no | yes |
| `updated_at` | Updated | Audit | no | yes |
| `archived_at` | Archived | Audit | no | yes |

### B. Columns the renderer actually paints (custom cell render fns)

From `buildWorkItemsColumns()` in `work-items-tree-config.tsx`:

| Key | Header label | Render fn / cell | File:line |
|---|---|---|---|
| `id` | ID | `<IdCell>` (tree-line + expander + ID button) | `work-items-tree-config.tsx:518-529`, body `:238-274` |
| `title` | Summary | `<SummaryCell>` (type badge + inline-edit title) | `:530-545`, body `:276-333` |
| `status` | Status | `<StatusCell>` (`<FlowStatePillRow>`) | `:546-560`, body `:335-375` |
| `priority` | Pri | `<PriorityCell>` (`<InlineSelect>` w/ pill trigger) | `:561-567`, body `:377-408` |
| `points` | Pts | `<PointsOwnerCell>` (`<InlineEditField>` numeric) | `:568-576`, body `:410-448` |
| `owner` | Owner | `<OwnerChip>` | `:577-588` |
| `parent` | Parent | inline span w/ parent id + title | `:589-610` |
| `sprint` | Sprint | inline span (alias) | `:611-619` |
| `due` | Due | `<DueCell>` (click-to-edit `<input type="date">`) | `:620-632`, body `:456-500` |

Other catalogue keys (e.g. `is_blocked`, `blocked_reason`, `colour`, `topology_node_id`, `release_id`, `milestone_id`, etc.) come through the wire but get default cell rendering — no per-key renderer.

---

## Demotion-candidate frontend readiness

For each candidate the task asks about: does an inline-form input exist? does the grid have a column entry?

| Candidate | Type | Inline form? | Grid catalogue entry? | Grid custom renderer? | Verdict |
|---|---|---|---|---|---|
| `blocked` | boolean | YES — `<BlockedToggle>` at `ArtefactInlineForm.tsx:356-361` (PATCH `is_blocked`) | YES — `is_blocked` at `columns.go:116` | NO (default rendering) | NEEDS-COL-RENDERER (inline form done) |
| `blocked_reason` | textbox | YES — inside `<BlockedToggle>` reveal-textarea at `BlockedToggle.tsx:57-71` | YES — `blocked_reason` at `columns.go:117` | NO | NEEDS-COL-RENDERER (inline form done) |
| `browser` | textbox | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `environment` | textbox | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `expedite` | boolean | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `ready` | boolean | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `regression` | boolean | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `defect_severity` | select | NO | NO | NO | NEEDS-INLINE-AND-COL (also needs option source — see Q below) |
| `estimate_hours` | decimal | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `estimate_remaining` | decimal | NO | NO | NO | NEEDS-INLINE-AND-COL |
| `notes` | richtext | NO | NO | NO | NEEDS-INLINE-AND-COL — `<RichTextField>` is already used for description so the primitive exists |
| `steps_to_reproduce` | richtext | NO | NO | NO | NEEDS-INLINE-AND-COL — same as `notes` |
| `risk_impact` | select | NO | NO | NO | NEEDS-INLINE-AND-COL (also needs option source) |
| `risk_probability` | select | NO | NO | NO | NEEDS-INLINE-AND-COL (also needs option source) |
| `risk_score` | decimal | NO | NO | NO | NEEDS-INLINE-AND-COL (computed? — see notes below) |

`blocked` / `blocked_reason` are NOT fully READY: inline form is done, but the grid only advertises them in the column catalogue — there is no per-key cell renderer in `buildWorkItemsColumns()`. They show as default-formatted text today. If we want a visible pill / icon / wrapped-text in the grid for these, we still owe a render fn.

---

## What needs adding per candidate

The two existing primitive patterns the new core columns should mirror:

- **Boolean** — inline form: bespoke is the `<BlockedToggle>` precedent (icon button), but it's bespoke per-feature with reveal logic. For plain booleans without a reveal target the cheapest pattern is a native `<select>` with Yes/No (same shape as `EditCustomFields.tsx:208-224`). For new core booleans without reveals, recommend a small generic `<BooleanToggle>` primitive. **NO generic boolean control exists today** in `ArtefactInlineForm/`.
- **Textbox** — inline form: native `<input type="text">` with local-draft state + blur commit (pattern at `ArtefactInlineForm.tsx:284-292` for Title). No generic `InlineEditField` wrapper is used inside the form (it's used in the grid only).
- **Decimal / number** — inline form: native `<input type="number" step="any">` with local-draft state (pattern at `ArtefactInlineForm.tsx:448-461` for Story Points but `step={1}`). Pattern is fine.
- **Select** — inline form: native `<select>` with options (pattern at `ArtefactInlineForm.tsx:392-407` for Owner). No `<InlineSelect>` usage inside the form.
- **Richtext** — inline form: `<RichTextField>` already in use for description at `:303-321`. Pattern is fine; just point at a new PATCH key per field. **Caveat:** `EditCustomFields` does NOT use `<RichTextField>` for its `richtext` case — it uses a plain `<textarea>` (`EditCustomFields.tsx:149-161`). Reusing `RichTextField` for the core columns would be inconsistent with how the catalogue's `richtext` type renders today.

### Per-candidate additions

For all new core columns the work to do is the same shape: add an inline-form input + a grid column catalogue entry + (optionally) a grid render fn. File:line for additions:

**Inline form (single mount point):** `app/components/ArtefactInlineForm/ArtefactInlineForm.tsx`, in the right column between line ~531 (after Milestone) and line ~543 (before `<EditCustomFields>` — keeping custom fields the last block). Each new field follows the existing labelled `<label class="artefact-inline-form__Field">` pattern.

**Grid catalogue:** `backend/internal/artefactitems/columns.go::ArtefactItemColumns` — append entries after the existing "Visual" group (lines 114-118) for blocked/colour/is_blocked siblings, or open a new group e.g. "Quality" or "Estimation" if the candidate clusters call for it.

**Grid renderer:** `app/components/work-items-tree-config.tsx::buildWorkItemsColumns()` — append `ColumnDef` entries after line 632. Only worth doing for ones that need custom display (booleans rendered as a tick, selects rendered as pills, etc.); default rendering is good enough for textbox/decimal.

**Wire shape (must be in `WorkItem` interface):** `app/components/work-items-tree-config.tsx:52-108`. Every new column needs a typed field here, plus matching fields in `ArtefactInlineForm/types.ts::ArtefactDetail` (lines 58-96) so the inline form can read/PATCH.

Concrete mapping (per candidate, file:line of the addition):

| Candidate | Inline form control | Inline form add at | Grid catalogue add at | Grid renderer needed | WorkItem / ArtefactDetail wire field add |
|---|---|---|---|---|---|
| `blocked` | already done (`<BlockedToggle>`) | n/a | already done | OPTIONAL — render fn at `work-items-tree-config.tsx:632` | `is_blocked` already on wire |
| `blocked_reason` | already done (textarea inside BlockedToggle) | n/a | already done | OPTIONAL — render fn at `work-items-tree-config.tsx:632` | `blocked_reason` already on wire |
| `browser` | native `<input type="text">` (Title pattern) | `ArtefactInlineForm.tsx:531` | `columns.go:118` | NO — default text cell | Add to `WorkItem` (~line 108) + `ArtefactDetail` (~line 90) |
| `environment` | native `<input type="text">` | `ArtefactInlineForm.tsx:531` | `columns.go:118` | NO | Add to wire interfaces |
| `expedite` | NEW generic `<BooleanToggle>` OR native `<select>` Yes/No | `ArtefactInlineForm.tsx:531` | `columns.go:118` | YES — boolean pill | Add to wire interfaces |
| `ready` | NEW generic `<BooleanToggle>` OR native `<select>` Yes/No | `ArtefactInlineForm.tsx:531` | `columns.go:118` | YES — boolean pill | Add to wire interfaces |
| `regression` | NEW generic `<BooleanToggle>` OR native `<select>` Yes/No | `ArtefactInlineForm.tsx:531` | `columns.go:118` | YES — boolean pill | Add to wire interfaces |
| `defect_severity` | native `<select>` (Owner pattern at :392-407) | `ArtefactInlineForm.tsx:531` | `columns.go:118` (probably under new "Quality" group) | YES — pill modifier per slot | Add to wire interfaces. Option source needed (hardcoded enum vs catalogue table). |
| `estimate_hours` | native `<input type="number" step="any">` (Points pattern at :448-461) | `ArtefactInlineForm.tsx:531` | `columns.go:118` (Priority & Estimation group at line 88) | NO — default numeric cell | Add to wire interfaces |
| `estimate_remaining` | native `<input type="number" step="any">` | `ArtefactInlineForm.tsx:531` | `columns.go:118` (Priority & Estimation group at line 88) | NO | Add to wire interfaces |
| `notes` | `<RichTextField>` (description pattern at :303-321) | `ArtefactInlineForm.tsx:531` | `columns.go:118` (Content group at line 77) | NO — default text cell (probably truncated) | Add `notes` + `notes_doc` to wire interfaces |
| `steps_to_reproduce` | `<RichTextField>` | `ArtefactInlineForm.tsx:531` | `columns.go:118` (new "Defect" group?) | NO | Add `steps_to_reproduce` + `_doc` to wire |
| `risk_impact` | native `<select>` | `ArtefactInlineForm.tsx:531` | `columns.go:118` (new "Risk" group) | YES — pill | Add to wire. Option source needed. |
| `risk_probability` | native `<select>` | `ArtefactInlineForm.tsx:531` | `columns.go:118` (new "Risk" group) | YES — pill | Add to wire. Option source needed. |
| `risk_score` | derived (`impact × probability`) — read-only `<span>` OR `<input type="number">` | `ArtefactInlineForm.tsx:531` | `columns.go:118` (new "Risk" group) | OPTIONAL — colour-band cell | Add to wire (read-only). Compute server-side. |

---

## Summary

- **Already wired (no FE changes):** **0** — even `blocked` / `blocked_reason`, the most-baked candidates, are missing per-key grid renderers (they show as default-rendered cells today).
- **Need inline-form addition only:** 0 (everything that needs inline-form work also needs grid work)
- **Need grid column-catalogue addition only:** 0 (all the not-yet-wired candidates need both the catalogue entry AND a wire-shape addition; grid renderer is optional for plain-text/numeric, mandatory for booleans/selects/richtext)
- **Need both inline-form AND grid:** **13** — `browser`, `environment`, `expedite`, `ready`, `regression`, `defect_severity`, `estimate_hours`, `estimate_remaining`, `notes`, `steps_to_reproduce`, `risk_impact`, `risk_probability`, `risk_score`
- **Partially wired — needs grid renderer only:** **2** — `blocked` (`is_blocked`), `blocked_reason`. Catalogue entries exist; inline form is done. Just no custom render fn in the grid.

### Need a NEW control type entirely

- **Generic `<BooleanToggle>`** — the codebase has `<BlockedToggle>` (bespoke: green/red icon, reveal-on-true textarea) but **no generic on/off toggle**. `EditCustomFields` falls back to a `<select>` with Yes/No options for booleans, which works but is not the SaaS norm and doesn't read well in the design-ethos "wow with colour + craft" frame. Worth building one primitive for `ready` / `expedite` / `regression`, reused across all three.
- **Select-with-pill-styling primitive** — `<InlineSelect>` exists but is used in the grid only and renders a custom-trigger (e.g. priority pill). For the inline form's right column, a styled select primitive that matches the priority pill's visual weight would be ideal for `defect_severity` / `risk_impact` / `risk_probability` (P0/P1/P2 vibe applied to severity tiers).

### Things that surprised the audit

1. **`is_blocked` and `blocked_reason` are in the column catalogue but have NO custom grid renderer.** They come through the wire (the backend handler returns them, the catalogue advertises them, the picker can toggle them on) but the grid paints them as default text cells. The handover doc says "the substrate, backend, and UI for these two are already done as core" — that's true for the inline form, not for the grid. Worth flagging to Rick before claiming "READY".

2. **`EditCustomFields` renders `richtext` as a plain `<textarea>`, not a `<RichTextField>` (TipTap).** See `EditCustomFields.tsx:149-161`. So custom-field richtext today is a multiline-text experience, not a true rich-text experience. Demoting `notes` / `steps_to_reproduce` to core and wiring them via `<RichTextField>` would actually IMPROVE the editing UX for those fields — the demotion is a quality win, not just a metadata cleanup.

3. **The inline form uses native `<select>` and native `<input>` everywhere** — none of the inline-form right-column fields use `<InlineSelect>` or `<InlineEditField>` (those primitives live in the grid). The inline form's design language is "labelled native control"; the grid's is "click-to-edit inline trigger". Two parallel patterns — relevant when sketching what new core fields should look like in the form.

4. **Column catalogue is server-driven** (`useColumnCatalogue.ts` fetches `/work-items/columns` → `ColumnSpec[]` from `backend/internal/artefactitems/columns.go`). So every new core column reaches the picker by editing `columns.go` alone — no parallel TS constant. This is good news for the demotion work: backend-only catalogue edits land in the UI automatically.

5. **Custom-field columns are intentionally NOT in the column catalogue** (see `useColumnCatalogue.ts:14-23`, gated by TD-OBJECTTREE-PICKER-CUSTOM-FIELDS). So once a row is demoted from custom → core, it MUST gain a column-catalogue entry to remain visible in the picker — there's no fallback path.

6. **No `<form>` wrapper anywhere in `ArtefactInlineForm.tsx`.** Each labelled control commits independently via `patch({...})` on blur. The "Finished" button at the bottom is purely UX — it does nothing but close the panel. No native form-submit semantics to worry about when adding fields.

7. **`<EditCustomFields>` handles the `boolean` type with a `<select value="" | "true" | "false">`** (lines 208-224), but the value is stored as a string ("true" / "false"). If we keep custom-fields rendering and demote some booleans to core, the two coexisting boolean experiences (bespoke `<BlockedToggle>` for blocked, custom-field select for any catalogue boolean) will diverge visually unless we standardise the new core booleans on a generic primitive.

8. **`risk_score` is listed as `decimal` in the candidate set** but it's a derived value (`risk_impact × risk_probability`). Worth confirming with Rick whether the user types it (overridable) or it's server-computed (read-only display).

