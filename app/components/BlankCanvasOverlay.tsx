"use client";

// <BlankCanvasOverlay> — page-shell overlay scaffold, no content.
//
// Copies ArtefactTree's expanded-overlay pattern (measured
// .rd-shell__main-body rect, fixed overlay, Esc-to-close, close-button
// toolbar) but leaves the body empty. The sentinel script being built
// in the background will fill this canvas later; until then this is the
// container.

import { useEffect, useLayoutEffect, useState } from "react";
import { MdClose } from "react-icons/md";

export interface BlankCanvasOverlayProps {
  onRequestClose: () => void;
}

export default function BlankCanvasOverlay({ onRequestClose }: BlankCanvasOverlayProps) {
  const [shellRect, setShellRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const el = document.querySelector(".rd-shell__main-body") as HTMLElement | null;
      setShellRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onRequestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onRequestClose]);

  const style: React.CSSProperties = shellRect
    ? {
        top: shellRect.top,
        left: shellRect.left,
        width: shellRect.width,
        height: shellRect.height,
      }
    : { inset: 0 };

  return (
    <div
      className="artefact-tree__Overlay"
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label="Canvas (expanded)"
    >
      <div className="artefact-tree artefact-tree--expanded">
        <div className="artefact-tree__Toolbar">
          <button
            type="button"
            className="artefact-tree__Toolbar_Btn"
            onClick={onRequestClose}
            aria-label="Close canvas"
          >
            <MdClose size={16} />
          </button>
        </div>
        <div className="artefact-tree__Body" />
      </div>
    </div>
  );
}
