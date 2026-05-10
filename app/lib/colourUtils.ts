// Colour accessibility utilities — WCAG 2.1 relative luminance + safe ink.

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const lA = relativeLuminance(a);
  const lB = relativeLuminance(b);
  const [lo, hi] = lA < lB ? [lA, lB] : [lB, lA];
  return (hi + 0.05) / (lo + 0.05);
}

// Returns "#ffffff" or "#000000" — whichever has higher contrast against bg.
export function safeInk(bg: string): "#ffffff" | "#000000" {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#000000")
    ? "#ffffff"
    : "#000000";
}

export type TypeColourMap = Map<string, { colour: string; name: string }>;
