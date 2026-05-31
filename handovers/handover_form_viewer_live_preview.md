# Handover — FLB Form Viewer: Live-Data Artefact Preview Dropdown

**Written:** 2026-05-30 (end of FLB session, pre context-wipe)
**Author:** Claude (governing agent)
**Pairs with:** `handovers/handover_unified_field_registry.md` (the substrate this consumes — read it for how fields/values are modelled)
**Design doc:** `docs/superpowers/specs/2026-05-30-form-layout-builder-design.md` (FLB overall)

---

## 1. The feature Rick asked for (verbatim intent)

> "when you show the form preview, i want you to add a dropdown at the top of the form that lists all the artefacts we have in the artefacts table of that kind, so i can select one and show the form populate, so if defect form, show defects, in accordance with the topology clamp"

So: in the FLB **preview** pane, add a **dropdown at the top** listing real artefacts of the current artefact-type (e.g. a Defect form → lists Defects), **scoped by the sentinel topology clamp**. Selecting one **populates the preview with that artefact's real field values** instead of empty placeholders. Today's preview (`FormPreview` in `FormBuilderShell.tsx` ~line 770) renders disabled inputs with the field LABEL as placeholder — pure layout check, no data. This feature turns it into a real-data preview.

---

## 2. Current state of the preview (what exists today)

- **`app/components/FormLayoutBuilder/FormBuilderShell.tsx`**
  - `FormBuilderShellProps` (line ~57): already has `nodeId: string` and `artefactTypeId: string` as props. **Both IDs are in hand — no new plumbing to get them.**
  - `previewing` state (line ~122) toggles preview vs edit. Preview renders `<FormPreview rows={state.rows} fieldByKey={fieldByKey} />` (line ~370).
  - `FormPreview` (line ~770): maps `state.rows` through `FormLayoutRenderer`, each placed cell → `<PreviewField label dataType />` (disabled input). Empty cells → `flb-preview__Empty`.
  - `PreviewField` (line ~802): disabled input/textarea/select/toggle keyed off `dataType`, `placeholder={label}`.
  - `fieldByKey` is a `Map<string, CoreFieldDescriptor>` already built in the shell (used by the canvas + preview).

- **`app/components/FormLayoutBuilder/FormLayoutRuntime.tsx`** — THIS IS YOUR TEMPLATE. It already does almost exactly what the preview needs, but for the runtime (real artefact) context: it fetches a layout + field catalogue + an artefact's custom values, builds a `values` map, and renders via `FormLayoutRenderer` with a `renderCell` that binds real values. **Copy its value-binding pattern into the preview.** Key bits:
  - `valueFromWire(fv)` (line 43) — collapses the 5 EAV typed buckets to a display string.
  - `getValue(key)` (line 127) — core keys read from `coreValues`, `custom:` keys from the EAV `values` map.
  - The `Promise.all([...])` value-load (line 81): `getCurrentLayout`, `getCoreFields`, and `apiSite('${path}/${artefactId}/field-values')`.

---

## 3. The data path (CORRECT, post-`meg=` correction)

**Scoping:** the topology clamp is owned by sentinel server-side — `sentinel.FromCtx(ctx).AllowedSubtreeIDs`, applied fail-closed in the artefacts List service via `sentinel.SubtreeClause`. **DO NOT pass `meg=` to scope the dropdown.** `meg=` is a user bookmark/share URL param (written by `SentinelProvider.setFocus()`, read by sentinel, named after Megan PLA-0053) and auto-forwarded by `withForwardedMeg` — it is a NARROW hint with no authority. The list is automatically scoped to the user's current topology focus by the clamp. (This was a correction Rick made this session; CLAUDE.md tracing-authority entry + diagnose skill both updated with the call-site corollary.)

**(a) List artefacts of this type, clamped:**
```ts
// app/lib/apiSite/index.ts — workItems.list(params: string)
siteApi.workItems.list(`?item_type_id=${artefactTypeId}`)
// → GET /work-items?item_type_id=<typeId>
// Sentinel clamp scopes to current node + allowed subtree, fail-closed.
// Response: { items: WorkItem[], total }. Each item carries id, title,
// owner, flow_state_name + core columns.
```
Backend handler: `backend/internal/artefactitems/handler.go` List method (~line 249). It reads `sentinel.WorkspaceIDFromCtx` (ESTABLISH) + applies the subtree clamp (ESTABLISH); `item_type_id` is a pure selection filter (NARROW). Paginates via `limit`/`offset` (default 50 — for a dropdown, pass `&limit=100` or similar; if a type has >100 artefacts, consider a typeahead later — note the cap, don't silently truncate).

**(b) On select — load the chosen artefact's values:**

> **IMPORTANT — values live in TWO homes today (see registry handoff §2).** Core values = typed columns on the `artefacts` row. Custom values = EAV rows in `artefacts_fields_values`. The "one table" fold was examined and REJECTED as a regression (design doc §Critical substrate facts). So a faithful preview needs both:
> - **Core:** `workItems.get(id)` → full `WorkItem` (title, owner, flow_state_name, defect_severity, all core columns).
> - **Custom:** `workItems.getFieldValues(id)` → `{ field_values: FieldValueWire[] }` (EAV; backend `handler.go` ListFieldValues ~line 1426). Map each `custom:<field_library_id>` → `valueFromWire`.

**When the registry handoff lands**, the registry tells you each field's `valueLocation` (`artefacts_column` | `eav`), so the merge becomes mechanical. Until then, hardcode the two-read merge (core keys from `.get`, `custom:` keys from `.getFieldValues`). If Rick insists on ONE read before the registry lands, that's only possible for CORE fields (`.get` alone) — custom fields would show blank. Flag that trade-off; don't silently ship a half-empty preview as if it were complete.

---

## 4. What to build

1. **Dropdown component** at the top of the preview pane (inside `FormPreview` or a new `PreviewDataPicker`). On preview-mode enter (or lazily on first open), call `workItems.list('?item_type_id=' + artefactTypeId + '&limit=100')`. Populate `<select>` with `items` → option label = `item.title` (fall back to id). Add a leading "— Select a {typeLabel} to preview —" empty option that keeps the current placeholder behaviour (so preview still works with no selection).
2. **On select**, fetch `.get(id)` + `.getFieldValues(id)` in parallel, build a `values: Record<string,string>` (core from the WorkItem by key, `custom:<libId>` from `valueFromWire`). Reuse `FormLayoutRuntime`'s `valueFromWire` + `getValue` shape — consider extracting them to a shared helper if duplication bothers you (NCY).
3. **Populate the preview**: change `PreviewField` to accept an optional `value` and render it (still disabled — preview is read-only). When no artefact is selected, `value` is undefined → falls back to `placeholder={label}` exactly as today. When selected, shows the real value.
4. **Loading + empty states**: while fetching, show a subtle loading affordance (reuse `flb-runtime__Loading` styling or a `flb-preview` variant). If the type has zero artefacts under the clamp, the dropdown shows only the empty option + a hint ("No {type} artefacts in this scope yet").
5. **CSS**: add `flb-preview__Picker` (+ `_Select`, `_Hint`) to `app/globals.css` near the existing `flb-preview__*` block. Catalog class first, NO inline `style={{}}`, naming `root-block__Container_Child_leaf` (here `flb-preview__Picker`). FLB classes are all `flb-*`.

---

## 5. Gotchas / landmines

- **NEVER pass `meg=` to scope the list** (see §3). The clamp does it. If you catch yourself adding `&meg=`, stop.
- **SERVER IS THE GATE** — the list endpoint already filters by the sentinel clamp; you're consuming an already-scoped result, which is correct. Don't add a client-side node filter and call it security.
- **Two reads is correct today, not a bug** — it reflects the real two-home substrate. Don't "optimise" to one read and lose custom values. When the registry lands, the merge gets cleaner but it's still two value sources physically.
- **Preview stays read-only** — disabled inputs. This is a layout+data preview, not a data-entry surface. No PATCH/PUT.
- **`workItems.get` returns `unknown`** in the client (`apiSite/index.ts:294`) — you'll need a light type/shape for the core fields you read (title, owner, flow_state_name, + whatever the layout places). Map by the same `fieldKey` vocabulary the descriptors use.
- **Core field key ↔ WorkItem json tag**: the `CoreFieldDescriptor.fieldKey` (e.g. `"title"`, `"flow_state_name"`, `"owner"`) should match the WorkItem JSON field names. Verify a couple against `backend/internal/artefactitems/types.go` WorkItem struct json tags before assuming — owner may be a nested `{id,email,display_name}` object, so `owner` likely needs `.display_name`. Handle the nested-object core fields (owner, priority) explicitly.
- **Don't commit unless Rick asks.** Dirty MFA file + playwright scripts stay unstaged.
- **Test in the browser** (golden path + a type with zero artefacts + a type with custom fields that have values) before calling it done — UI correctness isn't proven by tsc.

---

## 6. Definition of done
1. Dropdown at top of preview lists clamp-scoped artefacts of the current type (verified: a Defect form lists Defects, scoped to the focused node).
2. Selecting one populates every PLACED field in the preview with that artefact's real value — core (from `.get`) and custom (from `.getFieldValues`).
3. No selection → preview falls back to today's label-placeholder behaviour.
4. Zero-artefact and loading states handled; >100 cap noted (not silently truncated).
5. No `meg=` at any call site. Scoping proven to come from the sentinel clamp.
6. `tsc --noEmit` clean; CSS uses `flb-preview__*` catalog classes, no inline styles.
7. Browser-tested on the three cases above.
