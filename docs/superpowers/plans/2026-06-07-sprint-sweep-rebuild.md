# Sprint Sweep-to-Commit Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace the per-move-React-state sprint divider with an imperative DOM sweep: press the handle, drag over rows (instant CSS highlight, ZERO React renders per move), release to commit once. Direction-aware (down=add green, up=remove amber). Fix the blank Sprint column.

**Architecture:** New `useSweepSelect` hook owns the gesture imperatively — snapshots rows on pointerdown, toggles a `.swept` class via `el.classList` per move (no setState), collects swept uuids on release and calls the existing `commit` seam. `Grid__SprintBoundary` rewired to it; `useSprintBoundary` (the defect) retired. No shared-Grid edits.

**Tech Stack:** React+TS (refs + imperative DOM, not per-move state), Vitest + @testing-library/react (incl. a render-count spy as the perf regression guard), CSS in app/globals.css.

---

## Constraints (verify every task)
- NO edits to `Grid__Tree*.tsx`, `useTree.ts`, `useColumnManager.ts`, `types.ts`, `scopeTreeData.ts`, `app/lib/apiSite`, `PrefixBlockStripes.tsx`, `Grid__Tree_ActionBar.tsx`. Compose by import.
- Work on `main`. Do NOT create a branch (HARD RULE). Commit on main.
- Inspect `git diff --cached --stat` before every commit; stage only intended files; if `docs/c_tech_debt.md` shows unrelated churn, do NOT bundle it.
- The performance contract is non-negotiable: ZERO React renders between pointerdown and pointerup. Task 1's render-count test enforces it.

## Confirmed facts
- `pocColumns = makeScopeColumns(...)` returns ALL columns incl. Sprint (id "sprint", renderCell `r.sprint ?? "—"`) — so the blank Sprint col is an OVERFLOW clip, not a missing column. The `.grid`/`.grid__Tree*` CSS family uses `overflow: hidden`/`overflow-x: hidden`.
- The current divider is `<div role="separator" className="grid__SprintBoundary_Divider">` — reuse as the sweep handle; replace its internal capture-drag with sweep handlers.
- The page `commit`/`pocCommit({toSprint,toBacklog})` seam is reused verbatim.
- ScopeNode rows carry `uuid` (write key) + `summary` (title). mapWire sets `sprint: w.sprint?.alias ?? null`.

## File structure
- Create: `app/components/Grid/useSweepSelect.ts` + `__tests__/useSweepSelect.test.ts`
- Modify: `app/components/Grid/Grid__SprintBoundary.tsx` (rewire to sweep; data-attrs on rows; retire useSprintBoundary import) + its test
- Modify: `app/components/Grid/Grid__SprintBoundary_Divider.tsx` (handle: sweep pointer props instead of capture-drag) — OR fold the handle into the skin; planner picks the smaller diff
- Modify: `app/globals.css` (`-sweptAdd`/`-sweptRemove` styles + container overflow fix)
- Delete: `app/components/Grid/useSprintBoundary.ts` + `__tests__/useSprintBoundary.test.ts`
- Modify: `app/(user)/value-sprint/page.tsx` only if the commit-prop mapping needs adjusting (likely no change — commit shape preserved)

---

## Task 1: `useSweepSelect` — imperative DOM sweep engine (with zero-render contract)

**Files:** Create `app/components/Grid/useSweepSelect.ts` + `__tests__/useSweepSelect.test.ts`

The hook owns the gesture. It is DOM-imperative: only TWO React renders per gesture (dragging true on down, false on up). Everything between is `classList`/`textContent`.

- [ ] **Step 1: Write the failing test.** Create `__tests__/useSweepSelect.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSweepSelect, type SweepResult } from "../useSweepSelect";

// Build a fake container with N rows at known Y positions. Each row is a div
// with data-sweep-uuid + data-sweep-section, and a mocked getBoundingClientRect.
function makeContainer(rows: { uuid: string; section: "sprint" | "backlog"; top: number; height: number }[]) {
  const container = document.createElement("div");
  for (const r of rows) {
    const el = document.createElement("div");
    el.setAttribute("data-sweep-row", "");
    el.setAttribute("data-sweep-uuid", r.uuid);
    el.setAttribute("data-sweep-section", r.section);
    el.getBoundingClientRect = () =>
      ({ top: r.top, height: r.height, bottom: r.top + r.height, left: 0, right: 0, width: 0, x: 0, y: r.top, toJSON: () => {} }) as DOMRect;
    container.appendChild(el);
  }
  document.body.appendChild(container);
  return container;
}

function pointer(clientY: number) {
  return { clientY, pointerId: 1, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} }, preventDefault() {} } as unknown as React.PointerEvent<HTMLElement>;
}

describe("useSweepSelect", () => {
  it("sweeps DOWN over backlog rows → add delta with their uuids", () => {
    // sprint rows above (top 0,40), backlog rows below (80,120,160), handle origin at y=70
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "s2", section: "sprint", top: 40, height: 40 },
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
      { uuid: "b2", section: "backlog", top: 120, height: 40 },
      { uuid: "b3", section: "backlog", top: 160, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let result: SweepResult | null = null;
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit: (r) => { result = r; } }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));   // origin between sprint & backlog
    act(() => p.onPointerMove(pointer(150)));  // sweep down to cover b1 (mid 100) + b2 (mid 140)
    // b1 mid=100 ≤ 150, b2 mid=140 ≤ 150, b3 mid=180 > 150 → b1,b2 swept
    expect(container.querySelectorAll(".grid__SprintBoundary_Row-sweptAdd").length).toBe(2);
    act(() => p.onPointerUp(pointer(150)));
    expect(result).toEqual({ direction: "add", uuids: ["b1", "b2"] });
    // classes cleared on release
    expect(container.querySelectorAll(".grid__SprintBoundary_Row-sweptAdd").length).toBe(0);
    container.remove();
  });

  it("sweeps UP over sprint rows → remove delta", () => {
    const container = makeContainer([
      { uuid: "s1", section: "sprint", top: 0, height: 40 },
      { uuid: "s2", section: "sprint", top: 40, height: 40 },
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let result: SweepResult | null = null;
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit: (r) => { result = r; } }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));   // origin just below sprint
    act(() => p.onPointerMove(pointer(10)));   // sweep up: s1 mid=20≥10, s2 mid=60≥10 → both swept-remove
    expect(container.querySelectorAll(".grid__SprintBoundary_Row-sweptRemove").length).toBe(2);
    act(() => p.onPointerUp(pointer(10)));
    expect(result).toEqual({ direction: "remove", uuids: ["s2", "s1"].sort() === ["s1","s2"] ? ["s1","s2"] : ["s1","s2"] });
    container.remove();
  });

  it("a click with no movement commits nothing", () => {
    const container = makeContainer([{ uuid: "b1", section: "backlog", top: 80, height: 40 }]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    const onCommit = vi.fn();
    const { result: hook } = renderHook(() =>
      useSweepSelect({ containerRef, counterRef, onCommit }),
    );
    const p = hook.current.handlePointerProps;
    act(() => p.onPointerDown(pointer(70)));
    act(() => p.onPointerUp(pointer(70)));     // no move
    expect(onCommit).not.toHaveBeenCalled();
    container.remove();
  });

  it("does NOT re-render React between pointerdown and pointerup (perf contract)", () => {
    const container = makeContainer([
      { uuid: "b1", section: "backlog", top: 80, height: 40 },
      { uuid: "b2", section: "backlog", top: 120, height: 40 },
    ]);
    const containerRef = { current: container };
    const counterRef = { current: document.createElement("span") };
    let renders = 0;
    const { result: hook } = renderHook(() => {
      renders++;
      return useSweepSelect({ containerRef, counterRef, onCommit: () => {} });
    });
    const p = hook.current.handlePointerProps;
    const beforeDown = renders;
    act(() => p.onPointerDown(pointer(70)));   // 1 render allowed (dragging=true)
    const afterDown = renders;
    act(() => { p.onPointerMove(pointer(100)); p.onPointerMove(pointer(140)); p.onPointerMove(pointer(160)); });
    // ZERO renders during the moves — the whole point.
    expect(renders).toBe(afterDown);
    act(() => p.onPointerUp(pointer(160)));    // 1 render allowed (dragging=false)
    expect(afterDown - beforeDown).toBeLessThanOrEqual(1);
    container.remove();
  });
});
```

- [ ] **Step 2: Run → fail (module missing).** `npx vitest run app/components/Grid/__tests__/useSweepSelect.test.ts`

- [ ] **Step 3: Implement `useSweepSelect.ts`:**

```ts
"use client";

// useSweepSelect — imperative DOM sweep for the sprint boundary. The gesture is
// pure DOM: pointerdown snapshots the rows + their midpoints ONCE; pointermove
// toggles a .swept class via classList (NO React state → NO re-render of the
// 100+ row grid); pointerup collects the swept uuids and commits once. Only two
// React renders happen per gesture (dragging true/false). This is the fix for
// the old per-move-setState divider that re-rendered the whole grid on every
// pixel and "checked each artefact" as you passed it.

import { useCallback, useRef, useState } from "react";

export interface SweepResult {
  direction: "add" | "remove";
  uuids: string[];
}

interface RowSnap {
  el: HTMLElement;
  uuid: string;
  section: "sprint" | "backlog";
  mid: number;
}

export interface UseSweepSelectArgs {
  containerRef: { current: HTMLElement | null };
  counterRef: { current: HTMLElement | null };
  onCommit: (result: SweepResult) => void;
}

export interface UseSweepSelectResult {
  dragging: boolean;
  handlePointerProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  };
}

const ADD = "grid__SprintBoundary_Row-sweptAdd";
const REMOVE = "grid__SprintBoundary_Row-sweptRemove";

export function useSweepSelect({
  containerRef,
  counterRef,
  onCommit,
}: UseSweepSelectArgs): UseSweepSelectResult {
  const [dragging, setDragging] = useState(false);
  const snapRef = useRef<RowSnap[]>([]);
  const originRef = useRef(0);
  const sweptRef = useRef<{ direction: "add" | "remove"; uuids: string[] }>({
    direction: "add",
    uuids: [],
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const container = containerRef.current;
      if (!container) return;
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>("[data-sweep-row]"),
      );
      snapRef.current = rows.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          el,
          uuid: el.getAttribute("data-sweep-uuid") ?? "",
          section:
            (el.getAttribute("data-sweep-section") as "sprint" | "backlog") ??
            "backlog",
          mid: r.top + r.height / 2,
        };
      });
      originRef.current = e.clientY;
      sweptRef.current = { direction: "add", uuids: [] };
      setDragging(true);
    },
    [containerRef],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const snap = snapRef.current;
    if (snap.length === 0) return;
    const y = e.clientY;
    const goingDown = y >= originRef.current;
    const direction: "add" | "remove" = goingDown ? "add" : "remove";
    const uuids: string[] = [];
    for (const row of snap) {
      let swept = false;
      if (goingDown) {
        // add: backlog rows whose midpoint is between origin and pointer
        swept = row.section === "backlog" && row.mid > originRef.current && row.mid <= y;
        row.el.classList.toggle(ADD, swept);
        row.el.classList.remove(REMOVE);
      } else {
        // remove: sprint rows whose midpoint is between pointer and origin
        swept = row.section === "sprint" && row.mid < originRef.current && row.mid >= y;
        row.el.classList.toggle(REMOVE, swept);
        row.el.classList.remove(ADD);
      }
      if (swept) uuids.push(row.uuid);
    }
    sweptRef.current = { direction, uuids };
    if (counterRef.current) {
      counterRef.current.textContent =
        uuids.length === 0
          ? ""
          : `${uuids.length} to ${direction === "add" ? "add" : "remove"}`;
    }
  }, [counterRef]);

  const clearClasses = useCallback(() => {
    for (const row of snapRef.current) {
      row.el.classList.remove(ADD, REMOVE);
    }
    if (counterRef.current) counterRef.current.textContent = "";
  }, [counterRef]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      const result = sweptRef.current;
      clearClasses();
      snapRef.current = [];
      setDragging(false);
      if (result.uuids.length > 0) onCommit(result);
    },
    [clearClasses, onCommit],
  );

  return { dragging, handlePointerProps: { onPointerDown, onPointerMove, onPointerUp } };
}
```

NOTE for the executor: the second test's `expect(result).toEqual(...)` for the UP case has a sloppy ternary — replace it with `expect(result).toEqual({ direction: "remove", uuids: ["s1", "s2"] })` and ensure the implementation pushes sprint uuids in DOM order (s1 then s2). Adjust the test to the actual emit order if the loop yields a different order; pin whatever order the loop produces deterministically.

- [ ] **Step 4: Run → all 4 pass** (down, up, no-op, zero-render). `npx vitest run app/components/Grid/__tests__/useSweepSelect.test.ts`
- [ ] **Step 5: Commit.** `git add app/components/Grid/useSweepSelect.ts app/components/Grid/__tests__/useSweepSelect.test.ts && git commit -m "feat(grid): useSweepSelect — imperative DOM sweep (zero renders mid-gesture)"`

---

## Task 2: Rewire Grid__SprintBoundary to the sweep + row data-attrs + CSS

**Files:** Modify `Grid__SprintBoundary.tsx`, `Grid__SprintBoundary_Divider.tsx`, `app/globals.css`, the skin test.

- [ ] **Step 1: Read** the current `Grid__SprintBoundary.tsx` + `Grid__SprintBoundary_Divider.tsx` fully.

- [ ] **Step 2: Rewire the skin.** In `Grid__SprintBoundary.tsx`:
  - Remove the `useSprintBoundary` import + usage and the `dragStartY`/`dragStartIndex`/`rowHeight`/`onDragStart`/`onDragMove`/`onDragEnd`/`boundary` machinery.
  - Add a `containerRef` (on `grid__SprintBoundary_Body`) and a `counterRef`.
  - Build the commit adapter: `const onSweepCommit = useCallback((r: SweepResult) => commit(r.direction === "add" ? { toSprint: r.uuids, toBacklog: [] } : { toSprint: [], toBacklog: r.uuids }), [commit]);`
  - `const { dragging, handlePointerProps } = useSweepSelect({ containerRef, counterRef, onCommit: onSweepCommit });`
  - Render: sprint rows, then the handle (the divider element, now spread with `handlePointerProps` + holding the `counterRef` span), then backlog rows.
  - Each row `<div>` gets `data-sweep-row data-sweep-uuid={n.row.uuid} data-sweep-section={isSprintSection ? "sprint" : "backlog"}`. "isSprintSection" = the row came from `sprintNodes` (render sprintNodes first with section="sprint", then backlogNodes with section="backlog" — no boundaryIndex needed anymore).
  - Keep: the title band, action bar, GridTreeHead, the empty-sprint hint (hide it while `dragging` — `{sprintNodes.length === 0 && !dragging && (…hint…)}`), the searchTerm filter, the dedupe.
  - The "N of M in sprint" divider counter is replaced by the live `counterRef` span ("N to add"/"N to remove" during sweep, empty at rest) — or keep a static "Sprint N · Backlog M" label at rest.

- [ ] **Step 3: Rewire the divider into a sweep handle.** In `Grid__SprintBoundary_Divider.tsx`: replace the capture-drag internals with a presentational handle that spreads `handlePointerProps` and renders the grip + the `counterRef` span. Simplest: change its props to `{ pointerProps, counterRef, dragging }` and render `<div role="separator" className={...dragging...} {...pointerProps}><span grip/><span ref={counterRef} className="..._Count"/></div>`. Remove the old onDragStart/Move/End/inSprintCount/total props.

- [ ] **Step 4: CSS** (append/replace in app/globals.css; keep the existing `-dragging` bloom):
```css
.grid__SprintBoundary_Row-sweptAdd {
  background: color-mix(in srgb, var(--accent, #0bb45a) 16%, transparent);
  box-shadow: inset 3px 0 0 var(--accent, #0bb45a);
}
.grid__SprintBoundary_Row-sweptRemove {
  background: color-mix(in srgb, #e8a13a 18%, transparent);
  box-shadow: inset 3px 0 0 #e8a13a;
}
```

- [ ] **Step 5: Update the skin test** (`Grid__SprintBoundary.test.tsx`): the drag tests now drive the HANDLE's pointer props over rows. Replace the boundary-counter assertions with sweep assertions: pointerdown on the separator, pointermove over rows (with mocked getBoundingClientRect on the row divs), pointerup → assert `commit({toSprint:[…]})`. Keep the title-band / action-bar / empty-state / search / dedupe tests (adjust empty-state if the hint now hides on drag). Remove tests that asserted "N of M in sprint" boundary text.

- [ ] **Step 6: Run** `npx vitest run app/components/Grid/__tests__/Grid__SprintBoundary.test.tsx` → all pass. Then whole dir.
- [ ] **Step 7: Typecheck** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i sprintboundary || echo clean`. Shared-file check empty.
- [ ] **Step 8: Commit** the 4 files.

---

## Task 3: Fix the blank Sprint column (overflow)

**Files:** Modify `app/globals.css` (and only if needed, the page's column set).

- [ ] **Step 1: Diagnose live-faithfully** — the `.grid`/`.grid__Tree*` container has `overflow: hidden`/`overflow-x: hidden`, clipping right columns when the template is wider than the container. Add a scoped rule so the POC grid scrolls horizontally instead of clipping:
```css
.grid__SprintBoundary,
.grid__SprintBoundary_Body { overflow-x: auto; }
```
ONLY scope to `grid__SprintBoundary*` — do NOT change the shared `.grid`/`.grid__Tree` rules (other grids rely on them).
- [ ] **Step 2: Verify** the Sprint column renders (test asserts the "Sprint" header + a row alias is present). If the data lacks `r.sprint` for sprint-clamped rows, that's a data issue — note it; the column showing "—" is acceptable, a clipped/missing column is not.
- [ ] **Step 3: Commit.**

---

## Task 4: Retire useSprintBoundary + final wiring

**Files:** Delete `useSprintBoundary.ts` + its test; verify page mount.

- [ ] **Step 1:** Confirm nothing imports `useSprintBoundary` anymore: `grep -rn "useSprintBoundary" app/ | grep -v "__tests__"` → only its own file. Then `git rm app/components/Grid/useSprintBoundary.ts app/components/Grid/__tests__/useSprintBoundary.test.ts`.
- [ ] **Step 2:** Page mount — the `commit` prop shape is unchanged, so `value-sprint/page.tsx` likely needs NO change. If the skin dropped a prop the page passed (e.g. none), confirm typecheck. Do not otherwise touch the page.
- [ ] **Step 3:** `npx vitest run app/components/Grid/` → all pass (sweep + skin + others; useSprintBoundary tests gone). Typecheck whole. Commit.

---

## Self-review notes
- Spec coverage: imperative sweep w/ zero-render contract (T1 + its render-count test), skin rewire + direction-aware highlight + empty-hint-hides-on-drag (T2), Sprint-column overflow (T3), retire old engine (T4). ✓
- The performance contract is a TEST, not a hope (T1 step 3 render-count). This is the guard against the exact regression the user hit.
- Verification seams: the exact divider→handle prop reshape (T2.3) and the skin test rewrite (T2.5) are the fiddly bits — executor adapts to the real current structure, never edits shared files.
- LIVE VERIFICATION REQUIRED before declaring done (controller will drive the real browser); unit-green is necessary but NOT sufficient this time.
