"use client";

// DataContainer — Layer 1. The dumb frame, renamed from the old <DataGrid>.
// It is ONLY a header band + a zero-padding empty viewport. It knows nothing
// about trees, columns, fetching, or forms.
//
// The four header strings (title / description / subtitle / subDescription)
// are pushed UP into the band by the content, via a render-prop: the child is
// a function that receives `setHeader` and calls it (typically from an effect)
// once it knows what to show. This keeps the frame reusable across every page
// assembler (GridExecution today; GridStrategic / GridRisk / … later) — the
// frame is identical, only the content differs.

import { useState, useCallback } from "react";

export interface DataContainerHeader {
  title?: string;
  description?: string;
  subtitle?: string;
  subDescription?: string;
}

export interface DataContainerProps {
  /** Content render-prop. Receives setHeader; calls it to fill the band. */
  children: (setHeader: (h: DataContainerHeader) => void) => React.ReactNode;
  className?: string;
}

export function DataContainer({ children, className }: DataContainerProps) {
  const [header, setHeaderState] = useState<DataContainerHeader>({});

  // Stable identity so a child can list it in an effect dep array without
  // re-firing every render.
  const setHeader = useCallback((h: DataContainerHeader) => {
    setHeaderState(h);
  }, []);

  const hasHeader =
    header.title != null ||
    header.description != null ||
    header.subtitle != null ||
    header.subDescription != null;

  return (
    <div className={className ? `data-container ${className}` : "data-container"}>
      {hasHeader && (
        <div className="data-container__Header">
          {header.title != null && (
            <h2 className="data-container__Title">{header.title}</h2>
          )}
          {header.description != null && (
            <p className="data-container__Description">{header.description}</p>
          )}
          {header.subtitle != null && (
            <p className="data-container__SubTitle">{header.subtitle}</p>
          )}
          {header.subDescription != null && (
            <p className="data-container__SubDescription">
              {header.subDescription}
            </p>
          )}
        </div>
      )}
      <div className="data-container__Viewport">{children(setHeader)}</div>
    </div>
  );
}
