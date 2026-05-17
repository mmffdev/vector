# `<treelist>` Skill

Reference pattern for rendering a recursive tree structure with correct connector lines (│ ├ └) at any depth. Use this whenever building or fixing a tree-view list component.

---

## The pattern

### Mental model

Every row draws its own spine SVG. The spine has `depth` columns. Each column is `STEP` px wide. A vertical guide line sits at `LINE_X` px within each column (typically `STEP / 2`).

```
Column:   0        1        2        3
          |←STEP→| |←STEP→| |←STEP→| |←STEP→|
          ^LINE_X                     ^own col (depth-1)
```

**Two kinds of column:**

| Column | Rule |
|---|---|
| `c < depth-1` | Ancestor pass-through. Draw a full vertical (top→bottom) if `ancestorMoreChildren[c]` is `true`. Draw nothing if `false`. |
| `c = depth-1` | This row's own connector. `isLast=true` → elbow └. `isLast=false` → T ├. |

**Elbow (└):** vertical top→mid, then horizontal mid→right edge of column.
**T (├):** full vertical top→bottom, plus horizontal arm mid→right edge.

No gaps between rows — the SVG height must exactly match the CSS row height.

---

### SVG paths

```
STEP    = 16      // px per depth level
ROW_H   = 32      // must match CSS height of each row
LINE_X  = 8       // x of vertical within each column = STEP/2
MID     = ROW_H/2 // y of horizontal arm
```

For each column `c` in `0..depth-1`:

```
x = c * STEP + LINE_X
rightEdge = (c + 1) * STEP

if c < depth-1:
  if ancestorMoreChildren[c]:  → M{x} 0 L{x} {ROW_H}   // full vertical
  else:                        → (nothing)

if c == depth-1:
  if isLast:   → M{x} 0 L{x} {MID} L{rightEdge} {MID}  // elbow └
  else:        → M{x} 0 L{x} {ROW_H}                    // vertical
                 M{x} {MID} L{rightEdge} {MID}           // + horizontal arm ├
```

SVG width = `depth * STEP`. Height = `ROW_H`. Depth-0 rows return null (no spine).

Use `strokeLinecap="square"` so horizontal arms meet verticals flush.

---

### The `ancestorMoreChildren` array

Produced by `walkTopology` (this project's shared walker). For a row at depth D:

- Length = D
- Index `i` = "does the ancestor at depth `i` still have siblings below this row?"
  - `true` → that ancestor column stays live (vertical through-line)
  - `false` → that ancestor's subtree ended (no line)
- Index `D-1` = immediate parent → same as `!isLast` of the parent row

**Walker builds it as:** when recursing into a node's children, append `!isLast` to the path array. Children inherit the full path of their parent.

---

### Workspace / section header isolation

When tree roots are section headers (e.g. workspaces), their sibling relationship must NOT bleed through-lines into their children's spines. Fix: slice the workspace-level entry off the ancestor path before rendering child rows.

```ts
ancestorMoreChildren: r.depth > 0 ? r.ancestorMoreChildren.slice(1) : []
```

This makes each root's subtree visually self-contained — depth-1 nodes start with a clean path.

---

### React Spine component (canonical)

```tsx
const STEP = 16;
const ROW_H = 32;
const LINE_X = 8;

function Spine({ depth, isLast, ancestorMoreChildren }: {
  depth: number;
  isLast: boolean;
  ancestorMoreChildren: boolean[];
}) {
  if (depth === 0) return null;

  const W = depth * STEP;
  const H = ROW_H;
  const MID = H / 2;
  const paths: string[] = [];

  for (let c = 0; c < depth; c++) {
    const x = c * STEP + LINE_X;
    const rightEdge = (c + 1) * STEP;

    if (c < depth - 1) {
      if (ancestorMoreChildren[c]) {
        paths.push(`M${x} 0 L${x} ${H}`);
      }
    } else {
      if (isLast) {
        paths.push(`M${x} 0 L${x} ${MID} L${rightEdge} ${MID}`);
      } else {
        paths.push(`M${x} 0 L${x} ${H}`);
        paths.push(`M${x} ${MID} L${rightEdge} ${MID}`);
      }
    }
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="var(--ink-subtle)" strokeWidth="1.5"
              fill="none" strokeLinecap="square" />
      ))}
    </svg>
  );
}
```

---

### CSS requirements

```css
.treelist__item {
  display: flex;
  align-items: center;
  gap: 0;              /* no gap — spine SVG is flush with label */
  height: 32px;        /* must match ROW_H */
  padding: 0 12px 0 0;
}

/* Root nodes (depth 0) have no spine — give them explicit left padding */
.treelist__item--root {
  padding-left: 12px;
}

.treelist__spine {
  flex-shrink: 0;
  display: block;
}

.treelist__item-name {
  padding-left: 4px;   /* small gap after spine horizontal arm */
}
```

The list container must have `display: flex; flex-direction: column` with **no gap** — rows must be flush so SVG verticals connect across row boundaries.

---

### Checklist when implementing

- [ ] Row height in CSS exactly equals `ROW_H` constant
- [ ] List container has no `gap`, no `margin` between items
- [ ] `strokeLinecap="square"` on all paths
- [ ] Depth-0 nodes return null from Spine and get explicit `padding-left` in CSS
- [ ] If tree has section-header roots (workspaces etc.), apply `.slice(1)` to `ancestorMoreChildren`
- [ ] Verify with a node that has: multiple siblings, a last sibling, a deeply nested last child, an ancestor with later siblings

---

## Live implementation in this codebase

- **`app/components/ScopePicker.tsx`** — scope picker dropdown (workspace roots + full topology subtree)
- **`app/components/ScopeRail.tsx`** — sidebar topology flyout (same pattern, collapsible)
- **`app/lib/shared/topology/walker.ts`** — the `walkTopology` function that produces `ancestorMoreChildren`, `isLast`, `hasChildren`
