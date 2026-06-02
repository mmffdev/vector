"use client";

// DataContainer — Layer 1. The dumb frame. It is ONLY a title panel (the
// page-level identity) + a zero-padding viewport. It knows nothing about
// trees, columns, fetching, or forms.
//
// It takes its OWN title / description props directly — nothing passes
// THROUGH it. The content (a tree, a board, …) is plain children rendered in
// the viewport, and that content wires its OWN identity (e.g. Grid__Tree's
// title band) independently. The old setHeader render-prop — where content
// pushed header strings UP into the frame — is gone: the frame is a container,
// not a header bus.

export interface DataContainerProps {
  /** Page-level title shown in the frame's title panel. */
  title?: string;
  /** Page-level description shown under the title. */
  description?: string;
  /** The content rendered in the zero-padding viewport. */
  children: React.ReactNode;
  className?: string;
}

export function DataContainer({
  title,
  description,
  children,
  className,
}: DataContainerProps) {
  const hasTitle = title != null || description != null;

  return (
    <div className={className ? `data-container ${className}` : "data-container"}>
      {hasTitle && (
        <div className="data-container__TitlePanel">
          {title != null && (
            <h2 className="data-container__Title">{title}</h2>
          )}
          {description != null && (
            <p className="data-container__Description">{description}</p>
          )}
        </div>
      )}
      <div className="data-container__Viewport">{children}</div>
    </div>
  );
}
