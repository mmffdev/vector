// JoinArrowIcon — the custom merge handle glyph: a vertical double-headed
// arrow (two arrowheads pointing apart) with a notch at each side of the
// middle, gold fill + dark outline. Used on the seam join buttons. Rotate the
// element 90° for the horizontal (merge-right) variant.
//
// viewBox 0 0 24 45, drawn symmetric about both axes. The path traces:
//   top point → upper-right shoulder → notch in → notch out (mid-right) →
//   lower-right shoulder → bottom point → mirror back up the left side.
//
// The SHAFT (the central column between the two arrowheads) is lengthened by
// 15px vs the original — the heads are unchanged in size, just pushed apart at
// each end. Shaft now spans y=11→34 (23px) inside a 0→45 viewBox; arrowhead
// geometry (point↔shoulder spread) is identical top and bottom. The rendered
// glyph is also +6px wider (see .flb-seam__Glyph in globals.css).
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
      viewBox="0 0 24 45"
      width="100%"
      height="100%"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="
          M12 2
          L21 11
          L15 11
          L15 34
          L21 34
          L12 43
          L3 34
          L9 34
          L9 11
          L3 11
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
