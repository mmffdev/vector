"use client";

// WipGearButton — FB1.3.6
//
// Renders a gear icon button that opens the WipSettingsModal.
// Only visible to callers who are explicit members of the topology node
// (i.e. have a row in topology_nodes_members for that node).
//
// Membership is checked via useNodeMembership():
//   - isLoading → render nothing (prevents flash of incorrect button).
//   - isMember === false → return null (gear hidden for non-members, AC 1).
//   - isMember === true → render button that calls onClick().
//
// Note: icon uses a Unicode gear (⚙) for v1. A proper icon component
// should replace this once the icon library is wired — TD-FB-GEAR-ICON.
//
// Spec: docs/superpowers/specs/2026-05-27-flowboard-design.md §4, §7.4

import React from "react";
import { useNodeMembership } from "../hooks/useNodeMembership";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WipGearButtonProps {
  topologyNodeId: string;
  onClick: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WipGearButton({
  topologyNodeId,
  onClick,
}: WipGearButtonProps): React.ReactElement | null {
  const { isMember, isLoading } = useNodeMembership(topologyNodeId);

  // While loading: render nothing to prevent premature display.
  if (isLoading) return null;

  // Non-member: gear is fully hidden (AC 1).
  if (!isMember) return null;

  return (
    <button
      type="button"
      className="flow-board__GearButton"
      onClick={onClick}
      aria-label="WIP limit settings"
      title="Edit WIP limits"
    >
      ⚙
    </button>
  );
}

export default WipGearButton;
