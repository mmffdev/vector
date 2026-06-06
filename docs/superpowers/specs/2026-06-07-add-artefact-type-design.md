# Add Artefact Type (+ insert strategic layer) — Design

**Date:** 2026-06-07
**Surface:** `/workspace-admin/artefacts/artefact-types`
**Permission gate:** `portfolio.model.edit` (same as today's inline edits)
**DB:** `vector_artefacts` (vaPool) — tables `artefacts_types`, `artefacts`
**Status:** Design — approved for plan

---

## 1. Problem & intent

The artefact-types page can edit and resync types but cannot **create** one. We add creation. The
"matrix that defines the hierarchy rules" splits across two stores today:

- **Work types** — nesting hard-coded in the frontend constant `PARENT_PREFIX_MAP`
  (`app/components/ArtefactInlineForm/types.ts:119`).
- **Strategy types** — nesting in DB column `artefacts_types_id_parent_type` (self-FK; renamed to
  `artefacts_types_strategy_parent_id` by this work — see §5) (+ a now-unreliable
  `artefacts_types_layer_depth`).

Decision (approved): **`parent_type_id` chain is the single source of truth.** `layer_depth`
becomes a derived, read-only display mirror (distance-from-root), recomputed after structural
changes. We do not hand-manage or branch on its numeric value in the new code paths.

## 2. Live ladder (verified against dev, 2026-06-06)

```
strategy  depth 0  PRW   Portfolio Runway     parent = NULL        ← TOP bound (immutable)
strategy  depth 1  PR    Product              parent = PRW
strategy  depth 2  BO    Business Objective   parent = PR
strategy  depth 3  TH    Theme                parent = BO
strategy  depth -  FxxT  Feature              parent = TH          ← BOTTOM bound (immutable)
work      depth 5  US    Story                parent = NULL  (flat; nesting via map today)
work      depth 6  DE    Defect               parent = NULL
work      depth 7  RSK   Risk                 parent = NULL
work      depth 8  TA    Task                 parent = NULL
work      depth 9  EP    Epic                 parent = NULL
```

Anomalies the design must tolerate:
- **Feature has `layer_depth = NULL`** despite being the leaf — proof `layer_depth` is not
  trustworthy as hierarchy truth. The `parent_type_id` chain is.
- **Work types carry depths 5–9** with `parent_type_id = NULL` — flat in DB; their nesting is the
  frontend map. We migrate this to a stored rule (§5).

## 3. Two operations, one entry point

An **Add type** button on the page opens a create flyout. First field is **Scope** (Work | Strategy).
Scope forks the operation:

### Operation A — Create Work Type (low risk)

Inputs: **Tag** (prefix), **Name**, **Description**, **Colour**, **Behaves like** (which existing
execution rung it siblings with — e.g. "like Story").

- Effect: one `INSERT` into `artefacts_types` (`scope='work'`, `source='tenant'`,
  `strategy_parent_id=NULL`, `colour`, `prefix`, `name`, `description`, `sort_order` = max+10 in scope).
- **No artefact instances are touched.**
- The new type's allowed parents are derived from the "Behaves like" choice via the stored
  work-nesting rule (§5), not from a code edit. This is what makes work-type creation fully
  self-serve and satisfies the "DB columns only" decision.

Worked example: a "Spike" that behaves like Story inherits Story's allowed parents
(`Feature`, `Epic`) and sits as a sibling of Story at the execution level. The execution ladder's
shape does not change.

### Operation B — Insert Strategic Layer (high risk)

Inputs: **Tag**, **Name**, **Description**, **Colour**, **Insertion point** ("between [Parent
layer] and [Child layer]").

- The insert lands **strictly between** Portfolio Runway (top) and Feature (bottom). Those two are
  immutable bounds — they can never be replaced, renamed-away, or removed by this feature.
- Inserting into a gap breaks the existing parent→child link across that gap; we re-stitch it with a
  **pass-through backfill** (§7), behind a **mandatory impact-confirmation gate** (§8).

## 4. Insertion-point selection

The flyout offers only the adjacent pairs along the **live `parent_type_id` chain**, excluding the
two slots that violate the bounds:

- Cannot insert above PRW (PRW stays absolute root).
- Cannot insert below Feature (FE stays absolute leaf).
- Valid gaps in the current ladder: `PRW–PR`, `PR–BO`, `BO–TH`, `TH–FE`.

Selection is expressed server-side as the **child type id** whose `parent_type_id` will be rewritten
(the parent is derived from that child's current `parent_type_id`). This avoids any reliance on
`layer_depth`.

## 5. Parent-link columns: scoped, honest naming (foundation)

Today the parent rules split across an awkwardly-named DB column + a frontend constant:

- Strategy: `artefacts_types_id_parent_type` (self-FK) — named for its *mechanism* (an id/FK), not
  its *meaning* (the strategy ladder's parent link).
- Work: `PARENT_PREFIX_MAP` (frontend constant) — not in the DB at all.

We make the two parallel and scope-declaring, while honouring their genuinely different shapes
(strategy = strict single parent → FK; execution = multiple legal parents → array). **The two are
NOT the same shape** — naming them identically would trade one lie for another. Final columns on
`artefacts_types`:

| Column | Type | Scope | Meaning |
|---|---|---|---|
| `artefacts_types_strategy_parent_id` | `UUID` (self-FK, `ON DELETE RESTRICT`) | strategy | the **one** parent type this strategy type nests under (the chain) |
| `artefacts_types_execution_parent_slots` | `TEXT[]` (soft-ref list) | work | the **list** of parent type **slots** this work type may nest under (the rule) |

### 5a. Rename strategy column (FK preserved)

`artefacts_types_id_parent_type` → `artefacts_types_strategy_parent_id`. Pure rename, **zero
behaviour change**, FK + `ON DELETE RESTRICT` retained (the insert-layer transaction depends on a
walkable, integrity-guarded chain).

- **DB:** `ALTER TABLE artefacts_types RENAME COLUMN ...`; also rename the FK + the
  `artefacts_types_parent` partial index to match.
- **JSON wire field stays `parent_type_id`.** The DB rename is internal; the API contract and the
  5 frontend consumers keep the existing `parent_type_id` JSON key (struct tag maps
  `ArtefactType.ParentTypeID json:"parent_type_id"` → the renamed column). No frontend churn for a
  DB-internal rename.
- **Go blast radius (rename the SQL identifiers only, behaviour unchanged):**
  `backend/internal/artefacttypes/{types.go,service.go}`,
  `backend/internal/portfoliomodels/{adopt_work_types.go,adopt_strategy_types.go,adopt_readopt.go,sql.go}`,
  plus the 4 `portfoliomodels` tests. Migrations `003/009/011/066` are historical — not edited; the
  new migration is additive.

### 5b. New execution column (replaces the frontend map)

New column `artefacts_types_execution_parent_slots TEXT[]` (nullable; only meaningful for
`scope='work'`). The `artefacts_types_work_no_parent` CHECK is unaffected — work types still keep
`strategy_parent_id = NULL`; this column encodes the *legal* parents (plural), not a stored parent.

- **Store slots, not prefixes.** Entries are the rename-proof handles (`wrk_story`, `wrk_epic`,
  `wrk_defect`, `wrk_task`) — NOT display prefixes (`US`, `EP`). A gadmin renaming "Story" or
  changing its tag must not break the rule. The resolver maps slot → live type id via the workspace
  catalogue (the same slot→id resolution already used for chip filters per PLA-0054).
- **Backfill migration** from the current `PARENT_PREFIX_MAP`, translated prefix→slot, byte-for-byte
  behaviour-preserving: `wrk_task→[wrk_defect,wrk_story]`, `wrk_story→[<feature-slot>,wrk_epic]`,
  `wrk_defect→[wrk_epic,wrk_story]`, `wrk_epic→[<feature-slot>]`. (Feature is a strategy type — its
  slot is resolved at backfill time; if absent, store its prefix as a documented fallback and flag
  in TD.) Risk/RSK absent from the map today → `NULL`/empty, preserving current behaviour
  (TD-RISK-WORK-PARENT-SLOTS).

### 5c. Resolver collapse (`useParentCandidates`)

Today `resolveAllowedTypes` (`app/components/ArtefactInlineForm/useParentCandidates.ts:57`) has three
tiers: (1) `PARENT_PREFIX_MAP`, (2) `layer_depth < myDepth`, (3) `parent_type_id` chain walk. After
cleanup there are **two data-driven tiers, one per scope**:

- **Work types** → resolve `editing.execution_parent_slots` (slots) → live type ids → candidates.
  Replaces tier 1.
- **Strategy types** → walk the `parent_type_id` chain upward (existing tier-3 logic).
  **Tier 2's `layer_depth` numeric comparison is removed entirely** — consistent with "layer_depth
  is a derived mirror, never branched on." The chain walk is immune to the Feature=NULL /
  duplicate-depth contamination that forced the map in the first place.
- `PARENT_PREFIX_MAP` is deleted; its only consumers are `useParentCandidates`,
  `workItemsReparentRules`, and their tests — all migrated to `execution_parent_slots` / chain-walk.
- **`workItemsReparentRules.workItemsCanReparent`** reads the mover type's
  `execution_parent_slots` (resolved to prefixes/ids for comparison) instead of the map, so
  create / inline-edit / drag-reparent stay in agreement.
- **"Behaves like" on create** copies the chosen rung's `execution_parent_slots` onto the new type.

> This pays down `TD-PARENT-CANDIDATES-DYNAMIC` and corrects the `artefacts_types_id_parent_type`
> naming. In-scope because the feature cannot be self-serve for work types without the execution
> column, and the rename is cheapest now while we're already touching every reader — see CLAUDE.md
> "name scope creep as scope correction" + "cleanup, not deferral".

## 6. Strategic type-chain rewrite (one transaction)

Given chosen child `C` with current parent `P` (= `C.parent_type_id`), inserting new type `N`:

1. `INSERT` `N`: `scope='strategy'`, `source='tenant'`, `parent_type_id = P.id`, plus
   tag/name/description/colour, `allows_children = TRUE`, `sort_order` between P and C.
2. `UPDATE` `C.parent_type_id = N.id`.
3. Recompute `layer_depth` for every strategy type as **distance-from-root along the chain**
   (derived mirror; capped at the 0..9 CHECK range — if a chain ever exceeds 10 layers the insert is
   rejected with a clear message rather than silently clamping, per "no hacks disguised as fixes").

Steps 1–3 plus the §7 backfill are a **single DB transaction**. Partial state is impossible.

## 7. Pass-through instance backfill

After the type chain is fixed, existing **artefact instances** of type `C` are still parented to
instances of type `P`, skipping `N`. Re-stitch 1-for-1:

**Live `artefacts` instance table columns (verified against migration 107_RF1_5_7):**
table `artefacts` (singular); PK `artefacts_id`; parent link `artefacts_id_parent`;
type link `artefacts_id_artefact_type`; workspace clamp `artefacts_id_workspace`;
soft-delete `artefacts_archived_at`.

For every live artefact `c` where `c.artefacts_id_artefact_type = C` (and
`c.artefacts_archived_at IS NULL`, and `c.artefacts_id_workspace = <clamp>`):

- Let `p = c.artefacts_id_parent` (may be NULL).
- Create pass-through artefact `n`: `artefacts_id_artefact_type = N`,
  **name mirrors `c`** (the wrapped child's name — approved choice), `artefacts_id_parent = p`,
  `artefacts_id_workspace = <clamp>`.
- Set `c.artefacts_id_parent = n`.

Result: `p → c` becomes `p → n → c`.

Edge cases:
- **`c` has no parent (`p = NULL`)** — `n` is created with `parent_artefact_id = NULL` (a root of the
  new layer) and `c` is reparented under `n`. One wrapper per child is preserved.
- **Clamp scope** — the backfill operates only within the caller's workspace clamp
  (`sentinel.WorkspaceIDFromCtx`); instances outside the clamp are never read or written.
- **Archived instances** — `archived_at IS NOT NULL` artefacts are excluded from wrapping (they're
  not live members of the hierarchy).

Pass-through artefacts carry the same `source`/ownership semantics as user-created artefacts and are
fully editable afterwards (the user can rename them away from the mirrored name).

## 8. Confirmation gate (mandatory, dry-run first)

Strategic insert is two-phase from the UI:

1. **Preview** — flyout calls the preview endpoint (no writes). Returns:
   - the new layer's position ("between Theme and Feature"),
   - count + list of artefact instances to be wrapped (the `c`s, with their names + current parent),
   - count of pass-through artefacts to be created,
   - any rejection reason (e.g. would exceed depth cap).
2. **Confirm** — user reviews the impact list and explicitly confirms. Only then does the commit
   endpoint run the transactional insert + backfill.

Copy example: *"Inserting 'Strategic Objective' between Theme and Feature will create 14 pass-through
artefacts and re-link 14 Features under them. Review the list below, then confirm."*

## 9. Backend surface

All under `/_site/artefact-types`, mounted in `backend/internal/artefacttypes/handler.go`, gated by
the existing auth + sentinel middleware. Server re-validates permission (`portfolio.model.edit`),
bounds, and clamp — **server is the gate**; the client checks are defence-in-depth only.

| Method | Path | Purpose | Writes |
|---|---|---|---|
| `POST` | `/artefact-types` | Create **work** type (scope='work' in body) | 1 row |
| `POST` | `/artefact-types/insert-layer/preview` | Dry-run impact for a strategic insert | none |
| `POST` | `/artefact-types/insert-layer` | Transactional insert + pass-through backfill | type chain + N instances |

Notes:
- Strategy types are **only** created via `insert-layer` (never a bare append) — there is no valid
  "top or bottom" strategy slot to append to given the immutable bounds.
- `POST /artefact-types` validates: prefix 1–4 `[A-Z0-9]`, unique within (workspace, scope) live;
  name 1–64; colour NULL or `#RRGGBB`; `behaves_like` resolves to a live work type in scope.
- `insert-layer` body: `{ tag, name, description, colour, child_type_id }` where `child_type_id` is
  the type whose `parent_type_id` gets rewritten to the new type. Server derives `P` and validates
  the resulting position is strictly inside the PRW…Feature bounds.
- Reuse the existing 422 `violations[]` shape for validation failures (matches `Patch`).
- **Preview vs commit error convention:** `insert-layer/preview` returns `200` always when the
  request is well-formed, surfacing any blocking condition (depth-cap overflow, bounds violation) in
  the `rejection` string so the flyout can disable Confirm and explain why. `insert-layer` (commit)
  re-checks the same conditions and returns `422` with `violations[]` if they now fail — the preview
  `rejection` is advisory; the commit gate is authoritative (server is the gate).

### Wire types (frontend `artefactTypesApi.ts`)

```ts
create(body: {
  scope: "work";
  tag: string; name: string; description?: string | null; colour?: string | null;
  behaves_like_type_id: string;        // existing work rung to copy parent-slots from
}): Promise<ArtefactType>;

previewInsertLayer(body: {
  tag: string; name: string; description?: string | null; colour?: string | null;
  child_type_id: string;
}): Promise<{
  parent_layer: { id: string; name: string };
  child_layer:  { id: string; name: string };
  impacted: { id: string; name: string; current_parent_name: string | null }[];
  passthrough_count: number;
  rejection?: string | null;
}>;

insertLayer(body: { /* same as previewInsertLayer */ }): Promise<{
  new_type: ArtefactType;
  created_count: number;
}>;
```

`ArtefactType` gains `execution_parent_slots: string[] | null` (JSON field name; maps to DB
`artefacts_types_execution_parent_slots`). The existing `parent_type_id` JSON field is unchanged
(now backed by the renamed `artefacts_types_strategy_parent_id` column).

## 10. Frontend surface

- **New component `app/components/ArtefactTypeCreateFlyout/`.** Do **not** reuse
  `ArtefactCreateFlyout/` — that component creates artefact **instances** (POSTs to `/work-items`,
  carries sprints/owners/flow-states/story-points). Creating a type is a different concern; a
  shared component would be a category error. The new flyout:
  - Scope toggle → Work | Strategy (the toggle lives *inside* this flyout; it forks the fields).
  - Work form: Tag, Name, Description, Colour, "Behaves like" select (live work types).
  - Strategy form: Tag, Name, Description, Colour, "Insert between" select (valid gaps), then a
    **two-step preview → confirm** with the impact list.
  - Styling: follow the `.dui-*`-free `app/(user)` convention (this is a user page, not /dev);
    reuse `ColourPicker`, `safeInk`, and existing form primitives.
- **`app/(user)/workspace-admin/artefacts/artefact-types/page.tsx`**: add the "Add type" button to
  `at-tree__toolbar`; on success, refetch the list (`load()`).
- **Remove the inline `Layer` editor column** (`layer` in `buildColumns`) — depth is now derived and
  read-only. Display depth as a non-editable label or drop the column entirely (plan decides; leans
  to read-only label so the ladder is still legible).
- Colour input reuses the existing `ColourPicker`; ink contrast via `safeInk`.

## 11. Validation & safety summary

- Server-side first for every gate (permission, bounds, prefix uniqueness, clamp). Client mirrors.
- Single transaction for insert + backfill — no partial hierarchy.
- Depth cap (0..9) enforced by rejection, not silent clamp.
- Immutable bounds (PRW, Feature) enforced server-side by position check.
- Pass-through naming mirrors the wrapped child; instances are normal, editable artefacts afterwards.

## 12. Testing

Backend (Go):
- `create` work type: happy path; duplicate prefix → 422; bad prefix/colour → 422; cross-tenant id
  in `behaves_like` rejected.
- `insert-layer` preview: returns correct impacted list for `TH–FE` gap with N Features under M
  Themes; empty gap returns `passthrough_count = 0`.
- `insert-layer` commit: transactional `p → c` becomes `p → n → c`; orphan child (`p = NULL`) wraps
  correctly; archived instances excluded; depth recompute correct; bounds violation rejected;
  permission denied for non-`portfolio.model.edit` caller; clamp isolation (cross-workspace
  instances untouched).
- Migration: `execution_parent_slots` backfilled (prefix→slot) to match `PARENT_PREFIX_MAP` exactly;
  strategy column rename is behaviour-neutral (existing strategy adoption tests still green).

Frontend (Vitest/RTL):
- Flyout scope fork renders correct fields.
- Strategy path blocks confirm until preview returned; renders impact list; confirm calls commit.
- `useParentCandidates` reads `execution_parent_slots` (slot→id resolved) and matches prior
  behaviour for system types.

## 13. Tech-debt entries

- **TD-PARENT-CANDIDATES-DYNAMIC** — moved from "open" to "paid (work scope)": work nesting now in
  `execution_parent_slots`; `PARENT_PREFIX_MAP` retired; `artefacts_types_id_parent_type` renamed to
  `artefacts_types_strategy_parent_id`. Strategy nesting already dynamic.
- **TD-LAYER-DEPTH-DERIVED** (new, S3) — `layer_depth` retained as a derived mirror. After this
  work, the `useParentCandidates` depth comparison is gone; the only remaining numeric readers are
  `DependencyMapOverlay` (root detection via `min(depth)`) and `p_ObjectTree` / `ArtefactCreateFlyout`
  (`isTopLevel === layer_depth === 0`). Both can switch to `parent_type_id == null` for "is root".
  Trigger: when those two read the chain, drop the column in a clean migration.
- **TD-RISK-WORK-PARENT-SLOTS** (new, S3) — Risk/RSK has no entry in `PARENT_PREFIX_MAP` today;
  backfilled as empty. Trigger: product decision on where Risk nests.

## 14. Out of scope

- Deleting / archiving a strategic layer (the inverse "collapse a layer" operation) — separate spec.
- Reordering existing layers.
- Renaming the immutable bounds.
- Strategy-type creation outside the insert-between flow.
