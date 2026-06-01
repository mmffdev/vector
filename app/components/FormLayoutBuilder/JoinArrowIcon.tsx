// JoinArrowIcon — the custom merge handle glyph: a vertical double-headed
// arrow (two arrowheads pointing apart) with a notch at each side of the
// middle, gold fill + dark outline. Used on the seam join buttons. Rotate the
// element 90° for the horizontal (merge-right) variant.
//
// viewBox 0 0 24 21, drawn symmetric about both axes. The path traces:
//   top point → upper-right shoulder → notch in → notch out (mid-right) →
//   lower-right shoulder → bottom point → mirror back up the left side.
//
// The SHAFT (central column between the heads) is 7px (y=7→14; Rick, 2026-06-01:
// +4px from the prior 3px). The ARROWHEADS are 5px each, point pulled toward the
// shoulder; both heads identical. The rendered glyph is +8px bigger overall (see
// .flb-seam__Glyph in globals.css).
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
      viewBox="0 0 24 21"
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
          L15 14
          L21 14
          L12 19
          L3 14
          L9 14
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
