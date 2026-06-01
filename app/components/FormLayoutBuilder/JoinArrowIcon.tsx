// JoinArrowIcon — the custom merge handle glyph: a vertical double-headed
// arrow (two arrowheads pointing apart) with a notch at each side of the
// middle, gold fill + dark outline. Used on the seam join buttons. Rotate the
// element 90° for the horizontal (merge-right) variant.
//
// viewBox 0 0 24 17, drawn symmetric about both axes. The path traces:
//   top point → upper-right shoulder → notch in → notch out (mid-right) →
//   lower-right shoulder → bottom point → mirror back up the left side.
//
// The SHAFT (central column between the heads) is 3px (y=7→10). The ARROWHEADS
// were SHORTENED to 5px each (Rick, 2026-06-01: head −4px from the prior 9px) —
// the point pulled toward the shoulder, shoulders unchanged. Both heads identical.
// The rendered glyph is also +8px bigger overall (see .flb-seam__Glyph in
// globals.css).
//
// COLOUR is CSS-driven (Rick, 2026-06-01) so the glyph has two modes:
//   • NORMAL — quiet: 1px panel-border (#C8C3BB) outline, sandy site-bg
//     (--surface-sunken #EDEAE4) fill. The defaults in the var() fallbacks.
//   • DEBUG — bright gold (#FFCC33) / near-black (#1c1c22), via .flb-debug-poles
//     overriding --flb-arrow-fill / --flb-arrow-stroke / --flb-arrow-stroke-w in
//     globals.css.
import React from "react";

export function JoinArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 17"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="
          M12 2
          L21 7
          L15 7
          L15 10
          L21 10
          L12 15
          L3 10
          L9 10
          L9 7
          L3 7
          Z
        "
        fill="var(--flb-arrow-fill, #EDEAE4)"
        stroke="var(--flb-arrow-stroke, #C8C3BB)"
        strokeWidth="var(--flb-arrow-stroke-w, 1)"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
