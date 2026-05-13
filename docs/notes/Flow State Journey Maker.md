# Orbit View — Kanban Transition Rule Editor

A handoff brief for Claude Code. Paste this whole document into Claude Code
to scaffold the feature.

---

## What it is

A UI for defining which workflow transitions are allowed on a Kanban board.
Instead of an N×N matrix, the user picks **one source state at a time** and
sees the remaining states **orbiting around it**. Each orbiting state is a
button: tap to allow that transition, tap again to block it.

Mental model: *"Where can a card go from HERE?"* — one question at a time.

This replaces the existing "Allowed transitions" matrix screen.

---

## Why this shape

- A matrix forces users to mentally orient on two axes (from-row, to-column)
  before every decision. Most product owners think in journeys, not grids.
- The orbit reframes the question as a single, focused one: pick the source,
  then answer 6 yes/no questions about destinations.
- All destinations are equidistant from the source — no implied ordering or
  hierarchy. The visual is neutral.
- An inbound arrow from the centre confirms the move is allowed (positive
  affirmation). No arrow = blocked. No red, no checkmarks needed.

---

## Information architecture

```
┌─────────────────────────────────────────────────────────┐
│  Workflow rules                                          │
│  Pick a source state. Tap a destination to allow/block. │
├──────────────┬──────────────────────────────────────────┤
│ SOURCE STATE │                                          │
│ ● Backlog  1 │                                          │
│ ● To Do    2 │              [ Backlog ]                 │
│ ● Doing    1 │           ↗            ↘                 │
│ ● …        0 │      [ Rick ]      [ To Do ]             │
│              │         ↓     FROM      ↓                │
│              │      [ Done ]   ←→   [ Doing ]           │
│              │           ↘            ↗                 │
│              │             [ Accepted ]                 │
│              │                                          │
├──────────────┴──────────────────────────────────────────┤
│ RULE COUNT 4   Backlog→To Do  To Do→Doing  Doing→To Do │
└─────────────────────────────────────────────────────────┘
```

- **Left rail**: list of all workflow states. Selected state is highlighted.
  Each row shows a count of outbound rules from that state.
- **Centre canvas**: an SVG. The focused state sits in the middle inside a
  larger ringed node. The other states orbit on a circle, evenly spaced. A
  gold arrow points from the centre to every state currently allowed as a
  destination.
- **Footer**: a live summary of the resolved rule set across all sources.

---

## Interactions

| Action                         | Result                                       |
| ------------------------------ | -------------------------------------------- |
| Click a state in the left rail | That state becomes the focused centre        |
| Click an orbiting state        | Toggles the transition `focus → orbiting` |
| (Hover an orbiting state)      | Slight highlight on its ring                 |

No drag, no multi-select, no modes. One control: tap.

---

## Data model

Rules are a set of directed `(from, to)` pairs.

```ts
type StateId = string;
type Transition = { from: StateId; to: StateId };

// Suggested storage shape:
// rules: Set<`${from}>${to}`>
```

Helper operations the UI needs:

- `has(from, to): boolean` — is this transition allowed?
- `toggle(from, to)` — flip it
- `allow(from, to)` / `block(from, to)` — explicit setters
- `countOutbound(from): number` — for the left-rail badge
- `all(): Transition[]` — flatten for the footer + persistence

---

## Visual specification

This sits inside the existing **Vector Design System** (warm-neutral with a
dark mode). Use the project's design tokens, not hard-coded values.

### Layout

- Left rail: fixed 200px wide.
- Centre canvas: fills remaining width. ViewBox `760 × 440` is a good
  starting ratio.
- Centre node radius: 48px. Stroke `--ink`, fill `--canvas`.
- Orbit radius: 155px (from canvas centre).
- Orbiting node radius: 32px.

### Tokens

| Use                           | Token                                      |
| ----------------------------- | ------------------------------------------ |
| Canvas background             | `--canvas`                               |
| Rail / panel surface          | `--surface`                              |
| Selected row in rail          | `--sunken` + `--border-strong` outline |
| Centre node ring              | `--ink`                                  |
| Orbit allowed: fill           | `--accent-soft` (≈16% accent)           |
| Orbit allowed: stroke + arrow | `--accent` (warm gold)                   |
| Orbit blocked: fill           | `--surface-2`                            |
| Orbit blocked: stroke         | `--border-strong`                        |
| Per-state dot colour          | A small deterministic hue per state id     |

### Type

- Inter throughout. Centre node label is 13px / 600. Orbit labels 11px /
  500. Rail rows 12px. Eyebrow labels (SOURCE STATE, FROM, RULE COUNT) are
  10px / 600 / `0.12em` letter-spacing / `--ink-subtle`.
- Two-word state names ("Deglan Review") wrap to two lines inside their
  circle: first word at y=3, second at y=15, smaller and muted.

### Motion

- 150ms tone change when toggling allow/block on a node.
- 200ms ease on the inbound arrow's stroke opacity when it appears or
  disappears.
- No bounce, no spring. Respect `prefers-reduced-motion`.

---

## React component shape

A single component, `<OrbitView />`, with one piece of local state for the
focused state and one for the rule set (or a prop if rules live higher).

```tsx
type OrbitViewProps = {
  states: { id: string; name: string }[];
  rules: Set<string>;            // "from>to" strings
  onChange: (next: Set<string>) => void;
};
```

Internal layout: a flex row of `<StateRail />` + `<OrbitCanvas />`.

### `<OrbitCanvas />` — SVG

Pure SVG, no canvas. Compute orbit positions in JS:

```ts
const angle = (-Math.PI / 2) + (i / orbiting.length) * 2 * Math.PI;
const x = cx + Math.cos(angle) * R;
const y = cy + Math.sin(angle) * R;
```

For each orbiting state, draw:

1. An arrow line from the centre (offset by 50px) to the node (offset by
   `R - 32`) — but only if the transition is allowed.
2. The circle.
3. The label text.

Use a single `<marker>` definition for the arrowhead.

### Accessibility

- Each orbit circle is a `<button>` overlaid on the SVG node (or wrap
  `<g>` with `role="button"` + `tabIndex` + keyboard handlers).
- Label: `"Allow move from {from} to {to}"` (toggles).
- Left rail rows are real `<button>`s with `aria-pressed`.

---

## Empty / edge states

- **No rules at all from focused state**: the centre still shows; no arrows
  radiate; orbit nodes are all in their blocked tone. The footer reads "No
  transitions allowed yet."
- **More than 8 states**: keep the algorithm — it scales to ~10. Beyond
  that, increase the orbit radius and shrink the orbit nodes. Don't add a
  scroll; the whole point is seeing all destinations at once.
- **Self-transitions**: the focused state is excluded from the orbit, so
  this is impossible by construction. If the data model permits them,
  ignore them in the orbit view and surface them as a separate toggle near
  the centre node.

---

## Persistence

Whenever the rule set changes, persist to the same backend that the matrix
view used. Same data shape — no migration. The Orbit view is purely a
different presentation of the same `Transition[]`.

---

## File layout (suggested)

```
src/features/workflow-rules/
├── OrbitView.tsx        # the main component
├── OrbitCanvas.tsx      # the SVG
├── StateRail.tsx        # the left-rail picker
├── rules.ts             # Set<string> helpers + types
└── OrbitView.module.css # if not using a CSS-in-JS solution
```

---

## Acceptance criteria

- [ ] Picking any state in the left rail moves it to the centre within
  150ms with no layout shift outside the canvas.
- [ ] Tapping an orbit node toggles the rule and animates the arrow in/out.
- [ ] Each rail row shows a live count of outbound rules.
- [ ] All 7 (or N) states are visible without scroll.
- [ ] Keyboard: Tab through orbit nodes; Space/Enter toggles; arrow keys
  walk the orbit clockwise/counter-clockwise.
- [ ] Footer shows resolved rules and total count, updates live.
- [ ] Matches Vector Design System dark mode tokens — no hard-coded
  colours.

---

## Reference

A working prototype lives in this project at
`Flow rule builders.html` → artboard "03 · Orbit view". Source files:
`m3-orbit.jsx`, `shared.jsx`, `styles.css`. Open the artboard in focus mode
to interact with it; copy the SVG positioning math from `m3-orbit.jsx`
verbatim.
