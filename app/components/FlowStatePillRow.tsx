"use client";

import React from "react";
import { type WorkItemFlowState } from "./useWorkItemFlowStates";

export function FlowStatePillRow({
  currentId,
  states,
  onCommit,
  // When true, the block row is rendered locked: blocks are non-
  // interactive (no onClick, cursor:default, aria-disabled) and the
  // group carries a tooltip explaining the derivation. Used by
  // execution-zone artefacts that have children — their flow state is
  // derived from the children (work flows up), so manual edits are
  // rejected backend-side too (ErrParentFlowStateDerived → 409).
  derived = false,
  readOnly = false,
  readOnlyTitle,
}: {
  currentId: string;
  states: WorkItemFlowState[];
  onCommit: (id: string) => void;
  derived?: boolean;
  readOnly?: boolean;
  readOnlyTitle?: string;
}) {
  if (states.length === 0) return null;

  const locked = derived || readOnly;

  return (
    <span
      className={"grid__Tree_Row_FlowState" + (derived ? " grid__Tree_Row_FlowState-derived" : "")}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      title={
        derived
          ? "Derived from children — change a child's state to update this row"
          : readOnlyTitle
      }
    >
      {states.map((s) => {
        const isActive = s.id === currentId;
        const className =
          "grid__Tree_Row_FlowState_Btn" +
          (isActive ? " grid__Tree_Row_FlowState_Btn-active" : "");
        return (
          <button
            key={s.id}
            type="button"
            className={className}
            aria-pressed={isActive}
            aria-disabled={locked || isActive ? true : undefined}
            aria-label={s.name}
            title={s.name}
            onClick={locked || isActive ? undefined : () => onCommit(s.id)}
          >
            <span className="grid__Tree_Row_FlowState_Btn_Label">{s.name[0]}</span>
          </button>
        );
      })}
    </span>
  );
}
