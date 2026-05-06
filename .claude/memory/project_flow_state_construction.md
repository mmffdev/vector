---
name: Flow-state construction across the <Table> artefacts (PLA-0015 → PLA-0017)
description: How the Flows tab migration produced the addressable-substrate bug, why the fix lives in <Table>, and how that pattern threads through every spec-driven mode (tree, accordion, dnd, section, dense). Pick this up when continuing universal-modes work.
type: project
originSessionId: 67d23c1d-67ab-4f68-9e41-b57f3d3c96a9
---
## What this memory is

A pickup-where-we-left-off record for the work spanning workspace-settings → Flows tab migration → addressable-substrate fault → centralised fix in `<Table>` → universal-modes plan (PLA-0017). Read this before resuming PLA-0017 work so you understand the *why* behind the spec-driven flag model.

**Why:** the user wants every table-shaped surface (flat / tree / accordion / drag-reorder / section-header / dense flyout) to compose from the same `<Table>` primitive, with capabilities expressed as flags on the spec, not as separate components. The flow-state plumbing is the load-bearing principle — get this wrong and every adopter has to re-implement the same edge cases.

**How to apply:** when adding a new mode or migrating an allow-listed caller, ask "is this a *flag on the same spec* or a different primitive?" If the visual contract is the same chrome and the only difference is data shape + open-state semantics, it's a flag — keep it inside `<Table>`. Don't fork.

---

## The arc of the session

### 1. Migration target (PLA-0015 / Story 00427)

Nine flat-table call sites needed migrating onto the v1 `<Table>` primitive shipped earlier in the plan: workspace-settings (Workspaces, Archived, Users, Permissions, Flows), portfolio-model (Artifacts + Terminology), library-releases, risk, work-items/settings, theme tokens. All migrated.

### 2. The Flows-tab bug (the root cause to remember)

Migrating the Flows table at `app/(user)/workspace-settings/page.tsx:1903`, I wrote:

```tsx
slot={`flows__${g.target_id}`}    // g.target_id is a UUID
```

The user fixed it (swapped `-` → `_` in the interpolation) and asked "did you cause this error?" — I confirmed yes.

Then a runtime error from a different page made the deeper truth obvious:

```
buildAddress: invalid name "workspace-settings__flows__54085ad7_0118_401b_aae4_db94ccc59e13"
```

The *slot* was now hyphen-free, but `pageId="workspace-settings"` carried hyphens of its own. The substrate composes `${pageId}__${slot}` and applies `NAME_RE = /^[a-z0-9_]{1,64}$/` (defined in [`app/contexts/DomRegistryContext.tsx:267`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/app/contexts/DomRegistryContext.tsx#L267)). Six other pages with hyphenated `pageId` (`library-releases`, `table-harness`, `portfolio-model`, `work-items`, `work-items-settings`, `account-settings`) were one bug-report away from the same failure.

### 3. The fix that anchors everything (the principle to remember)

I moved hyphen normalisation **inside `<Table>`**, not at every call site:

```ts
// app/components/Table.tsx (~line 472)
const addressableName = `${pageId}__${slot}`.toLowerCase().replace(/-/g, "_");
```

This matches the substrate's documented "normalises legacy hyphenated names to underscores" contract from [`docs/c_c_addressables.md:19`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/docs/c_c_addressables.md#L19). Callers can keep using natural kebab-case without thinking about it.

**The principle this establishes:** when a caller can introduce a class of bug by passing a "natural" value (here: a kebab-case page id, a UUID), the primitive must absorb the normalisation. The whole point of having a primitive is that the surface is forgiving by construction — every caller-side defence is a tax that some future caller will forget to pay.

This is the principle PLA-0017 generalises across modes.

### 4. CSS state at end of PLA-0015

- 9 sites use `<Table>` (which composes `.tree_accordion-dense__*` internally).
- 8 sites still use legacy `.table*` BEM (`raw_table_exempt.json` allow-list): 4 tree exceptions (work-items page + Example2Tree + LayersTable + WizardModelCardList), 4 provisional (LayersPreviewTable + ArchiveMapFlyout + ServiceHealthPanel + TopologyTreeFlyout).
- `.table*` rules in `app/globals.css` are annotated DEPRECATED-RETAINED but kept alive specifically because those 8 files consume them.
- `.tbl` Vector-kit alias (zero callers) was deleted in 00427c — that part of the strip happened.
- `.btn--row-expander` survives because TopologyTreeFlyout + work-items tree consume it.

### 5. The user's reframe (the goal that produced PLA-0017)

> "we need all tables no matter their purpose or function, accordion etc must use the same styling, such as row columns, headers, colours font size etc that was the point, the <table> should be clever enough to select the right table type based on spec you see"

> "drag and drop is a flag state for example"

> "same as accordion, if flagged it expected a nested child row set"

The reframe: every table-shaped surface — flat, expandable, accordion, tree, drag-reorderable, section-headered, dense flyout — is the same visual contract with different capability flags on the spec. `<Table>` reads the spec and dispatches to the right internal renderer. Callers never pick a primitive.

---

## The spec-flag model PLA-0017 codifies

Every capability is **a flag on the spec**, not a separate component:

| Capability | Flag / data shape | Open-state semantics |
|---|---|---|
| flat | `rows: T[]` | n/a |
| expandable-panel | `expandable.renderPanel` | per-row Set |
| **tree** | `rows[i].children: T[]` | per-row Set, multi-open, depth unbounded |
| **accordion** | `accordion: true` (same `children` shape) | single `openId \| null`, only one parent open |
| **dnd** | `dnd: true \| { onReorder, scope }` | n/a (composes with any shape; intra-parent for tree/accordion) |
| **section-header row** | row with `kind: "section", label` | non-interactive, colSpan-all strip |
| **dense** | `density: "dense"` | tighter rows, no hover, group-suppressed hairlines |

**Visual contract is identical across all flags.** Row height token, hairline, head treatment, expander glyph, hover lift, numeric/mono cell typography, pill cells — same. Only data shape and open-state semantics change.

**Why this is the right model:** it's the same shape as the hyphen-normalisation fix. The primitive absorbs the dispatch logic so callers never have to choose. Adding a new caller is "describe my data + tick the capabilities I need" — never "go pick the right component."

---

## What's done at the end of this session

1. **PLA-0015 / Story 00427** — the original 9-site flat-table migration, lint:no-raw-table allow-list, partial CSS strip — all shipped. `lint:no-raw-table` reports `OK — 9 match(es), all exempt`.

2. **The hyphen-normalisation fix** — central in `Table.tsx`. Every call site with a hyphenated `pageId` is now safe.

3. **Stray leakage cleaned** — `theme/page.tsx:1219` lost a borrowed `.table-wrap` class (page-namespaced override already provided the visual); `risk/page.tsx:3-4` lost a stale 7-line comment referencing legacy classes.

4. **PLA-0017 drafted** — `dev/plans/PLA-0017.json` + `docs/c_plan_index.md` registry row. 10 stories (00433, 00433b, 00434–00441), 15 AC. Tree, accordion, dnd, section-header rows, dense as composable flags; migration of all 8 allow-listed callers; final `.table*` strip; harness extension. Status `active`, no Planka cards minted yet.

---

## Pickup signal — what to do next

If the user points at this memory and says "back to it" or "continue PLA-0017," the choice point is:

1. **Mint the cards** — run `<stories>` against PLA-0017 to create the 10 Planka cards (each gets the mandatory PLA-0017 + AIGEN + PH-NNNN + FE-AAA-NNNN + EST + RISK labels).
2. **Start coding directly** — open `app/components/Table.tsx` and begin Story 00433 (tree mode: rows with `children` auto-indent + per-row expander, multi-open). Cards can be minted later from the implementation.

Confirm with the user which path they want before either.

When implementing any story in PLA-0017, the load-bearing rule from this session is: **every new capability is a flag on the spec, not a new component.** If you find yourself thinking "this needs a new prop type" or "this caller is special," check first whether the special-ness is a flag combination you haven't enumerated yet. The hyphen-normalisation fix is the prototype: one centralised piece of logic in the primitive removes the need for every caller to remember a rule.

---

## Cross-references for full context

- Plan: [`dev/plans/PLA-0017.json`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/dev/plans/PLA-0017.json)
- Plan index: [`docs/c_plan_index.md`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/docs/c_plan_index.md)
- v1 surface: [`docs/c_c_table_component.md`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/docs/c_c_table_component.md)
- Substrate: [`docs/c_c_addressables.md`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/docs/c_c_addressables.md)
- The fix: [`app/components/Table.tsx`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/app/components/Table.tsx) — search for "hyphen normalisation" or "PLA-0005"
- Allow-list: [`dev/registries/raw_table_exempt.json`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/dev/registries/raw_table_exempt.json)
- Lint: [`dev/scripts/lint_no_raw_table.py`](../../../Documents/MMFFDev-Projects/MMFFDev%20-%20Vector/dev/scripts/lint_no_raw_table.py)
