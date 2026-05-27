"use client";

// FlowBoard — top-level component skeleton. FB1.3.1.
//
// Props contract and placeholder render only. Actual implementation
// (columns, cards, drag engine, WIP headers) lands in FB1.3.2 – FB1.3.7.
//
// The addressable `data-samantha-slot` attribute is included here so the
// samanthaAPI surface is established from the first commit; full
// AddressAnchorResolver registration wires in FB1.3.7.

import type React from "react";
import type { FlowBoardConfig } from "@/app/components/FlowBoard/loader";
import { getFlowBoardSlotName } from "@/app/components/FlowBoard/registry";

// ── Props contract ────────────────────────────────────────────────────────────

export interface FlowBoardProps {
  /**
   * Validated sidecar config — import the JSON and run it through
   * `loadFlowBoardConfig` before passing it here.
   */
  config: FlowBoardConfig;

  /**
   * Topology node UUID the board belongs to. When omitted the component
   * resolves the active node from `useSentinel()` (wired in FB1.3.2).
   */
  topologyNodeId?: string;

  /**
   * Currently selected artefact type UUID. When provided, the parent
   * controls the switcher (controlled mode). When omitted the component
   * owns the selection as internal state (uncontrolled mode).
   */
  artefactTypeId?: string;

  /**
   * Called when the type switcher changes. Required for controlled mode;
   * ignored when `artefactTypeId` is omitted.
   */
  onArtefactTypeChange?: (id: string) => void;

  /**
   * Per-mount config override (samanthaAPI uses this to customise a
   * sidecar field without forking the JSON). The override is applied
   * inside `loadFlowBoardConfig` before the config reaches this component;
   * pass it there rather than here. This prop is reserved for future
   * samanthaAPI adapter wiring (FB1.3.7).
   */
  configOverride?: Partial<FlowBoardConfig>;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * FlowBoard — Kanban board whose columns are the custom flow states of a
 * selected artefact type, cards are live artefacts at the sentinel scope,
 * and card movement fires the existing flow-state PATCH.
 *
 * v1 scaffold — renders a placeholder until FB1.3.7 wires the full board.
 */
export function FlowBoard({
  config,
  topologyNodeId: _topologyNodeId,
  artefactTypeId: _artefactTypeId,
  onArtefactTypeChange: _onArtefactTypeChange,
  configOverride: _configOverride,
}: FlowBoardProps): React.ReactElement {
  const slotName = getFlowBoardSlotName(config.name);

  return (
    <div
      data-flowboard-placeholder
      data-samantha-slot={slotName}
      aria-label={config.title}
    >
      FlowBoard scaffold — implementation in FB1.3.7
    </div>
  );
}

export default FlowBoard;
