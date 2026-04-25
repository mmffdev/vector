// Interactions barrel — single import surface for the engine's optional
// behaviours. Each interaction is a no-op unless its flag is `true` on
// the Graph; the GraphCanvas wires the data-* attributes that CSS hangs
// hover/grab cursors off of.

export { attachDrag } from "./drag";
export type { DragHandle, DragOptions } from "./drag";
export { attachHover } from "./hover";
export type { HoverHandle, HoverOptions } from "./hover";
