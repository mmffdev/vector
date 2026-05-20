"use client";

import React from "react";
import { safeInk } from "@/app/lib/colourUtils";
import { type WorkItemFlowState } from "./useWorkItemFlowStates";

export function FlowStatePillRow({
  currentId,
  currentCode,
  states,
  onCommit,
  // When true, the pill row is rendered locked: pills are non-
  // interactive (no onClick, cursor:default, aria-disabled) and the
  // group carries a tooltip explaining the derivation. Used by
  // execution-zone artefacts that have children — their flow state is
  // derived from the children (work flows up), so manual edits are
  // rejected backend-side too (ErrParentFlowStateDerived → 409).
  derived = false,
}: {
  currentId: string;
  currentCode: string;
  states: WorkItemFlowState[];
  onCommit: (id: string) => void;
  derived?: boolean;
}) {
  if (states.length === 0) return null;

  return (
    <span
      className={"wi-flow-row" + (derived ? " wi-flow-row--derived" : "")}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      title={derived ? "Derived from children — change a child's state to update this row" : undefined}
    >
      {states.map((s) => {
        const isActive = s.id === currentId;
        // Use the current item's canonical_code for the active segment so the
        // colour reflects the actual state even when tenant has renamed it.
        const code = isActive ? currentCode : s.canonical_code;
        // Tenant-set per-state colour takes precedence over the canonical-
        // code palette. When non-null we inline the swatch as background;
        // when null we fall back to the legacy --active-<code> class so
        // system flows keep their semantic colour palette.
        const hex = s.colour ?? null;
        // Canonical-code colour class is applied in BOTH states for
        // no-hex pills:
        //   - inactive → --code-<code> sets border colour
        //   - active   → --active-<code> sets bg + border
        // Hex pills bypass these and use the inline style instead.
        const codeClass = hex ? "" : " wi-flow-row__btn--code-" + code;
        const className =
          "wi-flow-row__btn" +
          codeClass +
          (isActive
            ? " wi-flow-row__btn--active" + (hex ? "" : " wi-flow-row__btn--active-" + code)
            : "");
        // Chevron pills use a layered fill: the button itself paints
        // the border colour (chevron outline) and ::before paints the
        // fill colour 1px inset on every side, leaving a 1px outline.
        // Three CSS custom properties feed both layers — set once here,
        // consumed by the .wi-flow-row__btn rules. Hex states override
        // the canonical colour; no-hex states inherit from the
        // .wi-flow-row__btn--code-<code> classes (which set the
        // same custom properties).
        //
        //   --pill-border : chevron outline colour (always the state's hue)
        //   --pill-fill   : interior colour (white when inactive, hue when active)
        //   --pill-text   : letter colour
        const style: React.CSSProperties | undefined = hex
          ? ({
              "--pill-border": hex,
              "--pill-fill": isActive ? hex : "#fff",
              "--pill-text": isActive ? safeInk(hex) : "#000",
            } as React.CSSProperties)
          : undefined;
        return (
          <button
            key={s.id}
            type="button"
            className={className}
            style={style}
            aria-pressed={isActive}
            aria-disabled={derived || isActive ? true : undefined}
            aria-label={s.name}
            title={s.name}
            // Derived rows can't be edited (cascade owns the state) —
            // drop the handler so the click does nothing AND the cursor
            // doesn't read as actionable.
            onClick={derived || isActive ? undefined : () => onCommit(s.id)}
          >
            {/* Letter is wrapped so it can sit ABOVE the ::before fill
                layer. Without this it renders as a bare text node which
                can't carry a z-index, and the chevron's interior paints
                over it. */}
            <span className="wi-flow-row__btn_Label">{s.name[0]}</span>
          </button>
        );
      })}
    </span>
  );
}
