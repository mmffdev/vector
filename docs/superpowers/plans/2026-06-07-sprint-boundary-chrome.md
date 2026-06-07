# Sprint Boundary Chrome & Sprint-Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give `Grid__SprintBoundary` the value-sprint-review sprint grid's chrome — in-skin title band (stripe + red FILTER + live sprint name), subtitle, a fully-wired action bar (Prev/Next/Current/Switch/Status + Search + filter chips), an empty-sprint explanatory row, and a default-to-current-sprint behavior.

**Architecture:** All chrome renders INSIDE `Grid__SprintBoundary` (self-contained), composing the existing `PrefixBlockStripes` + `GridTreeActionBar` + the `grid__Tree_Title*` markup/classes WITHOUT editing `Grid__Tree`. Sprint resolution + nav-button JSX + radial stay page-owned (they need `useNextSprint`/the radial) and pass in as props. Filters thread through both `useTree` clamps via the GridSprintReview fingerprint pattern. Search is client-side (backend has no search term — TD logged).

**Tech Stack:** React+TS, existing Grid primitives (compose, don't edit), `useWorkItemsFilters`/`WorkItemsFilterChips`, Vitest + @testing-library/react. CSS reuses `grid__Tree_Title*`; new bits append `grid__SprintBoundary_*` to app/globals.css.

---

## Constraints (verify every task)

- **NO edits** to `Grid__Tree.tsx`, `Grid__Tree_Row/Head/Lines.tsx`, `useTree.ts`, `useColumnManager.ts`, `types.ts`, `scopeTreeData.ts`, `app/lib/apiSite`, `PrefixBlockStripes.tsx`, `Grid__Tree_ActionBar.tsx`. Import/compose them.
- All NEW `Grid__SprintBoundary` props are OPTIONAL — the 34 existing tests + the existing mount must keep passing unchanged.
- Work on `main` (user approved staying on main; do NOT create a branch).
- Membership-only / commit-on-drop / story-defect-risk clamp retained.
- Inspect `git diff --cached --stat` before every commit; stage only the intended files.

## Confirmed facts (from study)

- Backend has **no** server-side search field on `WorkItemQueryBody` → search is client-side title-contains; log `TD-SPRINT-BOUNDARY-SEARCH`.
- `value-sprint/page.tsx` `panelSprintId` chain is `override ?? nextSprint ?? null` — it does NOT include `currentSprint`. Must change to `override ?? currentSprint ?? nextSprint ?? null` + add an auto-advance effect.
- `PrefixBlockStripes` default export, props `{ size?=32, className? }`.
- Title classes: `grid__Tree_Title`, `grid__Tree_Title_Body`, `grid__Tree_Title_Heading`, `grid__Tree_Title_Heading_Filter` (red FILTER), `grid__Tree_Title_Sub`.
- `GridTreeActionBar` export, config `{ ariaLabel?, leading?, search?: {placeholder,value,onChange}, filterChips? }`.
- Filter threading pattern: `GridSprintReview.tsx:148-254` (useWorkItemsFilters → effectiveFilters → fetchRoots + fingerprint→refresh).

## File structure

- Modify: `app/components/Grid/Grid__SprintBoundary.tsx` — add chrome (title band, action bar) + empty-sprint row; new optional props.
- Modify: `app/components/Grid/sprintBoundaryTreeData.ts` — `fetchSprintRoots` gains optional `extraFilters`.
- Modify: `app/(user)/value-sprint/page.tsx` — fix sprint default chain + auto-advance; build chrome props (title/subtitle/actionBar leading+search+chips); thread filters into both trees.
- Modify: `app/globals.css` — append any `grid__SprintBoundary_*` empty-row + title-host styles.
- Modify: `app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx` — new cases.
- Modify: `app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts` — extraFilters case.
- Modify: `docs/c_tech_debt.md` — `TD-SPRINT-BOUNDARY-SEARCH`.

---

## Task 1: Data layer — optional extraFilters

**Files:** Modify `app/components/Grid/sprintBoundaryTreeData.ts`; Modify its test.

- [ ] **Step 1: Add a failing test** (append to `sprintBoundaryTreeData.test.ts`, inside the describe):

```ts
  it("merges extraFilters (flowStateId/priorityId/ownerId) into the query", async () => {
    queryMock.mockResolvedValue({ items: [], total: 0 });
    await fetchSprintRoots({ limit: 100, offset: 0 }, "sprint-9", ["t1"], {
      flowStateId: ["fs1"],
      priorityId: ["p1"],
      ownerId: ["o1"],
    });
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: {
        sprintId: "sprint-9",
        itemTypeId: ["t1"],
        flowStateId: ["fs1"],
        priorityId: ["p1"],
        ownerId: ["o1"],
      },
    });
  });

  it("omits empty extraFilters arrays", async () => {
    queryMock.mockResolvedValue({ items: [], total: 0 });
    await fetchSprintRoots({ limit: 100, offset: 0 }, "__none__", undefined, {
      flowStateId: [],
    });
    expect(queryMock).toHaveBeenCalledWith({
      page: { limit: 100, offset: 0 },
      filters: { sprintId: "__none__" },
    });
  });
```

- [ ] **Step 2: Run → fails.** `npx vitest run app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts`

- [ ] **Step 3: Implement.** Replace the `fetchSprintRoots` body in `sprintBoundaryTreeData.ts`:

```ts
export interface SprintBoundaryExtraFilters {
  flowStateId?: string[];
  priorityId?: string[];
  ownerId?: string[];
}

export async function fetchSprintRoots(
  page: { limit: number; offset: number },
  sprintId: string,
  itemTypeIds?: string[],
  extraFilters?: SprintBoundaryExtraFilters,
): Promise<{ rows: ScopeNode[]; total: number }> {
  const filters: NonNullable<WorkItemQueryBody["filters"]> = { sprintId };
  if (itemTypeIds && itemTypeIds.length) filters.itemTypeId = itemTypeIds;
  if (extraFilters?.flowStateId?.length) filters.flowStateId = extraFilters.flowStateId;
  if (extraFilters?.priorityId?.length) filters.priorityId = extraFilters.priorityId;
  if (extraFilters?.ownerId?.length) filters.ownerId = extraFilters.ownerId;
  const body: WorkItemQueryBody = {
    page: { limit: page.limit, offset: page.offset },
    filters,
  };
  const res = await workItems.query(body);
  const rows = (res.items as WireWorkItem[]).map(mapWire);
  return { rows, total: res.total ?? 0 };
}
```

Keep existing imports. Confirm the 4 prior tests still pass (back-compat: no extraFilters → only sprintId[+itemTypeId]).

- [ ] **Step 4: Run → all pass** (6 cases). `npx vitest run app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts`
- [ ] **Step 5: Commit.** `git add app/components/Grid/sprintBoundaryTreeData.ts app/components/Grid/__tests__/sprintBoundaryTreeData.test.ts && git commit -m "feat(grid): sprintBoundary data layer accepts extra filters"`

---

## Task 2: Skin — title band + action bar + empty-sprint row

**Files:** Modify `app/components/Grid/Grid__SprintBoundary.tsx`; append CSS; add tests.

- [ ] **Step 1: Add failing tests** (append to `Grid__SprintBoundary.test.tsx`):

```tsx
  it("renders the title band with FILTER prefix + sprint label + subtitle", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1"])}
        columns={columns}
        commit={vi.fn()}
        sprintLabel="Sprint 1 — Red"
        subtitle="Work items committed to this sprint."
      />,
    );
    expect(screen.getByText("FILTER")).toBeInTheDocument();
    expect(screen.getByText("Sprint 1 — Red")).toBeInTheDocument();
    expect(screen.getByText("Work items committed to this sprint.")).toBeInTheDocument();
  });

  it("renders the action bar leading + search when provided", () => {
    const onChange = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["s1"])}
        backlogTree={treeStub(["b1"])}
        columns={columns}
        commit={vi.fn()}
        actionBar={{
          leading: <button>Prev</button>,
          search: { placeholder: "Search…", value: "", onChange },
          filterChips: <div data-testid="chips">chips</div>,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Prev" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
    expect(screen.getByTestId("chips")).toBeInTheDocument();
  });

  it("shows the empty-sprint explanatory row when the sprint section is empty", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub([])}
        backlogTree={treeStub(["b1", "b2"])}
        columns={columns}
        commit={vi.fn()}
        sprintLabel="Sprint 1 — Red"
      />,
    );
    const empty = screen.getByText(/this sprint is empty/i);
    expect(empty).toBeInTheDocument();
    // divider still present and sits at top (0 of 2 in sprint)
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByText("0 of 2 in sprint")).toBeInTheDocument();
  });

  it("still commits a drag when the sprint started empty", () => {
    const commit = vi.fn();
    render(
      <GridSprintBoundary
        sprintTree={treeStub([])}
        backlogTree={treeStub(["b1", "b2", "b3"])}
        columns={columns}
        commit={commit}
        rowHeightForTest={40}
      />,
    );
    const divider = screen.getByRole("separator");
    fireEvent.pointerDown(divider, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(divider, { clientY: 180, pointerId: 1 }); // +80 → 2 rows
    fireEvent.pointerUp(divider, { clientY: 180, pointerId: 1 });
    expect(commit).toHaveBeenCalledWith({ toSprint: ["b1-uuid", "b2-uuid"], toBacklog: [] });
  });
```

- [ ] **Step 2: Run → new cases fail.** `npx vitest run app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx`

- [ ] **Step 3: Implement chrome in `Grid__SprintBoundary.tsx`.**

Add imports:
```tsx
import PrefixBlockStripes from "@/app/components/PrefixBlockStripes";
import { GridTreeActionBar, type GridTreeActionBarConfig } from "./Grid__Tree_ActionBar";
```

Extend the props interface (all optional):
```tsx
  sprintLabel?: string;
  subtitle?: string;
  actionBar?: GridTreeActionBarConfig;
  emptySprintHint?: React.ReactNode;
```

In the returned JSX, render ABOVE the existing `<GridTreeHead>`:
```tsx
      {(sprintLabel != null || subtitle != null) && (
        <div className="grid__Tree_Title grid__SprintBoundary_Title">
          <PrefixBlockStripes />
          <div className="grid__Tree_Title_Body">
            {sprintLabel != null && (
              <h3 className="grid__Tree_Title_Heading">
                <span className="grid__Tree_Title_Heading_Filter">FILTER</span>{" "}
                {sprintLabel}
              </h3>
            )}
            {subtitle != null && (
              <p className="grid__Tree_Title_Sub">{subtitle}</p>
            )}
          </div>
        </div>
      )}
      {actionBar && <GridTreeActionBar {...actionBar} />}
```

For the empty-sprint row: in the body, when `sprintNodes.length === 0`, render the explanatory row before the divider. The skin already special-cases `boundary.boundaryIndex === 0` to render the divider at top; insert the hint row just before it:
```tsx
      <div className="grid__SprintBoundary_Body" ref={bodyRef}>
        {sprintNodes.length === 0 && (
          <div className="grid__SprintBoundary_Empty" data-sprintboundary-empty>
            {emptySprintHint ?? (
              <>
                <strong>This sprint is empty.</strong> Drag the handle below
                downward through the backlog to commit work items
                {sprintLabel ? <> into <strong>{sprintLabel}</strong></> : null}.
                Release to save.
              </>
            )}
          </div>
        )}
        {/* …existing combined.map(...) + divider rendering unchanged… */}
```

Keep the rest of the body rendering exactly as-is (the `combined.map` + the `boundaryIndex===0` divider branch already place the divider correctly; with 0 sprint rows boundaryIndex starts at 0 so the divider renders at top, right after the empty row).

- [ ] **Step 4: Append CSS to `app/globals.css`:**
```css
/* Grid__SprintBoundary — chrome */
.grid__SprintBoundary_Title { /* inherits grid__Tree_Title; host hook only */ }
.grid__SprintBoundary_Empty {
  padding: 16px 20px;
  color: var(--ink-subtle, #8A8A8A);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  background: color-mix(in srgb, var(--accent) 4%, transparent);
  border-bottom: 1px dashed var(--border-subtle, #d0d3d8);
}
```

- [ ] **Step 5: Run → all skin tests pass** (existing 3 + 4 new = 7). `npx vitest run app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx`
- [ ] **Step 6: Shared-file check.** `git status --porcelain app/components/Grid/Grid__Tree.tsx app/components/Grid/Grid__Tree_ActionBar.tsx app/components/PrefixBlockStripes.tsx` → empty.
- [ ] **Step 7: Whole-dir.** `npx vitest run app/components/Grid/` → all pass.
- [ ] **Step 8: Commit.** `git add app/components/Grid/Grid__SprintBoundary.tsx app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx app/globals.css && git commit -m "feat(grid): sprintBoundary in-skin title band + action bar + empty-sprint row"`

---

## Task 3: Page — default-to-current + auto-advance + chrome wiring + filters

**Files:** Modify `app/(user)/value-sprint/page.tsx`.

- [ ] **Step 1: Fix the sprint default chain.** Change (around line 205):
```tsx
  const panelSprintId =
    panelSprintIdOverride ?? nextSprint?.timeboxes_sprints_id ?? null;
```
to include currentSprint first (default-to-current):
```tsx
  const panelSprintId =
    panelSprintIdOverride ??
    currentSprint?.timeboxes_sprints_id ??
    nextSprint?.timeboxes_sprints_id ??
    null;
```
NOTE: `currentSprint` is computed at ~line 225 (AFTER this line). MOVE the `currentSprint` useMemo ABOVE the `panelSprintId` declaration so it's defined first (it depends only on `allSprints`, no forward refs). Verify no other code between them breaks.

- [ ] **Step 2: Add the auto-advance-to-current effect** (mirror value-sprint-review/page.tsx:234-249). After `currentSprint` + `panelSprintIdOverride` are defined:
```tsx
  // Auto-advance to the sprint whose date window contains today, unless the
  // user has explicitly navigated elsewhere. Mirrors value-sprint-review.
  const autoAdvancedToRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentSprint) return;
    const newId = currentSprint.timeboxes_sprints_id;
    const userNavigatedAway =
      panelSprintIdOverride !== null &&
      panelSprintIdOverride !== autoAdvancedToRef.current;
    if (userNavigatedAway) return;
    if (panelSprintIdOverride === newId) return;
    autoAdvancedToRef.current = newId;
    setPanelSprintIdOverride(newId);
  }, [currentSprint, panelSprintIdOverride]);
```

- [ ] **Step 3: Add boundary filter state.** Near the other POC hooks:
```tsx
  const BOUNDARY_FILTER_PREF_KEY = "value_sprint.boundary.filters";
  const { filters: boundaryFilters } = useWorkItemsFilters(BOUNDARY_FILTER_PREF_KEY);
  const [boundarySearch, setBoundarySearch] = useState("");
  const boundaryExtraFilters = useMemo(
    () => ({
      flowStateId: boundaryFilters.status,
      priorityId: boundaryFilters.priority,
      ownerId: boundaryFilters.owner_id,
    }),
    [boundaryFilters],
  );
```
(Confirm `useWorkItemsFilters` import + the `filters` shape — `.status`/`.priority`/`.owner_id` per work-items-tree-config. Adjust field names to the real ones.)

- [ ] **Step 4: Thread filters into both useTree fetchRoots** (extend the existing two POC useCallback fetchRoots to pass `boundaryExtraFilters` as the 4th arg):
```tsx
    // sprint tree fetchRoots:
      (page) => fetchSprintRoots(page, pocSprintId, pocAllowedTypeIds, boundaryExtraFilters),
      [pocSprintId, pocAllowedTypeIds, boundaryExtraFilters],
    // backlog tree fetchRoots:
      (page) => fetchSprintRoots(page, "__none__", pocAllowedTypeIds, boundaryExtraFilters),
      [pocAllowedTypeIds, boundaryExtraFilters],
```

- [ ] **Step 5: Pass chrome props to `<GridSprintBoundary>`.** Replace the existing mount:
```tsx
            <GridSprintBoundary
              sprintTree={pocSprintTree}
              backlogTree={pocBacklogTree}
              columns={pocColumns}
              commit={pocCommit}
              sprintLabel={panelSprint ? formatSprintLabel(panelSprint) : "No sprint"}
              subtitle="Work items committed to this sprint — drag the divider to adjust membership."
              actionBar={{
                ariaLabel: "Sprint boundary actions",
                leading: /* the SAME Prev/Next/Current/Switch/Status JSX block already
                            present in the legacy panel — reuse it verbatim, pointed at
                            stepSprint / setPanelSprintIdOverride / setTargetMenu */ undefined,
                search: {
                  placeholder: "Search work items…",
                  value: boundarySearch,
                  onChange: setBoundarySearch,
                },
                filterChips: (
                  <WorkItemsFilterChips
                    prefKey={BOUNDARY_FILTER_PREF_KEY}
                    typeOptions={/* the story/defect/risk filter options */}
                    priorityOptions={/* priority options */}
                  />
                ),
              }}
            />
```
For `leading`: extract the Prev/Next/Current/Switch/Status `<button>` block that the legacy panel already renders (value-sprint/page.tsx ~791-877) into a `const boundaryNav = (<> … </>)` and pass it as `leading`. The buttons already reference `stepSprint`, `sprintNavState`, `showCurrentSprintBtn`, `setPanelSprintIdOverride`, `setTargetMenu`, refs — all in scope. Do NOT remove them from the legacy panel; build a parallel `leading` node (or share a single memoized node passed to both). CONFIRM `WorkItemsFilterChips` + the type/priority option props by reading how value-sprint-review/page or GridSprintReview builds them; reuse that.

- [ ] **Step 6: Client-side search filter.** Since the backend has no search term, filter the rendered rows by title client-side. Simplest correct POC approach: pass `boundarySearch` into `GridSprintBoundary` as an optional `searchTerm?` prop and have the skin filter `flatNodes` by `row.summary`/`row.title` contains (case-insensitive) before rendering. (Add this prop + a test in Task 2 if preferred, or as a small Task 3b.) Log `TD-SPRINT-BOUNDARY-SEARCH` for server-side search.

- [ ] **Step 7: Typecheck.** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "value-sprint/page|Grid__SprintBoundary" || echo clean`
- [ ] **Step 8: Additive check on the legacy panels.** Confirm the two legacy `<Panel>`s + their logic are unchanged (the diff adds chrome wiring; it may MOVE the currentSprint memo up and add an effect — those are fine, but no legacy panel removed). `git diff "app/(user)/value-sprint/page.tsx"` review.
- [ ] **Step 9: Commit.** Stage only page.tsx. `git commit -m "feat(value-sprint): boundary POC defaults to current sprint + in-skin chrome + filters"`

---

## Task 4: Client-side search in the skin + TD

**Files:** Modify `Grid__SprintBoundary.tsx` (+ test), `docs/c_tech_debt.md`.

- [ ] **Step 1: Test** — `searchTerm` filters visible rows by title:
```tsx
  it("filters rows by searchTerm (client-side, case-insensitive)", () => {
    render(
      <GridSprintBoundary
        sprintTree={treeStub(["Alpha", "Beta"])}
        backlogTree={treeStub(["Gamma"])}
        columns={columns}
        commit={vi.fn()}
        searchTerm="alph"
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    expect(screen.queryByText("Gamma")).not.toBeInTheDocument();
  });
```
(Note: `treeStub(id)` sets `summary = id`; the column renders `row.summary`. Confirm and adjust.)

- [ ] **Step 2: Implement** — add `searchTerm?: string` prop; before building `combined`, filter each tree's `flatNodes` by `n.row.summary?.toLowerCase().includes(searchTerm.trim().toLowerCase())` when `searchTerm` non-empty. IMPORTANT: filtering changes the row counts, which feeds `useSprintBoundary(sprintIds, backlogIds)` — the boundary resync effect (keyed on counts) handles this, but verify a search during a non-dragging state doesn't produce a phantom commit (it won't: commit only on pointerup; filtering just changes which rows render). Keep the divider counter reflecting the FILTERED counts.
- [ ] **Step 3: Run** → pass. `npx vitest run app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx`
- [ ] **Step 4: Wire** `searchTerm={boundarySearch}` on the page mount (Task 3 Step 6).
- [ ] **Step 5: TD entry** in `docs/c_tech_debt.md` (match house format):
  - `TD-SPRINT-BOUNDARY-SEARCH` (S3): boundary search is client-side title-contains over the loaded page only (backend `WorkItemQueryBody` has no search term). Trigger: sprints exceed one page (100 rows) so off-page matches are missed, OR search must match fields beyond title. Pay-down: add a `search` term to `WorkItemQueryBody` + handler ILIKE, switch the skin to server search.
- [ ] **Step 6: Whole-dir tests + typecheck**, then commit (skin+test, then page, then TD — or together if cohesive). Inspect staged diff first.

---

## Self-review notes
- Spec coverage: empty-state (T2), title+subtitle in-skin (T2), action bar in-skin fully-wired (T2 render + T3 page wiring + T1/T3 filters + T4 search), default-to-current (T3 Step 1-2). ✓
- All new skin props optional → existing 34 tests + existing mount unaffected (verify in T2/T4 whole-dir runs).
- Honesty: client-side search is a real limitation (one-page only) → TD-SPRINT-BOUNDARY-SEARCH logged, not hidden.
- Verification seams flagged: `useWorkItemsFilters` filter field names, `WorkItemsFilterChips` option props, the exact legacy nav-button block to reuse as `leading` — executor confirms against the real files and adapts the page only.
