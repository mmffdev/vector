// Decorative striped square — a barber-pole block (-45°, --ink / --canvas at
// 5px pitch) used as a visual prefix beside a section/page title. Pure
// presentation, no semantics → aria-hidden. Originated as the inline
// .grid__Tree_Title_Badge in Grid__Tree; extracted so the shell header and
// the /scope grid share one shape.

interface PrefixBlockStripesProps {
  /** Square edge length in px. Default 32 (the original grid-badge size). */
  size?: number;
  /** Extra class for call-site layout hooks. */
  className?: string;
}

export default function PrefixBlockStripes({
  size = 32,
  className,
}: PrefixBlockStripesProps) {
  return (
    <span
      className={`prefix-block-stripes${className ? ` ${className}` : ""}`}
      style={
        {
          ["--prefix-block-size" as string]: `${size}px`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    />
  );
}
