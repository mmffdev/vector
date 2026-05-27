"use client";

// FlowBoard registry — FB1.3.1 scaffold stub.
//
// Addressable slot-name helpers. Full registration against
// app/components/AddressAnchorResolver.tsx lands in FB1.3.7 once the
// component renders real content.
//
// Slot naming convention (spec §9):
//   samantha._viewport.app._kind.panel.flow_board_<name>
// where <name> is the `name` field from the sidecar config (e.g.
// "flow_board_workitems" → the first sidecar).

/**
 * Build the addressable slot name for a FlowBoard instance.
 *
 * The sidecar's `name` field IS the full slot suffix by convention
 * (e.g. "flow_board_workitems"). This helper only prepends the global
 * `samantha._viewport.app._kind.panel.` address namespace — it never
 * adds a `flow_board_` prefix of its own.
 *
 * @param name - The sidecar config `name` field (e.g. "flow_board_workitems").
 * @returns The fully-qualified samanthaAPI slot string.
 *
 * @example
 *   getFlowBoardSlotName("flow_board_workitems")
 *   // → "samantha._viewport.app._kind.panel.flow_board_workitems"
 */
export function getFlowBoardSlotName(name: string): string {
  return `samantha._viewport.app._kind.panel.${name}`;
}
