"use client";

import type { FlowState } from "@/app/lib/flowStatesApi";

export type StateRailProps = {
  states: FlowState[];
  hasRules: boolean;
  rulesSize: number;
  focusedId: string | null;
  onFocus: (id: string) => void;
  onClear: () => void;
  clearing: boolean;
  confirming: boolean;
};

export default function StateRail({ states, hasRules, rulesSize, focusedId, onFocus, onClear, clearing, confirming }: StateRailProps) {
  return (
    <div className="flow-rules__rail" role="group" aria-label="Source state picker">
      <p className="flow-rules__eyebrow">SOURCE STATE</p>
      <ul className="flow-rules__rail-list">
        {states.map((s) => {
          const isFocused = s.id === focusedId;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`flow-rules__rail-row${isFocused ? " is-focused" : ""}`}
                aria-pressed={isFocused}
                onClick={() => onFocus(s.id)}
              >
                <span
                  className="flow-rules__rail-dot"
                  style={s.colour ? { background: s.colour } : undefined}
                  aria-hidden
                />
                <span className="flow-rules__rail-name">{s.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flow-rules__rail-footer">
        <button
          type="button"
          className={`btn btn--sm${confirming ? " btn--danger" : " btn--ghost"}`}
          onClick={onClear}
          disabled={!hasRules || clearing}
          aria-busy={clearing || undefined}
        >
          {clearing ? "Clearing…" : confirming ? `Confirm: clear ${rulesSize}` : "Clear all rules"}
        </button>
      </div>
    </div>
  );
}
