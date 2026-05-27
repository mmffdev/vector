// CardFieldRenderer — FB1.3.5
//
// Pure-function per-field renderer for a single field on a FlowBoard card.
// Receives the field key and the full ArtefactCard row; returns the rendered
// output for that field slot, or null for unknown / removed field keys.
//
// Design contract (spec §7.5):
//   - Pure function: same input → same output, no hooks, no side effects.
//   - Unknown field keys render nothing (silent no-op) — per-user prefs may
//     include fields that have since been removed from the type; crashing or
//     showing an error would be worse than silent omission.
//   - Five default fields match the Rally-matching defaults in the sidecar
//     (id, title, assignee, points, priority).

import React from "react";
import type { ArtefactCard } from "@/app/components/FlowBoard/hooks/useFlowBoardData";

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CardFieldRendererProps {
  field: "id" | "title" | "assignee" | "points" | "priority" | string;
  artefact: ArtefactCard;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * CardFieldRenderer renders a single field of an artefact card.
 *
 * This is a pure function — no hooks, no side effects, no network calls.
 * The same (field, artefact) input always produces the same output.
 *
 * Unknown field keys return null (render nothing). This is intentional:
 * a user may have saved card prefs that include fields no longer present
 * on the artefact type; silent omission is the documented behaviour.
 */
export function CardFieldRenderer({
  field,
  artefact,
}: CardFieldRendererProps): React.ReactElement | null {
  switch (field) {
    case "id":
      return (
        <div className="flow-board__Card_field flow-board__Card_field-id">
          {artefact.id.slice(0, 8)}
        </div>
      );

    case "title":
      return (
        <div className="flow-board__Card_field flow-board__Card_field-title">
          {artefact.title}
        </div>
      );

    case "assignee":
      return (
        <div className="flow-board__Card_field flow-board__Card_field-assignee">
          {artefact.assignee ?? "—"}
        </div>
      );

    case "points":
      return (
        <div className="flow-board__Card_field flow-board__Card_field-points">
          {artefact.points ?? "—"}
        </div>
      );

    case "priority":
      return (
        <div className="flow-board__Card_field flow-board__Card_field-priority">
          {artefact.priority ?? "—"}
        </div>
      );

    default:
      // Unknown field key — silent no-op per spec §7.5.
      return null;
  }
}

export default CardFieldRenderer;
