"use client";

import React from "react";
import { type WorkItemFlowState } from "./useWorkItemFlowStates";

export function FlowStatePillRow({
  currentId,
  currentCode,
  states,
  onCommit,
}: {
  currentId: string;
  currentCode: string;
  states: WorkItemFlowState[];
  onCommit: (id: string) => void;
}) {
  if (states.length === 0) return null;

  return (
    <span
      className="wi-flow-row"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {states.map((s) => {
        const isActive = s.id === currentId;
        // Use the current item's canonical_code for the active segment so the
        // colour reflects the actual state even when tenant has renamed it.
        const code = isActive ? currentCode : s.canonical_code;
        return (
          <button
            key={s.id}
            type="button"
            className={
              "wi-flow-row__btn" +
              (isActive ? " wi-flow-row__btn--active wi-flow-row__btn--active-" + code : "")
            }
            aria-pressed={isActive}
            aria-label={s.name}
            title={s.name}
            onClick={isActive ? undefined : () => onCommit(s.id)}
          >
            {s.name[0]}
          </button>
        );
      })}
    </span>
  );
}
