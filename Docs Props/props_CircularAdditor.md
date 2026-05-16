# `<CircularAdditor>` props

Source: [`app/components/catalogue/c_circular_additor/circularAdditor.tsx`](app/components/catalogue/c_circular_additor/circularAdditor.tsx)
Props interface: [`circularAdditor.tsx:32-61`](app/components/catalogue/c_circular_additor/circularAdditor.tsx#L32-L61)

A standalone, reusable sub-panel for designing a cyclical sequence of items. Layout: `[ SOURCE STATE rail ] [ TRANSITION SELECTOR canvas ]`. Rail rows remove on click; canvas `+` slots insert at that angle (with two extra slots across the wrap gap for insert-before-first / insert-after-last). Newly inserted items pin to the clicked angle while the rest rebalance evenly.

## Controlled mode

Drive the component from parent state.

| Prop | Type | Notes |
|---|---|---|
| `items` | `OrbitItem[]` | Source of truth when supplied. Switches the component into controlled mode. |
| `onInsert` | `(index: number, angle: number) => void` | Fires when a `+` slot is clicked. |
| `onRemove` | `(id: string) => void` | Fires when a node or rail row is clicked. |

## Uncontrolled mode

Built-in local state. Ignored if `items` is set.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `defaultItems` | `OrbitItem[]` | `DEFAULT_SEED` (5 states) | Initial ring contents. |
| `paletteForNewItems` | `string[]` | 12-colour palette | Cycled when inserting new items. |
| `newItemLabel` | `(n: number) => string` | `` n => `New ${n}` `` | Label factory for inserted items. |

## Layout / chrome

| Prop | Type | Default | Notes |
|---|---|---|---|
| `showRail` | `boolean` | `true` | Hide to render canvas only. |
| `railEyebrow` | `string` | `"SOURCE STATE"` | Rail header eyebrow text. |
| `canvasEyebrow` | `string` | `"TRANSITION SELECTOR"` | Canvas header eyebrow text. |
| `railFooter` | `ReactNode` | — | Slot below the rail. |
| `onResetToDefaults` | `() => void` | — | Optional reset hook. |

## Geometry

| Prop | Type | Default |
|---|---|---|
| `viewbox` | `number` | `480` |
| `orbitRadius` | `number` | `160` |
| `nodeRadius` | `number` | `40` |
| `plusRadius` | `number` | `14` |

## Decoration / animation

| Prop | Type | Default | Notes |
|---|---|---|---|
| `showFlowDecoration` | `boolean` | `true` | Boundary wedge + flow arrows + outer crosses. |
| `transitionMs` | `number` | `360` | Rebalance animation duration. |

## Item shape

[`OrbitItem`](app/components/catalogue/c_circular_additor/circularAdditor.tsx#L26-L30):

```ts
interface OrbitItem {
  id: string;
  label: string;
  colour: string;
}
```

## Consumers

- [`app/(user)/workspace-admin/flow-states-v2/page.tsx`](app/(user)/workspace-admin/flow-states-v2/page.tsx) — Orbit PoC — Add / Remove States panel
- [`app/(user)/workspace-settings/workspace-settings/flow-states-v2/page.tsx`](app/(user)/workspace-settings/workspace-settings/flow-states-v2/page.tsx) — duplicate page
