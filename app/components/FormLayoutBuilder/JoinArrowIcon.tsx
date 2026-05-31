// JoinArrowIcon — the custom merge handle glyph: a vertical double-headed
// arrow (two arrowheads pointing apart) with a notch at each side of the
// middle, gold fill + dark outline. Used on the seam join buttons. Rotate the
// element 90° for the horizontal (merge-right) variant.
//
// viewBox 0 0 24 24, drawn symmetric about both axes. The path traces:
//   top point → upper-right shoulder → notch in → notch out (mid-right) →
//   lower-right shoulder → bottom point → mirror back up the left side.
import React from "react";

export function JoinArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 30"
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
          L15 19
          L21 19
          L12 28
          L3 19
          L9 19
          L9 11
          L3 11
          Z
        "
        fill="#FFCC33"
        stroke="#1c1c22"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
