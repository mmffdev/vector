"use client";

// PLA-0006 / 00274 — DiagramCanvas Controls.
//
// Three button group: zoom-in, zoom-out, fitView. d3-zoom (00275) will
// take over the actual zoom behaviour; for Phase 1 / 00274 we expose
// the imperative handle methods so consumers can wire things up.

interface ControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

export default function Controls({ onZoomIn, onZoomOut, onFit }: ControlsProps) {
  return (
    <div className="diagram-canvas__controls" role="group" aria-label="Diagram controls">
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm diagram-canvas__control-btn"
        aria-label="Zoom in"
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm diagram-canvas__control-btn"
        aria-label="Zoom out"
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm diagram-canvas__control-btn"
        aria-label="Fit to view"
        onClick={onFit}
      >
        ⤢
      </button>
    </div>
  );
}
